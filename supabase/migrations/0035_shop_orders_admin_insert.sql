-- ============================================================
-- 0035 — Admin can create orders on a buyer's behalf
--
-- The 0003 policy `shop_orders_insert_buyer` only lets a signed-in user
-- insert an order whose buyer_id = auth.uid(). Shop admins now need to
-- create walk-in / phone orders for customers who have no account
-- (buyer_id null) or for another user. Postgres evaluates INSERT WITH
-- CHECK as a logical OR across all permissive policies, so adding this
-- admin policy widens insert rights without touching the buyer path.
--
-- Item inserts are already admin-allowed via shop_order_items_write_admin
-- (0003); order updates/deletes via shop_orders_update_admin /
-- shop_orders_delete_admin. This closes the one missing verb (insert).
-- ============================================================

drop policy if exists "shop_orders_insert_admin" on public.shop_orders;
create policy "shop_orders_insert_admin" on public.shop_orders
  for insert with check (public.current_user_is_shop_admin());

comment on policy "shop_orders_insert_admin" on public.shop_orders is
  'Shop admin may create an order for any buyer (incl. buyer_id null for walk-in / phone orders). OR-combined with shop_orders_insert_buyer.';
