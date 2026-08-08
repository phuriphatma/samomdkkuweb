#!/usr/bin/env node
// ============================================================
// house0128-requests.mjs — the คำขอแก้ไข answer path, both directions.
//
// 0128 opened a NEW READ PATH: `get_my_student_record()` now returns the
// caller's own change requests, including the admin's decision note. Before it,
// `student_change_requests` was admin-only under RLS and nothing published it
// back — the admin typed a reason into a column no student could read.
//
// A new read path over a table holding ~1,800 people's requests is exactly the
// shape this repo has been bitten by (0086 / 0103 / 0108), so it gets a proof,
// and the proof exercises BOTH directions:
//
//   ALLOW  — a student sees their OWN request, with status, applied_value and
//            the admin's note.
//   DENY   — an account with no `house` grant reads ZERO rows from students,
//            student_change_requests and advisors directly.
//
// The deny half alone would be worthless: a probe that can only print 0 cannot
// tell a working policy from a broken connection. That is the entry in
// docs/mistakes/tooling-proofs.md this file exists to obey.
//
// Runs inside a transaction it ROLLS BACK.
// ============================================================
import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SQL = `
begin;

-- The ALLOW subject: a student who has an auth account.
create temporary table subj as
select s.id as sid, s.kkumail, u.id as uid
  from public.students s
  join public.users u on lower(btrim(u.email)) = lower(btrim(s.kkumail))
 limit 1;
grant select on subj to authenticated;

-- The DENY subject: role 'user', and empty on BOTH grant channels —
-- current_user_has_permission() reads the UNION of permissions and
-- managed_permissions (0081), so checking only the first picks an account that
-- is in fact a full admin through the ทีม SAMO tree.
create temporary table outsider as
select u.id as uid, u.email from public.users u
 where u.role = 'user'
   and coalesce(array_length(u.permissions, 1), 0) = 0
   and coalesce(array_length(u.managed_permissions, 1), 0) = 0
 limit 1;
grant select on outsider to authenticated;

-- An admin approves a request with a CORRECTED value and a note.
insert into public.student_change_requests
  (student_ref, field, current_value, requested_value, reason)
select sid, 'sai_code', '017', '027', 'probe' from subj;
update public.student_change_requests
   set status = 'approved', applied_value = '037',
       decision_note = 'probe-note', decided_at = now()
 where student_ref = (select sid from subj) and status = 'pending';

create temporary table probe(step text, expected text, got text);
-- The probe table is written while impersonating, so it needs the grant too.
-- Without it the run dies on a permission error that has nothing to do with
-- what is being measured.
grant insert, select on probe to authenticated;

-- ---- ALLOW ----
select set_config('role','authenticated',true),
       set_config('request.jwt.claims',
         json_build_object('sub',(select uid::text from subj),'role','authenticated')::text, true);
set local role authenticated;

insert into probe
select 'A1. own request is returned', 'approved',
       coalesce(r->>'status','(none)')
  from (select public.get_my_student_record()->'my_requests'->0 as r) x;
insert into probe
select 'A2. the corrected value travels', '037', coalesce(r->>'applied_value','(none)')
  from (select public.get_my_student_record()->'my_requests'->0 as r) x;
insert into probe
select 'A3. the admin note travels', 'probe-note', coalesce(r->>'decision_note','(none)')
  from (select public.get_my_student_record()->'my_requests'->0 as r) x;
insert into probe
select 'A4. อาจารย์ carry an address', 'yes',
       case when public.get_my_student_record()->'house_advisors'->0 ? 'email'
              or jsonb_array_length(public.get_my_student_record()->'house_advisors') = 0
            then 'yes' else 'no' end;
insert into probe
select 'A5. no คำนำหน้า field survives', 'gone',
       case when public.get_my_student_record()->'advisors'->0 ? 'title'
            then 'still there' else 'gone' end;

reset role;

-- ---- DENY ----
select set_config('role','authenticated',true),
       set_config('request.jwt.claims',
         json_build_object('sub',(select uid::text from outsider),'role','authenticated')::text, true);
set local role authenticated;

insert into probe values ('D0. probe subject is unprivileged', 'false',
  public.current_user_has_permission('house')::text);
insert into probe select 'D1. students unreadable', '0',
  (select count(*)::text from public.students);
insert into probe select 'D2. requests unreadable', '0',
  (select count(*)::text from public.student_change_requests);
insert into probe select 'D3. advisors unreadable', '0',
  (select count(*)::text from public.advisors);

reset role;

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;

rollback;
`;

const file = join(tmpdir(), `house0128-req-${process.pid}.sql`);
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
