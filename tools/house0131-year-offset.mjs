#!/usr/bin/env node
// ============================================================
// house0131-year-offset.mjs — ชั้นปี is a DIFFERENCE, end to end.
//
// The JS half of the rule is proven by unit tests (fields.test.js walks the
// arithmetic across two academic years). What those cannot reach is the round
// trip: does a student's own save actually land the offset, does the RPC hand
// it back, and does 0 collapse to null so `self_edited` stays honest.
//
// BOTH DIRECTIONS, as always:
//   ALLOW — the student writes their own offset and reads it back.
//   DENY  — a ชั้นปี is never storable as a number. There is no column to put
//           one in, which is the strongest form of that guarantee, so the deny
//           half checks the SHAPE: `year_override` must stay gone (0129), and
//           `year_offset` must be free of a range CHECK (deliberately unbounded,
//           the owner's call).
//
// Runs inside a transaction it ROLLS BACK.
// ============================================================
import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SQL = `
begin;

create temporary table subj as
select s.id as sid, s.kkumail, s.year_offset as was, u.id as uid
  from public.students s
  join public.users u on lower(btrim(u.email)) = lower(btrim(s.kkumail))
 limit 1;
grant select on subj to authenticated;

create temporary table probe(step text, expected text, got text);
grant insert, select on probe to authenticated;

-- ---- shape (checked as superuser, before impersonating) ----
insert into probe values ('S1. year_offset exists', 'yes',
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='students'
                       and column_name='year_offset') then 'yes' else 'no' end);
insert into probe values ('S2. year_override still gone', 'gone',
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='students'
                       and column_name='year_override') then 'BACK' else 'gone' end);
-- Unbounded on purpose: "not bound to that value, just up to them".
insert into probe values ('S3. no range CHECK on the offset', 'none',
  coalesce((select string_agg(con.conname, ',')
              from pg_constraint con
              join pg_attribute att on att.attrelid = con.conrelid
                                   and att.attnum = any(con.conkey)
             where con.conrelid = 'public.students'::regclass
               and con.contype = 'c' and att.attname = 'year_offset'), 'none'));
-- No SQL twin of the derivation: one implementation, in JS (class 6).
insert into probe values ('S4. no SQL implementation of ชั้นปี', 'none',
  coalesce((select string_agg(p.proname, ',')
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.prokind = 'f'
               and p.proname in ('student_year', 'study_year')), 'none'));

-- ---- ALLOW: the student writes and reads their own ----
select set_config('role','authenticated',true),
       set_config('request.jwt.claims',
         json_build_object('sub',(select uid::text from subj),'role','authenticated')::text, true);
set local role authenticated;

insert into probe
select 'A1. student stores -1', '-1',
       coalesce(public.update_my_student_record('{"year_offset":"-1"}'::jsonb)->>'year_offset','(null)');

insert into probe
select 'A2. and reads it back', '-1',
       coalesce(public.get_my_student_record()->>'year_offset','(null)');

-- Unbounded really is unbounded.
insert into probe
select 'A3. -4 is accepted too', '-4',
       coalesce(public.update_my_student_record('{"year_offset":"-4"}'::jsonb)->>'year_offset','(null)');

-- 0 and null both mean "exactly as computed"; storing 0 would make self_edited
-- claim an edit no reader could see.
insert into probe
select 'A4. 0 collapses to null', 'null',
       coalesce(public.update_my_student_record('{"year_offset":"0"}'::jsonb)->>'year_offset','null');

-- An unrelated save must not silently clear it (the key is simply absent).
insert into probe
select 'A5. absent key leaves it alone', '-2',
       coalesce((select public.update_my_student_record('{"nickname_self":"probe"}'::jsonb)->>'year_offset'
                   from (select public.update_my_student_record('{"year_offset":"-2"}'::jsonb)) x),
                '(null)');

reset role;

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;

rollback;
`;

const file = join(tmpdir(), `house0131-${process.pid}.sql`);
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
console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);
