-- ============================================================
-- 0010_vp_accounts_permissions.sql
--
-- Adds per-VP staff accounts (10 อุปนายก) and a flexible
-- permissions[] system for extra feature access.
--
-- Roles stay the same — all VPs use existing role 'vp_admin'.
-- What's new:
--   * users.permissions text[] — extra features beyond the role
--     defaults. Values: 'pr' | 'samoshop' | 'projects' | 'creator'.
--   * vs_tickets RLS — vp_admin sees ONLY tickets where target_dept
--     matches their users.department. The samomdkkuvssound super-
--     account stays role='vs_staff' so it still sees everything.
--   * Reserved usernames for the 10 VPs in reserved_staff_usernames.
--
-- The auth.users rows themselves must still be created manually in
-- the Supabase dashboard (one per VP). Pattern below. After creating,
-- run the UPDATE statements at the bottom to set role/dept/permissions.
-- ============================================================

-- ------------------------------------------------------------
-- 1. permissions column
-- ------------------------------------------------------------

alter table public.users
  add column if not exists permissions text[] not null default '{}';

comment on column public.users.permissions is
  'Extra feature permissions beyond the role default. Values: pr|samoshop|projects|creator. Stacks with role-based access (additive).';

-- Helper: does the current user have a given permission?
create or replace function public.current_user_has_permission(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and perm = any(permissions)
  );
$$;

grant execute on function public.current_user_has_permission(text) to anon, authenticated;


-- ------------------------------------------------------------
-- 2. vs_tickets RLS — per-dept VPs see only their own
-- ------------------------------------------------------------

-- READ: existing vs_staff/dev + owner; ADD vp_admin filtered by dept.
drop policy if exists "vs_tickets_read" on public.vs_tickets;
create policy "vs_tickets_read" on public.vs_tickets
  for select using (
    submitter_id = auth.uid()
    or public.current_user_role() in ('vs_staff', 'dev')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept = (select department from public.users where id = auth.uid())
    )
  );

-- UPDATE: existing vs_staff/dev; ADD vp_admin filtered by dept.
-- (The owner-update policy from 0009 stays — owners reply to their own.)
drop policy if exists "vs_tickets_update_staff" on public.vs_tickets;
create policy "vs_tickets_update_staff" on public.vs_tickets
  for update using (
    public.current_user_role() in ('vs_staff', 'dev')
    or (
      public.current_user_role() = 'vp_admin'
      and target_dept = (select department from public.users where id = auth.uid())
    )
  );


-- ------------------------------------------------------------
-- 3. Reserved VP usernames
--
-- samomdkkuvpa already reserved by 0006 — we keep it as the
-- อุปนายกฝ่ายบริหารองค์กร account. Adding 9 more.
-- ------------------------------------------------------------

insert into public.reserved_staff_usernames (username, role, email) values
  ('samomdkkudigital',   'vp_admin', 'samomdkkudigital@samomdkku.app'),
  ('samomdkkuinternal',  'vp_admin', 'samomdkkuinternal@samomdkku.app'),
  ('samomdkkuexternal',  'vp_admin', 'samomdkkuexternal@samomdkku.app'),
  ('samomdkkuuniversity','vp_admin', 'samomdkkuuniversity@samomdkku.app'),
  ('samomdkkuacademic',  'vp_admin', 'samomdkkuacademic@samomdkku.app'),
  ('samomdkkustrategy',  'vp_admin', 'samomdkkustrategy@samomdkku.app'),
  ('samomdkkuquality',   'vp_admin', 'samomdkkuquality@samomdkku.app'),
  ('samomdkkumedia',     'vp_admin', 'samomdkkumedia@samomdkku.app'),
  ('samomdkkuradiology', 'vp_admin', 'samomdkkuradiology@samomdkku.app')
on conflict (username) do nothing;


-- ============================================================
-- MANUAL STEPS (after this migration is applied):
--
-- 1. In Supabase Dashboard → Authentication → Users → Add user,
--    create the 9 new accounts with the emails below + password.
--    Suggested pattern: 'samo69<short>' (e.g. samo69digital).
--
-- 2. Run these UPDATE statements to set role/department/permissions:
--
-- update public.users set
--   role = 'vp_admin',
--   department = 'อุปนายกฝ่ายบริหารองค์กร',
--   permissions = array['samoshop']
-- where email = 'samomdkkuvpa@samomdkku.app';
--
-- update public.users set
--   role = 'vp_admin',
--   department = 'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร',
--   permissions = array['pr','creator']
-- where email = 'samomdkkudigital@samomdkku.app';
--
-- update public.users set
--   role = 'vp_admin',
--   department = 'อุปนายกฝ่ายกิจการภายใน',
--   permissions = '{}'
-- where email = 'samomdkkuinternal@samomdkku.app';
--
-- update public.users set
--   role = 'vp_admin',
--   department = 'อุปนายกฝ่ายกิจการภายนอก',
--   permissions = '{}'
-- where email = 'samomdkkuexternal@samomdkku.app';
--
-- update public.users set
--   role = 'vp_admin',
--   department = 'อุปนายกฝ่ายกิจการมหาวิทยาลัย',
--   permissions = '{}'
-- where email = 'samomdkkuuniversity@samomdkku.app';
--
-- update public.users set
--   role = 'vp_admin',
--   department = 'อุปนายกฝ่ายวิชาการ',
--   permissions = '{}'
-- where email = 'samomdkkuacademic@samomdkku.app';
--
-- update public.users set
--   role = 'vp_admin',
--   department = 'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร',
--   permissions = '{}'
-- where email = 'samomdkkustrategy@samomdkku.app';
--
-- update public.users set
--   role = 'vp_admin',
--   department = 'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',
--   permissions = '{}'
-- where email = 'samomdkkuquality@samomdkku.app';
--
-- update public.users set
--   role = 'vp_admin',
--   department = 'อุปนายกฝ่ายเวชนิทัศน์',
--   permissions = '{}'
-- where email = 'samomdkkumedia@samomdkku.app';
--
-- update public.users set
--   role = 'vp_admin',
--   department = 'อุปนายกฝ่ายรังสีเทคนิค',
--   permissions = '{}'
-- where email = 'samomdkkuradiology@samomdkku.app';
--
-- 3. To grant a permission to an existing user later, just update
--    the array:
--      update public.users set permissions = array['pr','samoshop']
--      where email = '...';
-- ============================================================
