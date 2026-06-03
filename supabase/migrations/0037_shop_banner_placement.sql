-- ============================================================
-- 0037 — Banner placement (launch vs announcement)
--
-- shop_banners (0019) drove only the "เปิดตัวล่าสุด" hero carousel.
-- We now want a SECOND admin-curated swipe carousel in the ประกาศ
-- area of the shop. Rather than a new table, tag each banner with a
-- `placement` so the same upload/caption/link/reorder/active admin UI
-- (and the same customer carousel CSS) serves both surfaces.
--
--   placement = 'launch'        → เปิดตัวล่าสุด hero (existing behaviour)
--   placement = 'announcement'  → ประกาศ SAMO Shop swipe carousel (new)
--
-- Existing rows default to 'launch' — they ARE launch banners, so no
-- backfill needed. Additive + idempotent.
-- ============================================================

alter table public.shop_banners
  add column if not exists placement text not null default 'launch';

-- The default 'launch' is already inside the new allowed set, so no
-- pre-update value cleanup is required here (cf. mistakes.md "check
-- constraint must be dropped BEFORE updating to a new enum value" —
-- that applies when the UPDATE moves rows OUTSIDE the old check).
alter table public.shop_banners
  drop constraint if exists shop_banners_placement_check;
alter table public.shop_banners
  add constraint shop_banners_placement_check
  check (placement in ('launch', 'announcement'));

comment on column public.shop_banners.placement is
  'Which shop surface this banner feeds: launch = เปิดตัวล่าสุด hero, '
  'announcement = ประกาศ SAMO Shop carousel. Reorder is per-placement '
  '(display_order is scoped by placement in the client).';

-- Sort/lookup index now keyed by placement first.
drop index if exists shop_banners_order_idx;
create index if not exists shop_banners_placement_order_idx
  on public.shop_banners (placement, display_order asc, created_at desc);
