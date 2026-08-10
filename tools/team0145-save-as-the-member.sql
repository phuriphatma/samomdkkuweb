-- ============================================================================
-- team0145-save-as-the-member.sql — the ชั้นปี save, walked as the real account.
--
--   node tools/db-query.mjs tools/team0145-save-as-the-member.sql
--
-- team0145-one-chan-pi.sql proves the TRIGGERS. This proves the PATH: it
-- impersonates the account that filed the report and calls the same RPC the
-- ข้อมูลของฉัน card calls, with `team_members_self_update_guard` armed and
-- auth.uid() set — which is the only way to catch a guard that refuses a write
-- it should allow.
--
-- ALLOW (2-8) and DENY (9) run over the SAME rows as the SAME person in the SAME
-- transaction, so neither half can pass for the wrong reason.
--
-- ⚠️ THE DENY HALF USES A DIFFERENT SUBJECT, AND THAT IS THE POINT. The
-- reporting account holds `master` through the ทีม SAMO tree — `permissions` is
-- literally `{}` while `managed_permissions` is `{master,team}` — so
-- `team_members_self_update_guard` exempts it entirely and a direct write to
-- `cohort_year` SUCCEEDS. The first run of this probe scored that as a fail-open
-- and it is not one; it is the grant engine working. "Check the PROBE SUBJECT"
-- (mistakes class 7): filter on BOTH columns, never on `permissions` alone.
--
-- ⚠️ THE GRANTS ON THE TEMP TABLES ARE LOAD-BEARING. `set local role
-- authenticated` cannot read a temp table the superuser created, and the 42501
-- it dies with looks exactly like the RPC refusing the caller.
--
-- Rolls back.
-- ============================================================================
begin;
create temp table r(n int, name text, got text, want text);

-- The reported account, as itself. Impersonation is the only way to exercise the
-- SAME path the card takes: a definer RPC resolving the person from auth.uid(),
-- with team_members_self_update_guard armed.
-- THE SUBJECT IS RESOLVED, NOT NAMED, and it must hold BOTH placements.
--
-- This was hardcoded to the reporting account. When that person's ระบบบ้าน row
-- was later removed, `students.year_offset` came back NULL and two checks failed
-- reporting `None` vs `-2` — which reads as "the mirror is broken" and is
-- actually "the fixture moved". A named subject is a bet that the data will not
-- change; it always changes.
--
-- The precondition is asserted separately (row 0b) so that if NOBODY holds both
-- placements the proof says THAT, instead of blaming the mirror it exists to
-- test.
create temp table me as
select u.id uid, u.email from public.users u
 where exists (select 1 from public.students s    where lower(s.kkumail) = lower(u.email))
   and exists (select 1 from public.team_members m where lower(m.kkumail) = lower(u.email))
 order by u.id limit 1;

insert into r select 0, 'found an account holding BOTH a ระบบบ้าน row and a ตำแหน่ง',
  (select count(*)::text from me), '1';
insert into r select 0, 'CONTROL — that account really has a students row',
  (select count(*)::text from public.students s
    where lower(s.kkumail) = (select lower(email) from me)), '1';

-- ⚠️ `set local role authenticated` cannot read a temp table the SUPERUSER
-- created. Without these grants the probe dies with 42501 on its own scratch
-- table, which looks exactly like the RPC refusing the caller.
grant select on me, r to authenticated;
grant insert on r to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select uid from me), 'role','authenticated')::text, true);

insert into r select 1, 'auth.uid() is the account, not null',
  coalesce(auth.uid()::text,'null'), (select uid::text from me);

-- THE SAVE THE CARD MAKES. ชั้นปี travels as year_offset; no `year` anywhere.
-- `perform` is PL/pgSQL; at top level it is `select`. (The first draft used
-- perform and 42601'd — the good failure: a probe that silently skipped the
-- write would have scored every later check as a pass.)
create temp table saved as select public.update_my_identity(jsonb_build_object(
  'nickname_self', 'ทดสอบ0145',
  'student_id',    '603070316-0',
  'major',         'MD',
  'year_offset',   '-2'
)) as out;

insert into r select 2, 'the ทีม SAMO postings took the ชั้นปี offset',
  (select distinct year_offset::text from public.team_members
    where lower(kkumail)=(select lower(email) from me)), '-2';

