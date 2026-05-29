-- ============================================================
-- 0020_shop_orders_buyer_slip_reupload.sql
--
-- Lets the buyer re-upload their slip when admin has flagged it
-- `slip_mismatch` (added in 0018). The existing
-- `shop_orders_update_self_early` policy gates buyer updates to
-- pending/review only; extend it to include slip_mismatch so the
-- buyer's setOrderSlip() PATCH succeeds.
--
-- setOrderSlip() flips status back to 'review' as part of the same
-- PATCH, so the order returns to the verify queue automatically.
-- ============================================================

drop policy if exists "shop_orders_update_self_early" on public.shop_orders;
create policy "shop_orders_update_self_early" on public.shop_orders
  for update using (
    buyer_id = auth.uid()
    and status in ('pending', 'review', 'slip_mismatch')
  );

comment on policy "shop_orders_update_self_early" on public.shop_orders is
  'Buyer can update their own order (slip_url, buyer_note, etc.) while it is still pending / review / slip_mismatch. Hands the order back to admin via the status flip baked into setOrderSlip().';
