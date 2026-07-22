-- ============================================================
-- 0057 — SAMO Shop catalog config
--
-- Three admin-configurable lists that were previously hardcoded /
-- single-valued:
--
--   1. shop_product_types    — ประเภทสินค้า (was the static SHOP_TYPES
--                              array in src/js/shop/data.js)
--   2. shop_promptpay_qrs    — a managed list of PromptPay accounts
--                              (was the single shop_settings QR); each
--                              product can pick one via
--                              shop_products.promptpay_qr_id.
--   3. shop_pickup_locations — สถานที่รับสินค้า shown at buy-time; each
--                              product can pick one via
--                              shop_products.pickup_location_id.
--
-- Reuses public.current_user_is_shop_admin() (0003) and
-- public.touch_updated_at() (0001). Idempotent: drop-policy-before-create,
-- add-column-if-not-exists, seed on-conflict-do-nothing.
--
-- Apply via the Supabase SQL editor (project fheueuowbchsnsvbcgil).
-- ============================================================


-- ============================================================
-- 1) SHOP PRODUCT TYPES
-- shop_products.type stays loose text (no FK) so removing a type never
-- breaks an existing product — the UI falls back to the raw id label.
-- ============================================================

create table if not exists public.shop_product_types (
  id          text primary key,               -- e.g. 'apparel-shirt'
  label       text not null,
  icon        text not null default 'bi-tag',  -- bootstrap-icon class
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists shop_product_types_active_idx
  on public.shop_product_types (is_active, sort_order);

-- Seed the 5 types that used to live in SHOP_TYPES. do-nothing so a
-- re-run never clobbers admin edits.
insert into public.shop_product_types (id, label, icon, sort_order) values
  ('apparel-shirt',   'เสื้อยืด',     'bi-bag',          10),
  ('apparel-polo',    'เสื้อโปโล',    'bi-person-vcard', 20),
  ('apparel-trouser', 'กางเกง',       'bi-bookshelf',    30),
  ('bag',             'กระเป๋า',      'bi-handbag',      40),
  ('stationery',      'เครื่องเขียน', 'bi-pencil',       50)
on conflict (id) do nothing;

drop trigger if exists touch_shop_product_types_updated_at on public.shop_product_types;
create trigger touch_shop_product_types_updated_at
  before update on public.shop_product_types
  for each row execute function public.touch_updated_at();


-- ============================================================
-- 2) SHOP PROMPTPAY QRS
-- A managed list of PromptPay accounts. A product with a null
-- promptpay_qr_id falls back to the single is_default row.
-- ============================================================

create table if not exists public.shop_promptpay_qrs (
  id              bigserial primary key,
  label           text not null default '',        -- admin's name, e.g. 'บัญชี MD'
  promptpay_name  text not null default '',
  promptpay_id    text not null default '',
  qr_url          text,
  instructions    text not null default '',         -- per-QR override; '' → global shop_settings.instructions
  is_default      boolean not null default false,
  is_active       boolean not null default true,
  sort_order      integer not null default 100,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Only one row may be the default.
create unique index if not exists shop_promptpay_qrs_one_default
  on public.shop_promptpay_qrs (is_default) where is_default;

create index if not exists shop_promptpay_qrs_active_idx
  on public.shop_promptpay_qrs (is_active, sort_order);

-- Seed one default account from the current single-QR shop_settings row,
-- but only if no default exists yet (so a re-run is a no-op).
insert into public.shop_promptpay_qrs (label, promptpay_name, promptpay_id, qr_url, instructions, is_default, sort_order)
select 'บัญชีหลัก',
       coalesce(s.promptpay_name, ''),
       coalesce(s.promptpay_id, ''),
       s.promptpay_qr_url,
       coalesce(s.instructions, ''),
       true,
       0
  from public.shop_settings s
 where s.id = 1
   and not exists (select 1 from public.shop_promptpay_qrs where is_default);

drop trigger if exists touch_shop_promptpay_qrs_updated_at on public.shop_promptpay_qrs;
create trigger touch_shop_promptpay_qrs_updated_at
  before update on public.shop_promptpay_qrs
  for each row execute function public.touch_updated_at();

-- Product → QR link. null means "use the default account".
alter table public.shop_products
  add column if not exists promptpay_qr_id bigint
  references public.shop_promptpay_qrs(id) on delete set null;


-- ============================================================
-- 3) SHOP PICKUP LOCATIONS
-- ============================================================

create table if not exists public.shop_pickup_locations (
  id          bigserial primary key,
  label       text not null default '',    -- short, e.g. 'ห้อง SAMO คณะแพทย์'
  detail      text not null default '',     -- address / directions
  is_active   boolean not null default true,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists shop_pickup_locations_active_idx
  on public.shop_pickup_locations (is_active, sort_order);

drop trigger if exists touch_shop_pickup_locations_updated_at on public.shop_pickup_locations;
create trigger touch_shop_pickup_locations_updated_at
  before update on public.shop_pickup_locations
  for each row execute function public.touch_updated_at();

-- Product → pickup location link. null means "no pickup line shown".
alter table public.shop_products
  add column if not exists pickup_location_id bigint
  references public.shop_pickup_locations(id) on delete set null;


-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

alter table public.shop_product_types    enable row level security;
alter table public.shop_promptpay_qrs     enable row level security;
alter table public.shop_pickup_locations  enable row level security;

-- TYPES: anon/authenticated read active rows (customer grid is viewable
-- logged-out); admin reads all + writes.
drop policy if exists "shop_product_types_read" on public.shop_product_types;
create policy "shop_product_types_read" on public.shop_product_types
  for select using (is_active or public.current_user_is_shop_admin());

drop policy if exists "shop_product_types_write_admin" on public.shop_product_types;
create policy "shop_product_types_write_admin" on public.shop_product_types
  for all using (public.current_user_is_shop_admin())
            with check (public.current_user_is_shop_admin());

-- QRS: readable by everyone (matches shop_settings). A product may
-- reference a QR the admin later deactivated, and checkout must still
-- render it; the QR id / image are not secret. Admin writes.
drop policy if exists "shop_promptpay_qrs_read" on public.shop_promptpay_qrs;
create policy "shop_promptpay_qrs_read" on public.shop_promptpay_qrs
  for select using (true);

drop policy if exists "shop_promptpay_qrs_write_admin" on public.shop_promptpay_qrs;
create policy "shop_promptpay_qrs_write_admin" on public.shop_promptpay_qrs
  for all using (public.current_user_is_shop_admin())
            with check (public.current_user_is_shop_admin());

-- PICKUP LOCATIONS: anon/authenticated read active rows; admin reads all + writes.
drop policy if exists "shop_pickup_locations_read" on public.shop_pickup_locations;
create policy "shop_pickup_locations_read" on public.shop_pickup_locations
  for select using (is_active or public.current_user_is_shop_admin());

drop policy if exists "shop_pickup_locations_write_admin" on public.shop_pickup_locations;
create policy "shop_pickup_locations_write_admin" on public.shop_pickup_locations
  for all using (public.current_user_is_shop_admin())
            with check (public.current_user_is_shop_admin());
