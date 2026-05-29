-- ============================================================
-- 0024_shop_product_production_status.sql
--
-- Adds a per-product production state machine so admin can mark a
-- batch as produced or announced and have all eligible customer
-- orders cascade automatically — instead of bulk-advancing manually
-- in the orders table.
--
-- Values:
--   pending   — default. No order movement.
--   produced  — every order in status='paid' that contains this
--               product is moved to 'produce'.
--   announced — every order in status IN ('paid','produce') that
--               contains this product is moved to 'ready'.
--
-- IMPORTANT: orders in off-path or terminal states (slip_mismatch,
-- refund_pending, refunded, cancel, no_show, exchange, done, pending,
-- review) are NEVER touched by the cascade. Only happy-path orders
-- past the "ยืนยันการชำระเงิน" stage get moved.
--
-- The cascade runs inside a SECURITY DEFINER function so it executes
-- in one transaction with RLS bypass — admin client calls it via the
-- /rpc/apply_product_production_status PostgREST endpoint.
-- ============================================================

alter table public.shop_products
  add column if not exists production_status text
  not null default 'pending';

alter table public.shop_products
  drop constraint if exists shop_products_production_status_check;
alter table public.shop_products
  add constraint shop_products_production_status_check
  check (production_status in ('pending', 'produced', 'announced'));

comment on column public.shop_products.production_status is
  'Per-product batch state. Setting to produced/announced via apply_product_production_status() cascades to every eligible happy-path order.';


create or replace function public.apply_product_production_status(
  p_product_id text,
  p_status     text
) returns table (
  updated_product boolean,
  moved_to_produce int,
  moved_to_ready   int
)
language plpgsql security definer set search_path = public as $$
declare
  v_moved_produce int := 0;
  v_moved_ready   int := 0;
begin
  if not public.current_user_is_shop_admin() then
    raise exception 'permission denied' using hint = 'shop admin only';
  end if;

  if p_status not in ('pending', 'produced', 'announced') then
    raise exception 'invalid production status: %', p_status;
  end if;

  update public.shop_products
    set production_status = p_status
    where id = p_product_id;

  if not found then
    raise exception 'product not found: %', p_product_id;
  end if;

  -- Cascade. Only happy-path eligible orders move. Off-path / terminal
  -- statuses (slip_mismatch, refund_pending, refunded, cancel, no_show,
  -- exchange, done, pending, review) are explicitly skipped — neither
  -- the produced→ready path nor the announced→ready path touches them.
  if p_status = 'produced' then
    with affected as (
      update public.shop_orders o
        set status = 'produce'
        where o.status = 'paid'
          and exists (
            select 1 from public.shop_order_items oi
            where oi.order_id = o.id and oi.product_id = p_product_id
          )
        returning 1
    )
    select count(*) into v_moved_produce from affected;

  elsif p_status = 'announced' then
    with affected as (
      update public.shop_orders o
        set status = 'ready'
        where o.status in ('paid', 'produce')
          and exists (
            select 1 from public.shop_order_items oi
            where oi.order_id = o.id and oi.product_id = p_product_id
          )
        returning 1
    )
    select count(*) into v_moved_ready from affected;
  end if;

  return query select true, v_moved_produce, v_moved_ready;
end $$;

grant execute on function public.apply_product_production_status(text, text)
  to authenticated;

comment on function public.apply_product_production_status(text, text) is
  'Sets a product''s production_status and cascades to every happy-path order containing it. produced → paid→produce. announced → paid/produce → ready. Off-path statuses never touched.';
