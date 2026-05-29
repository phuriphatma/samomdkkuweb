-- ============================================================
-- 0023_shop_product_code.sql
--
-- Adds a short admin-editable `code` to shop_products. Order ids are
-- generated as `<code><NNNN>` (e.g. SH1234) so the id is meaningful
-- at a glance and admin can pick a memorable abbreviation per
-- product (TS for t-shirt, PL for polo, BG for bag, …).
--
-- The id PK stays a stable opaque slug — only the user-facing code
-- changes. No FK cascade needed.
-- ============================================================

alter table public.shop_products
  add column if not exists code text;

comment on column public.shop_products.code is
  'Short admin-editable code used as the prefix in newly generated order ids (e.g. "SH" → order id "SH1234"). Falls back to "SH" if NULL.';

-- Backfill a placeholder for existing products — first 2 chars of the
-- name, uppercased, alphanumerics only. Empty result falls back to "SH".
update public.shop_products
  set code = coalesce(
    nullif(upper(regexp_replace(substring(name from 1 for 2), '[^A-Za-z0-9]', '', 'g')), ''),
    'SH'
  )
  where code is null;
