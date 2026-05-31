-- ============================================================
-- 0030 — Stock safety + preorder tag on orders
--
-- What this fixes:
--   1. Buyer sees `stock_matrix` raw — but `stock_matrix.S-red = 9`
--      doesn't mean 9 are available, it means admin loaded 9 into the
--      system. If 8 are sitting in active orders that haven't been
--      delivered/cancelled yet, only 1 is actually available. We need
--      the buyer side to display `max(0, stock - reserved)` and the
--      checkout to fail-fast at 0.
--   2. Two buyers racing to the last unit. The current client-only
--      check (stock_matrix > 0) is read+write across two HTTP calls
--      — both pass the check, both insert, oversell. The classic
--      fix is to lock the relevant product rows inside a single
--      server-side transaction.
--   3. Preorder orders need to be visible AS preorder in the admin
--      list — there's currently no way to filter "show me only the
--      preorder orders so I can plan a production run".
--
-- Schema changes:
--   - shop_orders.is_preorder boolean (frozen at order time — flipping
--     a product out of presale later does NOT change earlier orders'
--     tag, by design).
--   - public.shop_reserved_matrix(p_product_id) — bulk aggregate of
--     locked-up qty per variant for one product. Security definer so
--     the buyer can read the *aggregate* without seeing other buyers'
--     order rows (shop_orders SELECT RLS is owner-only).
--   - public.shop_reserved_matrix_all() — same shape but keyed by
--     product id, one round-trip for the entire product grid.
--   - public.place_shop_order(...) — atomic order-creation RPC that
--     LOCK the product rows, RE-READS the matrix + reservations
--     under the lock, validates available >= requested, then inserts
--     the order header + items in the same transaction. Concurrent
--     races serialise behind the row lock, so the last buyer in
--     line gets OUT_OF_STOCK, not a successful oversell.
--
-- Statuses counted as "reserving" stock:
--   pending, review, paid, produce, ready, slip_mismatch, exchange
--   — everything that hasn't been delivered (done) or aborted
--   (cancel, refunded, no_show, refund_pending) yet.
-- ============================================================

-- ----------- Preorder tag on orders -----------

alter table public.shop_orders
  add column if not exists is_preorder boolean not null default false;

comment on column public.shop_orders.is_preorder is
  'True iff any line item was a preorder product (is_presale=true) at order time. Frozen — flipping the product out of preorder later does not change this. Set by place_shop_order RPC.';

create index if not exists shop_orders_is_preorder_idx
  on public.shop_orders (is_preorder)
  where is_preorder = true;


-- ----------- Reserved-qty aggregates -----------

create or replace function public.shop_reserved_matrix(p_product_id text)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(key, qty),
    '{}'::jsonb
  )
  from (
    select
      coalesce(oi.size, 'F') || '-' || coalesce(oi.color, 'default') as key,
      sum(oi.qty)::int as qty
    from public.shop_order_items oi
    join public.shop_orders o on o.id = oi.order_id
    where oi.product_id = p_product_id
      and o.status in (
        'pending', 'review', 'paid', 'produce', 'ready',
        'slip_mismatch', 'exchange'
      )
    group by oi.size, oi.color
  ) sub;
$$;

grant execute on function public.shop_reserved_matrix(text) to anon, authenticated;


create or replace function public.shop_reserved_matrix_all()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(product_id, matrix),
    '{}'::jsonb
  )
  from (
    select
      product_id,
      jsonb_object_agg(key, qty) as matrix
    from (
      select
        oi.product_id,
        coalesce(oi.size, 'F') || '-' || coalesce(oi.color, 'default') as key,
        sum(oi.qty)::int as qty
      from public.shop_order_items oi
      join public.shop_orders o on o.id = oi.order_id
      where o.status in (
        'pending', 'review', 'paid', 'produce', 'ready',
        'slip_mismatch', 'exchange'
      )
      group by oi.product_id, oi.size, oi.color
    ) sub
    group by product_id
  ) outer_grouped;
$$;

grant execute on function public.shop_reserved_matrix_all() to anon, authenticated;


-- ----------- Atomic order placement RPC -----------

