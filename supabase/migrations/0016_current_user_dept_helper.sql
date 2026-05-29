-- ============================================================
-- 0016_current_user_dept_helper.sql
--
-- Refactor: replace the inline
--   (select department from public.users where id = auth.uid())
-- subqueries used in the vp_admin dept gates with a security-definer
-- helper. The inline form silently depends on `users_read_all` (0001)
-- staying permissive — if anyone tightens that policy, every per-dept
-- VP gate would return NULL → comparison fails → 0 rows, with no error.
--
-- Touches the three vs_tickets policies that embed the subquery:
--   * vs_tickets_read              (0010)
--   * vs_tickets_update_staff      (0013)
--   * vs_tickets_delete_staff      (0015)
--
-- Behavior is unchanged; this is a coupling fix.
-- ============================================================

create or replace function public.current_user_dept()
returns text language sql stable security definer set search_path = public as $$
  select department from public.users where id = auth.uid()
$$;

grant execute on function public.current_user_dept() to anon, authenticated;


-- ------------------------------------------------------------
-- vs_tickets_read  (mirrors 0010 shape)
-- ------------------------------------------------------------

drop policy if exists "vs_tickets_read" on public.vs_tickets;
create policy "vs_tickets_read" on public.vs_tickets
  for select using (
    submitter_id = auth.uid()
    or public.current_user_role() in ('vs_staff', 'dev')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept = public.current_user_dept()
    )
  );


-- ------------------------------------------------------------
-- vs_tickets_update_staff  (mirrors 0013 shape — USING/WITH CHECK split)
-- ------------------------------------------------------------

drop policy if exists "vs_tickets_update_staff" on public.vs_tickets;
create policy "vs_tickets_update_staff" on public.vs_tickets
  for update using (
    public.current_user_role() in ('vs_staff', 'dev')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept = public.current_user_dept()
    )
  ) with check (
    public.current_user_role() in ('vs_staff', 'dev')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept in (public.current_user_dept(), 'SE')
    )
  );

comment on policy "vs_tickets_update_staff" on public.vs_tickets is
  'vs_staff/dev: full update. vp_admin: USING limits to tickets in own dept; WITH CHECK allows new target_dept to be own dept OR SE only (no VP→VP direct transfer).';


-- ------------------------------------------------------------
-- vs_tickets_delete_staff  (mirrors 0015 shape)
-- ------------------------------------------------------------

drop policy if exists "vs_tickets_delete_staff" on public.vs_tickets;
create policy "vs_tickets_delete_staff" on public.vs_tickets
  for delete using (
    public.current_user_role() in ('vs_staff', 'dev')
    or public.current_user_has_permission('vs')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept = public.current_user_dept()
    )
  );

comment on policy "vs_tickets_delete_staff" on public.vs_tickets is
  'Any VS staff (vs_staff / dev / has(''vs'')) delete any. vp_admin delete tickets in own dept only.';
