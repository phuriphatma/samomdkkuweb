-- ============================================================
-- 0002 — Seed: staff role helper
--
-- Staff accounts themselves are created by tools/migrate-from-sheets.mjs
-- via the Auth Admin API (because Supabase requires going through auth
-- to make a user). What we do here is publish a helper view + function
-- so the migration script and ops know which usernames are reserved.
-- ============================================================

-- Reference table — names that are reserved for staff/dev roles.
-- The migration script reads this list, ensures each one has an auth.users
-- row + matching public.users row with the right role.
create table if not exists public.reserved_staff_usernames (
  username        text primary key,
  role            text not null check (role in ('pr_staff', 'vs_staff', 'dev')),
  email           text not null,         -- synthetic email used for Supabase Auth signup
  created_at      timestamptz not null default now()
);

-- Synthetic emails: "<username>@samomdkku.app" — must match the format
-- the frontend computes in src/js/auth.js (usernameToEmail). Supabase
-- Auth rejects .local (RFC 6762 reserved), so we use .app — a real
-- public TLD with no mail delivery configured.
insert into public.reserved_staff_usernames (username, role, email) values
  ('samomdkkupr',       'pr_staff', 'samomdkkupr@samomdkku.app'),
  ('samomdkkuvssound',  'vs_staff', 'samomdkkuvssound@samomdkku.app'),
  ('samomdkkudev',      'dev',      'samomdkkudev@samomdkku.app')
on conflict (username) do update set email = excluded.email, role = excluded.role;

alter table public.reserved_staff_usernames enable row level security;

drop policy if exists "reserved_staff_usernames_read_staff" on public.reserved_staff_usernames;
create policy "reserved_staff_usernames_read_staff" on public.reserved_staff_usernames
  for select using (public.current_user_is_staff());
