-- passport-link-on-signup — a carried passport must reach the student who
-- signs in, and a re-key that FAILS must be visible.
--
-- 179 of 631 passport profiles have no `auth.users` row. That is the EXPECTED
-- state, not a bug: students carried over from the old project who have not
-- signed into the new one yet. `on_auth_user_created_passport_link` →
-- `public.passport_link_user_by_email()` finds the profile by EMAIL on first
-- signup and re-keys `passport.scans`, `passport.season_results` and
-- `passport.profiles` onto the new auth id, so the student keeps their km.
--
-- WHY THIS PROOF EXISTS. That whole re-key sits inside
-- `exception when others then raise warning`, and it has a second silent exit
-- (`profile already at <new id> — skip re-key`). Both END THE SAME WAY: signup
-- succeeds, the student opens an EMPTY passport, their km sits on an orphaned
-- row, and the only trace is a warning in a Postgres log nobody reads. Nothing
-- in the app surfaces it.
--
-- The detectable state is exact, because `passport.profiles.email` is UNIQUE —
-- one email can only ever have one profile. So a profile whose email matches an
-- `auth.users` row with a DIFFERENT id is unambiguously a student who signed in
-- and did not get their passport back.
--
-- ⚠️ Step 1 alone is a sweep that returns zero, and a sweep that returns zero
-- has said nothing until it is shown returning something
-- (`skills/write-a-guard.md` §2). Steps 2 and 4 are that showing: 2 manufactures
-- the state, 4 reaches it through the function's OWN skip branch. Both assert
-- the detector reports it. Everything rolls back.
begin;

create temp table r(step text, got text, want text, verdict text) on commit drop;

-- ONE definition of "stranded", used by every assertion below. A second copy
-- would be free to drift from the one that matters.
create temp view stranded as
  select p.id as profile_id, p.email, p.total_km, u.id as auth_id
  from passport.profiles p
  join auth.users u on lower(u.email) = lower(p.email) and u.id <> p.id;

-- ---------------------------------------------------------------- 1. LIVE
-- The payload. Everything else exists to prove this line can go red.
insert into r select 'live: no student signed in to a stranded passport',
  count(*)::text, '0',
  case when count(*) = 0 then 'PASS'
       else 'FAIL — ' || count(*) || ' profile(s) hold km under an id the signed-in student is not using' end
from stranded;

-- ------------------------------------------------------------- 2. CONTROL
-- Can the detector see one at all?
create temp table ctl on commit drop as
  select u.id as auth_id, u.email
  from auth.users u
  where u.email is not null
    and not exists (select 1 from passport.profiles p where lower(p.email) = lower(u.email))
  limit 1;

insert into r select 'control subject exists', count(*)::text, '1',
  case when count(*) = 1 then 'PASS'
       else 'FAIL — no auth user without a passport profile, so the control below proves nothing' end
from ctl;

insert into passport.profiles (id, email)
  select gen_random_uuid(), email from ctl;

insert into r select 'control: the detector SEES a stranded profile',
  count(*)::text, '1',
  case when count(*) = 1 then 'PASS' else 'FAIL — the detector is blind; step 1''s zero means nothing' end
from stranded s join ctl c on c.auth_id = s.auth_id;

delete from passport.profiles p using ctl c
  where lower(p.email) = lower(c.email) and p.id <> c.auth_id;

insert into r select 'control withdrawn', count(*)::text, '0',
  case when count(*) = 0 then 'PASS' else 'FAIL — the control leaked into the assertions below' end
from stranded;

-- --------------------------------------------------------------- 3. ALLOW
-- A real carried student signs in and gets their passport back. Derived from
-- the property, never named: any profile with scans, no auth row at its id, and
-- an email no auth user holds yet.
create temp table subj on commit drop as
  select p.id as old_id, p.email, coalesce(p.total_km, 0) as total_km,
         (select count(*) from passport.scans s where s.user_id = p.id) as scans
  from passport.profiles p
  where p.email is not null
    and not exists (select 1 from auth.users u where u.id = p.id)
    and not exists (select 1 from auth.users u where lower(u.email) = lower(p.email))
    and exists (select 1 from passport.scans s where s.user_id = p.id)
  limit 1;

