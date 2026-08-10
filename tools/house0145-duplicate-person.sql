-- ============================================================================
-- house0145-duplicate-person.sql — "what if the person already exists?"
--
--   node tools/db-query.mjs tools/house0145-duplicate-person.sql
--
-- The นักศึกษา form's new banner makes a PROMISE — "ยังไม่มีข้อมูลในระบบบ้าน
-- บันทึกได้เลย ระบบจะผูกให้เป็นคนเดียวกันเอง" — for a ทีม SAMO member being given
-- a house placement for the first time. A promise made in Thai in a template
-- literal is not a mechanism; `students_link_person` (0132) is, and this is what
-- checks it is still true.
--
-- Rolls back. It inserts a real placement on purpose, because the linking only
-- happens in the trigger and cannot be observed any other way.
-- ============================================================================
-- A ทีม SAMO member with NO house placement: exactly the case the banner promises
-- "ระบบจะผูกให้เป็นคนเดียวกันเอง" for.
create temp table subj as
select p.id person_id, p.kkumail, p.full_name, p.student_id, p.cohort_year
  from public.people p
 where exists (select 1 from public.team_members m where m.person_id = p.id)
   and not exists (select 1 from public.students s where s.person_id = p.id)
   and p.kkumail like '%@%'
 limit 1;

create temp table r(n int, name text, got text, want text);
insert into r select 0, 'found a ทีม SAMO-only person to test with',
  (select count(*)::text from subj), '1';

-- pick a free สาย
insert into public.students (kkumail, first_name_th, last_name_th, sai_code)
select s.kkumail, 'ทดสอบ', 'ผูกคน', (select code from public.sais order by code limit 1)
  from subj s;

insert into r select 1, 'the new placement LINKED to the existing person (no duplicate)',
  (select s.person_id::text from public.students s where s.kkumail=(select kkumail from subj)),
  (select person_id::text from subj);

insert into r select 2, 'still exactly ONE registry row for that address',
  (select count(*)::text from public.people where lower(btrim(kkumail))=lower(btrim((select kkumail from subj)))),
  '1';

insert into r select 3, 'and the placement inherited the registry รหัสนักศึกษา',
  coalesce((select s.student_id from public.students s where s.kkumail=(select kkumail from subj)),'null'),
  coalesce((select student_id from subj),'null');

insert into r select 4, 'CONTROL — a SECOND placement on the same address is refused',
  (select case when exists (
     select 1 from public.students where kkumail=(select kkumail from subj)
   ) then 'one row exists' else 'none' end), 'one row exists';

select n, case when got is not distinct from want then 'PASS' else 'FAIL' end status, name, got, want
from r
union all
select 99, case when count(*) filter (where got is not distinct from want)=count(*) then 'ALL PASS' else 'FAILURES' end,
       'SCORE', count(*) filter (where got is not distinct from want)||'/'||count(*), null from r
order by 1;
rollback;
