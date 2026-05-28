-- ============================================================
-- 0008_announcements_excerpt.sql
--
-- Add a dedicated subhead/excerpt column to announcements so
-- authors control what appears under the headline (article view)
-- and inside the news cards (home + archive), instead of the
-- renderer auto-extracting the first ~80 chars of body text.
--
-- Additive only — nullable. Existing rows keep working: the
-- renderer falls back to its previous behaviour when excerpt
-- is null, so this migration is safe to apply at any time
-- without a backfill.
-- ============================================================

alter table public.announcements
  add column if not exists excerpt text;

comment on column public.announcements.excerpt is
  'Short 1-2 sentence subhead shown under the headline in the article view and as the body of news cards. Null = fall back to auto-extracted snippet from content.';
