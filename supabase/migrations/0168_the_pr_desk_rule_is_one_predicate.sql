-- ============================================================
-- 0168 — "may this caller work the PR desk?" becomes ONE named predicate
--
-- Not a bug fix. 0149 fixed a DRIFT between `pr_tickets_delete_staff` and
-- `soft_delete_pr_ticket` by correcting the copy; the copy survived, and
-- `docs/NEXT.md` §0d has carried "make it one implementation" ever since. This
-- is that, and opening the area turned up more than §0d knew:
--
--   the rule `current_user_role() in ('pr_staff','dev')
--             or current_user_has_permission('pr')`
--
-- was spelled FOUR times, not twice — `pr_tickets_read` (as its third branch),
-- `pr_tickets_update_staff`, `pr_tickets_delete_staff`, and the RPC. Naming the
-- extraction `..._can_delete_...` would have left three copies behind AND given
-- the shared predicate a name that lied about where it is used. So the
-- predicate is named for the DESK, and all four sites call it.
--
-- This is the shape the VS side has used since 0083: `current_user_vs_scope()`
-- is asked by the policy and by every RPC, so there is nothing to drift.
--
-- ── Behaviour is unchanged, and that is asserted, not assumed ───────────────
-- The extracted expression is character-for-character the live one (read from
-- `pg_policy.polqual`, not from the migration that first wrote it), with one
-- deliberate difference in the RPC:
--
--   the RPC's guard opened `if v_role is null or not (...)`, a 0045 fail-closed
--   guard. The POLICY has no such branch: for a caller with no `public.users`
--   row, `null in ('pr_staff','dev')` is NULL and `NULL or has_permission` is
--   NULL, which RLS reads as "no". The two therefore agree TODAY only because
--   no-users-row also means no permission (`current_user_has_permission` is an
--   `exists` over that same row) and `users.role` is NOT NULL with 0 null rows,
--   measured 2026-08-26. It was a latent divergence: a null role WITH the 'pr'
--   permission would have been allowed by the policy and refused by the RPC.
--   The predicate settles it once, in the policy's direction, with an explicit
--   `coalesce(..., false)` so the fail-closed intent of 0045 is kept as a
--   PROPERTY of the predicate rather than as a hand-written branch each caller
--   has to remember.
--
-- ── Guards ──────────────────────────────────────────────────────────────────
--   node tools/db-query.mjs tools/pr0149-delete-permission.sql
--     — §A/§B/§C already asked the policy and the RPC the same question about
--       three subjects. §D is new and STRUCTURAL: it fails if any of the four
--       sites stops calling the predicate, or starts spelling the rule again.
--   src/js/definer-authz.test.js
--     — extended to follow one level of helper calls, so extracting a role test
--       into a helper can no longer make a refuser invisible to that sweep.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The predicate. One home for the rule.
--
--    TRUE  = may read every PR ticket, edit one, and delete one
--    FALSE = no PR desk access by any channel (this includes "no users row")
--
--    `current_user_has_permission` already reads the UNION of `permissions`
--    and `managed_permissions` (0081) and answers yes to every key for a
--    `master` holder (0111) — so a ทีม SAMO node grant, a directly assigned
--    permission and master all resolve through that one call.
-- ------------------------------------------------------------
create or replace function public.current_user_can_manage_pr()
returns boolean language sql stable security definer set search_path = public as $$
  -- coalesce is load-bearing: with no public.users row `current_user_role()`
  -- is NULL, so the `in (...)` is NULL, and a NULL predicate must read as NO.
  select coalesce(
    public.current_user_role() in ('pr_staff', 'dev')
    or public.current_user_has_permission('pr'),
  false);
$$;

comment on function public.current_user_can_manage_pr() is
  'May the caller work the PR desk (read every ticket, edit one, delete one)? '
  'pr_staff/dev ROLE or the ''pr'' PERMISSION channel (permissions[] ∪ '
  'managed_permissions[], master answers yes). Fail-closed: NULL role => false. '
  'Asked by pr_tickets_read / _update_staff / _delete_staff and by '
  'soft_delete_pr_ticket — 0168 made those four one rule. Change it HERE.';

grant execute on function public.current_user_can_manage_pr() to anon, authenticated;

-- ------------------------------------------------------------
-- 2. The three policies. Same decision, one caller each.
--    The submitter branch on read stays — a guest tracking their own ticket is
--    a different channel and always was.
-- ------------------------------------------------------------
drop policy if exists "pr_tickets_read" on public.pr_tickets;
create policy "pr_tickets_read" on public.pr_tickets
  for select using (
    submitter_id = auth.uid()
    or public.current_user_can_manage_pr()
  );

drop policy if exists "pr_tickets_update_staff" on public.pr_tickets;
create policy "pr_tickets_update_staff" on public.pr_tickets
  for update using (public.current_user_can_manage_pr());

drop policy if exists "pr_tickets_delete_staff" on public.pr_tickets;
create policy "pr_tickets_delete_staff" on public.pr_tickets
  for delete using (public.current_user_can_manage_pr());

-- ------------------------------------------------------------
-- 3. The RPC. 0043 put the soft delete behind SECURITY DEFINER so it would not
--    inherit the broader UPDATE policy; that reason is unchanged. What changes
--    is that it no longer RESTATES the rule it is standing in for.
-- ------------------------------------------------------------
create or replace function public.soft_delete_pr_ticket(p_id text)
returns public.pr_tickets language plpgsql security definer set search_path = public as $$
declare r public.pr_tickets;
begin
  -- The SAME predicate pr_tickets_delete_staff asks. Not a copy of it.
  if not public.current_user_can_manage_pr() then
    raise exception 'not authorized to delete PR tickets' using errcode = '42501';
  end if;
  update public.pr_tickets set deleted_at = now()
    where id = p_id and deleted_at is null
    returning * into r;
  if not found then
    raise exception 'PR ticket not found or already deleted: %', p_id using errcode = 'P0002';
  end if;
  return r;
end $$;
