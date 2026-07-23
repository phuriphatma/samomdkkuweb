-- ============================================================
-- 0068 — VitalSound duplicate management (Phase 1, staff-side only)
--
-- Goal: let SE spot & collapse duplicate reports without changing the
-- existing SE↔VP routing workflow. This is PURELY ADDITIVE:
--   * a nullable `duplicate_of` self-FK marks a ticket as a duplicate of
--     a canonical ticket (GitHub "duplicate of #X" model). The canonical
--     keeps its normal status/dept/transfer lifecycle untouched.
--   * find_similar_vs_tickets() powers the "ตั๋วที่คล้ายกัน" panel in the
--     staff modal (trigram similarity on the problem text, same-dept first).
--   * merge / unmerge RPCs (staff-only, fail-closed — same pattern as the
--     soft_delete_vs_ticket guard in 0043/0045).
--   * when a CANONICAL is resolved (เสร็จสิ้น), its duplicates auto-close
--     with a remark, so every reporter sees resolution when they track
--     their own id. Nothing reroutes; SE↔VP flow is unchanged.
--
-- No public exposure here — everything is staff-gated. Public board is a
-- later phase.
-- ============================================================

create extension if not exists pg_trgm with schema extensions;

alter table public.vs_tickets
  add column if not exists duplicate_of text references public.vs_tickets(id) on delete set null;

comment on column public.vs_tickets.duplicate_of is
  'If set, this ticket is a duplicate of the referenced canonical ticket (migration 0068). Canonical tickets have this NULL.';

create index if not exists vs_tickets_duplicate_of_idx
  on public.vs_tickets (duplicate_of) where duplicate_of is not null;

-- ------------------------------------------------------------
-- Authorization helper predicate, inlined in each RPC below:
--   staff = vs_staff | dev | has-permission('vs') | vp_admin
-- Fails CLOSED on a NULL role (no public.users row / service role) — see
-- mistakes.md "null in (...) fails open".
-- ------------------------------------------------------------

-- find_similar_vs_tickets — top-N canonical tickets similar to p_id.
-- Only canonicals (duplicate_of is null) are returned, since you merge a
-- ticket INTO a canonical. Same-dept matches rank first, then similarity.
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
    and similarity(regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), v_problem) > 0.08
  -- Order by the explicit expression, NOT the OUT-param name `sim` (which a
  -- RETURNS TABLE function resolves to the null PL/pgSQL variable → no sort).
  order by (t.target_dept = v_dept) desc,
           similarity(regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), v_problem) desc
  limit greatest(least(coalesce(p_limit, 6), 20), 1);
end;
$$;

revoke all on function public.find_similar_vs_tickets(text, integer) from public, anon;
grant execute on function public.find_similar_vs_tickets(text, integer) to authenticated;

-- merge_vs_tickets — mark p_dup as a duplicate of p_canonical.
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

  -- Redirect to root if the chosen canonical is itself a duplicate (no chains).
  if v_can.duplicate_of is not null then
    p_canonical := v_can.duplicate_of;
    if p_canonical = p_dup then
      raise exception 'การรวมนี้จะทำให้เกิดวงจร' using errcode = 'P0001';
    end if;
  end if;

  -- A ticket that already has its own duplicates can't become a duplicate.
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

  -- If the canonical is already resolved, close the new duplicate immediately.
  if v_can.status = 'เสร็จสิ้น' and v_dup.status <> 'เสร็จสิ้น' then
    update public.vs_tickets set status = 'เสร็จสิ้น' where id = p_dup;
  end if;
end;
$$;

revoke all on function public.merge_vs_tickets(text, text) from public, anon;
grant execute on function public.merge_vs_tickets(text, text) to authenticated;

-- unmerge_vs_ticket — detach a duplicate back to a standalone ticket.
create or replace function public.unmerge_vs_ticket(p_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role();
  v_time text := to_char(now() at time zone 'Asia/Bangkok', 'DD/MM, HH24:MI');
begin
  if v_role is null or not (
       v_role in ('vs_staff', 'dev')
       or public.current_user_has_permission('vs')
       or v_role = 'vp_admin'
     ) then
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

-- Auto-close duplicates when their canonical is resolved. SECURITY DEFINER
-- so it can close duplicates in any department (bypasses RLS); depth guard
-- prevents any nested re-fire. Does nothing for tickets with no duplicates,
-- so the normal SE↔VP status flow is unaffected.
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
           remarks = coalesce(remarks, '[]'::jsonb) || jsonb_build_object(
             'type', 'log', 'by', 'ระบบ',
             'time', to_char(now() at time zone 'Asia/Bangkok', 'DD/MM, HH24:MI'),
             'text', 'ปิดอัตโนมัติ: รวมกับ ' || new.id || ' ซึ่งดำเนินการเสร็จสิ้นแล้ว')
     where duplicate_of = new.id and deleted_at is null and status <> 'เสร็จสิ้น';
  end if;
  return new;
end;
$$;

drop trigger if exists vs_cascade_resolve_trg on public.vs_tickets;
create trigger vs_cascade_resolve_trg
  after update of status on public.vs_tickets
  for each row execute function public.vs_cascade_resolve();
