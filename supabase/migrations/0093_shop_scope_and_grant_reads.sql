-- ============================================================
-- 0093 — SAMO Shop gets a per-แหล่งที่มา scope in the ทีม SAMO tree, and the
--        read policies that still asked "are you STAFF?" learn the grant channel.
--
-- PART A — SAMO Shop scope
--
-- There is only ONE shop permission today (`samoshop`); `samomdkkuvpa` and
-- `samomdkkumdi` both simply hold it, so they are not two workflows — they are
-- two departments sharing one blanket grant. What actually distinguishes them is
-- `shop_products.source` (md / rt / mdi / sittikao), the ownership key from 0058,
-- which until now only drove a localStorage UI filter.
--
-- This adds the scope dimension so the tree can grant "SAMO Shop, but only MDI".
-- Same rules the earlier scopes established:
--   · SCOPED IS NOT FULL (0083) — a row carries EITHER the blanket `samoshop`
--     permission OR a `shop_source`, never both, because
--     current_user_has_permission('samoshop') is an unconditional OR-branch that
--     would swallow the narrower check.
--   · The resolver returns NULL for "every source" and a non-empty array for a
--     scoped grant; `{}` means no access at all, so every predicate fails CLOSED
--     (the 0085 lesson about `null in (...)`).
--
-- ENFORCEMENT IS DELIBERATELY PARTIAL, AND HERE IS WHY. `shop_products` carries
-- `source`, so product writes are genuinely scopeable and are scoped here. An
-- ORDER is not: one order can contain items from several sources (that is the
-- whole point of a shared cart), so "orders belonging to MDI" is not a property
-- of a row — it is a property of some of its items. Splitting order access per
-- source means splitting the order, which is a product decision, not a policy
-- change. Orders therefore stay admin-wide (Model A), and the admin UI filters
-- them by `product_source` the way it already does. Anything else would be a
-- policy that LOOKS like it isolates departments and does not.
--
-- PART B — three read policies gated on current_user_is_staff()
--
-- `current_user_is_staff()` is a bare role list, and a tree-granted person is
-- role='user'. Every WRITE path learned the grant channel in 0081/0089/0090/0092;
-- these reads did not, so the grant opened a surface with missing data:
--   · announcements_read  — a `creator` grantee could WRITE an announcement but
--     only READ approved ones, so drafts/pending vanished from เขียนประกาศ and
--     ลำดับการแสดงประกาศ. Writing something you then cannot see is the worst
--     shape of this bug.
--   · vs_followers / vs_public_comments — a VS-scoped grantee could not read
--     followers or staff-only comments on tickets they otherwise administer.
--   · analytics_events — สถิติการใช้งาน is offered to anyone who can use the
--     admin app, but only staff could read the rows.
--
-- current_user_is_staff() itself is NOT broadened. It is what
-- users_self_update_guard (0028/0041) trusts to allow privileged-column writes,
-- so widening it would let any tree-granted account set its own role='dev'.
-- Each policy is repointed individually instead.
-- ============================================================

-- ------------------------------------------------------------
-- A1. Columns
-- ------------------------------------------------------------
alter table public.team_nodes
  add column if not exists shop_source text;
alter table public.team_members
  add column if not exists shop_source text;
alter table public.users
  add column if not exists managed_shop_sources text[] not null default '{}';

