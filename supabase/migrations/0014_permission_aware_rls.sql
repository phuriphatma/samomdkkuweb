-- ============================================================
-- 0014_permission_aware_rls.sql
--
-- Bug: VP accounts with permissions = ['pr'] / ['creator'] / ['samoshop']
-- saw blank dashboards because the RLS policies on pr_tickets,
-- pr_agents, announcements (writes), and shop_* gated only on the
-- ROLE (pr_staff / shop_admin / dev) and didn't consult the
-- permissions[] array added in 0010.
--
-- Fix: extend those policies to ALSO grant access when the user has
-- the matching permission. Same UI gating still applies — this just
-- catches up the DB to the per-account permission model.
--
-- Affects:
--   pr_tickets        — read/update/delete now honor 'pr' permission
--   pr_agents         — read/write now honor 'pr' permission
--   announcements     — write (insert/update/delete) honors 'creator'
--   shop_*            — broadened via current_user_is_shop_admin() to
--                       also return true for users with 'samoshop'
--                       permission. All existing shop policies that
--                       gate on that helper automatically pick this up.
-- ============================================================

-- ------------------------------------------------------------
-- pr_tickets — read / update / delete
-- ------------------------------------------------------------

drop policy if exists "pr_tickets_read" on public.pr_tickets;
create policy "pr_tickets_read" on public.pr_tickets
  for select using (
    submitter_id = auth.uid()
    or public.current_user_role() in ('pr_staff', 'dev')
    or public.current_user_has_permission('pr')
  );

drop policy if exists "pr_tickets_update_staff" on public.pr_tickets;
create policy "pr_tickets_update_staff" on public.pr_tickets
  for update using (
    public.current_user_role() in ('pr_staff', 'dev')
    or public.current_user_has_permission('pr')
  );

drop policy if exists "pr_tickets_delete_staff" on public.pr_tickets;
create policy "pr_tickets_delete_staff" on public.pr_tickets
  for delete using (
    public.current_user_role() in ('pr_staff', 'dev')
    or public.current_user_has_permission('pr')
  );

-- ------------------------------------------------------------
-- pr_agents — read / write
-- ------------------------------------------------------------

drop policy if exists "pr_agents_read" on public.pr_agents;
create policy "pr_agents_read" on public.pr_agents
  for select using (
    public.current_user_is_staff()
    or public.current_user_has_permission('pr')
  );

drop policy if exists "pr_agents_write" on public.pr_agents;
create policy "pr_agents_write" on public.pr_agents
  for all using (
    public.current_user_role() in ('pr_staff', 'dev')
    or public.current_user_has_permission('pr')
  ) with check (
    public.current_user_role() in ('pr_staff', 'dev')
    or public.current_user_has_permission('pr')
  );

-- ------------------------------------------------------------
-- announcements — write (read is public; left alone)
-- ------------------------------------------------------------

drop policy if exists "announcements_write" on public.announcements;
create policy "announcements_write" on public.announcements
  for all using (
    public.current_user_role() in ('pr_staff', 'dev')
    or public.current_user_has_permission('creator')
  ) with check (
    public.current_user_role() in ('pr_staff', 'dev')
    or public.current_user_has_permission('creator')
  );

-- ------------------------------------------------------------
-- shop — broaden the central helper. All shop_* policies gate on
-- current_user_is_shop_admin() so updating the helper grants access
-- everywhere at once.
-- ------------------------------------------------------------

create or replace function public.current_user_is_shop_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.current_user_role() in ('shop_admin', 'dev')
    or public.current_user_has_permission('samoshop')
$$;

grant execute on function public.current_user_is_shop_admin() to anon, authenticated;
