-- ============================================================
-- 0007 — SAMO Shop refactor
--
-- Changes driven by 2026-05-27 feedback round:
--   * SOURCE enum reshaped: 'md' / 'rt' / 'mdi' / 'sittikao' (replacing
--     project / fund / merch). Existing rows are migrated to 'md' so
--     constraint validation passes — admin should re-tag them.
--   * `stock_status` column added: 'available' | 'sold_out' | 'production_closed'
--     This is independent of `is_active` (kept for soft-archive).
--   * `dates_full` jsonb on pickup batches replaces the parallel
--     dates[] + shared hours columns with [{date, hours}] per entry.
--     The old columns are KEPT for legacy reads but writes go through
--     dates_full.
--   * `shop_pickup_records` table — per-item delivery checklist with
--     optional issue tracking (wrong size, damaged, missing, other).
-- ============================================================

-- ------------------------------------------------------------
-- SHOP PRODUCTS
-- ------------------------------------------------------------

-- 1) Drop the old check FIRST so the UPDATE below isn't blocked by it.
--    (The old constraint allowed 'project'|'fund'|'rt'|'mdi'|'merch',
--    so any UPDATE to 'md' would fail while it's still active.)
alter table public.shop_products
  drop constraint if exists shop_products_source_check;

-- 2) Migrate anything not in the new enum to 'md' (covers legacy
--    project/fund/merch + any unexpected values).
update public.shop_products
   set source = 'md'
 where source not in ('md', 'rt', 'mdi', 'sittikao');

-- 3) Add the new check
alter table public.shop_products
  add  constraint shop_products_source_check
       check (source in ('md', 'rt', 'mdi', 'sittikao'));

-- 2) stock_status
alter table public.shop_products
  add column if not exists stock_status text not null default 'available';
-- separate drop+add so re-runs are idempotent even if the enum changes
alter table public.shop_products
  drop constraint if exists shop_products_stock_status_check;
alter table public.shop_products
  add  constraint shop_products_stock_status_check
       check (stock_status in ('available', 'sold_out', 'production_closed'));

-- ------------------------------------------------------------
-- SHOP PICKUP BATCHES — dates_full
-- ------------------------------------------------------------

alter table public.shop_pickup_batches
  add column if not exists dates_full jsonb not null default '[]';

-- Backfill dates_full from legacy dates[] + hours, only where empty
update public.shop_pickup_batches b
   set dates_full = sub.fixed
  from (
    select id,
           coalesce(
             (select jsonb_agg(jsonb_build_object('date', d, 'hours', coalesce(b2.hours, '')))
                from public.shop_pickup_batches b2
                join lateral unnest(b2.dates) d on true
               where b2.id = b1.id),
             '[]'::jsonb
           ) as fixed
      from public.shop_pickup_batches b1
  ) sub
 where b.id = sub.id
   and (b.dates_full is null or b.dates_full = '[]'::jsonb);

-- ------------------------------------------------------------
-- SHOP PICKUP RECORDS — delivery checklist
-- ------------------------------------------------------------
create table if not exists public.shop_pickup_records (
  id              bigserial primary key,
  order_id        text not null references public.shop_orders(id) on delete cascade,
  order_item_id   bigint not null references public.shop_order_items(id) on delete cascade,
  picked_up_at    timestamptz not null default now(),
  picked_up_by_admin uuid references public.users(id) on delete set null,
  recipient_name  text,
  issue_type      text check (issue_type in ('wrong_size', 'damaged', 'missing', 'other')),
  issue_note      text,
  resolution      text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (order_item_id)
);

create index if not exists shop_pickup_records_order_idx on public.shop_pickup_records (order_id);
create index if not exists shop_pickup_records_unresolved_idx on public.shop_pickup_records (order_id) where issue_type is not null and resolved_at is null;

drop trigger if exists touch_shop_pickup_records_updated_at on public.shop_pickup_records;
create trigger touch_shop_pickup_records_updated_at
  before update on public.shop_pickup_records
  for each row execute function public.touch_updated_at();

alter table public.shop_pickup_records enable row level security;

-- Buyer reads only own pickup records; admin reads all.
drop policy if exists "shop_pickup_records_read" on public.shop_pickup_records;
create policy "shop_pickup_records_read" on public.shop_pickup_records
  for select using (
    public.current_user_is_shop_admin()
    or exists (
      select 1 from public.shop_orders o
       where o.id = order_id and o.buyer_id = auth.uid()
    )
  );

drop policy if exists "shop_pickup_records_write_admin" on public.shop_pickup_records;
create policy "shop_pickup_records_write_admin" on public.shop_pickup_records
  for all using (public.current_user_is_shop_admin())
            with check (public.current_user_is_shop_admin());
