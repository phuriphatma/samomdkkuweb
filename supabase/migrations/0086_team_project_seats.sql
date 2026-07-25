-- ============================================================
-- 0086 — หนังสือโครงการ seats via the SAMO Team tree + org-chart visibility
--
-- WHY A SEAT AND NOT JUST THE `projects` PERMISSION: unlike PR or SAMO Shop,
-- หนังสือโครงการ is not one capability — it is THREE seats with different
-- workflows, and the app reads them off users.role:
--     vp_admin  → ส่งหนังสือ (creates projects, sends documents)
--     uni_staff → รับเรื่อง / อัปเดตสถานะ
--     sa_prof   → ลงนาม (signs; must NOT see other projects)
-- `src/js/projects/index.js` does `currentRole = user.role`, so a tree-granted
-- person (role='user') with a flat `projects` grant lands in a broken half-
-- state: the tab opens and the inbox renders (project reads are public since
-- 0032) but no seat controls appear and every write is refused by
-- current_user_is_project_actor(), which is a hardcoded role list.
--
-- So the tree gains a SEAT dimension, exactly mirroring vs_dept (0082/0083):
--   team_nodes.project_seat / team_members.project_seat ∈ (vpa|staff|prof)
--     → users.managed_project_seats text[]  (server-managed, guarded)
--     → current_user_project_seats()        (the RLS helper)
-- The two role-only helpers are widened at their single definition each, so
-- every policy that already calls them picks the seats up for free.
--
-- Seats are ADDITIVE to the existing shared accounts (samomdkkuvpa / sastaff /
-- saprof keep working unchanged through users.role) — same additive contract
-- as managed_permissions vs permissions.
--
-- ORG-CHART VISIBILITY: the tree is destined to be rendered publicly as the
-- org chart with people's names, but อาจารย์ / เจ้าหน้าที่คณะ are not part of the
-- student org and must not appear there. team_nodes.is_public (default true)
-- marks a subtree as hidden from that chart. See the note above
-- get_public_org_chart() for why the flag is NOT the actual privacy boundary.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columns
-- ------------------------------------------------------------
alter table public.team_nodes
  add column if not exists project_seat text,
  add column if not exists is_public    boolean not null default true;

