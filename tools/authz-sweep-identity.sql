-- ============================================================
-- authz-sweep-identity.sql — what ANON and an ORDINARY STUDENT can reach
-- across the three identity subsystems: ทีม SAMO, ระบบบ้าน, accounts.
--
-- This is the proof for migration 0147 (`public.users` SELECT is self-only) and
-- the standing regression guard for the identity boundary generally. It was
-- written while the hole was open and deliberately withheld from this PUBLIC
-- repo until the hole was closed; it lands here now that it does.
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
   and (select count(*) from public.team_members) > 0
   and (select count(*) from public.users) > 1)::text;

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

-- ---- 0147: the account directory ----
-- The DENY half. Before 0147 this returned 531; the number that matters is the
-- one for OTHER people, because "1" is the caller's own row and MUST stay
-- readable (S6) or every login breaks.
insert into probe select 'S4. student cannot read ANY other account',          '0',
  pg_temp.probe_read(format(
    'select count(*) from public.users where id <> %L', (select uid from subj)));
insert into probe select 'S5. student cannot read another account''s EMAIL',   '0',
  pg_temp.probe_read(format(
    'select count(*) from public.users where id <> %L and email is not null',
    (select uid from subj)));
-- The reconnaissance half: role + permissions live in the same row, so a full
-- read also names which accounts hold master/dev/vp_admin.
insert into probe select 'S6. student cannot see who holds a permission',      '0',
  pg_temp.probe_read(format(
    'select count(*) from public.users where id <> %L '
    'and (coalesce(array_length(permissions,1),0) > 0 '
    '  or coalesce(array_length(managed_permissions,1),0) > 0)',
    (select uid from subj)));

-- ALLOW half — a signed-in student is supposed to reach these. If S7 ever goes
-- to 0, 0147 was over-tightened and NOBODY can load their own profile.
insert into probe select 'S7. ALLOW student CAN still read their OWN account row', '1',
  pg_temp.probe_read(format(
    'select count(*) from public.users where id = %L', (select uid from subj)));
-- NOT `public.houses` — that table's only policy is `houses_admin_all`, so an
-- ordinary student cannot read it directly BY DESIGN and asserting otherwise
-- made this proof fail for a correct reason (mistakes.md: a proof that fails
-- correctly gets ignored, and then it protects nothing). A student reaches
-- ระบบบ้าน through definer RPCs; `get_academic_year()` is the one every signed-in
-- account needs, because ชั้นปี is DERIVED from it (0145) and nothing renders
-- without it.
insert into probe select 'S8. ALLOW get_academic_year() answers for any signed-in account', 'true',
  (public.get_academic_year() is not null)::text;
insert into probe select 'S9. ALLOW get_my_team_seat() answers for the caller', 'true',
  (public.get_my_team_seat() is not null)::text;

-- WRITES — the escalation paths. Expected `blocked`, which accepts BOTH shapes
-- of refusal: RLS silently updates 0 rows, while `users_self_update_guard`
-- RAISEs P0001. Both mean the write did not land. Scoring only one of them is
-- the mistakes.md class in both directions — a proof that asks "did it throw?"
-- marks a fully-blocked RLS write as permitted, and a proof that asks "was it 0
-- rows?" marks a raising guard as broken.
insert into probe select 'S10. student cannot grant themselves a permission', 'blocked',
  pg_temp.probe_write(format(
    'update public.users set permissions = array[''master''] where id = %L',
    (select uid from subj)));
insert into probe select 'S11. student cannot promote their own role', 'blocked',
  pg_temp.probe_write(format(
    'update public.users set role = ''dev'' where id = %L', (select uid from subj)));
insert into probe select 'S12. student cannot rewrite anyone''s posting', 'blocked',
  pg_temp.probe_write('update public.team_members set nickname = ''pwned''');
insert into probe select 'S13. student cannot move themselves to another house', 'blocked',
  pg_temp.probe_write('update public.students set sai_code = ''001''');
insert into probe select 'S14. student cannot edit the person registry directly', 'blocked',
  pg_temp.probe_write('update public.people set first_name_th = ''pwned''');
insert into probe select 'S15. student cannot rename a house', 'blocked',
  pg_temp.probe_write('update public.houses set name = ''pwned''');
-- `advisors.full_name` is GENERATED ALWAYS (0135's name split), so inserting it
-- raises 428C9 — a DDL complaint that fires BEFORE any policy runs and MASKS
-- whatever RLS would have said. Write the real source column instead, so the
-- refusal we observe is the authorization one.
insert into probe select 'S16. student cannot add an อาจารย์', 'blocked',
  pg_temp.probe_write('insert into public.advisors (first_name_th) values (''pwned'')');
reset role;

select step, expected, got,
       case
         -- a READ is denied by 0 rows (RLS) or by 42501 (no GRANT) — both count,
         -- and probe_read has already told us WHICH.
         when expected = 'denied'  then case when got = '0' or got like 'denied%' then 'PASS' else 'FAIL' end
         -- a WRITE is blocked by 0 rows (RLS) or by a RAISE from a guard trigger.
         when expected = 'blocked' then case when got = '0' or got like 'denied%' then 'PASS' else 'FAIL' end
         when expected = 'allowed' then case when got ~ '^[1-9]' then 'PASS' else 'FAIL' end
         when expected = got then 'PASS' else 'FAIL'
       end as verdict
  from probe order by step;

rollback;
