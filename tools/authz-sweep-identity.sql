-- ============================================================
-- authz-sweep-identity.sql — what ANON and an ORDINARY STUDENT can reach
-- across the three identity subsystems: ทีม SAMO, ระบบบ้าน, accounts.
--
-- BOTH DIRECTIONS. Every DENY is paired with an ALLOW over the same rows,
-- because a table with policies but NO GRANT denies everyone and reads exactly
-- like the policy working (0138). A sweep that only prints "0 rows" is not
-- evidence of anything.
--
-- IT REPORTS *WHICH* DENIAL. A missing GRANT raises 42501; an RLS policy simply
-- returns no rows. Those are different mechanisms with different failure modes
-- — a GRANT-less table denies EVERYONE including the people it should serve —
-- so `probe_read` distinguishes them instead of collapsing both to "0".
--
-- THE PROBE SUBJECT IS PICKED ON BOTH COLUMNS. `current_user_has_permission()`
-- reads the UNION of `permissions` AND `managed_permissions` (0081), so an
-- account chosen by `permissions = '{}'` alone may hold `master` through the
-- ทีม SAMO tree and read exactly like a fail-open policy.
--
-- Wrapped in begin/rollback: tools/db-query.mjs COMMITS.
--   node tools/db-query.mjs tools/authz-sweep-identity.sql
-- ============================================================
begin;

create temporary table probe (step text, expected text, got text) on commit drop;

-- Count rows visible to the CURRENT role, naming the denial mechanism.
create or replace function pg_temp.probe_read(p_sql text) returns text as $$
declare n bigint;
begin
  execute p_sql into n;
  return n::text;
exception
  when insufficient_privilege then return 'denied(no GRANT)';
  when others then return 'error(' || sqlstate || ')';
end $$ language plpgsql;

-- Rows a write touched, same treatment.
create or replace function pg_temp.probe_write(p_sql text) returns text as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = ROW_COUNT;
  return n::text;
exception
  when insufficient_privilege then return 'denied(no GRANT)';
  when others then return 'denied(' || sqlstate || ')';
end $$ language plpgsql;

-- An ordinary signed-in account: no manual grants, no tree-derived grants, and
-- not a staff role.
create temporary table subj on commit drop as
select u.id as uid from public.users u
 where coalesce(array_length(u.permissions, 1), 0) = 0
   and coalesce(array_length(u.managed_permissions, 1), 0) = 0
   and u.role = 'user'
 order by u.id limit 1;

insert into probe select '00. found an ungranted probe subject', '1',
  (select count(*)::text from subj);
insert into probe select '01. the tables are NOT empty (so a 0 below means denied)', 'true',
  ((select count(*) from public.people) > 0
   and (select count(*) from public.team_members) > 0)::text;

grant select on subj to authenticated, anon;
grant insert, select on probe to authenticated, anon;
grant execute on function pg_temp.probe_read(text), pg_temp.probe_write(text) to authenticated, anon;

-- ============================================================
-- ANON — the signed-out visitor
-- ============================================================
select set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
set local role anon;
insert into probe select 'A1. anon cannot read the person registry',  'denied',
  pg_temp.probe_read('select count(*) from public.people');
insert into probe select 'A2. anon cannot read ทีม SAMO postings',    'denied',
  pg_temp.probe_read('select count(*) from public.team_members');
insert into probe select 'A3. anon cannot read ระบบบ้าน students',     'denied',
  pg_temp.probe_read('select count(*) from public.students');
insert into probe select 'A4. anon cannot read อาจารย์',               'denied',
  pg_temp.probe_read('select count(*) from public.advisors');
insert into probe select 'A5. anon cannot read accounts',              'denied',
  pg_temp.probe_read('select count(*) from public.users');
reset role;

-- ============================================================
-- AN ORDINARY STUDENT — signed in, no grants at all
-- ============================================================
select set_config('request.jwt.claims',
  json_build_object('sub',(select uid::text from subj),'role','authenticated')::text, true);
set local role authenticated;

insert into probe select 'S1. student cannot read the whole person registry', 'denied',
  pg_temp.probe_read('select count(*) from public.people');
insert into probe select 'S2. student cannot read every ทีม SAMO posting',    'denied',
  pg_temp.probe_read('select count(*) from public.team_members');
insert into probe select 'S3. student cannot read every ระบบบ้าน row',        'denied',
  pg_temp.probe_read('select count(*) from public.students');
insert into probe select 'S4. student cannot read every account',             'denied',
  pg_temp.probe_read('select count(*) from public.users');

-- ALLOW half — a signed-in student is supposed to reach these.
insert into probe select 'S5. ALLOW student CAN read the houses vocabulary', 'allowed',
  pg_temp.probe_read('select count(*) from public.houses');
insert into probe select 'S6. ALLOW get_my_team_seat() answers for the caller', 'true',
  (public.get_my_team_seat() is not null)::text;

-- WRITES — the escalation paths.
insert into probe select 'S7. student cannot grant themselves a permission', '0',
  pg_temp.probe_write(format(
    'update public.users set permissions = array[''master''] where id = %L',
    (select uid from subj)));
insert into probe select 'S8. student cannot promote their own role', '0',
  pg_temp.probe_write(format(
    'update public.users set role = ''dev'' where id = %L', (select uid from subj)));
insert into probe select 'S9. student cannot rewrite anyone''s posting', '0',
  pg_temp.probe_write('update public.team_members set nickname = ''pwned''');
insert into probe select 'S10. student cannot move themselves to another house', '0',
  pg_temp.probe_write('update public.students set sai_code = ''001''');
insert into probe select 'S11. student cannot edit the person registry directly', '0',
  pg_temp.probe_write('update public.people set first_name_th = ''pwned''');
insert into probe select 'S12. student cannot rename a house', '0',
  pg_temp.probe_write('update public.houses set name = ''pwned''');
insert into probe select 'S13. student cannot add an อาจารย์', '0',
  pg_temp.probe_write('insert into public.advisors (full_name) values (''pwned'')');
reset role;

select step, expected, got,
       case
         when expected = 'denied' then case when got = '0' or got like 'denied%' then 'PASS' else 'FAIL' end
         when expected = 'allowed' then case when got ~ '^[1-9]' then 'PASS' else 'FAIL' end
         when expected = got then 'PASS' else 'FAIL'
       end as verdict
  from probe order by step;

rollback;
