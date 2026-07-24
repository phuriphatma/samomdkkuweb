-- ============================================================
-- 0082 — Per-ฝ่าย VitalSound access via the SAMO Team tree
--
-- Goal: grant a person VS access SCOPED to a specific department through
-- the org tree — "this ฝ่าย handles VitalSound for แผนก X" — so their
-- kkumail login can see + manage only that dept's VS tickets, WITHOUT
-- provisioning them as a vp_admin with a hardcoded users.department.
--
-- Why a new column and not reuse users.department: department is single-
-- valued and tied to the vp_admin identity + the 9 seeded VP accounts.
-- A tree person can sit under several ฝ่าย, and is role='user'. So VS
-- dept-scope gets its own additive dimension, parallel to managed_permissions
-- (0081): managed_vs_depts[]. Gates read it ALONGSIDE the existing role /
-- vp_admin-dept paths (union), so nothing existing changes.
--
-- Binding: team_nodes.vs_dept names ONE of the 11 VS target_dept values the
-- node is responsible for. It inherits down the tree on the SAME
-- inherit_permissions flag as perms. A person's effective VS depts = the set
-- of vs_dept bindings on the nodes they sit under (inherited). Node-level
-- binding was the chosen model (the tree ฝ่าย names do NOT match the VS dept
-- strings, so an explicit picker is required — no auto-match).
--
-- Full `vs` (permissions[] or managed_permissions[]) still means ALL depts
-- (SE / super). This migration ALSO closes a latent gap: `has_permission('vs')`
-- was never in the vs_tickets READ/UPDATE policies (only DELETE), so a full-vs
-- grant showed the UI tab but returned no rows. Now both the full grant and
-- the per-dept scope are honored in read + update.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columns
-- ------------------------------------------------------------
alter table public.team_nodes
  add column if not exists vs_dept text;

comment on column public.team_nodes.vs_dept is
  'VitalSound department (vs_tickets.target_dept) this node is responsible '
  'for. Inherits down the tree on inherit_permissions. People under it get '
  'VS access scoped to this dept (see users.managed_vs_depts).';

alter table public.users
  add column if not exists managed_vs_depts text[] not null default '{}';

comment on column public.users.managed_vs_depts is
  'VitalSound departments this account may handle, synced from the SAMO Team '
  'tree (team_nodes.vs_dept). Server-managed — NOT client-writable '
  '(users_self_update_guard). vs_tickets RLS grants scoped access to these '
  'target_depts, additively with the role / vp_admin-dept paths.';

-- ------------------------------------------------------------
-- 2. Effective VS-dept helpers (mirror the 0081 perm walkers)
-- ------------------------------------------------------------

-- Collect the vs_dept bindings visible from a node: its own, plus each
-- ancestor's while the chain keeps inheriting (same rule as
-- node_effective_permissions).
create or replace function public.node_effective_vs_depts(p_node uuid)
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
    if v_node.vs_dept is not null and length(btrim(v_node.vs_dept)) > 0 then
      v_out := v_out || v_node.vs_dept;
    end if;
    exit when not coalesce(v_node.inherit_permissions, true);
    v_cur := v_node.parent_id;
  end loop;
  return v_out;
end;
$$;

-- Union of effective vs_depts across every team_member row for an email.
-- A member contributes its node's effective vs_depts only when it inherits
-- (inherit_permissions), matching how it inherits perms.
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
    if coalesce(m.inherit_permissions, true) then
      v_out := v_out || public.node_effective_vs_depts(m.node_id);
    end if;
  end loop;
  return (select coalesce(array_agg(distinct d), '{}') from unnest(v_out) as d);
end;
$$;

