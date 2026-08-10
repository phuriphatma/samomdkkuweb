-- ============================================================================
-- team0145-one-chan-pi.sql — ชั้นปี is ONE derived fact, in both systems.
--
--   node tools/db-query.mjs tools/team0145-one-chan-pi.sql
--
-- DIFFERENTIAL, and BOTH-DIRECTIONAL. Every check has an allow half and a deny
-- half, because a probe that can only report "unchanged" cannot tell a working
-- mirror from a write that never landed. Runs inside a transaction and ROLLS
-- BACK — it mutates a real person's row on purpose, because the bug it guards
-- only appears in the interaction between three triggers and an RPC.
--
-- WHAT IT PINS
--   1  a ชั้นปี edit SURVIVES the people-update that follows it (the revert)
--   2  a corrected รหัสนักศึกษา moves ปีที่เข้า on people, students AND the posting
--   3  year_offset reaches every placement, and is what a chooser writes
--   4  the ingredients agree across people / students / team_members
--   5  the CONTROL: person_mirror_down still refuses to fire on an equal row
--      (if this passes when it should fail, the guard is gone and the mirrors
--       are one recursion away from each other)
-- ============================================================================
begin;

create temp table result(n int, name text, got text, want text, ok boolean);

-- A person who holds BOTH a house placement and (two) ทีม SAMO postings. Picked
-- by shape, not by name, so this keeps working when the seed data moves.
create temp table subj as
select p.id as person_id, s.id as student_id, p.kkumail
  from public.people p
  join public.students s on s.person_id = p.id
 where exists (select 1 from public.team_members m where m.person_id = p.id)
   and p.student_id is not null
 order by (select count(*) from public.team_members m where m.person_id = p.id) desc,
          p.kkumail
 limit 1;

-- ---------------------------------------------------------------------------
-- 1 — THE REPORTED BUG. "when i change ชั้นปี in the main web, nothing happens".
--
-- Replays the my-seat save: write the ชั้นปี where the card writes it, then
-- touch `people` the way update_my_identity's last statement does. Before 0145
-- that second step wrote the stale registry value straight back over the first,
-- and check 2 is the assertion that made the diagnosis.
--
-- ⚠️ THE FIRST DRAFT OF THIS PROBE WROTE `team_members.year_offset` DIRECTLY and
-- failed — correctly. Since 0145 that column is a MIRROR the registry owns, so a
-- direct write to it SHOULD be undone. Demanding it survive was asking the mirror
-- to be broken; check 3 pins the refusal instead, and the card's save goes
-- through update_my_identity for exactly this reason.
-- ---------------------------------------------------------------------------
update public.students set year_offset = -2 where id = (select student_id from subj);

insert into result select 1, 'a ชั้นปี edit reaches the posting from the registry',
  (select distinct year_offset::text from public.team_members where person_id = (select person_id from subj)),
  '-2', false;

update public.people p
   set cohort_year = coalesce(s.cohort_year, p.cohort_year)
  from public.students s
 where s.person_id = p.id and p.id = (select person_id from subj);

insert into result select 2, 'and SURVIVES the people-touch that follows it',
  (select distinct year_offset::text from public.team_members where person_id = (select person_id from subj)),
  '-2', false;

-- THE DENY HALF of the same rule: the placement does not own this column.
update public.team_members set year_offset = 3 where person_id = (select person_id from subj);
update public.people set nickname = coalesce(nickname, '') || 'z'
 where id = (select person_id from subj);

insert into result select 3, 'DENY — a direct write to the posting is undone by the registry',
  (select distinct year_offset::text from public.team_members where person_id = (select person_id from subj)),
  '-2', false;

-- ---------------------------------------------------------------------------
-- 2 — a corrected รหัสนักศึกษา re-derives ปีที่เข้า on ALL THREE tables.
--
-- 603070316-0 is the id the owner used to report this: it encodes ปีที่เข้า 2560,
-- which at ปีการศึกษา 2569 is ชั้นปี 10 — "จบแล้ว". The point of the check is not
-- the number, it is that one number reaches all three readers.
-- ---------------------------------------------------------------------------
update public.students set student_id = '603070316-0'
 where id = (select student_id from subj);

insert into result select 4, 'students.cohort_year re-derived from the new รหัส',
  (select cohort_year::text from public.students where id = (select student_id from subj)),
  '2560', false;

insert into result select 5, 'people.cohort_year followed it up',
  (select cohort_year::text from public.people where id = (select person_id from subj)),
  '2560', false;

insert into result select 6, 'the ทีม SAMO posting got the same ingredient',
  (select distinct cohort_year::text from public.team_members where person_id = (select person_id from subj)),
  '2560', false;

insert into result select 7, 'and the รหัส itself reached the posting',
  (select distinct student_id from public.team_members where person_id = (select person_id from subj)),
  '603070316-0', false;

