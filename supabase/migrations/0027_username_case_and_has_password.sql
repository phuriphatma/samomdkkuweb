-- ============================================================
-- 0027 — Two small follow-ups to 0026 that turned up during the
-- profile-edit / Google-link round:
--
--   (1) Case-insensitive username lookup.
--       0026's `lookup_email_by_username` lower()-ed the input but
--       compared against `pu.username` as-is. Pre-existing rows can
--       have mixed-case usernames (the legacy register-with-password
--       flow never lowercased before writing), so the RPC missed
--       them. The fix is to lower() both sides. Going forward, the
--       JS also lowercases on every write — but the DB still has
--       to be tolerant of what's already there.
--
--   (2) `public.users.has_password` mirror.
--       Reliable UI gating for "Set password" vs "Change password"
--       in the profile modal. Supabase's `auth.users.encrypted_password`
--       is server-only; we can't read it from the browser. The
--       identities-array fallback we were using (`provider='email'`)
--       lies for Google-only users who later add a password via
--       `db.auth.updateUser({password})` — Supabase sets the password
--       but does not create an email identity row, so the profile
--       modal would have shown the Set form forever. Mirror the
--       presence of `encrypted_password` into a public column so the
--       client reads it on the normal profile fetch.
--
-- Re-running 0026 on top of this is safe; this file is independent.
-- ============================================================

-- ------------------------------------------------------------
-- (1) Case-insensitive RPC
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
  where lower(pu.username) = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.lookup_email_by_username(text) from public;
grant execute on function public.lookup_email_by_username(text) to anon, authenticated;

-- ------------------------------------------------------------
-- (2) has_password mirror
-- ------------------------------------------------------------
alter table public.users
  add column if not exists has_password boolean not null default false;

create or replace function public.handle_auth_user_password_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Mirror "does this auth user have a password set" into the public
  -- profile row so the browser can read it without a privileged call.
  update public.users
     set has_password = (new.encrypted_password is not null)
   where id = new.id
     and has_password is distinct from (new.encrypted_password is not null);
  return new;
end;
$$;

-- Fire on INSERT (account creation) and on UPDATE OF encrypted_password
-- (Supabase's updateUser({password}) path lands here). The WHEN clause
-- on INSERT keeps the trigger cheap for OAuth-only signups.
drop trigger if exists on_auth_user_password_sync_insert on auth.users;
create trigger on_auth_user_password_sync_insert
  after insert on auth.users
  for each row
  when (new.encrypted_password is not null)
  execute function public.handle_auth_user_password_sync();

drop trigger if exists on_auth_user_password_sync_update on auth.users;
create trigger on_auth_user_password_sync_update
  after update of encrypted_password on auth.users
  for each row
  execute function public.handle_auth_user_password_sync();

-- Backfill: stamp current value on every existing row so the profile
-- modal renders the right UI for staff seeded before this migration.
update public.users pu
   set has_password = (au.encrypted_password is not null)
  from auth.users au
 where au.id = pu.id
   and pu.has_password is distinct from (au.encrypted_password is not null);
