-- ============================================================
-- 0003 — SAMO Shop schema
--
-- Adds product catalogue, orders + items, pickup batches,
-- and a single-row settings table for the PromptPay QR.
--
-- Also expands users.role check constraint to allow 'shop_admin',
-- a new role mirroring the existing pr_staff / vs_staff pattern.
--
-- Run via Supabase SQL editor or `supabase db push`.
-- ============================================================

-- ============================================================
-- USERS: expand role constraint to admit 'shop_admin'
-- (touch_updated_at + current_user_is_staff are already defined in 0001)
-- ============================================================

alter table public.users
  drop constraint if exists users_role_check;
alter table public.users
  add  constraint users_role_check
       check (role in ('user', 'pr_staff', 'vs_staff', 'shop_admin', 'dev'));

-- Re-publish current_user_is_staff so shop_admin counts as staff for any
-- generic "is this person a staffer?" checks. Existing PR/VS RLS policies
-- still gate on the specific role ('pr_staff' / 'vs_staff' / 'dev'), so
-- broadening this helper doesn't grant shop_admin access to PR/VS data.
create or replace function public.current_user_is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('pr_staff', 'vs_staff', 'shop_admin', 'dev')
$$;


-- ============================================================
-- SHOP PRODUCTS
-- ============================================================

create table if not exists public.shop_products (
  id              text primary key,                -- e.g. 'p-rt69-tshirt'
  name            text not null,
  sub             text,                            -- short subtitle
  description     text,
  type            text not null,                   -- 'apparel-shirt' | 'apparel-polo' | 'apparel-trouser' | 'bag' | 'accessory' | 'stationery'
  source          text not null                    -- 'project' | 'fund' | 'rt' | 'mdi' | 'merch'
                  check (source in ('project', 'fund', 'rt', 'mdi', 'merch')),
  price           integer not null check (price >= 0),
  sizes           text[] not null default '{F}',   -- list of size labels; 'F' = free-size
  colors          jsonb  not null default '[]',    -- [{id, label, hex}]
  fits            text[] not null default '{unisex}', -- 'men' | 'women' | 'unisex'
  hue             integer not null default 220,    -- decorative placeholder hue
  image_url       text,
  is_new          boolean not null default false,
  is_presale      boolean not null default false,
  presale_note    text,
  popularity      integer not null default 0,
  is_active       boolean not null default true,
  stock_matrix    jsonb  not null default '{}',    -- { "S-red-women": 0 } means OOS
  added_at        timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null,
  updated_at      timestamptz not null default now()
);

create index if not exists shop_products_source_idx     on public.shop_products (source);
create index if not exists shop_products_type_idx       on public.shop_products (type);
create index if not exists shop_products_added_at_idx   on public.shop_products (added_at desc);
create index if not exists shop_products_is_active_idx  on public.shop_products (is_active);


-- ============================================================
-- SHOP ORDERS
-- ============================================================

