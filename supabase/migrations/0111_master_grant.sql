-- ============================================================
-- 0111 — `master`: one ทีม SAMO grant that carries every permission
--
-- ASKED FOR: "i want dev/master permission on adminteamsamo that can access
-- everything".
--
-- HOW IT IS BUILT, and why it is one line rather than forty. The obvious
-- implementation is to OR a `current_user_is_master()` helper into every policy
-- — which is precisely the bug this repo has paid for five times over
-- (0089 → 0090 → 0091 → 0093 → 0102, and inverted again in 0110 §8): a new
-- access channel has to be threaded through EVERY gate the old one used, and
-- the one you miss fails silently. So `master` is not a new channel. It is
-- taught to `current_user_has_permission()` — the single predicate that every
-- permission gate in this database already calls — and every one of them
-- honours it with no further change:
--
--   announcements · pr_tickets · pr_agents · shop_* (current_user_is_shop_admin)
--   projects · team_nodes/team_members/team_terms/team_people/team_archive_*
--   vs_tickets + vs_tags + vs_followers + vs_public_comments
--     (current_user_vs_scope already returns NULL = all depts once
--      has_permission('vs') is true)
--   analytics (current_user_has_any_grant) · passport (passport_admin_context
--     already keys its `all_departments` on has_permission('passport'))
--
-- WHAT MASTER IS NOT — deliberately, and this is the important half:
--
--   • It is NOT `role = 'dev'`. `current_user_is_staff()` is UNCHANGED, and it
--     is what `users_self_update_guard` (0028/0041) trusts to allow writes to
--     privileged columns on `public.users`. Widening it would let any master
--     grantee run `update users set role='dev'` on themselves — a PERMANENT
--     escalation that outlives the tree grant and cannot be revoked by editing
--     the tree, destroying the property that makes the tree safe to hand out.
--     The mistakes log is explicit: never widen a predicate a security trigger
--     also consumes.
--
--   • Three role-only surfaces therefore remain closed to a master, all
--     enumerated by query rather than from memory, and all correct:
--       users_update_staff                   — editing OTHER people's user rows
--                                              (role assignment stays with dev)
--       notify_log_select_staff              — the notify diagnostic log
--       reserved_staff_usernames_read_staff  — a reference table 0011 itself
--                                              calls "not load-bearing"
--     If any of these is wanted later, grant the person a real staff role;
--     do not widen current_user_is_staff().
--
-- ⚠️ master is the strongest grant the tree can issue. It includes `team_edit`,
-- so a master can grant `master` to anyone, including themselves. Same property
-- `team`/`team_edit` already had (0089/0110) — stated here so it is a decision
-- rather than a discovery.
-- ============================================================

-- ------------------------------------------------------------
-- §1 — the one line that does the work.
--
-- BASED ON THE LIVE BODY of current_user_has_permission as of 2026-08-05
-- (defined in 0010, redefined in 0081 — the 0081 version is live; verified with
-- pg_get_functiondef before editing, per the "recreating a function from the
-- migration that FIRST defined it" entry).
--
-- Note `perm <> 'master'` is NOT required: asking "does this user hold master?"
-- of a master correctly answers yes. And a NON-master asking about 'master'
-- takes the ordinary array test, so nothing is granted by accident.
-- ------------------------------------------------------------
create or replace function public.current_user_has_permission(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.users
     where id = auth.uid()
       and (perm    = any(permissions) or perm    = any(managed_permissions)
         -- 0111: `master` answers YES to every permission question.
         or 'master' = any(permissions) or 'master' = any(managed_permissions))
  );
$$;

-- ------------------------------------------------------------
-- §2 — the one helper a permission key cannot reach on its own.
--
-- `current_user_project_seats()` reads `users.managed_project_seats` DIRECTLY
-- rather than going through has_permission, so master would otherwise open the
-- หนังสือโครงการ tab with no seat — and 0086's lesson is that a `projects` grant
-- without a seat is a tab with no controls ("a capability key is not a ROLE").
-- Master gets all three seats; `projectSeatRole()` resolves the widest (vpa),
-- which is the ผู้ส่งหนังสือ workflow.
--
-- Found by enumeration, not by guessing:
--   select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname='public'
--      and pg_get_functiondef(p.oid) ~ 'managed_(project_seats|passport_scopes|vs_depts|shop_sources)';
-- Of the nine hits, this is the only one that gates the CALLER's own access:
-- three are server plumbing that must NOT be widened (users_self_update_guard,
-- sync_my_team_permissions, recompute_team_managed_permissions), two are
-- directory lookups about OTHER people (list_project_seat_users,
-- list_project_profs), current_user_vs_depts is already covered because
-- current_user_vs_scope() short-circuits on has_permission('vs'),
-- passport_admin_context keys its full-access flag on has_permission('passport'),
-- and current_user_has_any_grant is true for any non-empty permissions array.
-- ------------------------------------------------------------
create or replace function public.current_user_project_seats()
returns text[] language sql stable security definer set search_path = public as $$
  select case
    when public.current_user_has_permission('master') then array['vpa', 'staff', 'prof']
    else coalesce(
      (select coalesce(u.managed_project_seats, '{}') from public.users u where u.id = auth.uid()),
      '{}')
  end
$$;

comment on function public.current_user_has_permission(text) is
  'True when the caller holds `perm` through either channel (manual '
  'users.permissions or the ทีม SAMO tree''s managed_permissions) — OR holds '
  '`master`, which answers yes to every permission (0111). Deliberately does '
  'NOT touch current_user_is_staff(): master is not a role, and the users '
  'self-update guard must keep refusing it.';
