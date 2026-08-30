-- 0175 — a carried student who signs in must keep their km. 0174 took it away.
--
-- SYMPTOM (found by a guard, before any student hit it). A carried passport
-- profile that is re-keyed onto a new auth id on first signup arrives with
-- `total_km = 0` while every one of its scans is present. The stamps are there;
-- the number and the tier badge are gone.
--
-- CAUSE — the two halves of one rule, written a day apart and never run
-- together. `public.passport_link_user_by_email()` (the AFTER INSERT trigger on
-- `auth.users`) re-keys a carried profile in this order:
--
--     update passport.scans          set user_id = new.id where user_id = v_old;
--     update passport.season_results set user_id = new.id where user_id = v_old;
--     update passport.profiles       set id      = new.id where id      = v_old;
--
-- Until yesterday `passport.scans` had no UPDATE trigger, so the first line was
-- a pure re-pointing and the profile carried its `total_km` across untouched.
-- 0174 added `on_scan_points_changed`, which treats a change of `user_id` as a
-- transfer between two people: debit `old.user_id`, credit `new.user_id`. At
-- this instant the profile has NOT MOVED YET — there is no row at `new.id` — so
-- the debit empties the student's real profile and the credit updates zero
-- rows. The now-empty profile is then carried onto the new id by line three.
--
-- 0174 was right about transfers and blind to identity: this is not a scan
-- changing hands, it is one person's row changing its key. Reordering does not
-- help — move the profile first and the same trigger DOUBLES the total instead.
--
-- FIX. After the re-key, restate the invariant the passport already holds
-- everywhere else: a profile's `total_km` is the sum of its own scans. Measured
-- on production at the time of writing, all 631 profiles satisfy it exactly
-- (0174's reconciliation left drift at 0), so this asserts the property rather
-- than compensating for a particular trigger — a third trigger written later
-- cannot reintroduce the same hole.
--
-- EXPOSURE. Zero students affected. 144 carried profiles hold km and have not
-- signed in yet; every one of them would have lost it. The window was
-- 2026-08-29 15:00 UTC (0174 applied) to this migration; the two signups inside
-- it were not carried students, and no profile drifts from its scans.
--
-- PROOF. `tools/passport-link-on-signup.sql`, step "the km and the stamps
-- follow the student" — it reported `0 km / 1 scans` against `100 km / 1 scans`
-- before this migration and is what found the bug.

create or replace function public.passport_link_user_by_email()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old_id uuid;
begin
  begin
    if new.email is null then
      return new;
    end if;

    select p.id into v_old_id
    from passport.profiles p
    where lower(p.email) = lower(new.email)
      and p.id <> new.id
    limit 1;

    if v_old_id is null then
      return new;  -- no carried passport profile → nothing to re-key (app self-provisions on open)
    end if;

    if exists (select 1 from passport.profiles where id = new.id) then
      raise warning 'passport_link: profile already at % — skip re-key from %',
        new.id, v_old_id;
      return new;
    end if;

    update passport.scans          set user_id = new.id where user_id = v_old_id;
    update passport.season_results set user_id = new.id where user_id = v_old_id;
    update passport.profiles       set id      = new.id where id      = v_old_id;

    -- Re-keying is not a transfer. `on_scan_points_changed` cannot tell the
    -- difference, so it debited a profile that was about to become this one and
    -- credited an id nothing lived at yet. Restate the invariant instead of
    -- trying to out-order the trigger.
    update passport.profiles p
       set total_km = coalesce(
             (select sum(s.points_awarded) from passport.scans s where s.user_id = p.id), 0)
     where p.id = new.id;

  exception when others then
    raise warning 'passport_link_user_by_email failed for % (%): %',
      new.id, new.email, sqlerrm;
  end;
  return new;
end;
$function$;
