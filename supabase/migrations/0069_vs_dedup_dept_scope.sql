-- ============================================================
-- 0069 — VS dedup: re-apply the dept scope for vp_admin (security fix)
--
-- The 0068 RPCs are SECURITY DEFINER (they must be, to compute similarity
-- and cascade across the table) — which BYPASSES the vs_tickets read RLS.
-- That RLS (0010) restricts a vp_admin to their OWN department's tickets:
--     vp_admin  →  target_dept = current_user_dept()
-- but 0068 authorized vp_admin and returned / merged canonicals from ANY
-- department, leaking other-dept complaint snippets to a VP and allowing
-- cross-dept merges. vs_staff/dev/has('vs') legitimately see all (their
-- RLS is unrestricted); only vp_admin must be re-scoped here.
--
-- Fix: re-implement the same dept predicate inside each definer RPC.
-- (Same class as the "RLS inline subqueries depend on the referenced
-- table's RLS" / "SELECT RLS is DEAD under a definer" notes in mistakes.md:
-- a SECURITY DEFINER helper over a row-scoped table must re-apply the scope.)
-- ============================================================

create or replace function public.find_similar_vs_tickets(p_id text, p_limit integer default 6)
returns table (
  id text, problem_snippet text, status text, target_dept text,
  is_emergency boolean, created_at timestamptz, dup_count bigint, sim real
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_role text := public.current_user_role();
  v_problem text;
  v_dept text;
begin
  if v_role is null or not (
       v_role in ('vs_staff', 'dev')
       or public.current_user_has_permission('vs')
       or v_role = 'vp_admin'
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), t.target_dept
    into v_problem, v_dept
  from public.vs_tickets t where t.id = p_id;
  if v_problem is null then
    raise exception 'VS ticket not found: %', p_id using errcode = 'P0002';
  end if;

  -- vp_admin may only work within their own department (matches vs_tickets RLS).
  if v_role = 'vp_admin' and v_dept is distinct from public.current_user_dept() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select t.id,
         left(regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), 180),
         t.status, t.target_dept, t.is_emergency,
         coalesce(t.created_at, t.timestamp),
         (select count(*) from public.vs_tickets d
            where d.duplicate_of = t.id and d.deleted_at is null),
         similarity(regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), v_problem)
  from public.vs_tickets t
  where t.id <> p_id
    and t.deleted_at is null
    and t.duplicate_of is null
    -- confidentiality: a vp_admin never sees other departments' snippets.
    and (v_role <> 'vp_admin' or t.target_dept = public.current_user_dept())
    and similarity(regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), v_problem) > 0.08
  order by (t.target_dept = v_dept) desc,
           similarity(regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), v_problem) desc
  limit greatest(least(coalesce(p_limit, 6), 20), 1);
end;
$$;

revoke all on function public.find_similar_vs_tickets(text, integer) from public, anon;
grant execute on function public.find_similar_vs_tickets(text, integer) to authenticated;


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

  -- vp_admin: both the duplicate AND the (root) canonical must be their dept.
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
           'type', 'log', 'by', 'ระบบ', 'time', v_time,
           'text', 'รวมเป็นเรื่องซ้ำของ ' || p_canonical)
   where id = p_dup;

  update public.vs_tickets
     set remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_object(
           'type', 'log', 'by', 'ระบบ', 'time', v_time,
           'text', 'รับเรื่องซ้ำ ' || p_dup || ' เข้ามารวม')
   where id = p_canonical;

  if (select status from public.vs_tickets where id = p_canonical) = 'เสร็จสิ้น'
     and v_dup.status <> 'เสร็จสิ้น' then
    update public.vs_tickets set status = 'เสร็จสิ้น' where id = p_dup;
  end if;
end;
$$;

revoke all on function public.merge_vs_tickets(text, text) from public, anon;
grant execute on function public.merge_vs_tickets(text, text) to authenticated;


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
           'type', 'log', 'by', 'ระบบ', 'time', v_time, 'text', 'แยกออกจากการรวมเรื่องซ้ำ')
   where id = p_id and duplicate_of is not null and deleted_at is null;
end;
$$;

revoke all on function public.unmerge_vs_ticket(text) from public, anon;
grant execute on function public.unmerge_vs_ticket(text) to authenticated;
