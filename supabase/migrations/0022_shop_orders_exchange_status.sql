-- ============================================================
-- 0022_shop_orders_exchange_status.sql
--
-- Adds 'exchange' to the shop_orders.status check constraint so admin
-- can flag a delivered order that needs a swap (size, colour, damage)
-- without dropping it into refund flow. Customer-facing label:
-- "เปลี่ยนสินค้า".
--
-- Widening only — no existing rows touched.
-- ============================================================

alter table public.shop_orders
  drop constraint if exists shop_orders_status_check;

alter table public.shop_orders
  add constraint shop_orders_status_check
  check (status in (
    'pending',
    'review',
    'paid',
    'produce',
    'ready',
    'done',
    'cancel',
    'slip_mismatch',
    'refund_pending',
    'refunded',
    'no_show',
    'exchange'
  ));
