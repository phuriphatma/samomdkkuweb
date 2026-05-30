-- ============================================================
-- 0026 — Profile email-add flow + per-order contact fields
--
-- Unlocks two product features that were both shipped at once:
--
--   (1) Profile self-edit:
--       Users can edit their display name, add/change a verified
--       email, and link a Google identity to a username/password
--       account. After verifying an email via Supabase magic-link
--       (db.auth.updateUser), auth.users.email moves from the
--       synthetic <username>@samomdkku.app to the real address.
--       Username/password sign-in must keep working — so the
--       frontend looks up the auth email from the username via
--       a security-definer RPC instead of computing the synthetic
--       one. See `public.lookup_email_by_username` below.
--
--   (2) Shop checkout contact:
--       Orders now carry the buyer's chosen name AND email
--       separately from `buyer_label` (which stays as the display
--       string for admin lists). Both default to the profile but
--       are editable at checkout. This is what an order receipt
--       / reminder email will use later.
--
-- Backwards-compat: all new columns are nullable; existing JS
-- degrades gracefully when they're missing (api.js stamps them
-- when present, admin.js falls back to buyer_label).
-- ============================================================

-- ------------------------------------------------------------
-- (1a) RPC: lookup_email_by_username
--
-- Called from src/js/auth.js signInWithPassword to resolve the
-- right auth email before calling Supabase's
-- signInWithPassword({email, password}). Needs to be callable by
-- anon (pre-sign-in) and authenticated. Reads auth.users which
-- normal RLS doesn't touch — uses security definer + a tightly
-- scoped select. Returns NULL when no row matches (the JS then
-- falls back to the synthetic email so the path keeps working
-- for users who never added a real email — e.g. all staff).
-- ------------------------------------------------------------
create or replace function public.lookup_email_by_username(p_username text)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select au.email
  from public.users pu
  join auth.users au on au.id = pu.id
  where pu.username = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.lookup_email_by_username(text) from public;
grant execute on function public.lookup_email_by_username(text) to anon, authenticated;

-- ------------------------------------------------------------
-- (1b) Mirror auth.users.email → public.users.email on confirm
--
-- The existing on_auth_user_created trigger fires only on INSERT.
-- When Supabase's updateUser({email}) flow completes and
-- auth.users.email changes, we want public.users.email to follow
-- so the staff dashboards / display logic stay accurate.
-- ------------------------------------------------------------
create or replace function public.handle_auth_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.users
       set email = new.email
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();

-- ------------------------------------------------------------
-- (2) shop_orders contact fields
-- ------------------------------------------------------------
alter table public.shop_orders
  add column if not exists buyer_name  text,
  add column if not exists buyer_email text;

create index if not exists shop_orders_buyer_email_idx
  on public.shop_orders (buyer_email);
