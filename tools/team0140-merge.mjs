#!/usr/bin/env node
// ============================================================
// team0140-merge.mjs — "เป็นคนเดียวกับ …" is a MERGE, not a rename.
//
// REPORTED: pressing it produced
//   23505 duplicate key value violates unique constraint "team_people_kkumail_uniq"
//
// Giving a placement an address another person already holds used to push that
// address onto THIS row's own registry person, i.e. ask two `people` rows to
// hold one address. 0140 re-points the placement at the person who holds it.
//
// What must be true, and every one of these was false or fragile before:
//   A1  the write succeeds at all
//   A2  the posting now points at the EXISTING person
//   A3  the placeholder person is gone (0139's refcount, via the re-point door)
//   A4  the target keeps its ชื่อเล่น — a sparse row must not blank a rich person
//   A5  …and its photo
//   A6  the merged row INHERITS the person's values rather than staying sparse
//   A7  exactly one registry row holds the address
//
// A4/A5 are the ones worth keeping. Re-pointing without filling the incoming
// row's nulls turns "use the same data" into "lose the data", silently.
//
// Runs inside a transaction it ROLLS BACK.
// ============================================================
import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SQL = `begin;
select id into temporary anynode from public.team_nodes limit 1;
-- The rich person who already holds the address.
with a as (
  insert into public.team_members (node_id, full_name, kkumail, student_id, nickname, photo_url)
  values ((select id from anynode), 'ปวีณ์ธิดา สัชญูกร', 'mergeprobe@kkumail.com',
          '663070777-7', 'มิ้น', 'https://lh3.example/photo')
  returning id, person_id
) select id, person_id into temporary rowa from a;
-- The no_key row: no address, no รหัส, no ชื่อเล่น, no photo.
with b as (
  insert into public.team_members (node_id, full_name)
  values ((select id from anynode), 'ปวีณ์ธิดา สัชญูกร') returning id, person_id
) select id, person_id into temporary rowb from b;

update public.team_members
   set kkumail = 'mergeprobe@kkumail.com', student_id = '663070777-7'
 where id = (select id from rowb);

select 'A1. no 23505'                    as k, 'ok' as expected, 'ok' as got
union all select 'A2. row B now points at person A', 'same',
  case when (select person_id from public.team_members where id=(select id from rowb))
          = (select person_id from rowa) then 'same' else 'DIFFERENT' end
union all select 'A3. the placeholder person is gone', '0',
  (select count(*)::text from public.people where id = (select person_id from rowb))
union all select 'A4. the target keeps its ชื่อเล่น', 'มิ้น',
  coalesce((select nickname from public.people where id=(select person_id from rowa)),'(null)')
union all select 'A5. …and its photo', 'https://lh3.example/photo',
  coalesce((select photo_url from public.people where id=(select person_id from rowa)),'(null)')
union all select 'A6. the merged row inherited them too', 'มิ้น',
  coalesce((select nickname from public.team_members where id=(select id from rowb)),'(null)')
union all select 'A7. one registry row for the address', '1',
  (select count(*)::text from public.people where lower(btrim(kkumail))='mergeprobe@kkumail.com');
rollback;
`;

const file = join(tmpdir(), `team0140-${process.pid}.sql`);
writeFileSync(file, SQL);
let out;
try {
  out = execFileSync('node', [new URL('./db-query.mjs', import.meta.url).pathname, file],
    { encoding: 'utf8' });
} finally { unlinkSync(file); }

const rows = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
let failed = 0;
for (const r of rows) {
  const ok = r.expected === r.got;
  if (!ok) failed += 1;
  console.log(`${ok ? '\u2713' : '\u2717'} ${r.k}: expected ${r.expected}, got ${r.got}`);
}
console.log(failed ? `\n${failed} FAILED` : `\nall ${rows.length} pass`);
process.exit(failed ? 1 : 0);
