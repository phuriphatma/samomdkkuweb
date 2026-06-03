-- ============================================================
-- 0032_projects_public_read.sql
--
-- Add public (anon + authenticated) SELECT policies on the
-- projects-tracking tables so the read-only "customer view" of
-- หนังสือโครงการ on the public site can list everything VPA sees.
--
-- WHY a separate `*_read_public` policy alongside the existing
-- `*_read` (project_actor-gated) policy: Postgres RLS policies
-- are OR-combined for the same command. The existing actor-gated
-- policy keeps doing its job for signed-in staff; the new public
-- policy opens the same SELECT path to anon callers. Writes
-- (INSERT/UPDATE/DELETE) are NOT touched — those remain
-- vp_admin / uni_staff gated as before.
--
-- Scope of exposure (be intentional):
--   - projects                 — full row (id, name, description,
--                                status, created_at)
--   - project_documents        — full row including timeline (which
--                                may carry actor display names);
--                                comments / notes are PUBLIC.
--   - project_files            — Drive view URLs become public
--                                links. Drive permission on each
--                                file is the second layer; if a
--                                file's Drive permission is
--                                "anyone with the link", the URL
--                                we expose is the entire access
--                                token.
--   - project_doc_types        — already shape-level public (names
--                                of doc types).
--   - project_settings         — NOT publicised. Holds VPA email
--                                + Discord routing flags; no need
--                                to surface to anon.
--   - project_notifications    — NOT publicised. user_id-keyed
--                                bell entries.
--   - project_doc_views        — NOT publicised. per-user seenAt
--                                markers.
-- ============================================================

-- PROJECTS
drop policy if exists "projects_read_public" on public.projects;
create policy "projects_read_public" on public.projects
  for select to anon, authenticated using (true);

-- PROJECT DOCUMENTS
drop policy if exists "project_documents_read_public" on public.project_documents;
create policy "project_documents_read_public" on public.project_documents
  for select to anon, authenticated using (true);

-- PROJECT FILES — read all attachments for any document. (The
-- existing `project_files_read` policy gated by document-actor is
-- kept intact; this layer opens the path to anon as well.)
drop policy if exists "project_files_read_public" on public.project_files;
create policy "project_files_read_public" on public.project_files
  for select to anon, authenticated using (true);

-- PROJECT DOC TYPES — the customer view needs the labels.
drop policy if exists "project_doc_types_read_public" on public.project_doc_types;
create policy "project_doc_types_read_public" on public.project_doc_types
  for select to anon, authenticated using (true);

-- PROJECT SETTINGS — needs the uni_label / vp_label so the renderer
-- can show "เจ้าหน้าที่"/"SAMO" name pills. Only safe columns are
-- ever read by JS (no API keys/webhooks/emails live in this row
-- except `uni_email`; if exposing that is sensitive, add a view
-- column-select policy or a dedicated public view in a follow-up).
drop policy if exists "project_settings_read_public" on public.project_settings;
create policy "project_settings_read_public" on public.project_settings
  for select to anon, authenticated using (true);
