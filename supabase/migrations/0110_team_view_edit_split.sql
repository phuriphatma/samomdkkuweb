-- ============================================================
-- 0110 — ทีม SAMO: split `team` into VIEW and EDIT, and let a person fix
--        their own row
--
-- WHAT THE USER ASKED FOR
--   1. "everyone that has email in the admin teamsamo can view all information
--      in the admin teamsamo"
--   2. "i think you can have permission teamsamo view, teamsamo edit"
--   3. "the current people who has permission teamsamo should has permission
--      teamsamo edit"
--   4. "i still want people who has teamsamo edit permission to can edit the
--      permission everyone got"
--
-- THE SHAPE. `team` becomes the VIEW key and `team_edit` the WRITE key. The
-- two are NOT independent checkboxes: `team_edit` is strictly stronger, and
-- every read policy accepts either, so an editor never needs both ticked.
--
-- Membership grants VIEW implicitly. This is the important design choice, and
-- the alternative is what makes it worth writing down: the obvious
-- implementation is a `current_user_is_team_member()` helper OR-ed into each
-- read policy. That would have been a THIRD access channel, and the rule this
-- repo has paid for five times (0089 → 0090 → 0091 → 0093 → 0102) is that a
-- new channel has to be threaded through every gate the old one used — here
-- the two read policies, `userCanAccess('team')`, `ADMIN_FEATURES`, and
-- `canUseAdmin()` in admin-main.js. Instead the implicit grant is injected ONCE
-- in `effective_team_permissions_for_email()` (§2), so it arrives as an
-- ordinary `team` permission and every existing gate — SQL and JS — honours it
-- with no new plumbing.
--
-- ⚠️ PRIVACY, DELIBERATE AND EXPLICITLY REQUESTED. This lets all 285 distinct
-- people in the tree read all 404 `team_members` rows, including every other
-- person's `student_id`, `kkumail`, `year`, `major` and permission grants.
-- Before 0110 that was visible only to vp_admin/dev/`team` holders. The user
-- was shown this consequence and chose it ("Everything (as asked)"). It is a
-- widening of who can read student PII, not of who can change anything.
-- The PUBLIC org chart is unaffected — `get_public_team_chart()` is still a
-- hand-built projection of names and ตำแหน่ง only, and `team_members` still has
-- no policy granting `anon` anything (asserted in tools/team0110-view-edit.mjs).
--
-- ⚠️ `team_edit` remains effectively root, exactly as `team` was (0089): whoever
-- holds it can grant any permission, including `team_edit`, to anyone including
-- themselves. That is inherent to "may manage the org tree" and is requirement
-- 4 above. Not widened here — it is the same power, under a new name.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — Requirement 3: today's `team` holders become `team_edit` holders.
--
-- Rewrite in place rather than adding `team_edit` alongside: leaving `team` on
-- these rows would be harmless today but would make the two keys look like
-- independent grants, which is the "a narrowing scope added alongside an
-- unconditional permission is DEAD" trap (0083) waiting for someone to untick
-- the wrong one. VIEW comes back implicitly via §2 for anyone in the tree.
--
-- Idempotent: `array_remove` then `array_append` guarded by a NOT-any test.
-- ------------------------------------------------------------
update public.team_nodes
   set permissions = array_append(array_remove(permissions, 'team'), 'team_edit')
 where 'team' = any (coalesce(permissions, '{}'))
   and not ('team_edit' = any (coalesce(permissions, '{}')));

update public.team_members
   set permissions = array_append(array_remove(permissions, 'team'), 'team_edit')
 where 'team' = any (coalesce(permissions, '{}'))
   and not ('team_edit' = any (coalesce(permissions, '{}')));