insert into r select 3, 'the house placement took it too',
  (select year_offset::text from public.students
    where lower(kkumail)=(select lower(email) from me)), '-2';

insert into r select 4, 'ปีที่เข้า re-derived from the รหัส on every table',
  (select count(distinct cohort_year)::text from (
     select cohort_year from public.people   where lower(kkumail)=(select lower(email) from me)
     union all select cohort_year from public.students where lower(kkumail)=(select lower(email) from me)
     union all select distinct cohort_year from public.team_members where lower(kkumail)=(select lower(email) from me)
   ) t), '1';

insert into r select 5, 'and it is 2560, from 603070316-0',
  (select cohort_year::text from public.people where lower(kkumail)=(select lower(email) from me)), '2560';

-- The card reads back through get_my_team_seat: what the screen will show.
insert into r select 6, 'the seat payload carries the two ingredients',
  (select (p->>'cohort_year') || '/' || (p->>'year_offset')
     from jsonb_array_elements(public.get_my_team_seat()->'postings') p limit 1),
  '2560/-2';

insert into r select 7, 'and the ปีการศึกษา to compute against',
  (public.get_my_team_seat()->>'academic_year'),
  (select academic_year::text from public.house_settings order by id limit 1);

-- SECOND SAVE, no year_offset key at all: must LEAVE the offset alone (an absent
-- key means "keep", 0126). A save of an unrelated field silently clearing the
-- ลาพัก adjustment is the shape this whole migration exists to remove.
create temp table saved2 as select public.update_my_identity(
  jsonb_build_object('nickname_self','ทดสอบสอง')) as out;
insert into r select 8, 'a save with no ชั้นปี key leaves the offset alone',
  (select year_offset::text from public.students where lower(kkumail)=(select lower(email) from me)), '-2';

-- DENY: the posting is not writable directly for a self-editing member.
-- THE DENY HALF, exercised rather than asserted. `cohort_year` and
-- `year_offset` are registry columns mirrored onto the posting; the self-update
-- guard's allow-list does not name them, so a member PATCHing their own row must
-- be REFUSED. A probe that only ever prints "denied" cannot tell a working guard
-- from a broken connection — checks 2-8 above are the allow half over the same
-- rows, in the same transaction, as the same person.
reset role;
select set_config('request.jwt.claims', '', true);

-- An ORDINARY member: no master, no team_edit, not vp_admin/dev, through EITHER
-- permission column. Picked by shape, so it keeps working as the tree changes.
create temp table plain as
select u.id uid, u.email
  from public.users u
  join public.team_members m on lower(m.kkumail) = lower(btrim(u.email))
 where u.role not in ('vp_admin', 'dev')
   and not (coalesce(u.permissions, '{}') && array['master','team_edit'])
   and not (coalesce(u.managed_permissions, '{}') && array['master','team_edit'])
 limit 1;
grant select on plain to authenticated;

insert into r select 9, 'found an ORDINARY member for the deny half',
  (select count(*)::text from plain), '1';

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', (select uid from plain), 'role','authenticated')::text, true);

do $probe$
begin
  update public.team_members set cohort_year = 2500
   where lower(kkumail) = (select lower(email) from plain);
  insert into r values (10, 'DENY — an ordinary member cannot write cohort_year on their own posting',
    'allowed', 'refused');
exception when others then
  insert into r values (10, 'DENY — an ordinary member cannot write cohort_year on their own posting',
    'refused', 'refused');
end
$probe$;

-- …and the ALLOW half for the SAME person: a field the guard does list must
-- still go through, or the deny above proves nothing but a broken connection.
do $probe$
begin
  update public.team_members set nickname = 'ทดสอบสิทธิ์'
   where lower(kkumail) = (select lower(email) from plain);
  insert into r values (11, 'ALLOW — …but they CAN still edit their own ชื่อเล่น',
    'allowed', 'allowed');
exception when others then
  insert into r values (11, 'ALLOW — …but they CAN still edit their own ชื่อเล่น',
    'refused', 'allowed');
end
$probe$;

reset role;
select set_config('request.jwt.claims', '', true);

select n, case when got is not distinct from want then 'PASS' else 'FAIL' end status, name, got, want from r
union all select 99,
  case when count(*) filter (where got is not distinct from want)=count(*) then 'ALL PASS' else 'FAILURES' end,
  'SCORE', count(*) filter (where got is not distinct from want)||'/'||count(*), null from r
order by 1;
rollback;
