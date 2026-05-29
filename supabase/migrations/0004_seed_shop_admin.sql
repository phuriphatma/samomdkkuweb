-- ============================================================
-- 0004 — Seed: reserve shop_admin username
--
-- The actual auth.users row is created via the Auth Admin API (Supabase
-- Dashboard → Authentication → Add user). This migration only records
-- that the username is reserved and which role to assign on first sign-in.
--
-- After creating the auth user manually, update public.users to set the
-- role:
--   update public.users set role = 'shop_admin'
--     where email = 'samomdkkushop@samomdkku.app';
-- ============================================================

-- 0002 added 'reserved_staff_usernames' with a check constraint on role.
-- Expand it to admit 'shop_admin' (mirrors the role expansion in 0003).
alter table public.reserved_staff_usernames
  drop constraint if exists reserved_staff_usernames_role_check;
alter table public.reserved_staff_usernames
  add  constraint reserved_staff_usernames_role_check
       check (role in ('pr_staff', 'vs_staff', 'shop_admin', 'dev'));

insert into public.reserved_staff_usernames (username, role, email) values
  ('samomdkkushop', 'shop_admin', 'samomdkkushop@samomdkku.app')
on conflict (username) do update set email = excluded.email, role = excluded.role;

-- The frontend's `registerWithPassword` blocks these reserved usernames too;
-- the canonical list is in src/js/auth.js (RESERVED_USERNAMES). Keep both
-- in sync when adding a new reserved staff account.
