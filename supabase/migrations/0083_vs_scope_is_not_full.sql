-- ============================================================
-- 0083 — "scoped VitalSound" must NOT mean "full VitalSound"
--
-- BUG this fixes (reported live): a person granted VS through the SAMO Team
-- tree with a per-ฝ่าย binding (0082 `team_nodes.vs_dept`) logged in with
-- their kkumail and saw + managed EVERY department's tickets — not the one
-- dept they were bound to, unlike a real VP account (samomdkkuvpa).
--
-- Root cause: 0082 made the dept binding an ADDITIVE dimension sitting next
-- to the `vs` permission, and the perm modal offered both independently. The
-- admin naturally ticked "VitalSound" (to give VS access at all) AND picked a
-- dept. But `vs` in permissions[] means FULL VS — `current_user_has_permission
-- ('vs')` is an unconditional true branch in every VS policy, so it swallowed
-- the narrower `target_dept = any(current_user_vs_depts())` branch. Confirmed
-- on the live row: team_nodes "หัวหน้าฝ่าย IT" had permissions={vs} AND
-- vs_dept='อุปนายกฝ่ายวิชาการ' → managed_permissions={pr,vs} +
-- managed_vs_depts={อุปนายกฝ่ายวิชาการ} → full access.
--
-- New model — the scope is a PROPERTY OF THE VS GRANT, not a parallel one:
--   * `vs` in permissions[], no vs_dept  → full VS (ทุกฝ่าย) — SE / super.
--   * vs_dept set, `vs` NOT in permissions[] → VS scoped to that dept.
-- The UI now writes exactly one of these (the dept picker appears only after
-- VitalSound is ticked, and choosing a specific dept drops the `vs` perm).
-- Section 4 normalises the rows that predate that rule.
--
-- This migration also gives a scoped handler the REST of the VS workflow at
-- their own dept — the parity the report asks for ("like samomdkkuvpa"):
-- internal tags, dedup search/merge/unmerge, soft-delete, comment moderation.
-- Without this they could read + update tickets (0082) but every other staff
-- button threw "not authorized".
--
-- Also new: per-PERSON dept binding (`team_members.vs_dept`), so a single
-- person can be scoped without creating a node for them — matches the
-- per-person `permissions` channel added in 0081.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Per-person VS dept binding
-- ------------------------------------------------------------
alter table public.team_members
  add column if not exists vs_dept text;

comment on column public.team_members.vs_dept is
  'VitalSound department (vs_tickets.target_dept) THIS PERSON handles, '
  'independent of their node binding (0083). Unions with the node''s '
  'effective vs_dept when inherit_permissions is on. Server-resolved into '
  'users.managed_vs_depts.';

-- ------------------------------------------------------------
-- 2. Resolver — a member''s own vs_dept counts alongside the inherited ones
-- ------------------------------------------------------------
create or replace function public.effective_team_vs_depts_for_email(p_email text)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_out text[] := '{}';
  m     public.team_members%rowtype;
begin
  if p_email is null or length(btrim(p_email)) = 0 then
    return '{}';
  end if;
  for m in
    select * from public.team_members where lower(kkumail) = lower(btrim(p_email))
  loop
    -- own binding: always counts (an explicit per-person grant is not
    -- something the inherit toggle should be able to switch off).
    if m.vs_dept is not null and length(btrim(m.vs_dept)) > 0 then
      v_out := v_out || m.vs_dept;
    end if;
    if coalesce(m.inherit_permissions, true) then
      v_out := v_out || public.node_effective_vs_depts(m.node_id);
    end if;
  end loop;
  return (select coalesce(array_agg(distinct d), '{}') from unnest(v_out) as d);
end;
$$;

-- The live-recompute trigger must also fire on a member vs_dept change.
drop trigger if exists team_members_recompute_perms on public.team_members;
create trigger team_members_recompute_perms
  after insert or delete or update of permissions, inherit_permissions, node_id, kkumail, vs_dept
  on public.team_members
  for each statement execute function public.recompute_team_managed_permissions();

-- ------------------------------------------------------------
-- 3. current_user_vs_scope() — the one predicate every VS surface asks.
--
--    NULL       = unrestricted (vs_staff / dev / full `vs` permission)
--    '{}'       = NO VS access at all (fail closed)
--    {dept,...} = restricted to these target_depts
--
--    vp_admin contributes their users.department; a tree person contributes
--    users.managed_vs_depts; someone who is both gets the union.
-- ------------------------------------------------------------
create or replace function public.current_user_vs_scope()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_role() in ('vs_staff', 'dev')
      or public.current_user_has_permission('vs')
    then null::text[]
    else (
      select coalesce(array_agg(distinct d), '{}')
        from (
          select public.current_user_dept() as d
           where public.current_user_role() = 'vp_admin'
          union all
          select unnest(public.current_user_vs_depts())
        ) s
       where d is not null and length(btrim(d)) > 0
    )
  end
