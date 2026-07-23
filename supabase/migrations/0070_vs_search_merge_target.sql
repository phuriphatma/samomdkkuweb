-- ============================================================
-- 0070 — VS dedup: search for a merge target (not just suggestions)
--
-- find_similar_vs_tickets (0068) auto-suggests the top matches. Staff also
-- want to SEARCH and pick any canonical ticket to merge into (e.g. they
-- know the exact เรื่องหลัก but the algorithm didn't rank it). This RPC
-- returns canonical (duplicate_of is null, non-deleted) tickets matching a
-- free-text query on the id or the stripped problem text.
--
-- Same guards as 0068/0069: staff-only, fail-closed on null role, and
-- vp_admin is re-scoped to their own department (definer bypasses RLS).
-- Empty query → most-recent canonicals (a browse fallback).
-- ============================================================

create or replace function public.search_vs_tickets(
  p_query text, p_exclude text default null, p_limit integer default 8)
returns table (
  id text, problem_snippet text, status text, target_dept text,
  is_emergency boolean, created_at timestamptz, dup_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_role text := public.current_user_role();
  v_q text := btrim(coalesce(p_query, ''));
begin
  if v_role is null or not (
       v_role in ('vs_staff', 'dev')
       or public.current_user_has_permission('vs')
       or v_role = 'vp_admin'
     ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select t.id,
         left(regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), 180),
         t.status, t.target_dept, t.is_emergency,
         coalesce(t.created_at, t.timestamp),
         (select count(*) from public.vs_tickets d
            where d.duplicate_of = t.id and d.deleted_at is null)
  from public.vs_tickets t
  where t.deleted_at is null
    and t.duplicate_of is null
    and (p_exclude is null or t.id <> p_exclude)
    -- confidentiality: vp_admin only within their own department.
    and (v_role <> 'vp_admin' or t.target_dept = public.current_user_dept())
    and (
      v_q = ''
      or t.id ilike '%' || v_q || '%'
      or regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g') ilike '%' || v_q || '%'
    )
  -- id matches first, then most recent.
  order by (v_q <> '' and t.id ilike '%' || v_q || '%') desc,
           coalesce(t.created_at, t.timestamp) desc
  limit greatest(least(coalesce(p_limit, 8), 25), 1);
end;
$$;

revoke all on function public.search_vs_tickets(text, text, integer) from public, anon;
grant execute on function public.search_vs_tickets(text, text, integer) to authenticated;
