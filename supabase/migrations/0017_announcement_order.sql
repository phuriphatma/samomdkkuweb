-- ============================================================
-- 0017_announcement_order.sql
--
-- Adds an explicit display-order column to announcements so staff can
-- pin/reorder articles on the home page / archive. NULL = no manual
-- ordering (default), in which case the row falls back to created_at
-- desc. Non-NULL: higher number = appears earlier.
--
-- The drag-to-reorder UI in the admin creator assigns descending
-- integers to the visible list (topmost = N, second = N-1, …) so the
-- order stays stable as the list scrolls.
--
-- No new policy needed: announcements_write already covers UPDATE for
-- pr_staff / dev / users with 'creator' permission (per 0014).
-- ============================================================

alter table public.announcements
  add column if not exists display_order int;

comment on column public.announcements.display_order is
  'Manual sort key. Higher number = appears earlier in the list. NULL = no manual ordering (falls back to created_at desc).';

create index if not exists announcements_display_order_idx
  on public.announcements (display_order desc nulls last, created_at desc);
