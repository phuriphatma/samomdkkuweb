-- ============================================================
-- 0150 — a buyer may correct the CONTACT EMAIL on their own order
--
-- Why: SAMO Shop's only channel for a slip problem or a pickup announcement is
-- the contact ON THE ORDER, and the buyer TYPES that email at checkout. It is
-- not verified and not derived from the account — someone signed in with Google
-- can type over the prefill, and a username/password account has no email to
-- prefill at all. A typo there is silent and permanent: staff mail an address
-- that does not exist and the buyer never learns why nothing arrived. That is
-- also the reason the shop does NOT need to restrict who may sign in: the
-- reachable-contact problem lives on the order, not on the account.
--
-- What was wrong: `shop_orders_self_update_guard` — 0100's column guard, added
-- after a row-level UPDATE policy with no column guard let a buyer rewrite
-- prices — whitelists buyer_phone / slips / slip_url / slip_uploaded_at /
-- status / timeline / updated_at, while its own error message reads
-- "ผู้ซื้อแก้ไขได้เฉพาะสลิปและข้อมูลติดต่อของตนเองเท่านั้น". It PROMISES contact
-- data. Phone was writable; email was not. The message and the whitelist had
-- drifted, and email was the half that mattered.
--
-- Why this grants nothing new: the buyer already CHOOSES buyer_email — a
-- required field they type on the insert path. Correcting it later adds no
-- capability they did not already exercise; it removes a one-way door. Prices,
-- item rows and every admin field stay outside the whitelist as before.
--
-- `buyer_name` is deliberately NOT added: it is what staff match a person
-- against at pickup, which is closer to identity than to contact.
--
-- ⚠ THIS BODY WAS COPIED FROM THE LIVE FUNCTION (pg_get_functiondef), not from
-- the migration that first defined it, and only the whitelist line changed. The
-- live body carries four guards a reconstruction-from-memory dropped: a
-- jsonb_typeof check, a 200-entry timeline cap, a 200-character label cap, and
-- its own Thai messages. Recreating this function from an older migration would
-- silently revert all of them.
--
-- Guard: `node tools/db-query.mjs tools/shop0150-buyer-contact.sql` — both
-- directions in a rolled-back transaction: the buyer CAN set email and phone,
-- and still CANNOT touch the money.
-- ============================================================

CREATE OR REPLACE FUNCTION public.shop_orders_self_update_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- `buyer_email` joins `buyer_phone` in 0150: both are contact fields the buyer
  -- already types on the INSERT path, and the raise below has always described
  -- this set as "ข้อมูลติดต่อ".
  if (to_jsonb(old) - 'buyer_phone' - 'buyer_email' - 'slips' - 'slip_url'
                    - 'slip_uploaded_at' - 'status' - 'timeline' - 'updated_at')
     is distinct from
     (to_jsonb(new) - 'buyer_phone' - 'buyer_email' - 'slips' - 'slip_url'
                    - 'slip_uploaded_at' - 'status' - 'timeline' - 'updated_at') then
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
$function$

