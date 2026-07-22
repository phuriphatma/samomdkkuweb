-- 0062_passport_profiles_insert_own.sql
-- ============================================================
-- Passport merge follow-up: let a passport user CREATE their own profile row.
--
-- Fixes the "existing sameweb user opens passport for the first time" edge:
-- such a user already has an A auth account (so the signup trigger 0060/0061,
-- which fires only at signup, never runs for them) but has NO passport profile.
-- Without a profile their km can't be tracked (on_new_scan updates 0 rows) and
-- they're absent from the roster. As of 2026-07-22 this is 104 of 166 portal
-- users. The passport app now creates the profile on demand at login
-- (ensureProfile), which needs an own-row INSERT policy.
--
-- profiles previously had only read-all (SELECT using true) + update_own
-- (UPDATE auth.uid()=id) and NO insert policy (B relied purely on its
-- handle_new_user trigger). This adds a tightly-scoped INSERT: a user may
-- insert ONLY a row whose id equals their own auth uid — they cannot forge a
-- profile for someone else. Idempotent (drop-if-exists).
-- ============================================================

drop policy if exists profiles_insert_own on passport.profiles;
create policy profiles_insert_own on passport.profiles
  for insert to authenticated
  with check (auth.uid() = id);
