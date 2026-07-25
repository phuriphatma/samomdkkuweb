-- ============================================================
-- 0094 — Revert the SAMO Shop per-แหล่งที่มา scope added in 0093 (part A).
--
-- Product decision, not a bug: SAMO Shop is ONE role. Every shop admin manages
-- every แหล่งที่มา, so a scope dimension is not wanted — and a scope that exists
-- but nobody uses is worse than none, because the next person to touch this will
-- assume it is load-bearing and build on it (this repo has a mistakes.md entry
-- for exactly that shape).
--
-- REVERTED: current_user_shop_scope(), current_user_owns_shop_source(), and the
-- source-scoped shop_products write policy. current_user_is_shop_admin() goes
-- back to the plain role-or-permission definition it had before 0093.
--
-- KEPT (0093 part B — nothing to do with the shop scope, and all still needed):
--   · announcements_read honouring `creator`
--   · vs_followers / vs_public_comments via current_user_is_vs_handler()
--   · analytics_events via current_user_has_any_grant()
--
-- COLUMNS ARE LEFT IN PLACE, NOT DROPPED: team_nodes.shop_source,
-- team_members.shop_source, users.managed_shop_sources. Dropping columns is a
-- destructive schema change and these are inert — after this migration nothing
-- reads them (the frontend's userCanAccess no longer consults
-- managedShopSources, and no policy calls the scope helpers). They stay only so
-- the revert itself is non-destructive; drop them whenever you like with:
--     alter table public.team_nodes   drop column shop_source;
--     alter table public.team_members drop column shop_source;
--     alter table public.users        drop column managed_shop_sources;
-- (Then remove them from sync_my_team_permissions / recompute_team_managed_
-- permissions / users_self_update_guard, which still carry them below.)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Back to "any shop admin manages every source".
-- ------------------------------------------------------------
create or replace function public.current_user_is_shop_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() in ('shop_admin', 'dev')
      or public.current_user_has_permission('samoshop')
$$;

drop policy if exists "shop_products_write_admin" on public.shop_products;
create policy "shop_products_write_admin" on public.shop_products
  for all
  using (public.current_user_is_shop_admin())
  with check (public.current_user_is_shop_admin());

-- Drop the now-unreferenced helpers so nothing can quietly start depending on
-- a scope the product doesn't have. (Functions only — no data.)
drop function if exists public.current_user_owns_shop_source(text);
drop function if exists public.current_user_shop_scope();

-- ------------------------------------------------------------
-- 2. Clear every scoped shop binding and restore the blanket grant.
--    A row that carried a shop_source had `samoshop` stripped from
--    permissions[] by the 0093 "scoped is not full" rule — put it back, or the
--    revert would silently REMOVE shop access from whoever was scoped.
-- ------------------------------------------------------------
update public.team_nodes
   set permissions = (
         select coalesce(array_agg(distinct p), '{}')
           from unnest(coalesce(permissions, '{}') || array['samoshop']) as p),
       shop_source = null
 where shop_source is not null;

update public.team_members
   set permissions = (
         select coalesce(array_agg(distinct p), '{}')
           from unnest(coalesce(permissions, '{}') || array['samoshop']) as p),
       shop_source = null
 where shop_source is not null;

-- ------------------------------------------------------------
-- 3. Re-resolve everyone so managed_permissions picks the restored `samoshop`
--    up and managed_shop_sources drains to '{}'.
-- ------------------------------------------------------------
do $$
declare
  u record;
begin
  perform set_config('app.team_sync', '1', true);
  for u in
    select id, email from public.users
     where email is not null
       and exists (select 1 from public.team_members tm where lower(tm.kkumail) = lower(users.email))
  loop
    update public.users
       set managed_permissions  = public.effective_team_permissions_for_email(u.email),
           managed_shop_sources = public.effective_team_shop_sources_for_email(u.email)
     where id = u.id;
  end loop;
end $$;
