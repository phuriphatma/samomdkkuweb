-- ============================================================
-- 0029 — Two-price model for preorder products
--
-- `shop_products.is_presale` already flips a product into preorder
-- mode (badge + ribbon). The behaviour piece — unlimited buying,
-- hidden stock counts, and a separate price while in preorder —
-- is wired in the JS layer (src/js/shop/products.js). The only
-- schema piece needed is a second price column so admin can stage
-- the post-arrival price up front without having to remember to
-- edit it the moment the stock arrives.
--
-- Pricing rule (enforced in JS, not the DB):
--   is_presale = true  → preorder_price (fallback to price when null)
--   is_presale = false → price
--
-- A null preorder_price means "no separate preorder price" — the
-- existing `price` is used in both modes, matching today's behaviour
-- for products that pre-date this migration. So this column is safe
-- to ship as nullable with no backfill.
-- ============================================================

alter table public.shop_products
  add column if not exists preorder_price integer
    check (preorder_price is null or preorder_price >= 0);

comment on column public.shop_products.preorder_price is
  'Optional preorder-only price. Shown to buyers while is_presale = true; '
  'falls back to price when null. Admin can pre-set this then flip is_presale '
  'off when stock arrives to switch the displayed price.';
