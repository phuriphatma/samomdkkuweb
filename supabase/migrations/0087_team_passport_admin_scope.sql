-- ============================================================
-- 0087 — SAMO Passport admin permission, granted from the ทีม SAMO tree,
--        scoped per department / sub-department (or total).
--
-- Passport currently has NO server-side admin identity at all: the panel is
-- gated by a client-side `admin`/`1234` + localStorage flag and every admin
-- write goes out over the anon key. This migration builds the missing
-- IDENTITY + SCOPE half in samoweb, where the org tree already lives:
--
--     ทีม SAMO → จัดการสิทธิ์ → ☑ SAMO Passport → ขอบเขต
--         · ทุกฝ่าย                     → permissions[] += 'passport'
--         · ฝ่าย X                      → passport_dept_id     = X
--         · ฝ่าย X / แผนกย่อย Y          → passport_sub_dept_id = Y
--
-- resolved into users.managed_passport_scopes text[] with tokens
-- 'd:<department_id>' / 's:<sub_department_id>'.
--
-- SCOPED IS NOT FULL (the 0083 lesson): a row carries EITHER the flat
-- `passport` permission (all departments) OR a dept/sub binding, never both —
-- `current_user_has_permission('passport')` would be an unconditional true
-- branch that swallows any narrower check.
--
-- WHAT THIS DOES *NOT* DO — read this before assuming it secures anything:
-- the `passport` schema's own RLS is still wide open (`using (true)` /
-- `with check (true)` for anon on activities/scans/seasons/…, migration 0056).
-- Verified live: as the bare `anon` role, one statement updates all 845 scans.
-- So this migration establishes WHO an admin is and WHAT they may touch; it
-- does not yet enforce it. Enforcement is passport/SECURITY-HARDENING-PLAN.md
-- (close the anon policies, move stamping to a definer RPC), which then reads
-- passport_admin_context() below instead of inventing its own admin table.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columns
-- ------------------------------------------------------------
alter table public.team_nodes
  add column if not exists passport_dept_id     integer,
  add column if not exists passport_sub_dept_id integer;

alter table public.team_members
  add column if not exists passport_dept_id     integer,
  add column if not exists passport_sub_dept_id integer;

alter table public.users
  add column if not exists managed_passport_scopes text[] not null default '{}';

comment on column public.team_nodes.passport_dept_id is
  'SAMO Passport department this node administers (passport.departments.id). No FK — cross-schema on purpose, so the passport schema stays independently movable. NULL + no sub = no passport scope (0087).';
comment on column public.team_nodes.passport_sub_dept_id is
  'Narrower still: a single passport.sub_departments.id. When set it wins over passport_dept_id (0087).';
comment on column public.users.managed_passport_scopes is
  'Passport admin scope from the ทีม SAMO tree: tokens d:<dept_id> / s:<sub_dept_id>. Server-managed — NOT client-writable. Empty + no `passport` permission ⇒ not a passport admin.';

-- ------------------------------------------------------------
-- 2. Resolvers (same shape as vs_depts / project_seats)
-- ------------------------------------------------------------

/** One row's scope tokens. A sub-department binding is MORE specific, so it
 *  replaces the department token rather than adding to it. */
create or replace function public.passport_scope_tokens(p_dept integer, p_sub integer)
returns text[] language sql immutable set search_path = public as $$
  select case
    when p_sub  is not null then array['s:' || p_sub::text]
    when p_dept is not null then array['d:' || p_dept::text]
    else '{}'::text[]
  end
$$;

