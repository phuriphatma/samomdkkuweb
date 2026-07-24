-- ============================================================
-- 0074 — VS duplicate = LINKED progress-mirror (not a dead-end close)
--
-- Problem: closing B as "duplicate" left B's submitter at a dead-end — our
-- confidential model (0071) deliberately hides the canonical A's id, so unlike
-- GitHub they cannot click through and follow the real issue. This makes a
-- duplicate a LINK that mirrors A's progress to B's submitter, IDENTITY-BLIND:
--   * B's `status` is kept in sync with A's status while linked, so B's
--     submitter sees the real 4-phase progress advance (the phase string never
--     reveals A's id/identity/content).
--   * when A resolves, B mirrors A's `resolution` (the generic outcome enum) —
--     B's submitter sees the actual outcome, not a bare "it was a duplicate".
--     A's free-text `resolution_note` is NEVER copied (could be A-specific).
--   * B's submitter NEVER receives A's id. A new generated column
--     `is_duplicate` lets the submitter UI say "your report is linked to an
--     earlier one" without exposing which — closing the existing hole where a
--     logged-in submitter's raw `select=*` read returned `duplicate_of` (0071
--     only sanitized the guest RPC, not the owner read).
--
-- Discussion: B's private staff thread stays OPEN (the app keeps the reply box
-- on a linked ticket). The mirror propagates ONLY status + resolution, never
-- remark text — so A's staff replies never leak into B. Cross-submitter
-- discussion happens only on the pseudonymous public board (0072), if published.
--
-- "duplicate" is dropped from the MANUAL close-reason picker in the app (it
-- orphaned B). The enum value stays in the CHECK for back-compat with any row
-- already closed that way before this migration.
-- ============================================================

-- 1) Non-identifying "is this a duplicate" flag for submitter-facing reads.
--    Generated from duplicate_of so it can never drift; STORED so PostgREST can
--    select it. The submitter read selects THIS instead of duplicate_of.
alter table public.vs_tickets
  add column if not exists is_duplicate boolean
  generated always as (duplicate_of is not null) stored;

-- 2) Propagate progress from a canonical to its linked duplicates.
--    Replaces the 0071 vs_cascade_resolve (which only closed dups on resolve)
--    with a general progress mirror. Fires on status OR resolution change.
create or replace function public.vs_cascade_resolve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_time text := to_char(now() at time zone 'Asia/Bangkok', 'DD/MM, HH24:MI');
begin
  -- Depth guard: our own UPDATE of a duplicate re-fires this trigger for that
  -- row (which has no duplicates of its own — merge forbids chains). Bail.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status is not distinct from old.status
     and new.resolution is not distinct from old.resolution then
    return new;  -- nothing progress-relevant changed
  end if;

  if new.status = 'เสร็จสิ้น' then
    -- Newly-closing duplicates: close them, mirror the outcome enum (NOT the
    -- note), add an internal linked log + a GENERIC submitter-visible close
    -- remark (no id). Matches the 0071 cascade wording.
    update public.vs_tickets
       set status = 'เสร็จสิ้น',
           resolution = new.resolution,
           resolution_note = null,
           remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_array(
             jsonb_build_object('type', 'log', 'by', 'ระบบ', 'time', v_time,
               'internal', true, 'text', 'ปิดอัตโนมัติจากการรวมกับ ' || new.id),
             jsonb_build_object('type', 'log', 'by', 'ระบบ', 'time', v_time,
               'text', 'เรื่องนี้ได้รับการดำเนินการและปิดเรียบร้อยแล้ว'))
     where duplicate_of = new.id and deleted_at is null and status <> 'เสร็จสิ้น';

    -- Already-closed duplicates: keep the mirrored resolution in sync if the
    -- staffer edited A's resolution after close (no remark, no re-close).
    update public.vs_tickets
       set resolution = new.resolution, resolution_note = null
     where duplicate_of = new.id and deleted_at is null and status = 'เสร็จสิ้น'
       and resolution is distinct from new.resolution;
  else
    -- In-progress: mirror A's status onto its still-open duplicates so B's
    -- submitter sees the phase advance. (Do not touch dups already closed.)
    update public.vs_tickets
       set status = new.status
     where duplicate_of = new.id and deleted_at is null
       and status is distinct from new.status and status <> 'เสร็จสิ้น';
  end if;

  return new;
end;
$$;

