#!/usr/bin/env node
// ============================================================
// team0143-photo-refcount.mjs — a cleanup must not destroy a file that is
//                                still in use.
//
// FOUND BY AUDIT, live, before it cost anything. `deleteTeamPhotoIfUnused`
// counted `team_members` + `team_archive_members` — complete until 0132 gave
// `people` a photo_url and its mirror copied the same URL to `students`.
//
// Two things this pins, and the second is the one that made a client-side fix
// impossible:
//   • the OLD two-table count answers "unreferenced" for a portrait that
//     people AND students still point at;
//   • a `team_edit` admin — the caller who presses ลบสมาชิก — cannot read
//     `students` or `advisors` at all, and RLS answers that with ZERO ROWS
//     rather than an error. So any tally done in the browser is silently short
//     for exactly the person who triggers the delete.
//
// Hence photo_reference_count(), SECURITY DEFINER. It leaks nothing: the caller
// already holds the URL and is asking whether they may delete the file.
//
// Runs inside a transaction it ROLLS BACK.
// ============================================================
import { writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SQL = `begin;
create temporary table probe(k text, expected text, got text);
select id into temporary anynode from public.team_nodes limit 1;

with m as (
  insert into public.team_members (node_id, full_name, kkumail, photo_url)
  values ((select id from anynode), 'มีรูป ทดสอบ', 'photoprobe@kkumail.com', 'PROBEURL')
  returning id, person_id
) select id, person_id into temporary tm from m;
insert into public.students (kkumail, first_name_th, sai_code, person_id, photo_url)
values ('photoprobe@kkumail.com', 'มีรูป', '017', (select person_id from tm), 'PROBEURL');
update public.people set photo_url = 'PROBEURL' where id = (select person_id from tm);

delete from public.team_members where id = (select id from tm);

-- A 'team_edit' admin: the caller who actually presses ลบสมาชิก.
create temporary table caller as
select u.id as uid from public.users u
 where 'team_edit' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}'))
   and not ('house' = any (coalesce(u.permissions,'{}') || coalesce(u.managed_permissions,'{}')))
   and u.role not in ('vp_admin','dev')
 limit 1;
grant select on caller to authenticated;
grant insert, select on probe to authenticated;

insert into probe values ('found a team_edit-only admin to impersonate', '1',
  (select count(*)::text from caller));

do $do$
declare v_uid uuid; v_client int; v_server int;
begin
  select uid into v_uid from caller;
  if v_uid is null then
    insert into probe values ('client-side count (the old way)', '(skipped)', '(skipped)');
    insert into probe values ('server-side count (0143)', '(skipped)', '(skipped)');
    return;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
  set local role authenticated;
  -- What the SHIPPED count saw: team_members + team_archive_members only.
  -- This is the actual bug — the two tables it knew about are both empty once
  -- the member row is gone, so it answered "unreferenced" and deleted a file
  -- that people AND students still point at.
  select (select count(*) from public.team_members where photo_url='PROBEURL')
       + (select count(*) from public.team_archive_members where photo_url='PROBEURL')
    into v_client;
  select public.photo_reference_count('PROBEURL') into v_server;
  reset role;
  insert into probe values ('the OLD 2-table count says unreferenced (the bug)', '0', v_client::text);
  insert into probe values ('server-side count (0143) — keeps it', '2', v_server::text);
end $do$;
reset role;

insert into probe values ('a blank URL never answers zero', '1',
  public.photo_reference_count('')::text);

-- The reason the count had to move SERVER-side: a team_edit admin cannot read
-- students/advisors at all, and RLS answers that with zero rows rather than an
-- error — so any client-side tally of those tables is silently short.
do $do$
declare v_uid uuid; v_seen int;
begin
  select uid into v_uid from caller;
  if v_uid is null then return; end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);
  set local role authenticated;
  select (select count(*) from public.students where photo_url='PROBEURL')
       + (select count(*) from public.advisors where photo_url='PROBEURL')
    into v_seen;
  reset role;
  insert into probe values
    ('a team_edit admin reads 0 of the students/advisors refs (RLS, not an error)',
     '0', v_seen::text);
end $do$;
reset role;

select k, expected, got, case when expected=got then 'PASS' else 'FAIL' end as verdict from probe;
rollback;
`;

const file = join(tmpdir(), `team0143-${process.pid}.sql`);
writeFileSync(file, SQL);
let out;
try {
  out = execFileSync('node', [new URL('./db-query.mjs', import.meta.url).pathname, file],
    { encoding: 'utf8' });
} finally { unlinkSync(file); }

const rows = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
let failed = 0;
for (const r of rows) {
  const ok = r.verdict === 'PASS';
  if (!ok) failed += 1;
  console.log(`${ok ? '\u2713' : '\u2717'} ${r.k}: expected ${r.expected}, got ${r.got}`);
}
console.log(failed ? `\n${failed} FAILED` : `\nall ${rows.length} pass`);
process.exit(failed ? 1 : 0);
