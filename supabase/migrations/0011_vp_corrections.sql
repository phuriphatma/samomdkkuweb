-- ============================================================
-- 0011_vp_corrections.sql
--
-- Two corrections on top of 0010:
--   1. Rename the VP-Media account: samomdkkumedia → samomdkkumdi
--      (so the password follows samo69mdi). The auth.users row must
--      be re-created in the Supabase dashboard with the new email —
--      see manual steps below.
--   2. Of the VP accounts, ONLY อุปนายกฝ่ายบริหารองค์กร
--      (samomdkkuvpa) gets access to หนังสือโครงการ. The other 9
--      VPs see VS for their dept only. This is enforced via the
--      permissions[] array (the auth.js userCanAccess + projects/
--      index.js isAllowed have been updated to require an explicit
--      'projects' permission for vp_admin accounts).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Rename reserved username (only if the bookkeeping table exists)
--
-- `reserved_staff_usernames` was added by migration 0002. Some
-- Supabase projects skipped 0002 and have never seen the table —
-- it's a reservation/reference list, not load-bearing. Wrap in a
-- table-exists check so this migration runs cleanly either way.
-- ------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'reserved_staff_usernames'
  ) then
    delete from public.reserved_staff_usernames where username = 'samomdkkumedia';
    insert into public.reserved_staff_usernames (username, role, email) values
      ('samomdkkumdi', 'vp_admin', 'samomdkkumdi@samomdkku.app')
    on conflict (username) do nothing;
  end if;
end $$;

-- If you already created the samomdkkumedia auth user before this
-- rename, delete it in the Supabase Dashboard (Authentication → Users
-- → find samomdkkumedia@samomdkku.app → "Delete user"). Then re-add as
-- samomdkkumdi@samomdkku.app with password samo69mdi.


-- ============================================================
-- MANUAL STEPS — run these UPDATE statements after creating the
-- 9 auth users in the Supabase Dashboard.
--
-- Sign-in pattern: username (no @suffix) + password from the table.
--
-- | Account              | Department                                   | Permissions             |
-- |----------------------|----------------------------------------------|-------------------------|
-- | samomdkkuvpa         | อุปนายกฝ่ายบริหารองค์กร                       | projects, samoshop      |
-- | samomdkkudigital     | อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร            | pr, creator             |
-- | samomdkkuinternal    | อุปนายกฝ่ายกิจการภายใน                       | —                       |
-- | samomdkkuexternal    | อุปนายกฝ่ายกิจการภายนอก                      | —                       |
-- | samomdkkuuniversity  | อุปนายกฝ่ายกิจการมหาวิทยาลัย                  | —                       |
-- | samomdkkuacademic    | อุปนายกฝ่ายวิชาการ                            | —                       |
-- | samomdkkustrategy    | อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร           | —                       |
-- | samomdkkuquality     | อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม          | —                       |
-- | samomdkkumdi         | อุปนายกฝ่ายเวชนิทัศน์                         | —                       |
-- | samomdkkuradiology   | อุปนายกฝ่ายรังสีเทคนิค                        | —                       |
-- ============================================================

update public.users set
  role = 'vp_admin',
  department = 'อุปนายกฝ่ายบริหารองค์กร',
  permissions = array['projects', 'samoshop']
where email = 'samomdkkuvpa@samomdkku.app';

update public.users set
  role = 'vp_admin',
  department = 'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร',
  permissions = array['pr', 'creator']
where email = 'samomdkkudigital@samomdkku.app';

update public.users set
  role = 'vp_admin',
  department = 'อุปนายกฝ่ายกิจการภายใน',
  permissions = '{}'
where email = 'samomdkkuinternal@samomdkku.app';

update public.users set
  role = 'vp_admin',
  department = 'อุปนายกฝ่ายกิจการภายนอก',
  permissions = '{}'
where email = 'samomdkkuexternal@samomdkku.app';

update public.users set
  role = 'vp_admin',
  department = 'อุปนายกฝ่ายกิจการมหาวิทยาลัย',
  permissions = '{}'
where email = 'samomdkkuuniversity@samomdkku.app';

update public.users set
  role = 'vp_admin',
  department = 'อุปนายกฝ่ายวิชาการ',
  permissions = '{}'
where email = 'samomdkkuacademic@samomdkku.app';

update public.users set
  role = 'vp_admin',
  department = 'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร',
  permissions = '{}'
where email = 'samomdkkustrategy@samomdkku.app';

update public.users set
  role = 'vp_admin',
  department = 'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',
  permissions = '{}'
where email = 'samomdkkuquality@samomdkku.app';

update public.users set
  role = 'vp_admin',
  department = 'อุปนายกฝ่ายเวชนิทัศน์',
  permissions = '{}'
where email = 'samomdkkumdi@samomdkku.app';

update public.users set
  role = 'vp_admin',
  department = 'อุปนายกฝ่ายรังสีเทคนิค',
  permissions = '{}'
where email = 'samomdkkuradiology@samomdkku.app';
