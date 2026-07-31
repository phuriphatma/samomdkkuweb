-- ============================================================
-- 0107 — vs_transfer_dept(): move a VitalSound ticket to another ฝ่าย
--        through a SECURITY DEFINER RPC instead of a raw PATCH.
--
-- THE BUG THIS FIXES
-- ------------------
-- A dept-scoped handler (a vp_admin, or a SAMO Team grantee carrying
-- users.managed_vs_depts — 0082/0083) selecting "โอนคืน SE" in the VS staff
-- modal got:
--
--   บันทึกไม่สำเร็จ: {"code":"42501", ...
--     "message":"new row violates row-level security policy for table \"vs_tickets\""}
--
-- and the transfer never happened. Reproduced live in a rolled-back
-- transaction as samomdkkuquality (vp_admin, อุปนายกฝ่ายคุณภาพชีวิตฯ):
--
--   update vs_tickets set target_dept = 'SE'   where id = <own dept ticket>
--     -> ERROR 42501 new row violates row-level security policy
--   update vs_tickets set remarks     = remarks -> rows=1   (writes are fine)
--   update vs_tickets set target_dept = target_dept -> rows=1
--
-- WHY — and why it is NOT the UPDATE policy
-- -----------------------------------------
-- vs_tickets_update_staff's WITH CHECK (0082) explicitly permits SE:
--
--   ... or (current_user_role() = 'vp_admin'
--           and target_dept = any(array[current_user_dept(), 'SE']))
--   ... or (target_dept = 'SE' and <caller has any managed_vs_depts>)
--
-- and it evaluates TRUE for this write. Proven three ways: evaluating the
-- expression pulled straight out of pg_policy returned true; a probe wired
-- into the policy as `(<orig>) or _dbg_raise(...)` never fired for 'SE'
-- (while firing correctly for a genuinely-forbidden other-dept value); and
-- rewriting the policy to `with check (true)`, with every user trigger
-- disabled, STILL produced the same 42501.
--
-- The failing check is vs_tickets_READ. Postgres re-applies the SELECT
-- policy to the NEW row on UPDATE, and reports it with the same wording as a
-- WITH CHECK failure — the exact trap already logged in mistakes.md for
-- `INSERT ... RETURNING` (0032-era project_notifications), in its UPDATE
-- flavour. Confirmed: widening only vs_tickets_read to `using (true)`, with
-- both UPDATE policies left untouched at their real definitions, makes the
-- very same statement return rows=1.
--
-- The read policy scopes a handler to their own ฝ่าย:
--
--   ... or (current_user_role() = 'vp_admin' and target_dept = current_user_dept())
--   ... or (target_dept = any(current_user_vs_depts()))
--
-- so the instant target_dept becomes 'SE' the row leaves the writer's own
-- visibility — which is CORRECT (you handed the ticket off; you should not
-- keep reading it) and must not be relaxed. A handoff is therefore
-- structurally un-expressible as a client-side PATCH: any UPDATE whose whole
-- purpose is to move a row out of your scope cannot satisfy a SELECT policy
-- keyed on that scope.
--
-- THE FIX
-- -------
-- Route the dept move through a SECURITY DEFINER RPC, which bypasses RLS and
-- re-applies the same predicate the UPDATE policy encodes — the established
-- pattern in this repo (soft_delete_vs_ticket 0043/0045, vs_set_public 0072,
-- merge_vs_tickets 0083). RLS on vs_tickets is unchanged; nothing else gains
-- any new read.
--
-- Authorization mirrors vs_tickets_update_staff exactly:
--   * not a VS handler                    -> refused
--   * unrestricted scope (NULL: vs_staff / dev / full `vs`) -> any dept
--   * scoped: the ticket's CURRENT dept must be in scope, and the
--     DESTINATION must be in scope or 'SE' — never straight to another
--     อุปนายก (0082's rule; the client warns about this first).
--
-- Fail-closed notes (mistakes.md "null in (...) fails OPEN"):
--   * `current_user_is_vs_handler()` is checked first, so a `{}` scope (no VS
--     access at all) is rejected before any dept comparison runs.
--   * p_dept is explicitly null/blank-checked BEFORE the `any(v_scope)`
--     tests, because `null = any(...)` is NULL, and `if not (NULL) then` does
--     NOT take the branch — a null destination would have sailed past the
--     guard and blanked target_dept.
--   * returns text (the new dept), NOT `public.vs_tickets` — a
--     `returns setof <table>` RPC auto-exposes every column a future
--     migration adds (0079/0080).
--
-- p_remarks carries the complete new remarks array so the timeline entry
-- ("โอนย้ายฝ่าย: X → Y") and the move land in ONE statement. The client
-- writes every other field first, with that entry withheld, so a refused
-- transfer can never leave a timeline claiming a move that did not happen.
-- ============================================================

create or replace function public.vs_transfer_dept(
  p_id      text,
  p_dept    text,
  p_remarks jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text[] := public.current_user_vs_scope();
  v_cur   text;
begin
  if not public.current_user_is_vs_handler() then
    raise exception 'vs_transfer_dept: not authorized' using errcode = '42501';
  end if;

  -- Null/blank destination must fail BEFORE the scope comparisons below.
  if p_dept is null or btrim(p_dept) = '' then
    raise exception 'vs_transfer_dept: destination department is required'
      using errcode = '22023';
  end if;

  select target_dept into v_cur
    from public.vs_tickets
   where id = p_id and deleted_at is null;

  if v_cur is null then
    raise exception 'vs_transfer_dept: ticket % not found', p_id
      using errcode = 'P0002';
  end if;

  -- NULL scope = unrestricted (vs_staff / dev / full `vs`). Anything else is
  -- a per-ฝ่าย handler and must stay inside 0082's rule.
  if v_scope is not null then
    if not (v_cur = any (v_scope)) then
      raise exception 'vs_transfer_dept: ticket is outside your department scope'
        using errcode = '42501';
    end if;
    if not (p_dept = any (v_scope) or p_dept = 'SE') then
      raise exception 'vs_transfer_dept: may only transfer within your own department(s) or back to SE'
        using errcode = '42501';
    end if;
  end if;

  update public.vs_tickets
     set target_dept = p_dept,
         remarks     = coalesce(p_remarks, remarks)
   where id = p_id;

  return p_dept;
end;
$$;

comment on function public.vs_transfer_dept(text, text, jsonb) is
  '0107 — move a VS ticket to another ฝ่าย. Exists because the write is '
  'un-PATCHable: vs_tickets_read scopes a handler to their own target_dept, '
  'and Postgres re-applies the SELECT policy to the NEW row on UPDATE, so a '
  'handoff (โอนคืน SE) always 42501s even though vs_tickets_update_staff''s '
  'WITH CHECK permits it. Re-applies that same WITH CHECK predicate here.';

revoke all on function public.vs_transfer_dept(text, text, jsonb) from public, anon;
grant execute on function public.vs_transfer_dept(text, text, jsonb) to authenticated;