-- ------------------------------------------------------------
-- 3. sync_my_team_permissions() — now also writes managed_vs_depts and
--    returns BOTH sets as jsonb {permissions, vs_depts} (was: text[]).
--    Return type changes, so the 0081 function must be dropped first
--    (create-or-replace cannot change a function's return type).
-- ------------------------------------------------------------
drop function if exists public.sync_my_team_permissions();
create or replace function public.sync_my_team_permissions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_perms    text[];
  v_vs_depts text[];
begin
  if v_uid is null then
    return jsonb_build_object('permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb);
  end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null then
    return jsonb_build_object('permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb);
  end if;

  v_perms    := public.effective_team_permissions_for_email(v_email);
  v_vs_depts := public.effective_team_vs_depts_for_email(v_email);

  perform set_config('app.team_sync', '1', true);

  update public.team_members
     set user_id = v_uid
   where lower(kkumail) = lower(v_email)
     and user_id is distinct from v_uid;

  update public.users
     set managed_permissions = v_perms,
         managed_vs_depts     = v_vs_depts
   where id = v_uid
     and (managed_permissions is distinct from v_perms
          or managed_vs_depts is distinct from v_vs_depts);

  return jsonb_build_object(
    'permissions', to_jsonb(v_perms),
    'vs_depts',    to_jsonb(v_vs_depts)
  );
end;
$$;

grant execute on function public.sync_my_team_permissions() to authenticated;

-- ------------------------------------------------------------
-- 4. Live-recompute trigger — also recompute managed_vs_depts.
-- ------------------------------------------------------------
create or replace function public.recompute_team_managed_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  u          record;
  v_perms    text[];
  v_vs_depts text[];
begin
  perform set_config('app.team_sync', '1', true);
  for u in
    select id, email
      from public.users
     where email is not null
       and ( managed_permissions <> '{}'
          or managed_vs_depts <> '{}'
          or exists (select 1 from public.team_members tm
                      where lower(tm.kkumail) = lower(users.email)) )
  loop
    v_perms    := public.effective_team_permissions_for_email(u.email);
    v_vs_depts := public.effective_team_vs_depts_for_email(u.email);
    update public.users
       set managed_permissions = v_perms,
           managed_vs_depts     = v_vs_depts
     where id = u.id
       and (managed_permissions is distinct from v_perms
            or managed_vs_depts is distinct from v_vs_depts);
  end loop;
  return null;
end;
$$;

-- Recompute must also fire when a node's vs_dept binding changes.
drop trigger if exists team_nodes_recompute_perms on public.team_nodes;
create trigger team_nodes_recompute_perms
  after insert or delete or update of permissions, inherit_permissions, parent_id, vs_dept
  on public.team_nodes
  for each statement execute function public.recompute_team_managed_permissions();

-- (team_members trigger unchanged from 0081 — members carry no vs_dept.)

-- ------------------------------------------------------------
-- 5. current_user_vs_depts() — the scoped-access helper for RLS.
-- ------------------------------------------------------------
create or replace function public.current_user_vs_depts()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(managed_vs_depts, '{}') from public.users where id = auth.uid()
$$;

grant execute on function public.current_user_vs_depts() to anon, authenticated;

-- ------------------------------------------------------------
-- 6. Self-update guard — managed_vs_depts is server-managed too.
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

  -- Tree-managed columns: allowed only under the server-writer flag
  -- (sync_my_team_permissions / recompute_team_managed_permissions set it).
  if new.managed_permissions is distinct from old.managed_permissions then
    if coalesce(current_setting('app.team_sync', true), '') <> '1' then
      raise exception 'users_self_update_guard: managed_permissions is server-managed';
    end if;
  end if;
  if new.managed_vs_depts is distinct from old.managed_vs_depts then
    if coalesce(current_setting('app.team_sync', true), '') <> '1' then
      raise exception 'users_self_update_guard: managed_vs_depts is server-managed';
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
-- 7. vs_tickets RLS — add full-vs (has_permission) + per-dept scope.
--    READ + UPDATE (mirrors the 0016 shape; DELETE unchanged — deletion
--    stays staff / vp_admin-own-dept only).
-- ------------------------------------------------------------

drop policy if exists "vs_tickets_read" on public.vs_tickets;
create policy "vs_tickets_read" on public.vs_tickets
  for select using (
    submitter_id = auth.uid()
    or public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')                        -- full VS
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept = public.current_user_dept()
    )
    or target_dept = any (public.current_user_vs_depts())              -- per-ฝ่าย
  );

drop policy if exists "vs_tickets_update_staff" on public.vs_tickets;
create policy "vs_tickets_update_staff" on public.vs_tickets
  for update using (
    public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept = public.current_user_dept()
    )
    or target_dept = any (public.current_user_vs_depts())
  ) with check (
    public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept in (public.current_user_dept(), 'SE')
    )
    -- A per-dept handler may keep a ticket in one of their own depts, or
    -- hand it back to SE — never reassign it to an unrelated dept.
    or target_dept = any (public.current_user_vs_depts())
    or (target_dept = 'SE' and exists (
          select 1 from unnest(public.current_user_vs_depts()) as d where d is not null))
  );

comment on policy "vs_tickets_update_staff" on public.vs_tickets is
  'vs_staff/dev + full-vs: any. vp_admin: own dept (WITH CHECK own dept or SE). '
  'Per-ฝ่าย (managed_vs_depts): own dept(s), WITH CHECK own dept(s) or hand back to SE.';
