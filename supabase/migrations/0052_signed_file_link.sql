-- ============================================================
-- 0052 — Link a signed file to the original it signs
--
-- The UI now shows signing status INLINE on each attached file (the signed
-- version nests under its original), instead of a separate "การลงนาม"
-- section the user had to cross-reference. To nest a signed output under the
-- right original we need a per-file link: project_files.signs_file_id points
-- at the original project_files row this signed file is a signature of.
--
-- Set by the e-sign path (we know which original PDF was signed). The
-- reupload path leaves it null (request-level: the prof uploads signed files
-- not tied to a specific original — those show in the request's footer).
--
-- Apply AFTER 0051. Re-runnable.
-- ============================================================

alter table public.project_files
  add column if not exists signs_file_id bigint
    references public.project_files(id) on delete set null;

create index if not exists project_files_signs_file_idx
  on public.project_files (signs_file_id)
  where signs_file_id is not null;
