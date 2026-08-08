#!/usr/bin/env node
// ============================================================
// house0128-cohort.mjs — prove that รุ่น follows the รหัสนักศึกษา.
//
// The bug 0128 fixes is invisible to a one-directional probe: before it,
// INSERTing a student with a 65… รหัส produced the right cohort_year, and so
// did every read — the row only went wrong on the SECOND write. So this
// exercises the whole life of a row:
//
//   1. insert with 65…            → 2565   (the case that always worked)
//   2. update the รหัส to 59…     → 2559   (the reported bug; was 2565)
//   3. update it to an unreadable → null   (no รุ่น beats the previous one)
//   4. set cohort_year explicitly → honoured, not overwritten
//   5. update an unrelated column → the explicit value survives
//
// Steps 4 and 5 are the other direction: a probe that only checked "does it
// recompute" would score a trigger that recomputes ALWAYS as correct, and that
// trigger would silently destroy the transfer-student escape hatch.
//
// Runs inside a transaction it ROLLS BACK. It writes to `students`, which
// holds real people — nothing here is allowed to survive the run.
// ============================================================
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SQL = `
begin;

-- A row nobody else has: the kkumail is not a real address and the รหัส is the
-- repo's scrubbed example range (0120).
insert into public.students (kkumail, student_id, first_name_th, sai_code)
values ('house0128-probe@example.invalid', '659999999-9', 'ทดสอบ', null);

create temporary table probe(step text, expected text, got text);

insert into probe
select '1. insert 65…', '2565', coalesce(cohort_year::text, 'null')
  from public.students where kkumail = 'house0128-probe@example.invalid';

update public.students set student_id = '599999999-9'
 where kkumail = 'house0128-probe@example.invalid';
insert into probe
select '2. รหัส → 59…', '2559', coalesce(cohort_year::text, 'null')
  from public.students where kkumail = 'house0128-probe@example.invalid';

update public.students set student_id = '999999999-9'
 where kkumail = 'house0128-probe@example.invalid';
insert into probe
select '3. รหัส unreadable', 'null', coalesce(cohort_year::text, 'null')
  from public.students where kkumail = 'house0128-probe@example.invalid';

-- The escape hatch: an explicit cohort_year in the same statement wins over
-- whatever the รหัส would have said.
update public.students set student_id = '659999999-9', cohort_year = 2544
 where kkumail = 'house0128-probe@example.invalid';
insert into probe
select '4. explicit wins', '2544', coalesce(cohort_year::text, 'null')
  from public.students where kkumail = 'house0128-probe@example.invalid';

-- …and survives a write that does not touch the รหัส.
update public.students set nickname_imported = 'x'
 where kkumail = 'house0128-probe@example.invalid';
insert into probe
select '5. survives edit', '2544', coalesce(cohort_year::text, 'null')
  from public.students where kkumail = 'house0128-probe@example.invalid';

-- Schema half of the same migration.
insert into probe values (
  '6. advisors.title dropped', 'gone',
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='advisors'
                       and column_name='title') then 'still there' else 'gone' end);
insert into probe values (
  '7. applied_value exists', 'yes',
  case when exists (select 1 from information_schema.columns
                     where table_schema='public' and table_name='student_change_requests'
                       and column_name='applied_value') then 'yes' else 'no' end);
-- The backfill's own result. The probe row is EXCLUDED — step 4 deliberately
-- left it drifted, and counting it would score the escape hatch as the bug.
insert into probe values (
  '8. no live drift', '0',
  (select count(*)::text from public.students
    where kkumail <> 'house0128-probe@example.invalid'
      and student_id is not null
      and public.cohort_from_student_id(student_id) is not null
      and cohort_year is distinct from public.cohort_from_student_id(student_id)));

select step, expected, got, case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;

rollback;
`;

const file = join(tmpdir(), `house0128-${process.pid}.sql`);
writeFileSync(file, SQL);
let out;
try {
  out = execFileSync('node', [new URL('./db-query.mjs', import.meta.url).pathname, file],
    { encoding: 'utf8' });
} finally {
  unlinkSync(file);
}

// db-query prints the LAST statement's rows as JSON.
const rows = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
let failed = 0;
for (const r of rows) {
  if (r.verdict !== 'PASS') failed += 1;
  console.log(`${r.verdict === 'PASS' ? '✓' : '✗'} ${r.step}: expected ${r.expected}, got ${r.got}`);
}
console.log(failed ? `\n${failed} FAILED` : '\nall pass');
process.exit(failed ? 1 : 0);

// Silences the unused-import lint if this file is ever read by the bundler.
void readFileSync;
