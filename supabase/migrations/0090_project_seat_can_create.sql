-- ============================================================
-- 0090 — the `vpa` seat must be able to CREATE, not just update
--
-- Found in the end-of-session sweep after the 0089 role-only-gate bug: four
-- project policies never went through current_user_is_project_actor() and
-- stayed hardcoded to role vp_admin/dev —
--   projects_insert / projects_delete
--   project_documents_insert / project_documents_delete
-- 0086 widened the ACTOR helper, so a tree `vpa` seat could update a project
-- and a document but could not create a project or send a new หนังสือ, which
-- is the entire purpose of ผู้ส่งหนังสือ. The seat shipped half-working, and
-- proj0086-seats.mjs missed it because it asserted the HELPER rather than a
-- real INSERT — a predicate test is not a permission test.
--
-- Deliberately NOT switched to current_user_is_project_actor(): that helper
-- also admits uni_staff, who today cannot create projects or documents.
-- Adding the seat alongside the existing role list preserves uni_staff's
-- rights exactly and gives `vpa` parity with vp_admin — nothing else moves.
-- ============================================================

drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects
  for insert with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or 'vpa' = any (public.current_user_project_seats())
  );

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects
  for delete using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or 'vpa' = any (public.current_user_project_seats())
  );

drop policy if exists "project_documents_insert" on public.project_documents;
create policy "project_documents_insert" on public.project_documents
  for insert with check (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or 'vpa' = any (public.current_user_project_seats())
  );

drop policy if exists "project_documents_delete" on public.project_documents;
create policy "project_documents_delete" on public.project_documents
  for delete using (
    public.current_user_role() = any (array['vp_admin', 'dev'])
    or 'vpa' = any (public.current_user_project_seats())
  );

comment on policy "projects_insert" on public.projects is
  'Create a project: role vp_admin/dev, or the ทีม SAMO `vpa` seat (0090). '
  'uni_staff intentionally excluded — they receive, they do not send.';