create or replace function public.node_effective_passport_scopes(p_node uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_out  text[] := '{}';
  v_cur  uuid := p_node;
  v_node public.team_nodes%rowtype;
  v_hops int := 0;
begin
  loop
    v_hops := v_hops + 1;
    exit when v_cur is null or v_hops > 100;
    select * into v_node from public.team_nodes where id = v_cur;
    exit when not found;
    v_out := v_out || public.passport_scope_tokens(v_node.passport_dept_id, v_node.passport_sub_dept_id);
    exit when not coalesce(v_node.inherit_permissions, true);
    v_cur := v_node.parent_id;
  end loop;
  return v_out;
end;
$$;

create or replace function public.effective_team_passport_scopes_for_email(p_email text)
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
    v_out := v_out || public.passport_scope_tokens(m.passport_dept_id, m.passport_sub_dept_id);
    if coalesce(m.inherit_permissions, true) then
      v_out := v_out || public.node_effective_passport_scopes(m.node_id);
    end if;
  end loop;
  return (select coalesce(array_agg(distinct t), '{}') from unnest(v_out) as t);
end;
$$;

-- ------------------------------------------------------------
-- 3. Login sync + live recompute — carry the new dimension.
-- ------------------------------------------------------------
create or replace function public.sync_my_team_permissions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text;
  v_perms     text[];
  v_vs_depts  text[];
  v_seats     text[];
  v_passport  text[];
begin
  if v_uid is null then
    return jsonb_build_object('permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                              'project_seats', '[]'::jsonb, 'passport_scopes', '[]'::jsonb);
  end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null then
    return jsonb_build_object('permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                              'project_seats', '[]'::jsonb, 'passport_scopes', '[]'::jsonb);
  end if;

  v_perms    := public.effective_team_permissions_for_email(v_email);
  v_vs_depts := public.effective_team_vs_depts_for_email(v_email);
  v_seats    := public.effective_team_project_seats_for_email(v_email);
  v_passport := public.effective_team_passport_scopes_for_email(v_email);

  perform set_config('app.team_sync', '1', true);

  update public.team_members
     set user_id = v_uid
   where lower(kkumail) = lower(v_email)
     and user_id is distinct from v_uid;

  update public.users
     set managed_permissions     = v_perms,
         managed_vs_depts        = v_vs_depts,
         managed_project_seats   = v_seats,
         managed_passport_scopes = v_passport
   where id = v_uid
     and (managed_permissions     is distinct from v_perms
       or managed_vs_depts        is distinct from v_vs_depts
       or managed_project_seats   is distinct from v_seats
       or managed_passport_scopes is distinct from v_passport);

  return jsonb_build_object(
    'permissions',     to_jsonb(v_perms),
    'vs_depts',        to_jsonb(v_vs_depts),
    'project_seats',   to_jsonb(v_seats),
    'passport_scopes', to_jsonb(v_passport)
  );
end;
$$;

grant execute on function public.sync_my_team_permissions() to authenticated;

create or replace function public.recompute_team_managed_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  u          record;
  v_perms    text[];
  v_vs_depts text[];
  v_seats    text[];
  v_passport text[];
begin
  perform set_config('app.team_sync', '1', true);
  for u in
    select id, email
      from public.users
     where email is not null
       and ( managed_permissions     <> '{}'
          or managed_vs_depts        <> '{}'
          or managed_project_seats   <> '{}'
          or managed_passport_scopes <> '{}'
          or exists (select 1 from public.team_members tm
                      where lower(tm.kkumail) = lower(users.email)) )
  loop
    v_perms    := public.effective_team_permissions_for_email(u.email);
    v_vs_depts := public.effective_team_vs_depts_for_email(u.email);
    v_seats    := public.effective_team_project_seats_for_email(u.email);
    v_passport := public.effective_team_passport_scopes_for_email(u.email);
    update public.users
       set managed_permissions     = v_perms,
           managed_vs_depts        = v_vs_depts,
           managed_project_seats   = v_seats,
           managed_passport_scopes = v_passport
     where id = u.id
       and (managed_permissions     is distinct from v_perms
         or managed_vs_depts        is distinct from v_vs_depts
         or managed_project_seats   is distinct from v_seats
         or managed_passport_scopes is distinct from v_passport);
  end loop;
  return null;
end;
$$;

drop trigger if exists team_nodes_recompute_perms on public.team_nodes;
create trigger team_nodes_recompute_perms
  after insert or delete or update of permissions, inherit_permissions, parent_id,
                                      vs_dept, project_seat,
                                      passport_dept_id, passport_sub_dept_id
  on public.team_nodes
  for each statement execute function public.recompute_team_managed_permissions();

drop trigger if exists team_members_recompute_perms on public.team_members;
create trigger team_members_recompute_perms
  after insert or delete or update of permissions, inherit_permissions, node_id, kkumail,
                                      vs_dept, project_seat,
                                      passport_dept_id, passport_sub_dept_id
  on public.team_members
  for each statement execute function public.recompute_team_managed_permissions();

-- ------------------------------------------------------------
-- 4. Guard the new server-managed column.
-- ------------------------------------------------------------
create or replace function public.users_self_update_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_staff boolean := public.current_user_is_staff();
begin
  if is_staff then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'users_self_update_guard: id is immutable';
  end if;
  if new.role is distinct from old.role then
    raise exception 'users_self_update_guard: role can only be changed by staff';
  end if;
  if new.permissions is distinct from old.permissions then
    raise exception 'users_self_update_guard: permissions can only be changed by staff';
  end if;

  if new.managed_permissions is distinct from old.managed_permissions
     or new.managed_vs_depts is distinct from old.managed_vs_depts
     or new.managed_project_seats is distinct from old.managed_project_seats
     or new.managed_passport_scopes is distinct from old.managed_passport_scopes then
    if coalesce(current_setting('app.team_sync', true), '') <> '1' then
      raise exception 'users_self_update_guard: tree-managed columns are server-managed';
    end if;
  end if;

  if new.method is distinct from old.method then
    raise exception 'users_self_update_guard: method can only be changed by staff';
  end if;
  if new.has_password is distinct from old.has_password then
    if new.has_password is distinct from exists (
         select 1 from auth.users au
          where au.id = new.id and au.encrypted_password is not null
       ) then
      raise exception 'users_self_update_guard: has_password is server-managed';
    end if;
  end if;
  if old.username is not null and new.username is distinct from old.username then
    raise exception 'users_self_update_guard: username can only be set once';
  end if;

  return new;
end;
$$;

drop trigger if exists users_self_update_guard on public.users;
create trigger users_self_update_guard
  before update on public.users
  for each row execute function public.users_self_update_guard();

-- ------------------------------------------------------------
-- 5. The reference list for the ทีม SAMO picker.
--    passport.departments / sub_departments have RLS ENABLED with NO policy
--    (0056), so a direct client read returns zero rows. This definer read
--    exposes ONLY id + name — reference data, no PII.
-- ------------------------------------------------------------
create or replace function public.list_passport_departments()
returns jsonb language sql stable security definer set search_path = public, passport as $$
  select jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.id)
        from passport.departments d), '[]'::jsonb),
    'sub_departments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'department_id', s.department_id, 'name', s.name) order by s.id)
        from passport.sub_departments s), '[]'::jsonb)
  )
