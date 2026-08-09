#!/usr/bin/env node
// ============================================================
// house0139-insert-path.mjs — the INSERT is a write path too.
//
// 0138 taught the import not to overwrite a human's answer ON UPDATE. The path
// that matters for every ทีม SAMO member is the INSERT that CREATES their house
// placement when the faculty file lands, and it was unguarded — measured:
//
//   people   : ชื่อที่เจ้าตัวกรอก      students : ชื่อจากไฟล์      conflicts: 0
//
// ALLOW:
//   A1  an IMPORT insert keeps the registry's name…
//   A2  …in the placement row as well (they agree)
//   A3  …and records the disagreement as a question
//   A4  the file still owns สายรหัส — the registrar fact
//   A5  a field the registry does NOT have is taken from the file
//   A6  a HUMAN-created placement wins and travels UP to the registry
//   A7  a HUMAN-created ทีม SAMO posting travels up too
//
// DENY:
//   D1  a placement-less, login-less, never-confirmed person is pruned when its
//       last placement goes ("ฝ่ายเอิง(test) … still shows suggestion")
//   D2  a person WITH a login is never pruned
//   D3  a person still holding another placement is never pruned
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

with b as (insert into public.student_import_batches (file_name) values ('probe0139') returning id)
select id into temporary bat from b;

-- A ทีม SAMO person who typed their own name and is NOT yet in ระบบบ้าน.
with p as (
  insert into public.people (kkumail, first_name_th, last_name_th, student_id, major)
  values ('probe0139a@kkumail.com', 'ของเจ้าตัว', 'นามสกุลจริง', '659000009-9', 'MD')
  returning id
) select id as pid into temporary subj from p;

insert into public.students (kkumail, first_name_th, last_name_th, student_id, major,
                             sai_code, last_import_batch)
values ('probe0139a@kkumail.com', 'ของไฟล์', 'นามสกุลจากไฟล์', '659000009-9', 'MD',
        '017', (select id from bat));

insert into probe select 'A1. import insert keeps the registry name', 'ของเจ้าตัว',
  coalesce((select first_name_th from public.people where id = (select pid from subj)), '(none)');
insert into probe select 'A2. …and the placement agrees', 'ของเจ้าตัว',
  coalesce((select first_name_th from public.students where kkumail = 'probe0139a@kkumail.com'), '(none)');
insert into probe select 'A3. …and the disagreement is recorded', '2',
  (select count(*)::text from public.identity_conflicts
    where person_id = (select pid from subj) and status = 'open');
insert into probe select 'A4. the file still owns สายรหัส', '017',
  coalesce((select sai_code from public.students where kkumail = 'probe0139a@kkumail.com'), '(none)');

-- A5 — a field the registry has no answer for is taken from the file.
with p as (
  insert into public.people (kkumail, first_name_th) values ('probe0139b@kkumail.com', 'มีแค่ชื่อ')
  returning id
) select id as pid into temporary subj2 from p;
insert into public.students (kkumail, first_name_th, last_name_th, sai_code, last_import_batch)
values ('probe0139b@kkumail.com', 'มีแค่ชื่อ', 'นามสกุลจากไฟล์', '018', (select id from bat));
insert into probe select 'A5. a field the registry lacks comes from the file', 'นามสกุลจากไฟล์',
  coalesce((select last_name_th from public.students where kkumail = 'probe0139b@kkumail.com'), '(none)');

-- A6 — a HUMAN-created placement (no batch id) wins and mirrors UP.
with p as (
  insert into public.people (kkumail, first_name_th, last_name_th)
  values ('probe0139c@kkumail.com', 'เก่า', 'เก่า') returning id
) select id as pid into temporary subj3 from p;
insert into public.students (kkumail, first_name_th, last_name_th, sai_code)
values ('probe0139c@kkumail.com', 'ใหม่โดยแอดมิน', 'ใหม่', '019');
insert into probe select 'A6. a human-created placement travels UP', 'ใหม่โดยแอดมิน',
  coalesce((select first_name_th from public.people where id = (select pid from subj3)), '(none)');

-- A7 — the ทีม SAMO twin.
select id into temporary anynode from public.team_nodes limit 1;
insert into public.team_members (node_id, full_name, first_name_th, last_name_th, kkumail)
values ((select id from anynode), 'ตั้งใหม่ ทีม', 'ตั้งใหม่', 'ทีม', 'probe0139d@kkumail.com');
insert into probe select 'A7. a new ทีม SAMO posting travels UP', 'ตั้งใหม่',
  coalesce((select p.first_name_th from public.people p
             where lower(btrim(p.kkumail)) = 'probe0139d@kkumail.com'), '(none)');

-- ---- D1/D2/D3 — the refcount ----
delete from public.team_members where lower(btrim(kkumail)) = 'probe0139d@kkumail.com';
insert into probe select 'D1. deleting the last placement prunes the person', '0',
  (select count(*)::text from public.people
    where lower(btrim(kkumail)) = 'probe0139d@kkumail.com');

-- D2 — a person with a LOGIN survives.
select uid into temporary loginperson from (
  select u.id as uid from public.users u where u.email is not null limit 1) q;
with p as (
  insert into public.people (kkumail, first_name_th, user_id)
  values ('probe0139e@kkumail.com', 'มีบัญชี', (select uid from loginperson)) returning id
) select id as pid into temporary subj5 from p;
insert into public.team_members (node_id, full_name, kkumail, person_id)
values ((select id from anynode), 'มีบัญชี', 'probe0139e@kkumail.com', (select pid from subj5));
delete from public.team_members where lower(btrim(kkumail)) = 'probe0139e@kkumail.com';
insert into probe select 'D2. a person with a login is NOT pruned', '1',
  (select count(*)::text from public.people where id = (select pid from subj5));

-- D3 — still holding another placement.
insert into probe select 'D3. a person with another placement is NOT pruned', '1',
  (select count(*)::text from public.people where id = (select pid from subj));

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;
rollback;
`;

const file = join(tmpdir(), `house0139-${process.pid}.sql`);
writeFileSync(file, SQL);
let out;
try {
  out = execFileSync('node', [new URL('./db-query.mjs', import.meta.url).pathname, file],
    { encoding: 'utf8' });
} finally { unlinkSync(file); }

const rows = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
let failed = 0;
for (const r of rows) {
  if (r.verdict !== 'PASS') failed += 1;
  console.log(`${r.verdict === 'PASS' ? '✓' : '✗'} ${r.step}: expected ${r.expected}, got ${r.got}`);
}
console.log(failed ? `\n${failed} FAILED` : `\nall ${rows.length} pass`);
process.exit(failed ? 1 : 0);