create or replace function public.place_shop_order(
  p_buyer_id          uuid,
  p_buyer_label       text,
  p_buyer_name        text,
  p_buyer_email       text,
  p_buyer_note        text,
  p_pickup_location   text,
  p_slip_url          text,
  p_slip_uploaded_at  timestamptz,
  p_items             jsonb,    -- [{product_id, size, color, qty, unit_price, fit}]
  p_fee               int default 0
)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_order_id           text;
  v_subtotal           int := 0;
  v_total              int := 0;
  v_item               jsonb;
  v_product_id         text;
  v_size               text;
  v_color              text;
  v_qty                int;
  v_unit_price         int;
  v_is_preorder        boolean := false;
  v_item_is_preorder   boolean;
  v_stock_raw          text;
  v_stock              int;
  v_reserved           int;
  v_code               text;
  v_attempt            int;
  v_product_ids        text[];
  v_now                timestamptz := now();
  v_initial_status     text;
  v_initial_timeline   jsonb;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER';
  end if;

  -- Lock every distinct product row in deterministic order. The lock
  -- is held until commit, so any concurrent place_shop_order touching
  -- the same product blocks here and reads our committed reservations
  -- on retry — that's what prevents the oversell race.
  select array_agg(distinct (item->>'product_id') order by (item->>'product_id'))
    into v_product_ids
    from jsonb_array_elements(p_items) item;

  perform 1
    from public.shop_products
    where id = any(v_product_ids)
    for update;

  -- Walk items: validate, sum, detect preorder.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := v_item->>'product_id';
    v_size       := coalesce(v_item->>'size', 'F');
    v_color      := coalesce(v_item->>'color', 'default');
    v_qty        := coalesce((v_item->>'qty')::int, 0);
    v_unit_price := coalesce((v_item->>'unit_price')::int, 0);

    if v_qty <= 0 then
      raise exception 'INVALID_QTY: %', v_product_id;
    end if;

    select is_presale into v_item_is_preorder
      from public.shop_products where id = v_product_id;
    v_item_is_preorder := coalesce(v_item_is_preorder, false);

    if v_item_is_preorder then
      v_is_preorder := true;
      -- preorder = unlimited buying, skip the stock check
    else
      -- Read the per-variant stock from the JSONB matrix
      v_stock_raw := (
        select stock_matrix ->> (v_size || '-' || v_color)
          from public.shop_products where id = v_product_id
      );
      v_stock := nullif(v_stock_raw, '')::int;
      if v_stock is not null then
        v_reserved := coalesce(
          (select sum(oi.qty)::int
             from public.shop_order_items oi
             join public.shop_orders o on o.id = oi.order_id
             where oi.product_id = v_product_id
               and coalesce(oi.size, 'F') = v_size
               and coalesce(oi.color, 'default') = v_color
               and o.status in ('pending','review','paid','produce','ready','slip_mismatch','exchange')),
          0
        );
        if (v_stock - v_reserved) < v_qty then
          raise exception 'OUT_OF_STOCK: % %/% (stock=% reserved=% requested=%)',
            v_product_id, v_size, v_color, v_stock, v_reserved, v_qty;
        end if;
      end if;
    end if;

    v_subtotal := v_subtotal + (v_qty * v_unit_price);
  end loop;

  v_total := v_subtotal + coalesce(p_fee, 0);

  -- Order id prefix = first item's product code (admin sets it).
  select code into v_code
    from public.shop_products
    where id = (p_items->0->>'product_id');
  v_code := upper(regexp_replace(coalesce(v_code, 'SH'), '[^A-Z0-9]', '', 'g'));
  if length(v_code) = 0 then v_code := 'SH'; end if;
  v_code := left(v_code, 5);

  -- Initial status + timeline mirror the legacy createOrder logic:
  --   slip present  → review + 2 timeline entries
  --   slip missing  → pending + 1 timeline entry
  if p_slip_url is not null and p_slip_url <> '' then
    v_initial_status := 'review';
    v_initial_timeline := jsonb_build_array(
      jsonb_build_object('stage', 'pending', 'at', v_now, 'label', 'รอชำระเงิน'),
      jsonb_build_object('stage', 'review',  'at', v_now, 'label', 'ส่งสลิปแล้ว — รอตรวจ')
    );
  else
    v_initial_status := 'pending';
    v_initial_timeline := jsonb_build_array(
      jsonb_build_object('stage', 'pending', 'at', v_now, 'label', 'รอชำระเงิน')
    );
  end if;

  -- Try a fresh id; PK collision (rare with 9000-id pool per prefix) → retry.
  v_attempt := 0;
  loop
    v_order_id := v_code || lpad((1000 + (random() * 8999)::int)::text, 4, '0');
    begin
      insert into public.shop_orders
        (id, buyer_id, buyer_label, buyer_name, buyer_email, buyer_note,
         status, subtotal, fee, total, pickup_location, is_preorder,
         slip_url, slip_uploaded_at, timeline, placed_at, updated_at)
      values
        (v_order_id, p_buyer_id, p_buyer_label, p_buyer_name, p_buyer_email, p_buyer_note,
         v_initial_status, v_subtotal, coalesce(p_fee, 0), v_total, p_pickup_location, v_is_preorder,
         nullif(p_slip_url, ''), p_slip_uploaded_at, v_initial_timeline, v_now, v_now);
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 10 then
        raise exception 'ID_GENERATION_FAILED';
      end if;
    end;
  end loop;

  -- Insert items
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.shop_order_items
      (order_id, product_id, size, color, fit, qty, unit_price)
    values
      (v_order_id,
       v_item->>'product_id',
       coalesce(v_item->>'size', 'F'),
       coalesce(v_item->>'color', 'default'),
       coalesce(v_item->>'fit', 'unisex'),
       (v_item->>'qty')::int,
       (v_item->>'unit_price')::int);
  end loop;

  return v_order_id;
end;
$$;

grant execute on function public.place_shop_order(
  uuid, text, text, text, text, text, text, timestamptz, jsonb, int
) to anon, authenticated;