create table if not exists public.shop_orders (
  id              text primary key,                -- e.g. 'SS-26-00231'
  buyer_id        uuid references public.users(id) on delete set null,
  buyer_label     text,                            -- denormalised for guest-friendly display
  status          text not null default 'pending'
                  check (status in ('pending', 'review', 'paid', 'produce', 'ready', 'done', 'cancel')),
  subtotal        integer not null check (subtotal >= 0),
  fee             integer not null default 0 check (fee >= 0),
  total           integer not null check (total >= 0),
  slip_url        text,                            -- Drive thumbnail URL
  slip_uploaded_at timestamptz,
  pickup_location text,                            -- 'samo-room' | 'event' | custom
  pickup_batch_id bigint,                          -- FK created after shop_pickup_batches below
  buyer_note      text,
  admin_note      text,
  cancel_reason   text,
  timeline        jsonb  not null default '[]',    -- [{stage, at, label, by?}]
  placed_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists shop_orders_buyer_idx   on public.shop_orders (buyer_id);
create index if not exists shop_orders_status_idx  on public.shop_orders (status);
create index if not exists shop_orders_placed_idx  on public.shop_orders (placed_at desc);


-- ============================================================
-- SHOP ORDER ITEMS
-- ============================================================

create table if not exists public.shop_order_items (
  id              bigserial primary key,
  order_id        text not null references public.shop_orders(id) on delete cascade,
  product_id      text not null references public.shop_products(id) on delete restrict,
  size            text not null default 'F',
  color           text,
  fit             text not null default 'unisex',
  qty             integer not null check (qty > 0 and qty <= 99),
  unit_price      integer not null check (unit_price >= 0)
);

create index if not exists shop_order_items_order_idx on public.shop_order_items (order_id);
create index if not exists shop_order_items_product_idx on public.shop_order_items (product_id);


-- ============================================================
-- SHOP PICKUP BATCHES
-- Announcements that one or more products are ready for pickup,
-- with multiple date windows + a contact fallback.
-- ============================================================

create table if not exists public.shop_pickup_batches (
  id              bigserial primary key,
  title           text not null,
  product_ids     text[] not null default '{}',
  location        text not null,
  dates           text[] not null default '{}',    -- human-readable, e.g. ['27 พ.ค.', '28 พ.ค.']
  hours           text,                            -- e.g. '10:00 – 17:00 น.'
  note            text,
  contact_gmail   text,
  contact_instagram text,
  is_active       boolean not null default true,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists shop_pickup_batches_active_idx on public.shop_pickup_batches (is_active);

-- Now add the FK from orders.pickup_batch_id (separate so the create-table
-- order doesn't matter). on delete set null because deleting an announcement
-- shouldn't void the order.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shop_orders_pickup_batch_id_fkey'
  ) then
    alter table public.shop_orders
      add constraint shop_orders_pickup_batch_id_fkey
      foreign key (pickup_batch_id) references public.shop_pickup_batches(id) on delete set null;
  end if;
end$$;


-- ============================================================
-- SHOP SETTINGS — single-row config (PromptPay QR + instructions)
-- ============================================================

create table if not exists public.shop_settings (
  id                 integer primary key default 1,
  promptpay_name     text not null default '',
  promptpay_id       text not null default '',
  promptpay_qr_url   text,
  instructions       text not null default '',
  contact_gmail      text not null default '',
  contact_instagram  text not null default '',
  updated_at         timestamptz not null default now(),
  check (id = 1)
);

insert into public.shop_settings (id) values (1)
  on conflict (id) do nothing;


-- ============================================================
-- UPDATED_AT triggers (reuse touch_updated_at from 0001)
-- ============================================================

drop trigger if exists touch_shop_products_updated_at on public.shop_products;
create trigger touch_shop_products_updated_at
  before update on public.shop_products
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_shop_orders_updated_at on public.shop_orders;
create trigger touch_shop_orders_updated_at
  before update on public.shop_orders
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_shop_pickup_batches_updated_at on public.shop_pickup_batches;
create trigger touch_shop_pickup_batches_updated_at
  before update on public.shop_pickup_batches
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_shop_settings_updated_at on public.shop_settings;
create trigger touch_shop_settings_updated_at
  before update on public.shop_settings
  for each row execute function public.touch_updated_at();


-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

alter table public.shop_products        enable row level security;
alter table public.shop_orders          enable row level security;
alter table public.shop_order_items     enable row level security;
alter table public.shop_pickup_batches  enable row level security;
alter table public.shop_settings        enable row level security;

-- Helper: shop_admin OR dev
create or replace function public.current_user_is_shop_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('shop_admin', 'dev')
$$;

-- PRODUCTS: public reads of active products; admin writes any.
drop policy if exists "shop_products_read" on public.shop_products;
create policy "shop_products_read" on public.shop_products
  for select using (is_active or public.current_user_is_shop_admin());

drop policy if exists "shop_products_write_admin" on public.shop_products;
create policy "shop_products_write_admin" on public.shop_products
  for all using (public.current_user_is_shop_admin())
            with check (public.current_user_is_shop_admin());

-- ORDERS: buyers read their own; admin reads everything; buyers insert
-- their own (buyer_id must equal auth.uid()); only admin updates.
drop policy if exists "shop_orders_read" on public.shop_orders;
create policy "shop_orders_read" on public.shop_orders
  for select using (
    buyer_id = auth.uid()
    or public.current_user_is_shop_admin()
  );

drop policy if exists "shop_orders_insert_buyer" on public.shop_orders;
create policy "shop_orders_insert_buyer" on public.shop_orders
  for insert with check (buyer_id = auth.uid());

drop policy if exists "shop_orders_update_admin" on public.shop_orders;
create policy "shop_orders_update_admin" on public.shop_orders
  for update using (public.current_user_is_shop_admin());

-- The buyer is also allowed to update their own slip_url / buyer_note while
-- the order is still 'pending'/'review' (e.g. re-upload a corrected slip).
drop policy if exists "shop_orders_update_self_early" on public.shop_orders;
create policy "shop_orders_update_self_early" on public.shop_orders
  for update using (
    buyer_id = auth.uid() and status in ('pending', 'review')
  );

drop policy if exists "shop_orders_delete_admin" on public.shop_orders;
create policy "shop_orders_delete_admin" on public.shop_orders
  for delete using (public.current_user_is_shop_admin());

-- ORDER ITEMS: read piggy-backs on the parent order's read policy via a
-- subquery; insert is allowed for the buyer of the parent order; admin can
-- do anything.
drop policy if exists "shop_order_items_read" on public.shop_order_items;
create policy "shop_order_items_read" on public.shop_order_items
  for select using (
    exists (
      select 1 from public.shop_orders o
      where o.id = order_id
        and (o.buyer_id = auth.uid() or public.current_user_is_shop_admin())
    )
  );

drop policy if exists "shop_order_items_insert_buyer" on public.shop_order_items;
create policy "shop_order_items_insert_buyer" on public.shop_order_items
  for insert with check (
    exists (
      select 1 from public.shop_orders o
      where o.id = order_id and o.buyer_id = auth.uid()
    )
  );

drop policy if exists "shop_order_items_write_admin" on public.shop_order_items;
create policy "shop_order_items_write_admin" on public.shop_order_items
  for all using (public.current_user_is_shop_admin())
            with check (public.current_user_is_shop_admin());

-- PICKUP BATCHES: public reads of active; admin writes any.
drop policy if exists "shop_pickup_batches_read" on public.shop_pickup_batches;
create policy "shop_pickup_batches_read" on public.shop_pickup_batches
  for select using (is_active or public.current_user_is_shop_admin());

drop policy if exists "shop_pickup_batches_write_admin" on public.shop_pickup_batches;
create policy "shop_pickup_batches_write_admin" on public.shop_pickup_batches
  for all using (public.current_user_is_shop_admin())
            with check (public.current_user_is_shop_admin());

-- SETTINGS: anyone authenticated can read (so checkout shows QR); only
-- admin writes.
drop policy if exists "shop_settings_read_auth" on public.shop_settings;
create policy "shop_settings_read_auth" on public.shop_settings
  for select using (true);

drop policy if exists "shop_settings_write_admin" on public.shop_settings;
create policy "shop_settings_write_admin" on public.shop_settings
  for all using (public.current_user_is_shop_admin())
            with check (public.current_user_is_shop_admin());
