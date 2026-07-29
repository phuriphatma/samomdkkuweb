-- ============================================================
-- 0097 — project_files DELETE honours the หนังสือโครงการ seat
--
-- Found by the standing role-only policy sweep (STATE.md), which returned a
-- FOURTH row beyond the three deliberate ones:
--
--   project_files_delete
--     using (current_user_role() = any(array['vp_admin','uni_staff','dev'])
--            or (current_user_is_prof() and is_signed and uploaded_by = auth.uid()))
--
-- The prof branch already picks seats up (0095 widened current_user_is_prof()
-- to role-OR-seat), but the FIRST branch is a bare role list. So a person
-- granted a `vpa` or `staff` seat through ทีม SAMO could upload a file
-- (project_files_insert → current_user_is_project_actor(), 0086) and rename it
-- (project_files_update → same helper) but NOT delete it. Every neighbouring
-- policy on the table had already been threaded through the seat channel;
-- this one was missed — the same gap 0090 closed for projects_insert/delete
-- and project_documents_insert/delete.
--
-- The replacement is an EXACT superset by construction, not a judgement call:
--
--   current_user_is_project_actor()
--     = current_user_role() in ('vp_admin','uni_staff','dev')     ← same list
--       or current_user_project_seats() && array['vpa','staff']   ← the seats
--
-- so no role gains or loses anything; only the two seats that already hold
-- every other write on this table are added. `prof` is deliberately NOT an
-- actor (0086), so a professor's narrow branch — delete only their OWN signed
-- upload — is preserved verbatim rather than widened.
--
-- Idempotent (drop-policy-before-create; Postgres has no `create or replace
-- policy`).
-- ============================================================

drop policy if exists project_files_delete on public.project_files;
create policy project_files_delete on public.project_files
  for delete to authenticated
  using (
    public.current_user_is_project_actor()
    or (public.current_user_is_prof() and is_signed and uploaded_by = auth.uid())
  );

comment on policy project_files_delete on public.project_files is
  '0097 — actors (role OR vpa/staff seat) may delete any file; a professor only their own signed upload. Was role-only, so a seat holder could upload but not delete.';