-- The MANUAL channel (`users.permissions[]`, set by hand for staff accounts)
-- carries no 'team' today, but migrate it too so the key means one thing
-- everywhere. `users_self_update_guard` (0028/0041) fires on UPDATE of
-- `permissions` for non-staff callers — a migration runs as superuser with
-- auth.uid() = null, which is exactly the case 0041 had to special-case, so
-- disable the guard for this one statement and re-enable it. Safe because the
-- Management API runs the file as ONE implicit transaction (a failure rolls the
-- DISABLE back) and ALTER TABLE ... DISABLE TRIGGER takes an ACCESS EXCLUSIVE
-- lock, so no other session ever observes the guard off.
alter table public.users disable trigger users_self_update_guard;
update public.users
   set permissions = array_append(array_remove(permissions, 'team'), 'team_edit')
 where 'team' = any (coalesce(permissions, '{}'))
   and not ('team_edit' = any (coalesce(permissions, '{}')));
alter table public.users enable trigger users_self_update_guard;

-- ------------------------------------------------------------
-- §2 — Requirement 1: being in the tree IS the view grant.
--
-- BASED ON THE LIVE BODY of effective_team_permissions_for_email as of
-- 2026-08-05 (0081 is the only file that defines it; verified with
-- pg_get_functiondef before editing — see the "recreating a function from the
-- migration that FIRST defined it" entry in docs/mistakes/postgres-schema.md).
-- The ONLY change is the implicit 'team' below.
-- ------------------------------------------------------------
create or replace function public.effective_team_permissions_for_email(p_email text)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare
  v_out   text[] := '{}';
  v_found boolean := false;
  m       public.team_members%rowtype;
begin
  if p_email is null or length(btrim(p_email)) = 0 then
    return '{}';
  end if;
  for m in
    select * from public.team_members where lower(kkumail) = lower(btrim(p_email))
  loop
    v_found := true;
    v_out := v_out || coalesce(m.permissions, '{}');
    if coalesce(m.inherit_permissions, true) then
      v_out := v_out || public.node_effective_permissions(m.node_id);
    end if;
  end loop;

  -- 0110: a posting in the tree grants VIEW of ทีม SAMO, with no grant needed.
  -- Injected here so it reaches RLS, userCanAccess() and ADMIN_FEATURES through
  -- the one channel they all already read (users.managed_permissions).
  if v_found then
    v_out := v_out || array['team'];
  end if;

  -- dedupe
  return (select coalesce(array_agg(distinct p), '{}') from unnest(v_out) as p);
end;
$$;

-- ------------------------------------------------------------
-- §3 — Split the single FOR ALL policy into READ and WRITE.
--
-- 0089's `team_*_all_vp_dev` was FOR ALL with `has_permission('team')` in both
-- USING and WITH CHECK. Leaving it in place and adding a narrower read policy
-- would do NOTHING (permissive policies are OR-ed — the "scoped is not full"
-- class), so the ALL policy is dropped and rebuilt around `team_edit`.
-- ------------------------------------------------------------
drop policy if exists "team_nodes_all_vp_dev"   on public.team_nodes;
drop policy if exists "team_members_all_vp_dev" on public.team_members;
drop policy if exists "team_nodes_write"        on public.team_nodes;
drop policy if exists "team_members_write"      on public.team_members;
drop policy if exists "team_nodes_read"         on public.team_nodes;
drop policy if exists "team_members_read"       on public.team_members;

create policy "team_nodes_write" on public.team_nodes
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  );

create policy "team_nodes_read" on public.team_nodes
  for select to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
    or public.current_user_has_permission('team')
  );

create policy "team_members_write" on public.team_members
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  );

create policy "team_members_read" on public.team_members
  for select to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
    or public.current_user_has_permission('team')
  );

comment on policy "team_members_write" on public.team_members is
  'Manage ทีม SAMO: role vp_admin/dev, or `team_edit` from either channel — 0110. '
  'The `team` key is VIEW ONLY and deliberately absent here.';
comment on policy "team_members_read" on public.team_members is
  'View ทีม SAMO: vp_admin/dev, `team_edit`, or `team` — and `team` is granted '
  'implicitly to anyone with a posting in the tree by '
  'effective_team_permissions_for_email() — 0110. No anon branch: the public org '
  'chart is served by the get_public_team_chart() projection, not by this table.';

