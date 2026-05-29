-- ============================================================
-- 0025_shop_orders_paid_cascade.sql
--
-- Closes the gap left by 0024: the per-product production_status
-- cascade only ran when admin TOGGLED the product status. A NEW
-- customer whose order moves to 'paid' AFTER the product is already
-- at 'produced' / 'announced' was stuck at 'paid' until admin
-- re-toggled the product.
--
-- This adds a BEFORE-UPDATE trigger on shop_orders that, whenever a
-- status transitions INTO 'paid', inspects every item's
-- product.production_status and auto-advances the order:
--   all items production_status='announced' → order → 'ready'
--   all items production_status>='produced' → order → 'produce'
--   otherwise → stays at 'paid'
--
-- Multi-product orders need EVERY product to be at the target level
-- before the order advances; one straggler keeps the order at 'paid'.
--
-- Why BEFORE UPDATE: we mutate NEW.status before the row is written,
-- so there's exactly one INSERT/UPDATE event and the timeline trail
-- stays clean. The trigger only acts on the 'review' → 'paid' (or
-- 'pending' → 'paid') transition; other status changes (manual chips,
-- the 0024 RPC) pass through unchanged.
-- ============================================================

create or replace function public.shop_orders_apply_product_production()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_min_rank int;
begin
  -- No-op when status didn't change.
  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;

  -- Only fire on transitions INTO 'paid' — that's the slip-approval
  -- moment when admin says "yes this customer is good for production".
  -- Manual moves through 'produce'/'ready'/etc. shouldn't re-cascade.
  if NEW.status <> 'paid' then
    return NEW;
  end if;

  -- Aggregate the minimum production rank across this order's items.
  -- pending → 0, produced → 1, announced → 2. An order with a
  -- straggling item at pending can't advance.
  select min(
    case sp.production_status
      when 'announced' then 2
      when 'produced'  then 1
      else 0
    end
  ) into v_min_rank
  from public.shop_order_items oi
  join public.shop_products sp on sp.id = oi.product_id
  where oi.order_id = NEW.id;

  if v_min_rank is null then
    return NEW; -- no items? leave at paid
  end if;

  if v_min_rank >= 2 then
    NEW.status := 'ready';
  elsif v_min_rank >= 1 then
    NEW.status := 'produce';
  end if;

  return NEW;
end $$;

drop trigger if exists shop_orders_apply_product_production_trg on public.shop_orders;
create trigger shop_orders_apply_product_production_trg
  before update on public.shop_orders
  for each row execute function public.shop_orders_apply_product_production();

comment on function public.shop_orders_apply_product_production() is
  'BEFORE-UPDATE trigger: when an order transitions INTO paid, auto-advances to produce/ready based on the minimum product.production_status across its items. Closes the timing gap where a new payment lands after a product was already marked produced/announced (0024 only cascaded at the product-toggle moment).';
