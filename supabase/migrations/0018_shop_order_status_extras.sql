-- ============================================================
-- 0018_shop_order_status_extras.sql
--
-- Adds off-path statuses to the shop_orders state machine:
--   * slip_mismatch  — admin reviewed the slip and found it doesn't
--                       match the order amount or buyer. Awaits buyer
--                       re-upload.
--   * refund_pending — cancelled or rejected with refund owed.
--   * refunded       — refund issued.
--   * no_show        — buyer didn't collect during the announced
--                       pickup window. Admin may decide to issue / hold.
--
-- The check constraint is widened (no value changes), so existing rows
-- are untouched. The frontend STAGES_META labels are updated to match.
--
-- Pattern note: mistakes.md flags "drop check before UPDATE" when
-- migrating rows to new values. We're only widening the allowed set
-- here — no UPDATE needed — so we just replace the constraint.
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
    'no_show'
  ));
