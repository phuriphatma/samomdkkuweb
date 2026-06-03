-- ============================================================
-- 0033 — Per-item fulfilment + buyer phone + multi-slip
--
-- Foundation for the Hybrid status model. PURELY ADDITIVE — no
-- behaviour change on its own. The JS that reads/writes these columns
-- ships across phases 1–3; this migration is safe to apply first.
--
-- Hybrid model recap:
--   * shop_orders.status keeps the PAYMENT phase only
--     (pending → review → paid, + cancel/refund/slip_mismatch).
--   * shop_order_items.item_status carries the FULFILMENT phase
--     (paid → produce → ready → done, + exchange/no_show), so each
--     product in an order can progress independently.
--   * shop_order_items.is_preorder freezes whether the product was in
--     preorder mode AT BUY TIME — the same product bought preorder vs
--     normal shows as two distinct rows. Flipping a product's
--     is_presale later never rewrites earlier orders.
--
-- Other additions:
--   * shop_orders.buyer_phone — now required at checkout.
--   * shop_orders.slips jsonb — array of { url, at } so a buyer can
--     attach / replace / remove more than one payment slip. slip_url
--     is kept as the "latest/primary" slip for back-compat reads
--     (CSV export, QR modal, admin verify thumbnail). Backfilled from
--     the existing single slip below.
-- ============================================================

-- ----------- Per-item fulfilment columns -----------

alter table public.shop_order_items
  add column if not exists item_status   text  not null default 'paid',
  add column if not exists item_timeline jsonb not null default '[]',
  add column if not exists is_preorder   boolean not null default false;

alter table public.shop_order_items
  drop constraint if exists shop_order_items_item_status_check;
alter table public.shop_order_items
  add constraint shop_order_items_item_status_check
  check (item_status in (
    'paid', 'produce', 'ready', 'done', 'exchange', 'no_show'
  ));

create index if not exists shop_order_items_item_status_idx
  on public.shop_order_items (item_status);
create index if not exists shop_order_items_is_preorder_idx
  on public.shop_order_items (is_preorder)
  where is_preorder = true;

comment on column public.shop_order_items.item_status is
  'Per-item fulfilment status (paid→produce→ready→done, +exchange/no_show). '
  'Independent of the order''s payment-phase status. The order''s shown '
  'overall stage is a JS rollup (min item stage).';
comment on column public.shop_order_items.is_preorder is
  'Frozen snapshot of the product''s is_presale at buy time. Never rewritten '
  'when the product later flips in/out of preorder.';


-- ----------- Buyer phone + multi-slip -----------

alter table public.shop_orders
  add column if not exists buyer_phone text,
  add column if not exists slips       jsonb not null default '[]';

comment on column public.shop_orders.buyer_phone is
  'Buyer contact phone, collected at checkout (required for new orders).';
comment on column public.shop_orders.slips is
  'Array of payment slips [{url, at}]. Buyer can add/replace/remove while '
  'the order is pending/review/slip_mismatch. slip_url mirrors the latest.';

-- Backfill: fold the existing single slip into the new array so old
-- orders keep showing their slip. Only touch rows that have a slip and
-- an empty array (idempotent on re-run).
update public.shop_orders
   set slips = jsonb_build_array(
         jsonb_build_object(
           'url', slip_url,
           'at',  coalesce(slip_uploaded_at, placed_at)
         )
       )
 where slip_url is not null
   and slip_url <> ''
   and slips = '[]'::jsonb;