alter table public.team_members
  add column if not exists project_seat text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'team_nodes_project_seat_check') then
    alter table public.team_nodes add constraint team_nodes_project_seat_check
      check (project_seat is null or project_seat in ('vpa', 'staff', 'prof'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'team_members_project_seat_check') then
    alter table public.team_members add constraint team_members_project_seat_check
      check (project_seat is null or project_seat in ('vpa', 'staff', 'prof'));
  end if;
end $$;

alter table public.users
  add column if not exists managed_project_seats text[] not null default '{}';

comment on column public.team_nodes.project_seat is
  'หนังสือโครงการ seat this node grants: vpa=ผู้ส่ง, staff=เจ้าหน้าที่คณะ, prof=อาจารย์ (ลงนาม). Inherits down the tree on inherit_permissions (0086).';
comment on column public.team_nodes.is_public is
  'Show this node (and its subtree) in the PUBLIC org chart. false for อาจารย์ / เจ้าหน้าที่คณะ, who hold seats but are not part of the student org (0086).';
comment on column public.team_members.project_seat is
  'Per-person หนังสือโครงการ seat, unioned with the node binding (0086).';
comment on column public.users.managed_project_seats is
  'หนังสือโครงการ seats granted through the SAMO Team tree. Server-managed — NOT client-writable (users_self_update_guard). Read by current_user_project_seats().';

-- ------------------------------------------------------------
-- 2. Resolvers (mirror node_effective_vs_depts / *_for_email)
-- ------------------------------------------------------------
create or replace function public.node_effective_project_seats(p_node uuid)
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
    if v_node.project_seat is not null then
      v_out := v_out || v_node.project_seat;
    end if;
    exit when not coalesce(v_node.inherit_permissions, true);
    v_cur := v_node.parent_id;
  end loop;
  return v_out;
end;
$$;

create or replace function public.effective_team_project_seats_for_email(p_email text)
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
    -- An explicit per-person seat always counts (the inherit toggle governs
    -- what flows DOWN from the ตำแหน่ง, not what was set on the person).
    if m.project_seat is not null then
      v_out := v_out || m.project_seat;
    end if;
    if coalesce(m.inherit_permissions, true) then
      v_out := v_out || public.node_effective_project_seats(m.node_id);
    end if;
  end loop;
  return (select coalesce(array_agg(distinct s), '{}') from unnest(v_out) as s);
end;
$$;

-- ------------------------------------------------------------
-- 3. Login sync — now carries seats too. Return type stays jsonb, so
--    create-or-replace is fine (cf. the 0082 drop-first note).
-- ------------------------------------------------------------
create or replace function public.sync_my_team_permissions()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_perms    text[];
  v_vs_depts text[];
  v_seats    text[];
begin
  if v_uid is null then
    return jsonb_build_object('permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                              'project_seats', '[]'::jsonb);
  end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null then
    return jsonb_build_object('permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                              'project_seats', '[]'::jsonb);
  end if;

  v_perms    := public.effective_team_permissions_for_email(v_email);
  v_vs_depts := public.effective_team_vs_depts_for_email(v_email);
  v_seats    := public.effective_team_project_seats_for_email(v_email);

  perform set_config('app.team_sync', '1', true);

  update public.team_members
     set user_id = v_uid
   where lower(kkumail) = lower(v_email)
     and user_id is distinct from v_uid;

  update public.users
     set managed_permissions   = v_perms,
         managed_vs_depts      = v_vs_depts,
         managed_project_seats = v_seats
   where id = v_uid
     and (managed_permissions   is distinct from v_perms
       or managed_vs_depts      is distinct from v_vs_depts
       or managed_project_seats is distinct from v_seats);

  return jsonb_build_object(
    'permissions',   to_jsonb(v_perms),
    'vs_depts',      to_jsonb(v_vs_depts),
    'project_seats', to_jsonb(v_seats)
  );
end;
$$;

grant execute on function public.sync_my_team_permissions() to authenticated;

-- ------------------------------------------------------------
-- 4. Live recompute on any tree edit — now also seats.
-- ------------------------------------------------------------
create or replace function public.recompute_team_managed_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  u          record;
  v_perms    text[];
  v_vs_depts text[];
  v_seats    text[];
begin
  perform set_config('app.team_sync', '1', true);
  for u in
    select id, email
      from public.users
     where email is not null
       and ( managed_permissions   <> '{}'
          or managed_vs_depts      <> '{}'
          or managed_project_seats <> '{}'
          or exists (select 1 from public.team_members tm
                      where lower(tm.kkumail) = lower(users.email)) )
  loop
    v_perms    := public.effective_team_permissions_for_email(u.email);
    v_vs_depts := public.effective_team_vs_depts_for_email(u.email);
    v_seats    := public.effective_team_project_seats_for_email(u.email);
    update public.users
       set managed_permissions   = v_perms,
           managed_vs_depts      = v_vs_depts,
           managed_project_seats = v_seats
     where id = u.id
       and (managed_permissions   is distinct from v_perms
         or managed_vs_depts      is distinct from v_vs_depts
         or managed_project_seats is distinct from v_seats);
  end loop;
  return null;
end;
$$;

-- is_public is display-only — deliberately NOT in the trigger column lists,
-- so toggling chart visibility never triggers a permission recompute.
drop trigger if exists team_nodes_recompute_perms on public.team_nodes;
create trigger team_nodes_recompute_perms
  after insert or delete or update of permissions, inherit_permissions, parent_id, vs_dept, project_seat
  on public.team_nodes
  for each statement execute function public.recompute_team_managed_permissions();

drop trigger if exists team_members_recompute_perms on public.team_members;
create trigger team_members_recompute_perms
  after insert or delete or update of permissions, inherit_permissions, node_id, kkumail, vs_dept, project_seat
  on public.team_members
  for each statement execute function public.recompute_team_managed_permissions();

-- ------------------------------------------------------------
-- 5. The RLS helper + widening the two role-only gates.
-- ------------------------------------------------------------
create or replace function public.current_user_project_seats()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(managed_project_seats, '{}') from public.users where id = auth.uid()
$$;

grant execute on function public.current_user_project_seats() to anon, authenticated;

-- ACTOR = may create/update projects + documents + files.
-- A 'prof' seat is deliberately NOT an actor (same rule as role sa_prof,
-- 0050): the professor signs, and must not see unrelated projects.
create or replace function public.current_user_is_project_actor()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() in ('vp_admin', 'uni_staff', 'dev'), false)
      or coalesce(public.current_user_project_seats() && array['vpa', 'staff'], false)
$$;

-- PROF = the signing seat. Widening this ONE function covers every prof
-- policy in 0050 (sign requests, file insert, doc/settings reads).
create or replace function public.current_user_is_prof()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_role() = 'sa_prof', false)
      or coalesce('prof' = any (public.current_user_project_seats()), false)
$$;

comment on function public.current_user_is_project_actor() is
  'May create/update หนังสือโครงการ: role vp_admin/uni_staff/dev, or a tree seat of vpa/staff (0086). NEVER the prof seat. Fail-closed on a null role.';
comment on function public.current_user_is_prof() is
  'The signing seat: role sa_prof or a tree seat of prof (0086). Fail-closed on a null role.';

-- ------------------------------------------------------------
-- 6. Self-update guard — managed_project_seats is server-managed.
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

  -- Tree-managed columns: only under the server-writer flag.
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
  if new.managed_project_seats is distinct from old.managed_project_seats then
    if coalesce(current_setting('app.team_sync', true), '') <> '1' then
      raise exception 'users_self_update_guard: managed_project_seats is server-managed';
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
-- 7. Who can be sent a document to sign — seat-aware, and safe to expose.
--
--    src/js/projects/sign.js used listUsersByRole('sa_prof')[0], a role-only
--    lookup that (a) can never see a tree-granted อาจารย์ and (b) silently
--    assumed exactly one professor exists. This RPC replaces it. It returns
--    ONLY id + display name — never email/username — because the caller is
--    any project actor and a professor's address is not theirs to read.
-- ------------------------------------------------------------
create or replace function public.list_project_profs()
returns table (id uuid, display_name text)
language sql stable security definer set search_path = public as $$
  select u.id,
         coalesce(nullif(btrim(u.display_name), ''),
                  nullif(btrim(u.username), ''),
                  'อาจารย์') as display_name
    from public.users u
   where public.current_user_is_project_actor()
     and (u.role = 'sa_prof' or 'prof' = any (coalesce(u.managed_project_seats, '{}')))
   order by 2
$$;

revoke all on function public.list_project_profs() from public, anon;
grant execute on function public.list_project_profs() to authenticated;

-- ------------------------------------------------------------
-- 8. PUBLIC ORG CHART — a PROJECTION, never a table read.
--
-- THE RULE THIS ENCODES: the chart must never be built by adding a
-- `using (true)` SELECT policy to team_members. RLS is row-level, so such a
-- policy exposes EVERY COLUMN of every visible row — kkumail (students AND
-- the @kku.ac.th staff), student_id, year, major, permissions, user_id — and
-- a `returns setof public.team_members` would additionally auto-expose every
-- column added later (that is exactly how vs_tickets.tags reached guests in
-- 0079). is_public is therefore defence-in-depth, NOT the privacy boundary:
-- this hand-picked projection is.
--
-- Visibility is inherited: a node is shown only if it AND every ancestor is
-- is_public, so hiding อาจารย์ hides everyone under it.
-- ------------------------------------------------------------
create or replace function public.get_public_org_chart()
returns jsonb language sql stable security definer set search_path = public as $$
  with recursive visible as (
    select n.id, n.parent_id, n.name, n.kind, n.position
      from public.team_nodes n
     where n.parent_id is null and n.is_public
    union all
    select c.id, c.parent_id, c.name, c.kind, c.position
      from public.team_nodes c
      join visible v on c.parent_id = v.id
     where c.is_public
  )
  select jsonb_build_object(
    'nodes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'parent_id', v.parent_id,
               'name', v.name, 'kind', v.kind, 'position', v.position)
             order by v.position, v.name)
        from visible v), '[]'::jsonb),
    -- name + nickname + order ONLY. Never kkumail / student_id / year /
    -- major / permissions / vs_dept / project_seat / user_id / confirmed.
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'node_id', m.node_id,
               'name', m.full_name,
               'nickname', m.nickname,
               'position', m.position)
             order by m.position, m.full_name)
        from public.team_members m
        join visible v on v.id = m.node_id), '[]'::jsonb)
  )