$$;

revoke all on function public.list_passport_departments() from public, anon;
grant execute on function public.list_passport_departments() to authenticated;

-- ------------------------------------------------------------
-- 6. What the PASSPORT app calls to find out who it is talking to.
--
--    One call, one answer — so passport never re-derives the rule. Returns
--    resolved integer ids (not the raw tokens) plus `all_departments` for the
--    unscoped/full grant, so the passport UI can filter its activity + scan
--    lists exactly the way the VitalSound kanban filters by target_dept.
--
--    `is_admin` is TRUE for a full grant or ANY scope. Scope semantics:
--      all_departments = true  → every department (SE-equivalent)
--      departments[]           → whole departments
--      sub_departments[]       → single sub-departments only
-- ------------------------------------------------------------
create or replace function public.passport_admin_context()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_full   boolean;
  v_scopes text[];
begin
  if v_uid is null then
    return jsonb_build_object('is_admin', false, 'all_departments', false,
                              'departments', '[]'::jsonb, 'sub_departments', '[]'::jsonb);
  end if;

  v_full := coalesce(public.current_user_has_permission('passport'), false)
            or coalesce(public.current_user_role() = 'dev', false);
  select coalesce(managed_passport_scopes, '{}') into v_scopes
    from public.users where id = v_uid;
  v_scopes := coalesce(v_scopes, '{}');

  return jsonb_build_object(
    'is_admin',        v_full or cardinality(v_scopes) > 0,
    'all_departments', v_full,
    'departments', coalesce((
      select jsonb_agg(distinct (substring(t from 3))::int)
        from unnest(v_scopes) as t where t like 'd:%'), '[]'::jsonb),
    'sub_departments', coalesce((
      select jsonb_agg(distinct (substring(t from 3))::int)
        from unnest(v_scopes) as t where t like 's:%'), '[]'::jsonb)
  );
end;
$$;

comment on function public.passport_admin_context() is
  'Who the caller is for SAMO Passport admin, resolved from the ทีม SAMO tree '
  '(0087). The passport app MUST use this rather than inventing its own admin '
  'table. NOTE: identity + scope only — the passport schema RLS is still open '
  '(0056); enforcement is SECURITY-HARDENING-PLAN.md.';

revoke all on function public.passport_admin_context() from public, anon;
grant execute on function public.passport_admin_context() to authenticated;

-- ------------------------------------------------------------
-- 7. Re-sync every tree-linked account.
-- ------------------------------------------------------------
do $$
declare
  u record;
begin
  perform set_config('app.team_sync', '1', true);
  for u in
    select id, email from public.users
     where email is not null
       and exists (select 1 from public.team_members tm where lower(tm.kkumail) = lower(users.email))
  loop
    update public.users
       set managed_permissions     = public.effective_team_permissions_for_email(u.email),
           managed_vs_depts        = public.effective_team_vs_depts_for_email(u.email),
           managed_project_seats   = public.effective_team_project_seats_for_email(u.email),
           managed_passport_scopes = public.effective_team_passport_scopes_for_email(u.email)
     where id = u.id;
  end loop;
end $$;
