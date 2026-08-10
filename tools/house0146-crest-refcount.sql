-- ============================================================================
-- house0146-crest-refcount.sql — the house crest is a Drive file too.
--
--   node tools/db-query.mjs tools/house0146-crest-refcount.sql
--
-- `photo_reference_count` counted five tables, all spelling the column
-- `photo_url`. A house crest is the same kind of Drive file, uploaded by the
-- same uploader and deleted by the same `deleteTeamPhotoIfUnused` — it is just
-- stored in a column called `icon_url`. So the count answered 0 for every crest,
-- and 0 is the answer that authorises an irreversible delete.
--
-- Check 2 is the one that matters: TWO houses sharing one crest. That is the
-- case where the old count destroyed a file another house was using, and since
-- 0143 deletes revoke Drive sharing first, the victim 404s the same second
-- rather than surviving in the trash.
--
-- Rolls back.
-- ============================================================================
begin;
create temp table r(n int, name text, got text, want text);
-- ALLOW half: a crest actually in use must count.
update public.houses set icon_url = 'https://lh3.googleusercontent.com/d/CREST_TEST' where id = 1;
insert into r select 1, 'a crest in use counts as referenced',
  public.photo_reference_count('https://lh3.googleusercontent.com/d/CREST_TEST')::text, '1';
-- TWO houses sharing one crest: the case that made this dangerous.
update public.houses set icon_url = 'https://lh3.googleusercontent.com/d/CREST_TEST' where id = 2;
insert into r select 2, 'two houses sharing one crest count as TWO',
  public.photo_reference_count('https://lh3.googleusercontent.com/d/CREST_TEST')::text, '2';
-- DENY half: an unreferenced file must still answer 0, or the count is useless.
insert into r select 3, 'DENY — a file nothing points at is still 0',
  public.photo_reference_count('https://lh3.googleusercontent.com/d/NOBODY_HAS_THIS')::text, '0';
-- The blank-input rule: never 0, because 0 authorises a delete.
insert into r select 4, 'a blank URL answers 1, never 0',
  public.photo_reference_count('')::text, '1';
-- CONTROL: portraits still counted (the widening must not have replaced them).
-- CONTROL: the widening must not have REPLACED the five it already counted. A
-- live portrait mirrors across team_members + people + students, so the honest
-- answer is 3, not 1 — and 'greater than zero' would be a control that cannot
-- fail. (The first draft of this line asserted 0 and failed: a probe that
-- expects the wrong number is how a working function gets 'fixed'.)
-- The subject is DETERMINISTIC and the expectation is COMPUTED, not guessed.
-- Both halves were wrong before: `limit 1` with no ORDER BY picked an arbitrary
-- portrait, and the answer was hardcoded to 3 (people + team_members +
-- students). A person with TWO ตำแหน่ง legitimately counts 4, so the day one of
-- those rows was reachable the control failed over correct behaviour — the
-- "fails for a right reason, so nobody reads it again" shape.
insert into r
select 5, 'CONTROL — a portrait is counted once per row that references it',
       public.photo_reference_count(u)::text,
       ((select count(*) from public.team_members where photo_url = u)
      + (select count(*) from public.people       where photo_url = u)
      + (select count(*) from public.students     where photo_url = u))::text
  from (select photo_url u from public.team_members
         where photo_url is not null order by photo_url limit 1) x;
select n, case when got is not distinct from want then 'PASS' else 'FAIL' end status, name, got, want from r
union all select 99,
  case when count(*) filter (where got is not distinct from want)=count(*) then 'ALL PASS' else 'FAILURES' end,
  'SCORE', count(*) filter (where got is not distinct from want)||'/'||count(*), null from r
order by 1;
rollback;