do $$ begin
  alter table public.team_nodes
    add constraint team_nodes_shop_source_check
    check (shop_source is null or shop_source in ('md', 'rt', 'mdi', 'sittikao'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.team_members
    add constraint team_members_shop_source_check
    check (shop_source is null or shop_source in ('md', 'rt', 'mdi', 'sittikao'));
exception when duplicate_object then null; end $$;

comment on column public.team_nodes.shop_source is
  'SAMO Shop แหล่งที่มา this ตำแหน่ง administers (shop_products.source). NULL = no scoped shop grant; mutually exclusive with the blanket `samoshop` permission (0093).';
comment on column public.users.managed_shop_sources is
  'Shop sources from the ทีม SAMO tree. Server-managed. Empty + no `samoshop` permission ⇒ not a shop admin.';

-- ------------------------------------------------------------
-- A2. Resolvers (mirror the vs_dept pair — a source is additive, unlike a
--     project seat: one person can genuinely run two departments' shops).
-- ------------------------------------------------------------
create or replace function public.node_effective_shop_sources(p_node uuid)
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
    if v_node.shop_source is not null then
      v_out := v_out || v_node.shop_source;
    end if;
    exit when not coalesce(v_node.inherit_permissions, true);
    v_cur := v_node.parent_id;
  end loop;
  return v_out;
end;
$$;

create or replace function public.effective_team_shop_sources_for_email(p_email text)
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
    if m.shop_source is not null then
      v_out := v_out || m.shop_source;
    end if;
    if coalesce(m.inherit_permissions, true) then
      v_out := v_out || public.node_effective_shop_sources(m.node_id);
    end if;
  end loop;
  return (select coalesce(array_agg(distinct s), '{}') from unnest(v_out) as s);
end;
$$;

/** NULL  = every source (role shop_admin/dev, or the blanket `samoshop` grant)
 *  {}    = not a shop admin at all
 *  else  = exactly these sources.
 *  Shaped like current_user_vs_scope() so callers can't accidentally read
 *  "no access" as "all access". */
create or replace function public.current_user_shop_scope()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_role() in ('shop_admin', 'dev')
      or public.current_user_has_permission('samoshop') then null
    else coalesce(
      (select coalesce(u.managed_shop_sources, '{}') from public.users u where u.id = auth.uid()),
      '{}')
  end
$$;

revoke all on function public.current_user_shop_scope() from public;
grant execute on function public.current_user_shop_scope() to anon, authenticated;

/** Unchanged meaning (any shop admin), now including a scoped grant. */
create or replace function public.current_user_is_shop_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_shop_scope() is null
      or coalesce(cardinality(public.current_user_shop_scope()) > 0, false)
$$;

/** May the caller write a product owned by p_source? */
create or replace function public.current_user_owns_shop_source(p_source text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_shop_scope() is null then true
    when p_source is null then false          -- unsourced product: full admins only
    else p_source = any (public.current_user_shop_scope())
  end
$$;

revoke all on function public.current_user_owns_shop_source(text) from public;
grant execute on function public.current_user_owns_shop_source(text) to anon, authenticated;

-- ------------------------------------------------------------
-- A3. Product writes are scoped. (Reads stay open — the catalogue is public.)
-- ------------------------------------------------------------
drop policy if exists "shop_products_write_admin" on public.shop_products;
create policy "shop_products_write_admin" on public.shop_products
  for all
  using (public.current_user_owns_shop_source(source))
  with check (public.current_user_owns_shop_source(source));

-- ------------------------------------------------------------
-- A4. Carry the new dimension through the sync + recompute functions.
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
  v_shop      text[];
  v_empty     jsonb := jsonb_build_object(
                'permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                'project_seats', '[]'::jsonb, 'passport_scopes', '[]'::jsonb,
                'shop_sources', '[]'::jsonb);
begin
  if v_uid is null then return v_empty; end if;
  select email into v_email from public.users where id = v_uid;
  if v_email is null then return v_empty; end if;

  v_perms    := public.effective_team_permissions_for_email(v_email);
  v_vs_depts := public.effective_team_vs_depts_for_email(v_email);
  v_seats    := public.effective_team_project_seats_for_email(v_email);
  v_passport := public.effective_team_passport_scopes_for_email(v_email);
  v_shop     := public.effective_team_shop_sources_for_email(v_email);

  perform set_config('app.team_sync', '1', true);

  update public.team_members
     set user_id = v_uid
   where lower(kkumail) = lower(v_email)
     and user_id is distinct from v_uid;

  update public.users
     set managed_permissions     = v_perms,
         managed_vs_depts        = v_vs_depts,
         managed_project_seats   = v_seats,
         managed_passport_scopes = v_passport,
         managed_shop_sources    = v_shop
   where id = v_uid
     and (managed_permissions     is distinct from v_perms
       or managed_vs_depts        is distinct from v_vs_depts
       or managed_project_seats   is distinct from v_seats
       or managed_passport_scopes is distinct from v_passport
       or managed_shop_sources    is distinct from v_shop);

  return jsonb_build_object(
    'permissions',     to_jsonb(v_perms),
    'vs_depts',        to_jsonb(v_vs_depts),
    'project_seats',   to_jsonb(v_seats),
    'passport_scopes', to_jsonb(v_passport),
    'shop_sources',    to_jsonb(v_shop)
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
  v_shop     text[];
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
          or managed_shop_sources    <> '{}'
          or exists (select 1 from public.team_members tm
                      where lower(tm.kkumail) = lower(users.email)) )
  loop
    v_perms    := public.effective_team_permissions_for_email(u.email);
    v_vs_depts := public.effective_team_vs_depts_for_email(u.email);
    v_seats    := public.effective_team_project_seats_for_email(u.email);
    v_passport := public.effective_team_passport_scopes_for_email(u.email);
    v_shop     := public.effective_team_shop_sources_for_email(u.email);
    update public.users
       set managed_permissions     = v_perms,
           managed_vs_depts        = v_vs_depts,
           managed_project_seats   = v_seats,
           managed_passport_scopes = v_passport,
           managed_shop_sources    = v_shop
     where id = u.id
       and (managed_permissions     is distinct from v_perms
         or managed_vs_depts        is distinct from v_vs_depts
         or managed_project_seats   is distinct from v_seats
         or managed_passport_scopes is distinct from v_passport
         or managed_shop_sources    is distinct from v_shop);
  end loop;
  return null;
end;
$$;

drop trigger if exists team_nodes_recompute_perms on public.team_nodes;
create trigger team_nodes_recompute_perms
  after insert or delete or update of permissions, inherit_permissions, parent_id,
                                      vs_dept, project_seat,
                                      passport_dept_id, passport_sub_dept_id,
                                      shop_source
  on public.team_nodes
  for each statement execute function public.recompute_team_managed_permissions();

drop trigger if exists team_members_recompute_perms on public.team_members;
create trigger team_members_recompute_perms
  after insert or delete or update of permissions, inherit_permissions, node_id, kkumail,
                                      vs_dept, project_seat,
                                      passport_dept_id, passport_sub_dept_id,
                                      shop_source
  on public.team_members
  for each statement execute function public.recompute_team_managed_permissions();

-- ------------------------------------------------------------
-- A5. Guard the new server-managed column (same list as 0087).
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
     or new.managed_passport_scopes is distinct from old.managed_passport_scopes
     or new.managed_shop_sources is distinct from old.managed_shop_sources then
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

-- ============================================================
-- PART B — reads that only knew about roles
-- ============================================================

-- เขียนประกาศ / ลำดับการแสดงประกาศ: a `creator` grantee must see the drafts and
-- pending posts they are able to write, not just the approved ones.
drop policy if exists "announcements_read" on public.announcements;
create policy "announcements_read" on public.announcements
  for select
  using (status = 'approved'
      or public.current_user_is_staff()
      or public.current_user_has_permission('creator'));

-- VitalSound: a dept-scoped handler administers these tickets, so they must be
-- able to read the followers and the staff-only comment thread on them.
-- current_user_is_vs_handler() is already "staff OR any VS scope" (0084/0085).
drop policy if exists "vs_followers_read_staff" on public.vs_followers;
create policy "vs_followers_read_staff" on public.vs_followers
  for select using (public.current_user_is_vs_handler());

drop policy if exists "vs_public_comments_read_staff" on public.vs_public_comments;
create policy "vs_public_comments_read_staff" on public.vs_public_comments
  for select using (public.current_user_is_vs_handler());

-- สถิติการใช้งาน is offered to anyone who can use the admin app, so the read
-- must follow the same rule. Any tree grant counts; a plain user still gets
-- nothing. (The dashboard escapes every field on render — 0065 — because this
-- table is anon-INSERTable.)
create or replace function public.current_user_has_any_grant()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_user_is_staff(), false)
      or exists (
           select 1 from public.users u
            where u.id = auth.uid()
              and (coalesce(u.permissions, '{}')             <> '{}'
                or coalesce(u.managed_permissions, '{}')     <> '{}'
                or coalesce(u.managed_vs_depts, '{}')        <> '{}'
                or coalesce(u.managed_project_seats, '{}')   <> '{}'
                or coalesce(u.managed_passport_scopes, '{}') <> '{}'
                or coalesce(u.managed_shop_sources, '{}')    <> '{}')
         )
$$;

comment on function public.current_user_has_any_grant() is
  'Can this account use the admin app at all — by role OR by any ทีม SAMO grant '
  '(0093). Mirrors canUseAdmin() in admin-main.js. NOT a substitute for '
  'current_user_is_staff(), which users_self_update_guard trusts for privileged '
  'column writes and must stay a role list.';

revoke all on function public.current_user_has_any_grant() from public;
grant execute on function public.current_user_has_any_grant() to anon, authenticated;

drop policy if exists "analytics_events_select_staff" on public.analytics_events;
create policy "analytics_events_select_staff" on public.analytics_events
  for select using (public.current_user_has_any_grant());

-- ------------------------------------------------------------
-- Re-resolve every tree-linked account so the new column is populated.
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
       set managed_shop_sources = public.effective_team_shop_sources_for_email(u.email)
     where id = u.id;
  end loop;
end $$;
