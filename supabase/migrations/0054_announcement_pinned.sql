-- ============================================================
-- 0054_announcement_pinned.sql
--
-- Adds a `pinned` flag to announcements. When an announcement is pinned
-- it is shown as the single large "featured" post at the top of the home
-- page; the rest render as uniform small cards. When NOTHING is pinned,
-- the home page shows every announcement at the same small size (no
-- featured slot).
--
-- At most one announcement should be pinned at a time. That invariant is
-- enforced in the app (togglePinAnnouncement unpins others before pinning
-- a new one) rather than by a partial unique index, so an admin who pins a
-- second post simply moves the pin instead of hitting a constraint error.
--
-- No new RLS policy needed: `announcements_write` already covers UPDATE for
-- pr_staff / dev / users with the 'creator' permission (per 0014) — same as
-- the display_order column in 0017.
-- ============================================================

alter table public.announcements
  add column if not exists pinned boolean not null default false;

comment on column public.announcements.pinned is
  'When true, this announcement is featured as the single large post on the home page. At most one should be pinned at a time (enforced in app).';

-- Partial index: the home render filters for the single pinned row out of
-- the full set, so index only the (few/one) pinned rows.
create index if not exists announcements_pinned_idx
  on public.announcements (pinned) where pinned;
