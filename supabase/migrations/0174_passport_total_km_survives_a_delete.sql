-- 0174 — passport.total_km must survive a DELETE and an UPDATE, not just an INSERT.
--
-- SYMPTOM. 11 profiles hold a `total_km` higher than the sum of their own
-- scans — by 100 up to 2,850. Every single drift is POSITIVE; not one profile
-- has fewer points than its scans justify. That asymmetry is the whole clue.
--
-- CAUSE. `passport.scans` carried exactly ONE trigger: `on_new_scan`,
-- BEFORE INSERT (0056), which does
--
--     update profiles set total_km = total_km + calculated_points ...
--
-- Nothing mirrors it. Delete a scan and the points stay on the profile for
-- ever; edit `points_awarded` and the difference is never applied. Proved
-- directly, inside a rolled-back transaction: deleting one 200-point scan left
-- `total_km` at 300 while the remaining scans summed to 100.
--
-- The live-era id range (>648) holds 480 rows across 555 ids — **75 missing** —
-- so scans are deleted in normal operation, and each one has been silently
-- inflating a student's total since 0056.
--
-- ⚠️ THIS MIGRATION DOES NOT RECALCULATE ANY EXISTING TOTAL, ON PURPOSE.
-- Recomputing would REMOVE points from real students (one would drop from
-- 3,600 to 750). Whether a student keeps points they were shown is an owner's
-- decision, not a migration's. This closes the hole; it does not rewrite
-- history.
--
-- ⚠️ AND IT CANNOT EXPLAIN EVERY ROW. `putita.s@kkumail.com` is 1,996 above her
-- scans, and no scan can produce that: every `points_awarded` in the table is
-- 0/50/100/200/500 and no activity is hourly or non-round, so 1,996 is not
-- reachable by any combination of deleted scans. That total was written
-- directly — `passport.profiles_guard` lets `is_admin()` through — or came
-- across in the 2026-07 migration. Do not claim the delete bug explains it.

-- ── DELETE: give back what the insert took ──────────────────────────────
create or replace function passport.handle_scan_deleted()
returns trigger
language plpgsql
security definer
set search_path to 'passport'
as $$
begin
  -- old.points_awarded is the value the INSERT trigger actually stored
  -- (already doubled for a marketing-bonus activity), so subtracting it is
  -- exactly symmetric with what was added. Do NOT recompute from the activity:
  -- `is_marketing_bonus` can change after the fact, and then the two halves
  -- would disagree — the bug this migration exists to prevent, in reverse.
  update passport.profiles
     set total_km = greatest(coalesce(total_km, 0) - coalesce(old.points_awarded, 0), 0)
   where id = old.user_id;
  return old;
end$$;

drop trigger if exists on_scan_deleted on passport.scans;
create trigger on_scan_deleted after delete on passport.scans
  for each row execute function passport.handle_scan_deleted();

-- ── UPDATE: apply the difference ────────────────────────────────────────
create or replace function passport.handle_scan_points_changed()
returns trigger
language plpgsql
security definer
set search_path to 'passport'
as $$
begin
  -- Moving a scan between users is a delete + an insert as far as the totals
  -- are concerned; handle it rather than silently leaving both wrong.
  if new.user_id is distinct from old.user_id then
    update passport.profiles
       set total_km = greatest(coalesce(total_km,0) - coalesce(old.points_awarded,0), 0)
     where id = old.user_id;
    update passport.profiles
       set total_km = coalesce(total_km,0) + coalesce(new.points_awarded,0)
     where id = new.user_id;
  elsif new.points_awarded is distinct from old.points_awarded then
    update passport.profiles
       set total_km = greatest(coalesce(total_km,0)
                     + coalesce(new.points_awarded,0) - coalesce(old.points_awarded,0), 0)
     where id = new.user_id;
  end if;
  return new;
end$$;

drop trigger if exists on_scan_points_changed on passport.scans;
create trigger on_scan_points_changed after update on passport.scans
  for each row execute function passport.handle_scan_points_changed();

-- `passport.profiles_guard` refuses a total_km change unless
-- `pg_trigger_depth() > 1` or `is_admin()`. Both functions above run INSIDE a
-- trigger, so the depth check lets them through — the same door `on_new_scan`
-- has always used. No policy or grant change is needed.
