-- 0059_passport_email_key_merge.sql
-- ============================================================
-- Passport → samoweb merge, Phase 1 (Option B: email-keyed carry).
--
-- The Phase-0 port (0056) hard-FK'd two passport columns to auth.users:
--   passport.profiles.id       references auth.users(id)
--   passport.scans.user_id     references auth.users(id)
-- That blocks copying passport-only students — they have NO auth.users row in
-- project A yet (they signed up in the old project B). Under the agreed
-- email-keyed model we copy ALL passport data into A up front, keyed by email,
-- and back-fill the A auth uid lazily on each student's first login. So the two
-- auth FKs must go; email (already unique on profiles) is the cross-project
-- identity, and the login-time lazy-link re-establishes the uid relationship
-- in-app.
--
-- EVERYTHING ELSE IS PRESERVED:
--   * profiles_pkey / scans_pkey (PKs) stay — ids remain unique.
--   * scans.user_id stays NOT NULL (every scan still has an owner uuid).
--   * intra-passport FKs (activities→continents, samo_seasons→samo_years,
--     sub_departments→departments, season_results→seasons) unchanged.
--   * the on_new_scan → handle_new_scan points trigger unchanged.
--
-- Reversible: re-add the FKs once every profile/scan row references a real
-- auth.users(id) (i.e. after all uids are back-filled), if ever desired.
-- Idempotent: drop-if-exists is a no-op on re-run.
-- ============================================================

alter table passport.profiles drop constraint if exists profiles_id_fkey;
alter table passport.scans    drop constraint if exists scans_user_id_fkey;