$$;

comment on function public.current_user_vs_scope() is
  'VS department scope of the caller: NULL = all depts (vs_staff/dev/perm vs), '
  '{} = no VS access, else the allowed target_depts (vp_admin dept ∪ '
  'managed_vs_depts). Fail-closed: never returns NULL for a non-super caller.';

grant execute on function public.current_user_vs_scope() to anon, authenticated;

-- ------------------------------------------------------------
-- 4. Normalise the rows written under the old (ambiguous) model:
--    a dept binding + the full `vs` perm on the SAME row now means scoped.
--    The recompute trigger fires on these updates and rewrites every
--    affected account's managed_permissions / managed_vs_depts.
-- ------------------------------------------------------------
update public.team_nodes
   set permissions = array_remove(permissions, 'vs')
 where vs_dept is not null
   and 'vs' = any (coalesce(permissions, '{}'));

update public.team_members
   set permissions = array_remove(permissions, 'vs')
 where vs_dept is not null
   and 'vs' = any (coalesce(permissions, '{}'));

-- ------------------------------------------------------------
-- 5. vs_tags — a scoped handler reads the vocabulary and manages their own
--    dept's list (same rule a vp_admin already had). Read stays authenticated-
--    only; the tags are internal but not per-dept-secret (the kanban facet
--    groups every dept's tags on the cross-dept view).
-- ------------------------------------------------------------
drop policy if exists vs_tags_read_staff on public.vs_tags;
create policy vs_tags_read_staff on public.vs_tags
  for select to authenticated
  using (
    public.current_user_is_staff()
    or cardinality(public.current_user_vs_depts()) > 0
  );

drop policy if exists vs_tags_write_scoped on public.vs_tags;
create policy vs_tags_write_scoped on public.vs_tags
  for all to authenticated
  using (
    public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
    or (public.current_user_role() = 'vp_admin' and dept = public.current_user_dept())
    or dept = any (public.current_user_vs_depts())
  )
  with check (
    public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
    or (public.current_user_role() = 'vp_admin' and dept = public.current_user_dept())
    or dept = any (public.current_user_vs_depts())
  );

comment on policy vs_tags_write_scoped on public.vs_tags is
  'A department manages its OWN tags: vp_admin by users.department, a tree-'
  'scoped handler by users.managed_vs_depts (0083). vs_staff/dev/perm(vs): any.';

-- ------------------------------------------------------------
-- 6. Dedup RPCs — authorize + re-scope through current_user_vs_scope().
--    (SECURITY DEFINER bypasses RLS, so the scope MUST be re-applied in the
--    body — see mistakes.md "a definer RPC over a row-scoped table".)
--    Behaviour for existing callers is unchanged: super → NULL scope → every
--    branch collapses to what it was; vp_admin → {own dept} → same check as
--    the `v_role = 'vp_admin' and dept <> current_user_dept()` guard it
--    replaces.
-- ------------------------------------------------------------

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
  v_scope   text[] := public.current_user_vs_scope();
  v_problem text;
  v_dept    text;
begin
  if v_scope is not null and cardinality(v_scope) = 0 then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), t.target_dept
    into v_problem, v_dept
  from public.vs_tickets t where t.id = p_id;
  if v_problem is null then
    raise exception 'VS ticket not found: %', p_id using errcode = 'P0002';
  end if;

  -- A dept-scoped caller may only work inside their own dept(s).
  if v_scope is not null and not (v_dept = any (v_scope)) then
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
    -- confidentiality: a scoped caller never sees another dept's snippets.
    and (v_scope is null or t.target_dept = any (v_scope))
    and similarity(regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), v_problem) > 0.08
  -- ORDER BY the EXPRESSION, never the `sim` OUT-param name (it shadows the
  -- query column and silently sorts by NULL — see mistakes.md).
  order by (t.target_dept = v_dept) desc,
           similarity(regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g'), v_problem) desc
  limit greatest(least(coalesce(p_limit, 6), 20), 1);
end;
$$;

revoke all on function public.find_similar_vs_tickets(text, integer) from public, anon;
grant execute on function public.find_similar_vs_tickets(text, integer) to authenticated;


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
  v_scope text[] := public.current_user_vs_scope();
  v_q     text := btrim(coalesce(p_query, ''));
begin
  if v_scope is not null and cardinality(v_scope) = 0 then
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
    and (v_scope is null or t.target_dept = any (v_scope))
    and (
      v_q = ''
      or t.id ilike '%' || v_q || '%'
      or regexp_replace(coalesce(t.problem, ''), '<[^>]*>', ' ', 'g') ilike '%' || v_q || '%'
    )
  order by (v_q <> '' and t.id ilike '%' || v_q || '%') desc,
           coalesce(t.created_at, t.timestamp) desc
  limit greatest(least(coalesce(p_limit, 8), 25), 1);
end;
$$;

revoke all on function public.search_vs_tickets(text, text, integer) from public, anon;
grant execute on function public.search_vs_tickets(text, text, integer) to authenticated;


-- merge: body identical to 0074 except the authorization/scope guards.
create or replace function public.merge_vs_tickets(p_dup text, p_canonical text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope      text[] := public.current_user_vs_scope();
  v_dup        public.vs_tickets;
  v_can        public.vs_tickets;
  v_can_dept   text;
  v_can_status text;
  v_children   integer;
  v_time       text := to_char(now() at time zone 'Asia/Bangkok', 'DD/MM, HH24:MI');
begin
  if v_scope is not null and cardinality(v_scope) = 0 then
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

  -- BOTH sides must sit inside the caller's scope (no cross-dept merges).
  if v_scope is not null and not (
       v_dup.target_dept = any (v_scope) and v_can_dept = any (v_scope)
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
  v_scope text[] := public.current_user_vs_scope();
  v_dept  text;
  v_time  text := to_char(now() at time zone 'Asia/Bangkok', 'DD/MM, HH24:MI');
begin
  if v_scope is not null and cardinality(v_scope) = 0 then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select target_dept into v_dept from public.vs_tickets where id = p_id and deleted_at is null;
  if v_scope is not null and (v_dept is null or not (v_dept = any (v_scope))) then
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

-- ------------------------------------------------------------
-- 7. Soft delete — a scoped handler deletes only inside their dept(s).
--    vs_staff / dev / perm(vs) / vp_admin keep 0044's "any ticket" rule
--    unchanged (that was a deliberate product decision, not an oversight).
-- ------------------------------------------------------------
create or replace function public.soft_delete_vs_ticket(p_id text)
returns public.vs_tickets language plpgsql security definer set search_path = public as $$
declare
  r      public.vs_tickets;
  v_role text := public.current_user_role();
  v_dept text;
begin
  select target_dept into v_dept from public.vs_tickets where id = p_id and deleted_at is null;
  if v_role is null or not (
       v_role in ('vs_staff', 'dev', 'vp_admin')
    or public.current_user_has_permission('vs')
    or (v_dept is not null and v_dept = any (public.current_user_vs_depts()))
  ) then
    raise exception 'not authorized to delete this VS ticket' using errcode = '42501';
  end if;
  update public.vs_tickets set deleted_at = now()
    where id = p_id and deleted_at is null
    returning * into r;
  if not found then
    raise exception 'VS ticket not found or already deleted: %', p_id using errcode = 'P0002';
  end if;
  return r;
end $$;

revoke all on function public.soft_delete_vs_ticket(text) from public, anon;
grant execute on function public.soft_delete_vs_ticket(text) to authenticated;

-- ------------------------------------------------------------
-- 8. Public-board comment moderation — a scoped handler moderates only
--    comments on a canonical problem in their dept(s).
-- ------------------------------------------------------------
create or replace function public.vs_hide_public_comment(p_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope text[] := public.current_user_vs_scope();
begin
  if v_scope is not null and cardinality(v_scope) = 0 then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.vs_public_comments c
     set hidden = p_hidden,
         hidden_by = case when p_hidden then auth.uid() else null end,
         hidden_at = case when p_hidden then now() else null end
   where c.id = p_id
     and (v_scope is null or exists (
           select 1 from public.vs_tickets t
            where t.id = c.canonical_id and t.target_dept = any (v_scope)));
end;
$$;

revoke all on function public.vs_hide_public_comment(uuid, boolean) from public, anon;
grant execute on function public.vs_hide_public_comment(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 9. Re-sync every affected account now (section 4's updates already fired
--    the statement trigger, but run it once more so an account whose row was
--    written before this file lands is consistent).
-- ------------------------------------------------------------
do $$
declare
  u          record;
  v_perms    text[];
  v_vs_depts text[];
begin
  perform set_config('app.team_sync', '1', true);
  for u in
    select id, email from public.users
     where email is not null
       and (managed_permissions <> '{}' or managed_vs_depts <> '{}')
  loop
    v_perms    := public.effective_team_permissions_for_email(u.email);
    v_vs_depts := public.effective_team_vs_depts_for_email(u.email);
    update public.users
       set managed_permissions = v_perms,
           managed_vs_depts    = v_vs_depts
     where id = u.id
       and (managed_permissions is distinct from v_perms
            or managed_vs_depts is distinct from v_vs_depts);
  end loop;
end $$;

-- NOTE (known, deliberate gap): the public-board "staff-only" comment
-- surface (get_public_vs_problem / vs_post_public_comment, 0078) still gates
-- on current_user_is_staff(), so a tree-scoped handler is not treated as
-- เจ้าหน้าที่ there. Widening it means re-emitting those two large function
-- bodies; left for a follow-up rather than transcribed here.
