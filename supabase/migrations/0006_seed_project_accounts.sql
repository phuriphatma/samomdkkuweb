-- ============================================================
-- 0006 — Seed: reserve project-tracking accounts
--
-- Reserves two usernames for the new project-tracking workflow:
--   samomdkkuvpa  → role 'vp_admin' (SAMO VP Administration / sender)
--   sastaff       → role 'uni_staff' (university officer "พี่นิค" / receiver)
--
-- The actual auth.users rows are created via the Supabase Dashboard
-- (Authentication → Add user). Synthetic emails are used because
-- those accounts never receive real mail. After creating, run:
--
--   update public.users set role = 'vp_admin'  where email = 'samomdkkuvpa@samomdkku.app';
--   update public.users set role = 'uni_staff' where email = 'sastaff@samomdkku.app';
--
-- Apply AFTER 0005_project_tracking_schema.sql.
-- ============================================================

-- 0002 introduced reserved_staff_usernames with a check on role; 0004 expanded
-- it for shop_admin. Expand again for the two new roles.
alter table public.reserved_staff_usernames
  drop constraint if exists reserved_staff_usernames_role_check;
alter table public.reserved_staff_usernames
  add  constraint reserved_staff_usernames_role_check
       check (role in ('pr_staff', 'vs_staff', 'shop_admin', 'vp_admin', 'uni_staff', 'dev'));

insert into public.reserved_staff_usernames (username, role, email) values
  ('samomdkkuvpa', 'vp_admin',  'samomdkkuvpa@samomdkku.app'),
  ('sastaff',      'uni_staff', 'sastaff@samomdkku.app')
on conflict (username) do update set email = excluded.email, role = excluded.role;

-- Frontend mirror lives in src/js/auth.js RESERVED_USERNAMES — keep in sync.
