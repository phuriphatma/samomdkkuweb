-- ============================================================
-- 0071 — VS dedup: keep the duplicate cross-reference STAFF-INTERNAL
--
-- GitHub closes a duplicate and cross-links "duplicate of #A". That's safe
-- only because a repo has uniform visibility. VS does NOT: any guest with a
-- ticket id can read that ticket (get_vs_ticket_by_id, 0021, is a SECURITY
-- DEFINER lookup granted to anon). So embedding the canonical's id in the
-- duplicate's submitter-visible data leaks it — B's submitter could read the
-- canonical id and look up A, exposing ANOTHER student's confidential
-- complaint (and symmetrically A's submitter could reach B).
--
-- Fix — the cross-reference is INTERNAL (staff-only), the submitter sees a
-- generic resolution:
--   * dedup remarks that name another ticket's id are tagged `internal:true`.
--   * the guest lookup get_vs_ticket_by_id() now SANITIZES its row: nulls
--     `duplicate_of` and strips `internal` remarks. Staff read the raw table
--     (dashboard fetch) so they still see everything.
--   * when a duplicate auto-closes, the submitter gets a generic
--     "ดำเนินการและปิดแล้ว" remark (no id); staff get the internal linked one.
--
-- (No data backfill: 0 existing tickets have duplicate_of / dedup remarks.)
-- ============================================================

-- Guest lookup: sanitize the returned row (null the link, drop internal remarks).
create or replace function public.get_vs_ticket_by_id(p_id text)
returns setof public.vs_tickets
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r public.vs_tickets;
begin
  select * into r from public.vs_tickets where id = p_id and deleted_at is null limit 1;
  if not found then return; end if;
  r.duplicate_of := null;
  r.remarks := (
    select coalesce(jsonb_agg(e), '[]'::jsonb)
    from jsonb_array_elements(coalesce(r.remarks, '[]'::jsonb)) e
    where coalesce((e ->> 'internal')::boolean, false) = false
  );
  return next r;
end;
$$;

grant execute on function public.get_vs_ticket_by_id(text) to anon, authenticated;

-- merge: tag the id-bearing remarks internal.
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

  select target_dept into v_can_dept from public.vs_tickets where id = p_canonical;

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

  update public.vs_tickets
     set duplicate_of = p_canonical,
         remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_object(
           'type', 'log', 'by', 'ระบบ', 'time', v_time, 'internal', true,
           'text', 'รวมเป็นเรื่องซ้ำของ ' || p_canonical)
   where id = p_dup;

  update public.vs_tickets
     set remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_object(
           'type', 'log', 'by', 'ระบบ', 'time', v_time, 'internal', true,
           'text', 'รับเรื่องซ้ำ ' || p_dup || ' เข้ามารวม')
   where id = p_canonical;

  -- Merging into an already-resolved canonical closes the dup now, with a
  -- generic (submitter-visible) close message.
  if (select status from public.vs_tickets where id = p_canonical) = 'เสร็จสิ้น'
     and v_dup.status <> 'เสร็จสิ้น' then
    update public.vs_tickets
       set status = 'เสร็จสิ้น',
           remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_object(
             'type', 'log', 'by', 'ระบบ', 'time', v_time,
             'text', 'เรื่องนี้ได้รับการดำเนินการและปิดเรียบร้อยแล้ว')
     where id = p_dup;
  end if;
end;
$$;

revoke all on function public.merge_vs_tickets(text, text) from public, anon;
grant execute on function public.merge_vs_tickets(text, text) to authenticated;

-- unmerge: internal-only note.
create or replace function public.unmerge_vs_ticket(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_dept text;
  v_time text := to_char(now() at time zone 'Asia/Bangkok', 'DD/MM, HH24:MI');
begin
  if v_role is null or not (
       v_role in ('vs_staff', 'dev')
       or public.current_user_has_permission('vs')
       or v_role = 'vp_admin'
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select target_dept into v_dept from public.vs_tickets where id = p_id and deleted_at is null;
  if v_role = 'vp_admin' and v_dept is distinct from public.current_user_dept() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.vs_tickets
     set duplicate_of = null,
         remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_object(
           'type', 'log', 'by', 'ระบบ', 'time', v_time, 'internal', true,
           'text', 'แยกออกจากการรวมเรื่องซ้ำ')
   where id = p_id and duplicate_of is not null and deleted_at is null;
end;
$$;

revoke all on function public.unmerge_vs_ticket(text) from public, anon;
grant execute on function public.unmerge_vs_ticket(text) to authenticated;

-- cascade: internal linked remark (staff) + generic close remark (submitter).
create or replace function public.vs_cascade_resolve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  if new.status is distinct from old.status and new.status = 'เสร็จสิ้น' then
    update public.vs_tickets
       set status = 'เสร็จสิ้น',
           remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_array(
             jsonb_build_object('type', 'log', 'by', 'ระบบ',
               'time', to_char(now() at time zone 'Asia/Bangkok', 'DD/MM, HH24:MI'),
               'internal', true, 'text', 'ปิดอัตโนมัติจากการรวมกับ ' || new.id),
             jsonb_build_object('type', 'log', 'by', 'ระบบ',
               'time', to_char(now() at time zone 'Asia/Bangkok', 'DD/MM, HH24:MI'),
               'text', 'เรื่องนี้ได้รับการดำเนินการและปิดเรียบร้อยแล้ว'))
     where duplicate_of = new.id and deleted_at is null and status <> 'เสร็จสิ้น';
  end if;
  return new;
end;
$$;

drop trigger if exists vs_cascade_resolve_trg on public.vs_tickets;
create trigger vs_cascade_resolve_trg
  after update of status on public.vs_tickets
  for each row execute function public.vs_cascade_resolve();
