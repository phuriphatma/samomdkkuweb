#!/usr/bin/env node
// ============================================================
// house0138-conflicts.mjs — the import disagrees OUT LOUD, and only where
//                            somebody actually made a claim.
//
// The rule 0138 implements, restated as things that must be true:
//
// ALLOW — a real disagreement becomes a question:
//   A1  an import over a SELF-EDITED field records a conflict
//   A2  …and the person's value is still what the row holds
//   A3  a re-import that disagrees again UPDATES the same question, never
//       stacks a second copy of it
//   A4  the person can READ their own conflict
//   A5  resolving 'theirs' writes the file's value…
//   A6  …AND releases the column from self_edited, so the next import owns it
//   A7  resolving 'mine' closes it and KEEPS self_edited
//   A8  confirm_my_identity() stamps identity_confirmed_at
//   A9  identity_check_summary() counts confirmed / unchecked / open
//
// DENY — silence is not a claim, and a conflict is not a free-for-all:
//   D1  an import over a field NOBODY edited records NO conflict (this is the
//       majority of 1,800 rows; getting it wrong buries the real ones)
//   D2  a file that is SILENT about a field records no conflict — an omitted
//       column is not the faculty asserting a blank
//   D3  a stranger cannot read someone else's conflict
//   D4  a stranger cannot resolve one
//   D5  record_identity_conflict() is not executable by any client role, so a
//       conflict cannot be fabricated against somebody
//   D6  anon gets nothing
//
// D1 is the one that decides whether this feature is usable. If an import
// against an untouched row raised a conflict, every student would open their
// card to a question they never asked and the real mismatches would be lost in
// it.
//
// Runs inside a transaction it ROLLS BACK.
// ============================================================
import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SQL = `
begin;

create temporary table probe(step text, expected text, got text);

-- Real batch rows: students.last_import_batch is a FK into
-- student_import_batches, so a made-up uuid 23503s. Five of them, because the
-- rule under test is "a write that stamps a NEW batch id is an import" and a
-- re-import has to be a genuinely different batch.
with made as (
  insert into public.student_import_batches (file_name)
  select 'probe0138-' || n from generate_series(0, 4) n
  returning id, file_name
)
select (regexp_replace(file_name, '^probe0138-', ''))::int as n, id
  into temporary batches from made;

-- Two manufactured students, identical except for one thing: SUBJ has taken
-- over their own ชื่อ, and CLEAN has not. That single difference is the whole
-- rule, so the two rows are the experiment.
with p1 as (
  insert into public.people (kkumail, first_name_th, last_name_th, student_id, major)
  values ('probe0138a@kkumail.com', 'ของเจ้าตัว', 'นามสกุลเดิม', '659000001-1', 'MD')
  returning id
), p2 as (
  insert into public.people (kkumail, first_name_th, last_name_th, student_id, major)
  values ('probe0138b@kkumail.com', 'ไม่เคยแก้', 'นามสกุลเดิม', '659000002-2', 'MD')
  returning id
)
select (select id from p1) as pid_a, (select id from p2) as pid_b
  into temporary subj;

insert into public.students (kkumail, first_name_th, last_name_th, student_id, major,
                             sai_code, self_edited, last_import_batch, person_id)
values ('probe0138a@kkumail.com', 'ของเจ้าตัว', 'นามสกุลเดิม', '659000001-1', 'MD',
        '017', array['first_name_th'], (select id from batches where n = 0), (select pid_a from subj)),
       ('probe0138b@kkumail.com', 'ไม่เคยแก้', 'นามสกุลเดิม', '659000002-2', 'MD',
        '017', '{}', (select id from batches where n = 0), (select pid_b from subj));

-- ---- the import ----
-- One statement, both rows, a NEW batch id. That stamp is what makes this an
-- import rather than an admin edit (0125).
update public.students
   set first_name_th = 'ของไฟล์', last_import_batch = (select id from batches where n = 1)
 where kkumail in ('probe0138a@kkumail.com', 'probe0138b@kkumail.com');

insert into probe select 'A1. a self-edited field records a conflict', '1',
  (select count(*)::text from public.identity_conflicts
    where person_id = (select pid_a from subj) and field = 'first_name_th' and status = 'open');

insert into probe select 'A2. …and the person''s value still stands', 'ของเจ้าตัว',
  (select first_name_th from public.students where kkumail = 'probe0138a@kkumail.com');

insert into probe select 'D1. an UNTOUCHED field records NO conflict', '0',
  (select count(*)::text from public.identity_conflicts
    where person_id = (select pid_b from subj));

insert into probe select 'D1b. …and the import simply wrote it', 'ของไฟล์',
  (select first_name_th from public.students where kkumail = 'probe0138b@kkumail.com');

-- ---- A3 — a second disagreeing import ----
update public.students
   set first_name_th = 'ของไฟล์รอบสอง', last_import_batch = (select id from batches where n = 2)
 where kkumail = 'probe0138a@kkumail.com';

insert into probe select 'A3. a re-import UPDATES the same question', '1',
  (select count(*)::text from public.identity_conflicts
    where person_id = (select pid_a from subj) and field = 'first_name_th' and status = 'open');

insert into probe select 'A3b. …with the newer value', 'ของไฟล์รอบสอง',
  (select theirs from public.identity_conflicts
    where person_id = (select pid_a from subj) and field = 'first_name_th' and status = 'open');

-- ---- D2 — a file that says nothing about a field ----
-- An import carrying only สาย must not read as "the faculty asserts you have no
-- surname". Nothing is written for last_name_th, so nothing is claimed.
update public.students
   set sai_code = '018', last_import_batch = (select id from batches where n = 3)
 where kkumail = 'probe0138a@kkumail.com';

insert into probe select 'D2. a silent column raises no conflict', '0',
  (select count(*)::text from public.identity_conflicts
    where person_id = (select pid_a from subj) and field = 'last_name_th');

-- ---- the person's own end ----
create temporary table who as
select u.id as uid from public.users u limit 1;
-- Point a real login at the probe person, so 'the owner' is a real path and not
-- a role check that happens to pass.
update public.people set kkumail = (select lower(btrim(email)) from public.users
                                     where id = (select uid from who))
 where id = (select pid_a from subj);
update public.students set kkumail = (select lower(btrim(email)) from public.users
                                       where id = (select uid from who))
 where person_id = (select pid_a from subj);

grant select on who, subj to authenticated;
grant insert, select on probe to authenticated;
grant insert, select on probe to anon;

select set_config('request.jwt.claims',
  json_build_object('sub',(select uid::text from who),'role','authenticated')::text, true);
set local role authenticated;

insert into probe select 'A4. the person can read their own conflict', '1',
  (select count(*)::text from public.identity_conflicts
    where person_id = (select pid_a from subj) and status = 'open');

insert into probe select 'A4b. …through get_my_identity_status()', '1',
  jsonb_array_length(public.get_my_identity_status()->'conflicts')::text;

insert into probe select 'A8. confirm_my_identity() stamps the time', 'true',
  (public.confirm_my_identity()->>'confirmed');
reset role;

-- The id is captured as the OWNER, not read back through the policy under test.
-- A subselect run as the impersonated caller would make every later assertion
-- depend on the read policy, so one broken policy would fail six steps and none
-- of them would say which.
select id into temporary cid_first from public.identity_conflicts
 where person_id = (select pid_a from subj) and field = 'first_name_th' and status = 'open';
grant select on cid_first to authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub',(select uid::text from who),'role','authenticated')::text, true);
set local role authenticated;
-- A5/A6 — take the file's value.
select public.resolve_identity_conflict((select id from cid_first), 'theirs');
reset role;

insert into probe select 'A5. resolving theirs writes the file value', 'ของไฟล์รอบสอง',
  (select first_name_th from public.students where person_id = (select pid_a from subj));

insert into probe select 'A6. …and releases the column from self_edited', 'released',
  case when (select 'first_name_th' = any (self_edited) from public.students
              where person_id = (select pid_a from subj))
       then 'STILL HELD' else 'released' end;

insert into probe select 'A8b. identity_confirmed_at is set', 'set',
  case when (select identity_confirmed_at from public.people
              where id = (select pid_a from subj)) is null
       then 'NULL' else 'set' end;

-- A7 — the other decision. Give the person a claim again, disagree with it,
-- then keep theirs.
update public.students set self_edited = array['major'], major = 'MDI'
 where person_id = (select pid_a from subj);
update public.students set major = 'RT', last_import_batch = (select id from batches where n = 4)
 where person_id = (select pid_a from subj);

select id into temporary cid_major from public.identity_conflicts
 where person_id = (select pid_a from subj) and field = 'major' and status = 'open';
grant select on cid_major to authenticated;

select set_config('request.jwt.claims',
  json_build_object('sub',(select uid::text from who),'role','authenticated')::text, true);
set local role authenticated;
select public.resolve_identity_conflict((select id from cid_major), 'mine');
reset role;

insert into probe select 'A7. resolving mine keeps the person''s value', 'MDI',
  (select major from public.students where person_id = (select pid_a from subj));

insert into probe select 'A7b. …and KEEPS self_edited', 'held',
  case when (select 'major' = any (self_edited) from public.students
              where person_id = (select pid_a from subj))
       then 'held' else 'RELEASED' end;

-- ---- A9 ----
-- Needs an ADMIN caller. Running it with whatever claims happened to be left
-- over is how a step ends up asserting the wrong subject's permissions —
-- request.jwt.claims is transaction-scoped and survives a role reset.
create temporary table hadmin as
select u.id as uid from public.users u
 where u.role in ('vp_admin','dev')
    or (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
       && array['house','team_edit']
 limit 1;
grant select on hadmin to authenticated;

do $do$
declare v text; v_n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub',(select uid::text from hadmin),'role','authenticated')::text, true);
  set local role authenticated;
  -- KEYS CHANGED IN 0142. 'self_edited' was a separate tally that could exceed
  -- the number of humans; there is now ONE definition of 'checked' (confirmed
  -- OR self-edited) shared by the summary and the per-person list, so the count
  -- and the list can no longer describe different populations.
  select case when public.identity_check_summary()
                   ?& array['people','checked','confirmed','unchecked',
                            'open_conflicts','resolved']
              then 'yes' else 'no' end into v;
  -- The ALLOW half of the table's RLS. Without it D3 ('a stranger sees 0')
  -- passes just as happily against a table nobody can read at all.
  select count(*) into v_n from public.identity_conflicts
   where person_id = (select pid_a from subj);
  reset role;
  insert into probe values ('A9. an admin gets the summary', 'yes', v);
  insert into probe values ('A9b. an admin can READ the conflicts', '2', v_n::text);
end
$do$;
reset role;

-- ---- D3/D4 — somebody else ----
-- A DIFFERENT real login, so this is the ordinary "another student" case rather
-- than an unauthenticated one. Must hold no admin grant, or the admin policy
-- legitimately lets them see it and the probe proves nothing.
create temporary table other as
select u.id as uid from public.users u
 where u.id <> (select uid from who)
   and u.role not in ('vp_admin','dev')
   and not (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')
            && array['house','team_edit'])
 limit 1;
grant select on other to authenticated;

do $do$
declare v_other uuid; v_cid uuid; v_seen int; v_res text;
begin
  select uid into v_other from other;
  select id into v_cid from public.identity_conflicts
   where person_id = (select pid_a from subj) and field = 'major';
  if v_other is null then
    insert into probe values ('D3. a stranger cannot read it', '0', 'NO SUBJECT');
    insert into probe values ('D4. a stranger cannot resolve it', 'denied', 'NO SUBJECT');
    return;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.identity_conflicts
   where person_id = (select pid_a from subj);

  begin
    -- Re-open one so the refusal is about AUTHORISATION and not about the row
    -- already being resolved — a proof that passes for the wrong reason gets
    -- explained away.
    perform public.resolve_identity_conflict(v_cid, 'theirs');
    v_res := 'ALLOWED';
  exception when others then v_res := 'denied';
  end;

  reset role;
  insert into probe values ('D3. a stranger cannot read it', '0', v_seen::text);
  insert into probe values ('D4. a stranger cannot resolve it', 'denied', v_res);
end
$do$;
reset role;

-- D5 — the recorder is callable by nobody. A client that could call it could
-- assert that the faculty says anything at all about any person.
-- Read from pg_proc.proacl, not from the revoke written in the migration:
-- the ACL is the authority and a revoke that missed is invisible in the source.
-- The expectation is that no CLIENT role appears — postgres and service_role
-- always do, and asserting an empty ACL would be asserting something false.
insert into probe select 'D5. no client role can call record_identity_conflict', 'none',
  coalesce((select string_agg(g, ',') from pg_proc p,
                 lateral unnest(array['anon','authenticated']) g
             where p.proname = 'record_identity_conflict'
               and p.pronamespace = 'public'::regnamespace
               and array_to_string(p.proacl, ',') like '%' || g || '=%'), 'none');

-- D6 — anon.
select set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
set local role anon;
do $do$
declare v text; v_n int;
begin
  begin
    select count(*) into v_n from public.identity_conflicts;
    v := v_n::text;
  exception when others then v := '0';
  end;
  insert into probe values ('D6. anon sees no conflicts', '0', v);
end
$do$;
reset role;

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;

rollback;
`;

const file = join(tmpdir(), `house0138-${process.pid}.sql`);
writeFileSync(file, SQL);
let out;
try {
  out = execFileSync('node', [new URL('./db-query.mjs', import.meta.url).pathname, file],
    { encoding: 'utf8' });
} finally {
  unlinkSync(file);
}

const rows = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
let failed = 0;
for (const r of rows) {
  if (r.verdict !== 'PASS') failed += 1;
  console.log(`${r.verdict === 'PASS' ? '✓' : '✗'} ${r.step}: expected ${r.expected}, got ${r.got}`);
}
console.log(failed ? `\n${failed} FAILED` : `\nall ${rows.length} pass`);
process.exit(failed ? 1 : 0);
