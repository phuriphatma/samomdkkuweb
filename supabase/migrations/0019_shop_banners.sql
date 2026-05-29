-- ============================================================
-- 0019_shop_banners.sql
--
-- Admin-curated promotional banners for the shop landing hero
-- carousel. The customer-side Recent Launches carousel used to be a
-- silent stack of products flagged `is_new`; for an e-commerce feel
-- we want admin-uploaded banner images that can carry their own
-- caption + click-through URL.
--
-- Sort: display_order asc (lower = appears first). Active toggle lets
-- admin retire a banner without deleting it. RLS: public read,
-- shop-admin write (uses the existing current_user_is_shop_admin()
-- helper, broadened in 0014 to include the 'samoshop' permission).
-- ============================================================

create table if not exists public.shop_banners (
  id uuid primary key default gen_random_uuid(),
  image_url text not null,
  caption text,
  link_url text,
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.shop_banners is
  'Admin-curated promotional banners shown in the shop landing hero carousel. Sorted by display_order asc.';

create index if not exists shop_banners_order_idx
  on public.shop_banners (display_order asc, created_at desc);

alter table public.shop_banners enable row level security;

drop policy if exists "shop_banners_read" on public.shop_banners;
create policy "shop_banners_read" on public.shop_banners
  for select using (true);

drop policy if exists "shop_banners_write" on public.shop_banners;
create policy "shop_banners_write" on public.shop_banners
  for all
  using (public.current_user_is_shop_admin())
  with check (public.current_user_is_shop_admin());
