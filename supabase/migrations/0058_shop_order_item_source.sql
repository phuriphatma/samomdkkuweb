-- ============================================================
-- 0058 — Freeze product "source" (owning department) onto each
--        shop_order_item at purchase time.
--
-- WHY
-- ---
-- The shop is being co-managed by more than one department (MD, now
-- MDI, and possibly more later). `shop_products.source` is promoted
-- from a display tag to the OWNERSHIP KEY: the department that owns
-- and fulfils a product.
--
-- Today access control is intentionally global (any shop_admin sees
-- everything — Model A, fine for a few trusting teams). This migration
-- does NOT change that. It only lays the cheap groundwork so a future
-- per-department scoping (Model B: shop_admin writes/sees only their
-- own `source`) is an additive RLS change with NO data backfill:
--
--   * A single order can mix items from several departments (MD shirt +
--     MDI shirt in one cart — checkout already splits payment per
--     PromptPay account). Per-department order views must therefore
--     filter order ITEMS, not whole orders.
--   * We denormalise `source` onto the item and FREEZE it at insert
--     time (same pattern as `unit_price`), so a later `source` edit on
--     the product never rewrites who historically owned a sale, and an
--     archived product still resolves its owner without a join.
--
-- The value is set by a SECURITY DEFINER trigger from the authoritative
-- `shop_products.source` and ALWAYS overrides whatever the client sent,
-- so a buyer cannot spoof an item into another department's books.
--
-- Idempotent: add-column-if-not-exists, drop-trigger-before-create,
-- backfill only NULLs. Apply via tools/apply-migration.mjs (Management
-- API) or the Supabase SQL editor (project fheueuowbchsnsvbcgil).
-- ============================================================

alter table public.shop_order_items
  add column if not exists product_source text;

create index if not exists shop_order_items_source_idx
  on public.shop_order_items (product_source);

-- BEFORE INSERT: stamp the owning department from the product. Runs as
-- definer so it reads shop_products regardless of the caller's RLS (and
-- resolves archived products). Overrides any client-supplied value.
create or replace function public.shop_order_item_stamp_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select p.source into new.product_source
    from public.shop_products p
   where p.id = new.product_id;
  return new;
end;
$$;

drop trigger if exists stamp_shop_order_item_source on public.shop_order_items;
create trigger stamp_shop_order_item_source
  before insert on public.shop_order_items
  for each row execute function public.shop_order_item_stamp_source();

-- Backfill existing rows (one-time; only touches NULLs so a re-run is a
-- no-op). Orphaned product_id can't exist — FK is ON DELETE RESTRICT.
update public.shop_order_items oi
   set product_source = p.source
  from public.shop_products p
 where p.id = oi.product_id
   and oi.product_source is null;
