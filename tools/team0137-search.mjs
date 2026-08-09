#!/usr/bin/env node
// ============================================================
// team0137-search.mjs — the picker finds people, and cannot become a dump.
//
// search_people() is a deliberate widening: before it, a `team` admin could
// only confirm one exact kkumail (0130). It is an ILIKE over ~1,800 humans, and
// 0101 is the entry where an ILIKE turned an id into a PATTERN and {"p_id":"%"}
// walked the whole table. So the bounds are the interesting half of this proof.
//
// ALLOW — it actually finds people:
//   A1  by ชื่อ
//   A2  by นามสกุล
//   A3  by ชื่อเล่น
//   A4  by รหัสนักศึกษา typed WITHOUT its dash
//   A5  by kkumail
//   A6  an exact kkumail ranks first
//   A7  hits say whether the person already holds a ทีม SAMO posting
//
// DENY — it cannot be widened, and it publishes only identity:
//   D1  a bare '%' matches NOTHING (the wildcard is escaped, not honoured)
//   D2  '_' likewise
//   D3  a 1-character query returns [] rather than most of the faculty
//   D4  p_limit is clamped — asking for 5000 does not return 5000
//   D5  no placement facts in the projection: no sai_code, no house
//   D6  anon cannot execute it at all
//
// D1/D2 are the whole reason this file exists. Everything in ALLOW would pass
// just as happily against an unescaped implementation.
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

with fresh as (
  insert into public.people
    (kkumail, first_name_th, last_name_th, nickname, student_id, major)
  values ('probe0137@kkumail.com', 'ปิติทดสอบ', 'รักเรียนทดสอบ', 'ต้นทดสอบ',
          '659999999-9', 'MD')
  returning id
)
select id as pid into temporary subj from fresh;

-- Impersonate an admin who holds ONLY 'team' — the narrowest caller the gate
-- admits, so a pass here is a pass for everyone above them. Picked on the UNION
-- of permissions and managed_permissions (0081): an account chosen on
-- 'permissions' alone may hold its grant through the ทีม SAMO tree.
create temporary table caller as
select u.id as uid from public.users u
 where 'team' = any (coalesce(u.permissions, '{}') || coalesce(u.managed_permissions, '{}'))
    or u.role in ('vp_admin','dev')
 limit 1;
grant select on caller, subj to authenticated;
grant insert, select on probe to authenticated;
-- anon too: D6 records its own verdict, and it cannot do that without INSERT.
grant insert, select on probe to anon;

insert into probe values ('A0. found a caller with a grant', '1',
  (select count(*)::text from caller));

select set_config('request.jwt.claims',
  json_build_object('sub',(select uid::text from caller),'role','authenticated')::text, true);
set local role authenticated;

-- ---- ALLOW ----
insert into probe select 'A1. by ชื่อ', 'found',
  case when public.search_people('ปิติทดสอบ') @> ('[{"kkumail":"probe0137@kkumail.com"}]')::jsonb
       then 'found' else 'MISSED' end;

insert into probe select 'A2. by นามสกุล', 'found',
  case when public.search_people('รักเรียนทดสอบ') @> ('[{"kkumail":"probe0137@kkumail.com"}]')::jsonb
       then 'found' else 'MISSED' end;

insert into probe select 'A3. by ชื่อเล่น', 'found',
  case when public.search_people('ต้นทดสอบ') @> ('[{"kkumail":"probe0137@kkumail.com"}]')::jsonb
       then 'found' else 'MISSED' end;

-- Typed WITHOUT the dash, which is how a รหัส is read off a card.
insert into probe select 'A4. by รหัสนักศึกษา with no dash', 'found',
  case when public.search_people('6599999999') @> ('[{"kkumail":"probe0137@kkumail.com"}]')::jsonb
       then 'found' else 'MISSED' end;

insert into probe select 'A5. by kkumail', 'found',
  case when public.search_people('probe0137') @> ('[{"kkumail":"probe0137@kkumail.com"}]')::jsonb
       then 'found' else 'MISSED' end;

insert into probe select 'A6. an exact kkumail ranks FIRST', 'probe0137@kkumail.com',
  coalesce(public.search_people('probe0137@kkumail.com')->0->>'kkumail', '(none)');

insert into probe select 'A7. hits report ทีม SAMO membership', 'yes',
  case when public.search_people('ปิติทดสอบ')->0 ? 'in_team'
        and public.search_people('ปิติทดสอบ')->0 ? 'team_nodes'
       then 'yes' else 'no' end;

-- ---- DENY ----
-- The two that matter. An unescaped implementation returns the whole table for
-- both of these, and every ALLOW above still passes.
insert into probe select 'D1. a bare % matches nobody', '0',
  jsonb_array_length(public.search_people('%%'))::text;

insert into probe select 'D2. a bare _ matches nobody', '0',
  jsonb_array_length(public.search_people('__'))::text;

insert into probe select 'D3. one character is not a search', '0',
  jsonb_array_length(public.search_people('ป'))::text;

insert into probe select 'D4. p_limit is clamped to 50', 'true',
  (jsonb_array_length(public.search_people('a', 5000)) <= 50)::text;

-- The projection is identity ONLY. สายรหัส and บ้าน are placement facts and
-- ทีม SAMO has no business with them — the same line 0132 draws for the mirrors.
insert into probe select 'D5. no placement facts published', 'clean',
  case when public.search_people('ปิติทดสอบ')->0 ?| array['sai_code','house','sai','person_house']
       then 'LEAKS' else 'clean' end;
reset role;

-- D6 — anon. The gate raises before it reads anything, and the grant is not
-- there either; either way the answer must not be a result set.
select set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
set local role anon;
do $do$
declare v text;
begin
  begin
    perform public.search_people('ปิติทดสอบ');
    v := 'ALLOWED';
  exception when others then v := 'denied';
  end;
  insert into probe values ('D6. anon cannot search', 'denied', v);
end
$do$;
reset role;

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;

rollback;
`;

const file = join(tmpdir(), `team0137-${process.pid}.sql`);
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