-- The whole point: ONE ชั้นปี, computed the same way from the same ingredients,
-- no matter which table the reader started from. `year_offset` is still -2 from
-- check 1, so the honest answer is 10 − 2 = 8.
insert into result select 8, 'every table computes the SAME ชั้นปี',
  (select count(distinct public.get_academic_year() - cohort_year + 1 + coalesce(year_offset,0))::text
     from (select cohort_year, year_offset from public.people  where id = (select person_id from subj)
           union all
           select cohort_year, year_offset from public.students where id = (select student_id from subj)
           union all
           select cohort_year, year_offset from public.team_members where person_id = (select person_id from subj)) t),
  '1', false;

insert into result select 9, 'and it is ปีการศึกษา − ปีที่เข้า + 1 + offset',
  (select (public.get_academic_year() - cohort_year + 1 + coalesce(year_offset,0))::text
     from public.people where id = (select person_id from subj)),
  (public.get_academic_year() - 2560 + 1 - 2)::text, false;

-- ---------------------------------------------------------------------------
-- 3 — THE DENY HALF. An unreadable รหัส must give NO รุ่น, not a plausible one.
--
-- 0118 tightened cohort_from_student_id's window to 2540–2580 because 2500+99
-- was inside the original bound and a malformed id produced a confident "ปี 1".
-- ---------------------------------------------------------------------------
update public.students set student_id = '993070316-0'
 where id = (select student_id from subj);

insert into result select 10, 'an out-of-window รหัส derives NO ปีที่เข้า',
  coalesce((select cohort_year::text from public.students where id = (select student_id from subj)), 'null'),
  'null', false;

insert into result select 11, 'and the posting is blanked too, not left stale',
  coalesce((select distinct cohort_year::text from public.team_members where person_id = (select person_id from subj)), 'null'),
  'null', false;

-- ---------------------------------------------------------------------------
-- 4 — THE CONTROL THAT MUST FIND SOMETHING.
--
-- "A sweep returning NOTHING is not evidence of nothing." Prove the probe can
-- see a disagreement at all by creating one behind the mirrors' backs, then
-- prove the guard is what stops the mirror firing on an already-equal row.
-- ---------------------------------------------------------------------------
-- NOTE the trigger is `people_mirror_down`; the FUNCTION is `person_mirror_down`.
-- Naming the function here 42704s, which is the good failure — a probe that
-- silently skipped this step would score the control as a pass.
alter table public.people disable trigger people_mirror_down;
update public.people set cohort_year = 2599 where id = (select person_id from subj);
alter table public.people enable trigger people_mirror_down;

insert into result select 12, 'CONTROL — the probe CAN see a disagreement',
  (select case when (select cohort_year from public.people where id = (select person_id from subj))
                 is distinct from
               (select max(cohort_year) from public.team_members where person_id = (select person_id from subj))
          then 'differs' else 'same' end),
  'differs', false;

-- …and now the mirror repairs it, which is the allow half of the same check.
update public.people set nickname = coalesce(nickname, '') || 'x'
 where id = (select person_id from subj);

insert into result select 13, 'and the mirror repairs it on the next touch',
  (select distinct cohort_year::text from public.team_members where person_id = (select person_id from subj)),
  '2599', false;

-- ---------------------------------------------------------------------------
-- 5 — `year` is DEAD. Nothing may write it any more; it is dropped once the
-- bundle that stopped reading it is confirmed served.
-- ---------------------------------------------------------------------------
insert into result select 14, 'person_mirror_down no longer names `year`',
  (select case when pg_get_functiondef(p.oid) ~ '\myear\M\s*=\s*new\.year' then 'writes it' else 'clean' end
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'person_mirror_down' and p.prokind = 'f'),
  'clean', false;

insert into result select 15, 'CONTROL — that pattern DOES match a writer',
  (select case when 'set year = new.year' ~ '\myear\M\s*=\s*new\.year' then 'writes it' else 'clean' end),
  'writes it', false;

-- ---------------------------------------------------------------------------
-- 6 — every registry row that can have a ปีที่เข้า now has one.
-- ---------------------------------------------------------------------------
insert into result select 16, 'no member left with a ชั้นปี but no ปีที่เข้า',
  (select count(*)::text from public.team_members m
     where nullif(btrim(coalesce(m.year,'')),'') is not null and m.cohort_year is null
       and m.person_id is distinct from (select person_id from subj)),
  '0', false;

update result set ok = (got is not distinct from want);
-- ONE result set: tools/db-query.mjs prints only the last one, so a summary
-- SELECT after the detail SELECT hides exactly the rows you need.
select n, case when ok then 'PASS' else 'FAIL' end as status, name, got, want
  from result
union all
select 99, case when count(*) = count(*) filter (where ok) then 'ALL PASS' else 'FAILURES' end,
       'SCORE', count(*) filter (where ok) || '/' || count(*), null
  from result
 order by 1;

rollback;