-- Re-bind the trigger to also fire on resolution edits (was status-only).
drop trigger if exists vs_cascade_resolve_trg on public.vs_tickets;
create trigger vs_cascade_resolve_trg
  after update of status, resolution on public.vs_tickets
  for each row execute function public.vs_cascade_resolve();

-- 3) merge_vs_tickets: on link, START the mirror immediately (B.status = A's
--    status) + add a GENERIC submitter-visible note so B's submitter
--    understands their report is being handled with an earlier one. Otherwise
--    identical to 0071 (dept scope, cycle guard, internal cross-ref remarks).
create or replace function public.merge_vs_tickets(p_dup text, p_canonical text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_dup public.vs_tickets;
  v_can public.vs_tickets;
  v_can_dept text;
  v_can_status text;
  v_children integer;
  v_time text := to_char(now() at time zone 'Asia/Bangkok', 'DD/MM, HH24:MI');
begin
  if v_role is null or not (
       v_role in ('vs_staff', 'dev')
       or public.current_user_has_permission('vs')
       or v_role = 'vp_admin'
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_dup = p_canonical then
    raise exception 'ไม่สามารถรวมเรื่องเข้ากับตัวเองได้' using errcode = 'P0001';
  end if;

  select * into v_dup from public.vs_tickets where id = p_dup and deleted_at is null;
  if not found then raise exception 'VS ticket not found: %', p_dup using errcode = 'P0002'; end if;
  select * into v_can from public.vs_tickets where id = p_canonical and deleted_at is null;
  if not found then raise exception 'VS ticket not found: %', p_canonical using errcode = 'P0002'; end if;

  if v_can.duplicate_of is not null then
    p_canonical := v_can.duplicate_of;
    if p_canonical = p_dup then
      raise exception 'การรวมนี้จะทำให้เกิดวงจร' using errcode = 'P0001';
    end if;
  end if;

  select target_dept, status into v_can_dept, v_can_status
    from public.vs_tickets where id = p_canonical;

  if v_role = 'vp_admin' and (
       v_dup.target_dept is distinct from public.current_user_dept()
       or v_can_dept is distinct from public.current_user_dept()
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select count(*) into v_children from public.vs_tickets
    where duplicate_of = p_dup and deleted_at is null;
  if v_children > 0 then
    raise exception 'เรื่องนี้มีเรื่องซ้ำรวมอยู่แล้ว กรุณาแยกออกก่อน' using errcode = 'P0001';
  end if;

  -- Link + start the progress mirror (B.status = A's current status) + a
  -- GENERIC submitter-visible note (no id) + the internal cross-ref log.
  update public.vs_tickets
     set duplicate_of = p_canonical,
         status = case when v_can_status <> 'เสร็จสิ้น' then v_can_status else status end,
         remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_array(
           jsonb_build_object('type', 'log', 'by', 'ระบบ', 'time', v_time, 'internal', true,
             'text', 'รวมเป็นเรื่องซ้ำของ ' || p_canonical),
           jsonb_build_object('type', 'log', 'by', 'ระบบ', 'time', v_time,
             'text', 'เรื่องของคุณตรงกับเรื่องที่มีผู้อื่นแจ้งไว้ก่อนแล้ว ทีมงานกำลังดำเนินการร่วมกัน'))
   where id = p_dup;

  update public.vs_tickets
     set remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_object(
           'type', 'log', 'by', 'ระบบ', 'time', v_time, 'internal', true,
           'text', 'รับเรื่องซ้ำ ' || p_dup || ' เข้ามารวม')
   where id = p_canonical;

  -- Merging into an already-resolved canonical closes the dup now, mirroring
  -- the canonical's outcome enum, with a generic (submitter-visible) message.
  if v_can_status = 'เสร็จสิ้น' and v_dup.status <> 'เสร็จสิ้น' then
    update public.vs_tickets
       set status = 'เสร็จสิ้น',
           resolution = (select resolution from public.vs_tickets where id = p_canonical),
           resolution_note = null,
           remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_object(
             'type', 'log', 'by', 'ระบบ', 'time', v_time,
             'text', 'เรื่องนี้ได้รับการดำเนินการและปิดเรียบร้อยแล้ว')
     where id = p_dup;
  end if;
end;
$$;

revoke all on function public.merge_vs_tickets(text, text) from public, anon;
grant execute on function public.merge_vs_tickets(text, text) to authenticated;

comment on column public.vs_tickets.is_duplicate is
  'Generated (duplicate_of is not null). Submitter-facing reads select THIS instead of duplicate_of so the linked-state is known without leaking the canonical id. See 0074.';
