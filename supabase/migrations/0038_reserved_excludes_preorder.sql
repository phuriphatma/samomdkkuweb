-- ============================================================
-- 0038 — Reserved stock counts NORMAL-mode items only (not preorder)
--
-- Finite `stock_matrix` inventory exists for in-stock purchases. Preorder
-- items are made-to-order and must NOT deplete that finite stock — yet
-- 0034's reserved aggregates counted every active item regardless of
-- `is_preorder`. Symptoms:
--   * buyer-facing available = max(0, stock - reserved) shrank when
--     someone preordered, even though preorder doesn't consume stock;
--   * place_shop_order's oversell guard over-counted reserved (preorder
--     reservations included) and could falsely block a legit in-stock buy.
--
-- Fix: add `and coalesce(oi.is_preorder, false) = false` to all three
-- reserved aggregations:
--   (1) shop_reserved_matrix(text)
--   (2) shop_reserved_matrix_all()
--   (3) place_shop_order()'s inline v_reserved guard
-- `is_preorder` is the per-item frozen flag (admin-toggleable via
-- setOrderItemPreorder), so this respects later reclassification too.
--
-- Idempotent: all create-or-replace, signatures unchanged from 0034.
-- ============================================================

-- (1) Per-product reserved matrix.
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
      and coalesce(oi.is_preorder, false) = false
      and o.status in (
        'pending', 'review', 'paid', 'produce', 'ready',
        'slip_mismatch', 'exchange'
      )
      and coalesce(oi.item_status, 'paid') <> 'done'
    group by oi.size, oi.color
  ) sub;
$$;

grant execute on function public.shop_reserved_matrix(text) to anon, authenticated;


-- (2) All-products reserved matrix (one fetch for the whole catalogue).
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
      where coalesce(oi.is_preorder, false) = false
        and o.status in (
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


-- (3) place_shop_order — identical to 0034 except the v_reserved guard
--     now excludes preorder items. Signature unchanged.
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
               and coalesce(oi.is_preorder, false) = false
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
