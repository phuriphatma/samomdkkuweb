-- ============================================================
-- 0034 — Move fulfilment + preorder logic to the line-item level
--
-- Completes the Hybrid model started additively in 0033. After this:
--   * place_shop_order stamps per-item is_preorder (frozen snapshot of
--     the product's is_presale at buy time) and per-item item_status,
--     and persists buyer_phone + the slips[] array.
--   * The production cascade (0024 RPC + 0025 trigger) advances
--     shop_order_items.item_status instead of the whole-order status —
--     so products in one order can progress independently.
--   * Reserved-stock aggregates count at the item level (an item stops
--     reserving once it is delivered = item_status 'done').
--
-- Order-level shop_orders.status now stops at 'paid' for new orders
-- (payment phase). The customer/admin "overall" stage is a JS rollup of
-- the item statuses (see src/js/shop/data.js rollupOrderStage). Legacy
-- orders whose whole-order status was already advanced to
-- produce/ready/done keep displaying correctly because the rollup trusts
-- those order-level values directly.
-- ============================================================


-- ------------------------------------------------------------
-- (1) Reserved-qty aggregates — item-level predicate
--     An item reserves stock while its order is in an active payment
--     state AND the item itself hasn't been delivered (item_status
--     'done'). Mirrors the pre-0034 status set so legacy orders (whose
--     items default to item_status='paid') keep reserving exactly as
--     before.
-- ------------------------------------------------------------
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
        'pending', 'review', 'paid', 'produce', 'ready',
        'slip_mismatch', 'exchange'
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
        'pending', 'review', 'paid', 'produce', 'ready',
        'slip_mismatch', 'exchange'
      )
        and coalesce(oi.item_status, 'paid') <> 'done'
      group by oi.product_id, oi.size, oi.color
    ) sub
    group by product_id
  ) outer_grouped;
$$;

grant execute on function public.shop_reserved_matrix_all() to anon, authenticated;


-- ------------------------------------------------------------
-- (2) Product production-status cascade → item_status
--     produced  → every paid+ order's matching items move paid→produce
--     announced → every paid+ order's matching items move →ready
--     Off-path / pre-paid orders are never touched.
-- ------------------------------------------------------------
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

  -- Only items belonging to orders that have cleared payment
  -- (status not in the pre-paid / aborted set) are advanced. We gate on
  -- the ORDER being past review and the ITEM not already terminal.
  if p_status = 'produced' then
    with affected as (
      update public.shop_order_items oi
        set item_status = 'produce',
            item_timeline = coalesce(oi.item_timeline, '[]'::jsonb) ||
              jsonb_build_array(jsonb_build_object(
                'stage', 'produce', 'at', now(), 'label', 'สินค้าผลิตเสร็จแล้ว', 'by', 'cascade'))
        from public.shop_orders o
        where o.id = oi.order_id
          and oi.product_id = p_product_id
          and o.status in ('paid', 'produce', 'ready')
          and oi.item_status = 'paid'
        returning 1
    )
    select count(*) into v_moved_produce from affected;

  elsif p_status = 'announced' then
    with affected as (
      update public.shop_order_items oi
        set item_status = 'ready',
            item_timeline = coalesce(oi.item_timeline, '[]'::jsonb) ||
              jsonb_build_array(jsonb_build_object(
                'stage', 'ready', 'at', now(), 'label', 'ประกาศรอบรับสินค้า', 'by', 'cascade'))
        from public.shop_orders o
        where o.id = oi.order_id
          and oi.product_id = p_product_id
          and o.status in ('paid', 'produce', 'ready')
          and oi.item_status in ('paid', 'produce')
        returning 1
    )
    select count(*) into v_moved_ready from affected;
  end if;

  return query select true, v_moved_produce, v_moved_ready;
end $$;

grant execute on function public.apply_product_production_status(text, text)
  to authenticated;


-- ------------------------------------------------------------
-- (3) On order → paid, seed each item's item_status from its product's
--     production_status. Replaces the 0025 trigger that advanced the
--     whole-order status; we now leave the order at 'paid' and let the
--     items carry the fulfilment phase.
-- ------------------------------------------------------------
create or replace function public.shop_orders_apply_product_production()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if OLD.status is not distinct from NEW.status then
    return NEW;
  end if;
  if NEW.status <> 'paid' then
    return NEW;
  end if;

  -- Seed item_status from the product's current production_status, only
  -- for items still at the placeholder 'paid'. AFTER trigger so the row
  -- (and its id) exists for the UPDATE on the child rows.
  update public.shop_order_items oi
     set item_status = case sp.production_status
                         when 'announced' then 'ready'
                         when 'produced'  then 'produce'
                         else 'paid'
                       end
    from public.shop_products sp
   where oi.order_id = NEW.id
     and sp.id = oi.product_id
     and oi.item_status = 'paid'
     and sp.production_status in ('produced', 'announced');

  return NEW;