$$;

comment on function public.get_public_org_chart() is
  'Public org chart projection (0086): name/nickname/structure only, and only '
  'is_public subtrees. The ONLY sanctioned way to publish the SAMO Team tree — '
  'never add a public SELECT policy to team_members, which would expose every '
  'column (kkumail, student_id, …) of every visible row.';

grant execute on function public.get_public_org_chart() to anon, authenticated;

-- ------------------------------------------------------------
-- 9. Re-sync every tree-linked account so seats take effect without a
--    re-login for anyone already signed in.
-- ------------------------------------------------------------
do $$
declare
  u          record;
  v_perms    text[];
  v_vs_depts text[];
  v_seats    text[];
begin
  perform set_config('app.team_sync', '1', true);
  for u in
    select id, email from public.users
     where email is not null
       and exists (select 1 from public.team_members tm where lower(tm.kkumail) = lower(users.email))
  loop
    v_perms    := public.effective_team_permissions_for_email(u.email);
    v_vs_depts := public.effective_team_vs_depts_for_email(u.email);
    v_seats    := public.effective_team_project_seats_for_email(u.email);
    update public.users
       set managed_permissions   = v_perms,
           managed_vs_depts      = v_vs_depts,
           managed_project_seats = v_seats
     where id = u.id
       and (managed_permissions   is distinct from v_perms
         or managed_vs_depts      is distinct from v_vs_depts
         or managed_project_seats is distinct from v_seats);
  end loop;
end $$;
