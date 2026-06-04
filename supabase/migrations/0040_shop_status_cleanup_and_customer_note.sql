-- ============================================================
-- 0040 — Shop status cleanup + customer-facing order note
--
-- Three changes, all driven by the admin UX pass:
--
--  (1) Per-item fulfilment problem state collapses to a single 'issue'
--      (มีปัญหา). The old 'exchange' / 'no_show' item states are merged
--      into it. Unlike a cancelled order, 'issue' KEEPS reserving stock
--      (the item is still expected to be fulfilled once resolved) — the
--      reserved-matrix predicate already keys on item_status <> 'done',
--      so 'issue' counts automatically.
--
--  (2) Order-level problem statuses reduce to slip_mismatch + cancel.
--      The unused off-path order statuses (exchange / refund_pending /
--      no_show / refunded) are folded into 'cancel' and dropped from the
--      check constraint. (The per-item model means order status stops at
--      'paid'; these order-level off-paths were dead weight.)
--
--  (3) New shop_orders.customer_note — a note the admin writes that is
--      shown to the buyer on their "คำสั่งซื้อ" page (distinct from the
--      internal admin_note).
--
-- mistakes.md rule honoured: DROP the check constraint BEFORE the UPDATE
-- that moves rows to the new value set, then ADD the tightened constraint.
-- ============================================================


-- ----------- (1) Per-item: exchange/no_show → issue -----------

alter table public.shop_order_items
  drop constraint if exists shop_order_items_item_status_check;

update public.shop_order_items
   set item_status = 'issue'
 where item_status in ('exchange', 'no_show');

alter table public.shop_order_items
  add constraint shop_order_items_item_status_check
  check (item_status in ('paid', 'produce', 'ready', 'done', 'issue'));


-- ----------- (2) Order-level: fold dead off-paths into cancel -----------

alter table public.shop_orders
  drop constraint if exists shop_orders_status_check;

update public.shop_orders
   set status = 'cancel'
 where status in ('exchange', 'refund_pending', 'no_show', 'refunded');

alter table public.shop_orders
  add constraint shop_orders_status_check
  check (status in (
    'pending', 'review', 'paid', 'produce', 'ready', 'done',
    'cancel', 'slip_mismatch'
  ));


-- ----------- (3) Customer-facing note -----------

alter table public.shop_orders
  add column if not exists customer_note text;

comment on column public.shop_orders.customer_note is
  'Admin-written note shown to the buyer on their orders page. Distinct '
  'from admin_note (internal-only).';


-- ----------- Reserved-matrix predicates drop the now-invalid 'exchange'
--             order status. 'issue' is an ITEM status, so it never
--             appears here; it keeps reserving via item_status <> ''done''. -----------

create or replace function public.shop_reserved_matrix(p_product_id text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, qty), '{}'::jsonb)
  from (
    select
      coalesce(oi.size, 'F') || '-' || coalesce(oi.color, 'default') as key,
      sum(oi.qty)::int as qty
    from public.shop_order_items oi
    join public.shop_orders o on o.id = oi.order_id
    where oi.product_id = p_product_id
      and o.status in (
        'pending', 'review', 'paid', 'produce', 'ready', 'slip_mismatch'
      )
      and coalesce(oi.item_status, 'paid') <> 'done'
    group by oi.size, oi.color
  ) sub;
$$;

grant execute on function public.shop_reserved_matrix(text) to anon, authenticated;


create or replace function public.shop_reserved_matrix_all()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(jsonb_object_agg(product_id, matrix), '{}'::jsonb)
  from (
    select product_id, jsonb_object_agg(key, qty) as matrix
    from (
      select
        oi.product_id,
        coalesce(oi.size, 'F') || '-' || coalesce(oi.color, 'default') as key,
        sum(oi.qty)::int as qty
      from public.shop_order_items oi
      join public.shop_orders o on o.id = oi.order_id
      where o.status in (
        'pending', 'review', 'paid', 'produce', 'ready', 'slip_mismatch'
      )
        and coalesce(oi.item_status, 'paid') <> 'done'
      group by oi.product_id, oi.size, oi.color
    ) sub
    group by product_id
  ) outer_grouped;
$$;

grant execute on function public.shop_reserved_matrix_all() to anon, authenticated;

-- Note: place_shop_order (0034) has the same order-status set inline for
-- its at-checkout stock check, with a now-dead 'exchange' entry. It is
-- harmless (no order can be 'exchange' after this migration) and left in
-- place to avoid re-declaring that large SECURITY DEFINER function here.
