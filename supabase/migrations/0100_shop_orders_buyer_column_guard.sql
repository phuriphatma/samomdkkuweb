-- ============================================================
-- 0100 — a buyer may not rewrite their own order's MONEY
--
-- Third instance of the same class this session, and the first one that
-- touches money. `shop_orders_update_self_early` (0003) is
--
--   for update using (buyer_id = auth.uid()
--                     and status = any (array['pending','review','slip_mismatch']))
--
-- with NO `with check` — so Postgres reuses the USING expression as the check,
-- which is why a buyer cannot escape the early-status window. That containment
-- is real and is the only reason this is not far worse. But RLS is ROW-level:
-- inside that window the buyer may write EVERY column. Proven live against
-- production in a rolled-back transaction, as a real buyer's uid, on their own
-- pending ฿520 order:
--
--   update shop_orders set total = 0, subtotal = 0, fee = 0    → ACCEPTED
--   update shop_orders set admin_note = 'PAID IN FULL - verified by staff',
--          timeline = '[{"by":"admin","text":"ชำระเงินแล้ว"}]' → ACCEPTED
--   update shop_orders set status = 'paid'                     → blocked ✔
--   final row: total=0 subtotal=0 status=pending
--              admin_note='PAID IN FULL - verified by staff'
--              timeline=[{"by": "admin", "text": "ชำระเงินแล้ว"}]
--
-- So the attack is: place an order, PATCH the total to 0, forge an admin_note
-- and a timeline entry attributed to "admin", upload any slip. The order then
-- reaches the verify queue showing ฿0 due with staff-looking corroboration.
-- Whether it gets approved depends on the admin reading carefully — the data
-- integrity is broken either way, and `admin_note` / `timeline` are staff-facing
-- fields a student should never be able to author.
--
-- Same shape as `users_self_update_guard` (0028/0041) and
-- `vs_tickets_self_update_guard` (0096); same construction, same 0041 lesson —
-- it fires ONLY on the owner self-update path (`auth.uid() = old.buyer_id`,
-- non-admin), so shop admins, the `place_shop_order` RPC, service_role and the
-- Management API are untouched.
--
-- WHAT THE BUYER LEGITIMATELY WRITES, read off the three buyer call sites in
-- src/js/shop/api.js (everything else on shop_orders is admin-only):
--   enrichNewOrder    buyer_phone, slips
--   addOrderSlip      slips, slip_url, slip_uploaded_at, status, timeline
--   removeOrderSlip   slips, slip_url, slip_uploaded_at, status, timeline
-- That is the whole allow-list. `status` stays governed by the RLS predicate
-- above (pending/review/slip_mismatch only) rather than being re-checked here.
--
-- Deny-by-default via `to_jsonb(row) - allowed_keys`, so a column added by a
-- FUTURE migration is guarded automatically — notably any new price column.
-- `updated_at` is excluded because `touch_shop_orders_updated_at` also fires
-- BEFORE UPDATE; it sorts after this trigger by name, so at this point it
-- still holds the old value, but excluding it keeps the guard correct if the
-- trigger order ever changes. shop_orders has no GENERATED columns (the trap
-- that `is_duplicate` sprang in 0096), and
-- `shop_orders_apply_product_production_trg` is an AFTER trigger, so neither
-- interferes.
--
-- Idempotent.
-- ============================================================

create or replace function public.shop_orders_self_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_old_t jsonb;
  v_new_t jsonb;
  v_n     integer;
  i       integer;
  e       jsonb;
begin
  -- Shop admins: their own RLS policy (shop_orders_update_admin) is the boundary.
  if public.current_user_is_shop_admin() then
    return new;
  end if;
  -- Not the buyer self-update path. Server contexts (place_shop_order,
  -- service_role, migrations) have a null auth.uid(); everyone else is already
  -- refused by RLS.
  if v_uid is null or v_uid is distinct from old.buyer_id then
    return new;
  end if;

  -- Deny every column except the ones the buyer flows actually write.
  if (to_jsonb(old) - 'buyer_phone' - 'slips' - 'slip_url' - 'slip_uploaded_at'
                    - 'status' - 'timeline' - 'updated_at')
     is distinct from
     (to_jsonb(new) - 'buyer_phone' - 'slips' - 'slip_url' - 'slip_uploaded_at'
                    - 'status' - 'timeline' - 'updated_at') then
    raise exception 'ผู้ซื้อแก้ไขได้เฉพาะสลิปและข้อมูลติดต่อของตนเองเท่านั้น'
      using errcode = 'P0001',
            detail  = 'shop_orders_self_update_guard: price/admin fields are not buyer-writable';
  end if;

  -- Timeline: append-only, and an appended entry may not claim an author.
  -- The buyer flows push {stage, at, label}; only admin entries carry `by`,
  -- which is what made the forged '{"by":"admin"}' entry above possible.
  v_old_t := coalesce(old.timeline, '[]'::jsonb);
  v_new_t := coalesce(new.timeline, '[]'::jsonb);
  if v_new_t <> v_old_t then
    if jsonb_typeof(v_new_t) <> 'array' then
      raise exception 'รูปแบบไทม์ไลน์ไม่ถูกต้อง' using errcode = 'P0001';
    end if;
    v_n := jsonb_array_length(v_old_t);
    if jsonb_array_length(v_new_t) < v_n then
      raise exception 'ไม่สามารถลบประวัติของคำสั่งซื้อได้' using errcode = 'P0001';
    end if;
    for i in 0 .. v_n - 1 loop
      if (v_new_t -> i) is distinct from (v_old_t -> i) then
        raise exception 'ไม่สามารถแก้ไขประวัติเดิมของคำสั่งซื้อได้' using errcode = 'P0001';
      end if;
    end loop;
    if jsonb_array_length(v_new_t) > 200 then
      raise exception 'ประวัติของคำสั่งซื้อยาวเกินไป' using errcode = 'P0001';
    end if;
    for i in v_n .. jsonb_array_length(v_new_t) - 1 loop
      e := v_new_t -> i;
      if e ? 'by' then
        raise exception 'ไม่สามารถระบุผู้ดำเนินการในประวัติได้' using errcode = 'P0001';
      end if;
      if char_length(coalesce(e ->> 'label', '')) > 200 then
        raise exception 'ข้อความในประวัติยาวเกินไป' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists shop_orders_self_update_guard on public.shop_orders;
create trigger shop_orders_self_update_guard
  before update on public.shop_orders
  for each row execute function public.shop_orders_self_update_guard();

comment on function public.shop_orders_self_update_guard() is
  '0100 — column guard for the shop_orders_update_self_early RLS path. RLS is row-level; without this a buyer can zero their own total and forge admin_note/timeline while the order is pending (proven live). Fires only when auth.uid() = buyer_id and the caller is not a shop admin.';
