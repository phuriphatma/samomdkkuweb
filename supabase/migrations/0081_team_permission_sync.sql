-- ============================================================
-- 0081 — SAMO Team org tree drives real login permissions
--
-- Until now the ทีม SAMO tree (public.team_nodes.permissions +
-- inherit_permissions, migration 0046) was PURELY COSMETIC: nothing
-- connected it to the login gate. Both gates read only
-- public.users.permissions[] — the UI gate userCanAccess() (auth.js)
-- and the DB boundary current_user_has_permission() (RLS, 0014).
--
-- This migration makes the tree authoritative for a NEW, separate
-- permission channel while leaving the old one untouched:
--
--   * public.users.managed_permissions  — tree-derived, server-managed.
--     Kept SEPARATE from .permissions (manual grants) so the tree can
--     revoke its own grants without ever wiping a manually-assigned
--     perm. Both gates now read the UNION (additive).
--
--   * public.team_members.permissions + inherit_permissions — a
--     PER-PERSON permission layer on top of the node's perms (the
--     "depth as each person" requirement). A member's effective set =
--     (inherit ? node_effective : {}) ∪ member.permissions.
--
-- Delivery is auto + live:
--   * sync_my_team_permissions() — called at login (auth.js). Matches
--     the caller's OWN email (public.users.email, populated from
--     auth.users.email = the person's kkumail for Google logins) to
--     team_members.kkumail, computes the effective set, writes it to
--     the caller's managed_permissions. No client-trusted input — keyed
--     off auth.uid(). Provisions a person on their first login.
--   * a statement-level trigger on the tree recomputes managed_perms
--     for every already-logged-in matching account whenever a perm /
--     structure column changes → live update, no re-login needed.
--
-- Security: managed_permissions is added to users_self_update_guard so
-- a client cannot self-grant via a raw PATCH. The server writers (the
-- RPC + the trigger, both SECURITY DEFINER but running with the
-- caller's auth.uid()) set a transaction-local GUC app.team_sync='1'
-- that the guard recognizes — the documented "server-writer bypass
-- flag" pattern (see .claude/rules/mistakes.md, 0041 signup-brick).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columns
-- ------------------------------------------------------------
alter table public.users
  add column if not exists managed_permissions text[] not null default '{}';

comment on column public.users.managed_permissions is
  'Tree-derived permissions synced from the SAMO Team org tree '
  '(team_members / team_nodes). Server-managed — NOT client-writable '
  '(users_self_update_guard). Gates read the UNION with permissions[], '
  'so this stays separate from manual grants and the tree can revoke '
  'its own perms without touching them.';

alter table public.team_members
  add column if not exists permissions text[] not null default '{}';
alter table public.team_members
  add column if not exists inherit_permissions boolean not null default true;

comment on column public.team_members.permissions is
  'Per-person extra permissions, on top of the node the member sits in.';
comment on column public.team_members.inherit_permissions is
  'When true, the member also receives the node effective permissions.';

-- ------------------------------------------------------------
-- 2. Effective-permission helpers
-- ------------------------------------------------------------

-- Node effective perms = the node own perms plus, while a node opts to
-- inherit, each ancestor own perms until an ancestor opts out. Mirrors
-- the frontend inheritedPermsFor() + own logic exactly.
create or replace function public.node_effective_permissions(p_node uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_out  text[] := '{}';
  v_cur  uuid := p_node;
  v_node public.team_nodes%rowtype;
  v_hops int := 0;
begin
  loop
    v_hops := v_hops + 1;
    exit when v_cur is null or v_hops > 100;   -- cycle / runaway guard
    select * into v_node from public.team_nodes where id = v_cur;
    exit when not found;
    v_out := v_out || coalesce(v_node.permissions, '{}');
    -- climb to the parent only if this node inherits from it
    exit when not coalesce(v_node.inherit_permissions, true);
    v_cur := v_node.parent_id;
  end loop;
  return v_out;
end;
$$;

-- Union of effective perms across every team_member row for an email.
create or replace function public.effective_team_permissions_for_email(p_email text)
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
    v_out := v_out || coalesce(m.permissions, '{}');
    if coalesce(m.inherit_permissions, true) then
      v_out := v_out || public.node_effective_permissions(m.node_id);
    end if;
  end loop;
  -- dedupe
  return (select coalesce(array_agg(distinct p), '{}') from unnest(v_out) as p);
end;
$$;

-- ------------------------------------------------------------
-- 3. Login-time self-sync RPC (auto-provision on kkumail login)
-- ------------------------------------------------------------
create or replace function public.sync_my_team_permissions()
returns text[] language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_perms text[];
begin
  if v_uid is null then
    return '{}';
  end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null then
    return '{}';
  end if;

  v_perms := public.effective_team_permissions_for_email(v_email);

  -- server-writer bypass flag for the guard (txn-local)
  perform set_config('app.team_sync', '1', true);

  -- link the member row(s) to this account (display convenience; the
  -- user_id column is excluded from the recompute trigger so this does
  -- not re-fire it)
  update public.team_members
     set user_id = v_uid
   where lower(kkumail) = lower(v_email)
     and user_id is distinct from v_uid;

  update public.users
     set managed_permissions = v_perms
   where id = v_uid
     and managed_permissions is distinct from v_perms;

  return v_perms;
end;
$$;

grant execute on function public.sync_my_team_permissions() to authenticated;

-- ------------------------------------------------------------
-- 4. Live-update trigger — propagate tree edits to logged-in accounts
-- ------------------------------------------------------------
-- Statement-level: recompute once per statement regardless of row
-- count. Recomputes any account that currently matches a team member OR
-- currently holds tree-derived perms (the latter so a just-removed
-- member is revoked to '{}'). Cheap: the eligible set is tiny.
create or replace function public.recompute_team_managed_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  u       record;
  v_perms text[];
begin
  perform set_config('app.team_sync', '1', true);
  for u in
    select id, email
      from public.users
     where email is not null
       and ( managed_permissions <> '{}'
          or exists (select 1 from public.team_members tm
                      where lower(tm.kkumail) = lower(users.email)) )
  loop
    v_perms := public.effective_team_permissions_for_email(u.email);
    update public.users
       set managed_permissions = v_perms
     where id = u.id
       and managed_permissions is distinct from v_perms;
  end loop;
  return null;
end;
$$;

drop trigger if exists team_nodes_recompute_perms on public.team_nodes;
create trigger team_nodes_recompute_perms
  after insert or delete or update of permissions, inherit_permissions, parent_id
  on public.team_nodes
  for each statement execute function public.recompute_team_managed_permissions();

drop trigger if exists team_members_recompute_perms on public.team_members;
create trigger team_members_recompute_perms
  after insert or delete or update of permissions, inherit_permissions, node_id, kkumail
  on public.team_members
  for each statement execute function public.recompute_team_managed_permissions();

-- ------------------------------------------------------------
-- 5. Gate: current_user_has_permission also honors managed_permissions
-- ------------------------------------------------------------
create or replace function public.current_user_has_permission(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.users
     where id = auth.uid()
       and (perm = any(permissions) or perm = any(managed_permissions))
  );
$$;

-- ------------------------------------------------------------
-- 6. Self-update guard: block client writes to managed_permissions,
--    allow the server writers (RPC + trigger) via app.team_sync flag.
--    (Full re-create of the 0041 guard with the extra column.)
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

  -- managed_permissions is server-managed (the SAMO Team tree sync).
  -- Allowed only when the transaction-local server-writer flag is set —
  -- sync_my_team_permissions() and recompute_team_managed_permissions()
  -- set it; a client PATCH cannot, so a user cannot self-grant.
  if new.managed_permissions is distinct from old.managed_permissions then
    if coalesce(current_setting('app.team_sync', true), '') <> '1' then
      raise exception 'users_self_update_guard: managed_permissions is server-managed';
    end if;
  end if;

  if new.method is distinct from old.method then
    raise exception 'users_self_update_guard: method can only be changed by staff';
  end if;

  if new.has_password is distinct from old.has_password then
    if new.has_password is distinct from exists (
         select 1 from auth.users au
          where au.id = new.id
            and au.encrypted_password is not null
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