end $$;

-- Was BEFORE UPDATE in 0025 (it mutated NEW.status). Now it touches
-- child rows instead, so it must run AFTER the order row is updated.
drop trigger if exists shop_orders_apply_product_production_trg on public.shop_orders;
create trigger shop_orders_apply_product_production_trg
  after update on public.shop_orders
  for each row execute function public.shop_orders_apply_product_production();


-- ------------------------------------------------------------
-- (4) place_shop_order — per-item preorder snapshot + item_status,
--     buyer_phone + slips[]. New signature (adds p_buyer_phone,
--     p_slips); drop the 0030 signature so PostgREST resolves cleanly.
-- ------------------------------------------------------------
drop function if exists public.place_shop_order(
  uuid, text, text, text, text, text, text, timestamptz, jsonb, int
);

create or replace function public.place_shop_order(
  p_buyer_id          uuid,
  p_buyer_label       text,
  p_buyer_name        text,
  p_buyer_email       text,
  p_buyer_phone       text,
  p_buyer_note        text,
  p_pickup_location   text,
  p_slip_url          text,
  p_slip_uploaded_at  timestamptz,
  p_slips             jsonb,
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
  v_prod_status        text;
  v_item_status        text;
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

  select array_agg(distinct (item->>'product_id') order by (item->>'product_id'))
    into v_product_ids
    from jsonb_array_elements(p_items) item;

  perform 1 from public.shop_products where id = any(v_product_ids) for update;

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
    else
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
               and o.status in ('pending','review','paid','produce','ready','slip_mismatch','exchange')
               and coalesce(oi.item_status, 'paid') <> 'done'),
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

  select code into v_code
    from public.shop_products
    where id = (p_items->0->>'product_id');
  v_code := upper(regexp_replace(coalesce(v_code, 'SH'), '[^A-Z0-9]', '', 'g'));
  if length(v_code) = 0 then v_code := 'SH'; end if;
  v_code := left(v_code, 5);

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

  v_attempt := 0;
  loop
    v_order_id := v_code || lpad((1000 + (random() * 8999)::int)::text, 4, '0');
    begin
      insert into public.shop_orders
        (id, buyer_id, buyer_label, buyer_name, buyer_email, buyer_phone, buyer_note,
         status, subtotal, fee, total, pickup_location, is_preorder,
         slip_url, slip_uploaded_at, slips, timeline, placed_at, updated_at)
      values
        (v_order_id, p_buyer_id, p_buyer_label, p_buyer_name, p_buyer_email, p_buyer_phone, p_buyer_note,
         v_initial_status, v_subtotal, coalesce(p_fee, 0), v_total, p_pickup_location, v_is_preorder,
         nullif(p_slip_url, ''), p_slip_uploaded_at, coalesce(p_slips, '[]'::jsonb),
         v_initial_timeline, v_now, v_now);
      exit;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 10 then
        raise exception 'ID_GENERATION_FAILED';
      end if;
    end;
  end loop;

  -- Insert items with frozen is_preorder snapshot + seeded item_status.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := v_item->>'product_id';

    select is_presale, production_status
      into v_item_is_preorder, v_prod_status
      from public.shop_products where id = v_product_id;
    v_item_is_preorder := coalesce(v_item_is_preorder, false);

    v_item_status := case coalesce(v_prod_status, 'pending')
                       when 'announced' then 'ready'
                       when 'produced'  then 'produce'
                       else 'paid'
                     end;

    insert into public.shop_order_items
      (order_id, product_id, size, color, fit, qty, unit_price, is_preorder, item_status)
    values
      (v_order_id,
       v_product_id,
       coalesce(v_item->>'size', 'F'),
       coalesce(v_item->>'color', 'default'),
       coalesce(v_item->>'fit', 'unisex'),
       (v_item->>'qty')::int,
       (v_item->>'unit_price')::int,
       v_item_is_preorder,
       v_item_status);
  end loop;

  return v_order_id;
end;
$$;

grant execute on function public.place_shop_order(
  uuid, text, text, text, text, text, text, text, timestamptz, jsonb, jsonb, int
) to anon, authenticated;