-- ------------------------------------------------------------
-- §4 — A person may fix THEIR OWN row.
--
-- The recurring class this has to survive (found on `users` 0028, `vs_tickets`
-- 0096, `shop_orders` 0100): a per-row UPDATE policy is a ROW filter, never a
-- COLUMN policy. Once `using (this is my row)` passes, PostgREST will write any
-- column in the body — so without the guard below, any of the 285 members could
-- PATCH `permissions='{team_edit}'` onto their own row and become root.
--
-- The guard is deny-by-default: it diffs `to_jsonb(row) - allowed_keys`, so a
-- column added by a FUTURE migration is guarded automatically rather than
-- silently becoming self-writable.
--
-- KNOWN, ACCEPTED: `team_person_mirror_down()` (0108, trigger on team_people)
-- also writes guarded columns here (`kkumail`, `user_id`) and does NOT set the
-- app.team_sync flag. It is unreachable by a non-editor today — only
-- `team_edit`/vp_admin/dev can write `team_people`, and they are exempted
-- above — so it cannot fire under the guard. If `team_people` ever gains a
-- self-service surface, give that function the same `set_config('app.team_sync',
-- '1', true)` line rather than widening the allow-list here.
--
-- `kkumail` is deliberately NOT self-editable, for two independent reasons:
-- it is the identity this whole resolver chain keys on, and changing it would
-- move the row out of the caller's own SELECT policy — which Postgres reports
-- as a WITH CHECK violation and is un-PATCHable by construction (0107).
-- ------------------------------------------------------------
-- The caller's email, resolved WITHOUT depending on `public.users`'s own RLS.
-- An inline `(select email from public.users where id = auth.uid())` inside a
-- policy is evaluated under the CALLER's rights, so it works today only because
-- `users_read_all` happens to be `auth.role() = 'authenticated'`. Anyone
-- tightening that policy later would silently empty this one — the exact
-- coupling logged in docs/mistakes/authz-rls.md ("RLS inline subqueries
-- silently depend on the referenced table's RLS"), which is why every
-- cross-table lookup in a predicate here goes through a definer helper.
create or replace function public.current_user_email()
returns text language sql stable security definer set search_path = public as $$
  select nullif(btrim(coalesce(email, '')), '') from public.users where id = auth.uid();
$$;
revoke all on function public.current_user_email() from public, anon;
grant execute on function public.current_user_email() to authenticated;

create or replace function public.team_members_self_update_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  -- Columns a person may set on their own row. Everything else is admin-owned.
  -- `updated_at` is excluded from the DIFF (not granted): touch_updated_at is a
  -- BEFORE trigger on the same table and the two orderings are decided by name,
  -- so comparing it would reject every write depending on which fired first.
  v_allowed text[] := array[
    'prefix', 'full_name', 'nickname', 'student_id', 'year', 'major',
    'photo_url', 'photo_focus', 'updated_at'
  ];
  v_old jsonb;
  v_new jsonb;
begin
  -- THE SERVER-WRITER EXEMPTION. Read this before touching the guard.
  --
  -- `sync_my_team_permissions()` runs on EVERY login and does
  --   update team_members set user_id = v_uid where lower(kkumail) = lower(email)
  -- — a write to a guarded column, from a SECURITY DEFINER function, with a
  -- REAL auth.uid() (the member's own). The first cut of this guard therefore
  -- raised on every login by a member without `team_edit`: a total lockout of
  -- exactly the people 0110 exists for. Caught by tools/team0110-view-edit.mjs
  -- before it reached anyone.
  --
  -- This is the 0041 class ("a self-update column guard bricks signup when it
  -- blocks a column another trigger legitimately writes") wearing a second
  -- shape: the offending writer is not a TRIGGER, it is a definer FUNCTION,
  -- and `auth.uid() is null` — the test 0041 taught — does not catch it.
  -- The right signal is the one the server writer sets about itself, which
  -- 0081 already established: a transaction-local `app.team_sync`. A client
  -- cannot set it (PostgREST exposes no set_config, and it is scoped to the
  -- transaction), so it identifies our own code, not a claim from the caller.
  if coalesce(current_setting('app.team_sync', true), '') = '1' then return new; end if;

  -- Other server contexts (migrations, tools/*.mjs over the Management API,
  -- the recompute trigger) run with auth.uid() = null and must pass untouched.
  if auth.uid() is null then return new; end if;
  if public.current_user_role() = any (array['vp_admin', 'dev'])
     or public.current_user_has_permission('team_edit') then
    return new;
  end if;

  v_old := to_jsonb(old) - v_allowed;
  v_new := to_jsonb(new) - v_allowed;
  if v_old is distinct from v_new then
    raise exception 'team_members_self_update_guard: you may only edit your own name, nickname, student id, year, major and photo'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists team_members_self_update_guard on public.team_members;
create trigger team_members_self_update_guard
  before update on public.team_members
  for each row execute function public.team_members_self_update_guard();

drop policy if exists "team_members_update_self" on public.team_members;
create policy "team_members_update_self" on public.team_members
  for update to authenticated
  using (
    public.current_user_email() is not null
    and lower(btrim(coalesce(kkumail, ''))) = lower(public.current_user_email())
  )
  with check (
    public.current_user_email() is not null
    and lower(btrim(coalesce(kkumail, ''))) = lower(public.current_user_email())
  );

comment on policy "team_members_update_self" on public.team_members is
  'A member may correct their OWN row (0110). The blank-guard on both sides is '
  'load-bearing: 19 live rows have a null/blank kkumail and a caller whose '
  'users.email is blank would otherwise match every one of them. Column scope '
  'is enforced by team_members_self_update_guard, NOT by this policy — RLS is '
  'row-level only.';

-- ------------------------------------------------------------
-- §5 — Re-derive managed_permissions so the split takes effect immediately.
--
-- Without this, an existing `team` holder keeps the stale managed_permissions
-- until their next login sync and would lose write access in the meantime.
-- `sync_my_team_permissions()` only ever resolves the CALLER, so the backfill
-- is done directly here. The recompute trigger writes the same column, so the
-- same guard-disable applies.
-- ------------------------------------------------------------
alter table public.users disable trigger users_self_update_guard;
update public.users u
   set managed_permissions = public.effective_team_permissions_for_email(u.email)
 where u.email is not null
   and length(btrim(u.email)) > 0
   and u.managed_permissions
       is distinct from public.effective_team_permissions_for_email(u.email);
alter table public.users enable trigger users_self_update_guard;

-- ------------------------------------------------------------
-- §6 — get_my_team_seat(): the card now shows the whole record.
--
-- BASED ON 0109's BODY (the only definition; verified live). Changes:
--   • per-posting member_id + the identity fields, so the card can render the
--     portrait and every detail, and so the self-edit form knows which row to
--     PATCH;
--   • `can_edit_team` / `can_view_team`, so the card can say whether the person
--     may fix their own record here or must ask an admin.
--
-- Still a hand-built jsonb allow-list, never `returns setof team_members` — a
-- `setof` would auto-expose every column added by a future migration (the 0080
-- trap). Still takes NO argument: identity is auth.uid(), so this cannot be
-- aimed at anyone else and can never become a roster lookup.
-- ------------------------------------------------------------
create or replace function public.get_my_team_seat()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_postings jsonb := '[]'::jsonb;
  m          public.team_members%rowtype;
  v_node     public.team_nodes%rowtype;
  v_name     text;
  v_nick     text;
  v_empty    jsonb := jsonb_build_object(
                'email', null, 'name', null, 'nickname', null,
                'postings', '[]'::jsonb,
                'permissions', '[]'::jsonb, 'vs_depts', '[]'::jsonb,
                'project_seats', '[]'::jsonb, 'passport_scopes', '[]'::jsonb,
                'can_view_team', false, 'can_edit_team', false);
begin
  if v_uid is null then return v_empty; end if;
  select email into v_email from public.users where id = v_uid;
  -- NOTE `is null or length(btrim()) = 0` rather than a bare null check: a
  -- blank email would match `lower(kkumail) = ''` on any member row whose
  -- kkumail is the empty string, which is 10 live rows.
  if v_email is null or length(btrim(v_email)) = 0 then return v_empty; end if;

  for m in
    select * from public.team_members
     where lower(kkumail) = lower(btrim(v_email))
     order by created_at
  loop
    select * into v_node from public.team_nodes where id = m.node_id;
    if not found then continue; end if;      -- posting on a deleted ตำแหน่ง
    v_name := coalesce(v_name, nullif(btrim(coalesce(m.full_name, '')), ''));
    v_nick := coalesce(v_nick, nullif(btrim(coalesce(m.nickname,  '')), ''));
    v_postings := v_postings || jsonb_build_object(
      'member_id', m.id,
      'node_id',  v_node.id,
      'node',     v_node.name,
      'path',     to_jsonb(public.team_node_path(v_node.id)),
      'is_board', coalesce(v_node.is_board, false),
      -- The person's own record, so the card can show it and offer the fix.
      -- Every one of these is the CALLER'S OWN data — this adds no visibility
      -- of anyone else.
      'prefix',     m.prefix,
      'full_name',  m.full_name,
      'nickname',   m.nickname,
      'student_id', m.student_id,
      'year',       m.year,
      'major',      m.major,
      'kkumail',    m.kkumail,
      'photo_url',  m.photo_url,
      'photo_focus', m.photo_focus,
      -- Per-posting, so a person holding two seats can see which one carries
      -- which ability rather than one merged pile.
      'permissions', to_jsonb((
        select coalesce(array_agg(distinct p), '{}') from unnest(
          coalesce(m.permissions, '{}') ||
          case when coalesce(m.inherit_permissions, true)
               then public.node_effective_permissions(v_node.id)
               else '{}'::text[] end
        ) as p)),
      'confirmed', coalesce(m.confirmed, false)
    );
  end loop;

  return jsonb_build_object(
    'email',           v_email,
    'name',            v_name,
    'nickname',        v_nick,
    'postings',        v_postings,
    -- The union, i.e. exactly what the RLS helpers will answer for this caller.
    'permissions',     to_jsonb(public.effective_team_permissions_for_email(v_email)),
    'vs_depts',        to_jsonb(public.effective_team_vs_depts_for_email(v_email)),
    'project_seats',   to_jsonb(public.effective_team_project_seats_for_email(v_email)),
    'passport_scopes', to_jsonb(public.effective_team_passport_scopes_for_email(v_email)),
    'can_view_team',   public.current_user_has_permission('team')
                        or public.current_user_has_permission('team_edit')
                        or public.current_user_role() = any (array['vp_admin','dev']),
    'can_edit_team',   public.current_user_has_permission('team_edit')
                        or public.current_user_role() = any (array['vp_admin','dev'])
  );
end;
$$;

-- ------------------------------------------------------------
-- §7 — ACLs. This database's ALTER DEFAULT PRIVILEGES grant EXECUTE on every
-- new function to anon AND authenticated, and `revoke ... from public` does
-- NOT strip those — the trap that shipped team_node_path world-callable in
-- 0109. Revoke by NAME, then verify from pg_proc.proacl (the proof script
-- asserts it; do not trust this text).
--
-- The guard function is a trigger body — nothing should call it directly.
-- ------------------------------------------------------------
revoke all on function public.team_members_self_update_guard() from public, anon, authenticated;
revoke all on function public.effective_team_permissions_for_email(text) from public, anon, authenticated;

-- get_my_team_seat stays callable by a signed-in user (it resolves only the
-- caller); anon gets nothing.
revoke all on function public.get_my_team_seat() from public, anon;
grant execute on function public.get_my_team_seat() to authenticated;

-- ------------------------------------------------------------
-- §8 — the OTHER four team tables and the two term RPCs.
--
-- FOUND BY tools/team0104-terms.mjs, which went 37/40 the moment §3 landed —
-- three failures that were a REAL privilege regression introduced by this very
-- migration, not stale assertions:
--
--     FAIL other permissions alone cannot write team_terms
--     FAIL publish_team_term refuses a caller without `team`
--     FAIL team_term_status refuses a caller without `team`
--
-- Cause: §3 redefined `team` from "may manage ทีม SAMO" to "may look at it",
-- and §2 then handed it to all ~285 people in the tree. Every OTHER object
-- still reading `has_permission('team')` as a WRITE check therefore became
-- writable by every member: the ปีการศึกษา archive tables, `team_people`, and
-- publish/close of an academic year.
--
-- This is the mirror image of the rule this repo keeps relearning. The logged
-- version is "a new access channel must be threaded through every gate the old
-- one used" (0089 → 0090 → 0091 → 0093 → 0102). The inverse is just as sharp:
-- WEAKENING the meaning of an existing key silently promotes every gate that
-- still treats it as the strong one. Enumerate with, not from memory:
--   select tablename, policyname from pg_policies
--    where (coalesce(qual,'')||coalesce(with_check,'')) ~ 'has_permission\(''team''\)';
--   select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and pg_get_functiondef(p.oid) ~ 'has_permission\(''team''\)';
--
-- Read policies follow the same shape as §3 (view for `team`, write for
-- `team_edit`) so a member can SEE the archive and the people register — that
-- is the requested "view all information" — without being able to change them.
-- `get_my_team_seat()` also names `team`, correctly: it is reporting whether
-- the caller may VIEW, and is left alone.
-- ------------------------------------------------------------

-- team_terms: ปีการศึกษา (which year is live)
drop policy if exists "team_terms_all_manage" on public.team_terms;
drop policy if exists "team_terms_write"      on public.team_terms;
drop policy if exists "team_terms_read"       on public.team_terms;

create policy "team_terms_write" on public.team_terms
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  );

create policy "team_terms_read" on public.team_terms
  for select to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
    or public.current_user_has_permission('team')
  );

-- team_people: the person register (0108) — identity data, same class as team_members
drop policy if exists "team_people_all_manage" on public.team_people;
drop policy if exists "team_people_write"      on public.team_people;
drop policy if exists "team_people_read"       on public.team_people;

create policy "team_people_write" on public.team_people
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  );

create policy "team_people_read" on public.team_people
  for select to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
    or public.current_user_has_permission('team')
  );

-- team_archive_nodes: published org-chart snapshot
drop policy if exists "team_archive_nodes_all_manage" on public.team_archive_nodes;
drop policy if exists "team_archive_nodes_write"      on public.team_archive_nodes;
drop policy if exists "team_archive_nodes_read"       on public.team_archive_nodes;

create policy "team_archive_nodes_write" on public.team_archive_nodes
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  );

create policy "team_archive_nodes_read" on public.team_archive_nodes
  for select to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
    or public.current_user_has_permission('team')
  );

-- team_archive_members: published member snapshot
drop policy if exists "team_archive_members_all_manage" on public.team_archive_members;
drop policy if exists "team_archive_members_write"      on public.team_archive_members;
drop policy if exists "team_archive_members_read"       on public.team_archive_members;

create policy "team_archive_members_write" on public.team_archive_members
  for all to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  )
  with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
  );

create policy "team_archive_members_read" on public.team_archive_members
  for select to authenticated
  using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or public.current_user_has_permission('team_edit')
    or public.current_user_has_permission('team')
  );

-- ── team_term_status: publishing/closing an academic year is an EDIT.
create or replace function public.team_term_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_live timestamptz;
begin
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'team_term_status: not authorized';
  end if;

  select greatest(
           coalesce((select max(updated_at) from public.team_nodes),   'epoch'::timestamptz),
           coalesce((select max(updated_at) from public.team_members), 'epoch'::timestamptz))
    into v_live;

  return jsonb_build_object(
    'live_updated_at', v_live,
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'year', t.year,
               'published_at', t.published_at,
               -- Only meaningful for the CURRENT year: an archived past year is
               -- supposed to diverge from the live tree, that is what it is for.
               'stale', (t.is_current and t.published_at is not null
                         and v_live > t.published_at))
             order by t.year desc)
        from public.team_terms t), '[]'::jsonb));
end;
$function$;

-- ── publish_team_term: publishing/closing an academic year is an EDIT.
create or replace function public.publish_team_term(p_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nodes   integer;
  v_members integer;
  v_kept    integer;
begin
  -- coalesce(..., false) is load-bearing. current_user_role() is NULL for a
  -- caller with no public.users row, and `null = any(...)` is NULL, so a bare
  -- `if not (...)` would evaluate `not null` = null, skip the raise, and run the
  -- privileged body. mistakes.md: "null in (...) makes a raise-on-unauthorized
  -- guard fail OPEN".
  if not coalesce(
       public.current_user_role() = any (array['vp_admin', 'dev'])
       or public.current_user_has_permission('team_edit'), false) then
    raise exception 'publish_team_term: not authorized';
  end if;

  if p_year is null or p_year < 2500 or p_year > 2700 then
    raise exception 'publish_team_term: bad year %', p_year;
  end if;

  insert into public.team_terms (year) values (p_year)
    on conflict (year) do nothing;

  -- Stash the photos this year's archive already holds, keyed by the live member
  -- they came from. A temp table (not a CTE) because the delete below has to
  -- happen in between. ON COMMIT DROP so a re-run in the same session is clean.
  create temp table if not exists _pub_photos (
    src_member_id uuid primary key, photo_url text, photo_focus text
  ) on commit drop;
  delete from _pub_photos;
  insert into _pub_photos (src_member_id, photo_url, photo_focus)
  select distinct on (am.src_member_id) am.src_member_id, am.photo_url, am.photo_focus
    from public.team_archive_members am
   where am.year = p_year
     and am.src_member_id is not null
     and am.photo_url is not null
   order by am.src_member_id, am.id;

  -- Cascades to team_archive_members via node_id.
  delete from public.team_archive_nodes where year = p_year;

  -- `as materialized` is required, not stylistic: `mapped` is referenced twice
  -- and contains gen_random_uuid(). Inlined, each reference would generate a
  -- DIFFERENT uuid and every parent_id lookup would come back null, silently
  -- flattening the tree.
  with recursive live as (
    select n.id, n.parent_id, n.name, n.kind, n.position, n.is_board
      from public.team_nodes n
     where n.parent_id is null and n.is_public
    union all
    select c.id, c.parent_id, c.name, c.kind, c.position, c.is_board
      from public.team_nodes c
      join live l on c.parent_id = l.id
     where c.is_public
  ),
  mapped as materialized (
    select l.*, gen_random_uuid() as new_id from live l
  )
  insert into public.team_archive_nodes
        (id, year, src_id, parent_id, name, kind, position, is_board)
  select m.new_id, p_year, m.id,
         (select p.new_id from mapped p where p.id = m.parent_id),
         m.name, m.kind, m.position, m.is_board
    from mapped m;
  get diagnostics v_nodes = ROW_COUNT;

  -- Only members whose ตำแหน่ง made it into the archive, i.e. the public
  -- subtree. A member under a non-public node is not published live and must
  -- not become published by being archived.
  --
  -- Photo precedence: the live tree wins when it has one; otherwise fall back to
  -- whatever this year's archive already had for that same person.
  insert into public.team_archive_members
        (year, node_id, src_member_id, full_name, nickname, photo_url, photo_focus, position)
  select p_year, an.id, m.id, m.full_name, m.nickname,
         coalesce(m.photo_url,   p.photo_url),
         coalesce(m.photo_focus, p.photo_focus),
         m.position
    from public.team_members m
    join public.team_archive_nodes an on an.year = p_year and an.src_id = m.node_id
    left join _pub_photos p on p.src_member_id = m.id;
  get diagnostics v_members = ROW_COUNT;

  select count(*) into v_kept
    from public.team_archive_members am
    join _pub_photos p on p.src_member_id = am.src_member_id
    join public.team_members m on m.id = am.src_member_id
   where am.year = p_year and m.photo_url is null;

  update public.team_terms
     set published_at = now(), updated_at = now()
   where year = p_year;

  return jsonb_build_object('year', p_year, 'nodes', v_nodes,
                            'members', v_members, 'photos_kept', v_kept);
end;
$function$;
