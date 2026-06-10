-- ============================================================
-- 0053 — Let the professor replace/remove HIS OWN signed files
--
-- The prof can now re-sign / re-upload a signed file even after accepting
-- ("edit"), which means the app deletes the prior signed row before writing
-- the new one. The 0050 delete policy is vp_admin/uni_staff/dev only, so a
-- prof's delete was blocked. Widen it so a sa_prof caller may delete his OWN
-- signed outputs (is_signed AND uploaded_by = auth.uid()) — nothing else.
--
-- Apply AFTER 0052. Re-runnable.
-- ============================================================

drop policy if exists "project_files_delete" on public.project_files;
create policy "project_files_delete" on public.project_files
  for delete using (
    public.current_user_role() in ('vp_admin', 'uni_staff', 'dev')
    or (public.current_user_is_prof() and is_signed and uploaded_by = auth.uid())
  );
