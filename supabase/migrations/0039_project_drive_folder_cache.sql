-- ============================================================
-- 0039_project_drive_folder_cache
--
-- Additive. Cache each project's Drive folder location on the row so
-- the QR-folder feature (src/js/projects/qr.js) doesn't have to hit the
-- Apps Script /exec endpoint every time someone opens the QR.
--
-- Before this: showProjectQrModal() called the GAS `getProjectFolderInfo`
-- action on EVERY open (the only in-memory cache was per page-session and
-- lost on reload / per device). GAS shares an egress IP that Cloudflare
-- rate-limits (error 1015 — see .claude/rules/mistakes.md), so each extra
-- call brings the shared IP closer to its cooldown.
--
-- After this: the FIRST QR open for a project still calls GAS once (to
-- create the folder if needed AND set ANYONE_WITH_LINK sharing), then
-- persists the resolved URL/ID here. Every later open — any user, any
-- device, any session — reads these columns and generates the QR purely
-- client-side (the `qrcode` lib already runs in the browser). GAS is hit
-- at most once per project, ever.
--
-- The Drive folder ID/URL is stable across renames (the GAS walker
-- renames the folder in place but keeps the same ID), so the cache never
-- needs invalidation on a project rename.
--
-- Columns are nullable; JS degrades gracefully when absent (falls back to
-- the GAS round-trip), so the feature keeps working before this is applied.
-- ============================================================

alter table public.projects
  add column if not exists drive_folder_url text,
  add column if not exists drive_folder_id  text;