insert into r select 'a carried student exists to sign in as', count(*)::text, '1',
  case when count(*) = 1 then 'PASS'
       else 'FAIL — no carried profile with scans; the re-key half is vacuous' end
from subj;

create temp table nid on commit drop as select gen_random_uuid() as id;

insert into auth.users (id, email) select n.id, s.email from nid n cross join subj s;

insert into r select 'signing in re-keys the carried profile',
  (select count(*)::text from passport.profiles p join nid n on p.id = n.id), '1',
  case when (select count(*) from passport.profiles p join nid n on p.id = n.id) = 1
        and (select count(*) from passport.profiles p join subj s on p.id = s.old_id) = 0
       then 'PASS' else 'FAIL — the trigger did not move the row onto the new auth id' end;

insert into r select 'the km and the stamps follow the student',
  (select coalesce(p.total_km, 0)::text || ' km / ' ||
          (select count(*) from passport.scans x where x.user_id = n.id)::text || ' scans'
     from passport.profiles p cross join nid n where p.id = n.id),
  (select total_km::text || ' km / ' || scans::text || ' scans' from subj),
  case when (select coalesce(p.total_km, 0)::text || ' km / ' ||
                    (select count(*) from passport.scans x where x.user_id = n.id)::text || ' scans'
               from passport.profiles p cross join nid n where p.id = n.id)
          = (select total_km::text || ' km / ' || scans::text || ' scans' from subj)
       then 'PASS' else 'FAIL — the student signed in to a lighter passport' end;

insert into r select 'nothing is stranded after a successful signup',
  count(*)::text, '0',
  case when count(*) = 0 then 'PASS' else 'FAIL' end
from stranded;

-- ------------------------------------------------------- 4. SILENT FAILURE
-- The function's own skip branch, reached the way production would reach it: a
-- profile already sits at the new auth id, so the re-key is abandoned with a
-- `raise warning` and signup carries on regardless. This is the shape the guard
-- exists for — it is not simulated breakage, it is a live code path.
create temp table subj2 on commit drop as
  select p.id as old_id, p.email, coalesce(p.total_km, 0) as total_km
  from passport.profiles p
  where p.email is not null
    and not exists (select 1 from auth.users u where u.id = p.id)
    and not exists (select 1 from auth.users u where lower(u.email) = lower(p.email))
    and exists (select 1 from passport.scans s where s.user_id = p.id)
    and p.id <> (select old_id from subj)
  limit 1;

insert into r select 'a second carried student exists', count(*)::text, '1',
  case when count(*) = 1 then 'PASS' else 'FAIL — cannot exercise the skip branch' end
from subj2;

create temp table nid2 on commit drop as select gen_random_uuid() as id;

insert into passport.profiles (id, email)
  select n.id, 'proof-occupant+' || n.id::text || '@example.invalid' from nid2 n;

insert into auth.users (id, email) select n.id, s.email from nid2 n cross join subj2 s;

insert into r select 'a re-key that gives up does NOT fail the signup',
  (select count(*)::text from auth.users u join nid2 n on u.id = n.id), '1',
  case when (select count(*) from auth.users u join nid2 n on u.id = n.id) = 1
       then 'PASS' else 'FAIL — signup aborted; the failure would not be silent' end;

insert into r select 'and it leaves the student on an EMPTY passport',
  (select coalesce(p.total_km, 0)::text from passport.profiles p join nid2 n on p.id = n.id),
  '0',
  case when (select coalesce(p.total_km, 0) from passport.profiles p join nid2 n on p.id = n.id) = 0
        and (select count(*) from passport.profiles p join subj2 s on p.id = s.old_id) = 1
       then 'PASS' else 'FAIL — the skip branch no longer strands anyone; re-read the function' end;

insert into r select 'THE GUARD CATCHES IT — step 1 would have gone red',
  count(*)::text, '1',
  case when count(*) = 1 then 'PASS'
       else 'FAIL — a silently stranded student is invisible to step 1' end
from stranded s join subj2 x on x.old_id = s.profile_id;

select step, got, want, verdict from r;
rollback;
