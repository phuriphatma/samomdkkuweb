#!/usr/bin/env node
// ============================================================
// house0132-registry.mjs — one registry, one writer, and nothing drifts.
//
// 0132 is the migration with the most ways to be quietly wrong, because it
// leaves BOTH old identity columns in place and relies on a mirror to keep them
// honest. A backfill that merely "looks right" the day it runs is worth
// nothing; what has to be true is that a WRITE propagates, and that it stops at
// identity.
//
// ALLOW — the sync actually syncs:
//   A1  a registry edit reaches team_members
//   A2  the same edit reaches students
//   A3  update_my_identity() writes all three from one call
//   A4  get_my_profile() returns one merged identity
//   A5  a person in BOTH systems is ONE registry row, not two
//
// DENY — it stops where identity stops:
//   D1  the mirror never writes sai_code (the house is not the person's)
//   D2  the mirror never touches a posting's node_id
//   D3  no duplicate humans by address
//   D4  get_my_profile() is null for someone in neither system
//
// The deny half matters more than usual here: a mirror that copied too much
// would move a student between houses from the ทีม SAMO editor, silently.
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

-- A person who exists in BOTH systems — the interesting case.
create temporary table subj as
select p.id as pid, p.kkumail,
       (select s.id from public.students s where s.person_id = p.id limit 1)     as sid,
       (select m.id from public.team_members m where m.person_id = p.id limit 1) as mid,
       (select s.sai_code from public.students s where s.person_id = p.id limit 1) as sai0,
       (select m.node_id  from public.team_members m where m.person_id = p.id limit 1) as node0
  from public.people p
 where exists (select 1 from public.students s where s.person_id = p.id)
   and exists (select 1 from public.team_members m where m.person_id = p.id)
 limit 1;

insert into probe values ('A5. in both systems = ONE registry row', '1',
  (select count(*)::text from subj));

-- ---- the mirror ----
update public.people
   set first_name_th = 'ทดสอบ0132', last_name_th = 'ซิงค์'
 where id = (select pid from subj);

insert into probe
select 'A1. reaches team_members', 'ทดสอบ0132 ซิงค์',
       coalesce((select m.full_name from public.team_members m
                  where m.id = (select mid from subj)), '(none)');

insert into probe
select 'A2. reaches students', 'ทดสอบ0132',
       coalesce((select s.first_name_th from public.students s
                  where s.id = (select sid from subj)), '(none)');

-- ---- the mirror STOPS at identity ----
insert into probe
select 'D1. sai_code untouched', coalesce((select sai0 from subj), '(null)'),
       coalesce((select s.sai_code from public.students s
                  where s.id = (select sid from subj)), '(null)');

insert into probe
select 'D2. node_id untouched', coalesce((select node0::text from subj), '(null)'),
       coalesce((select m.node_id::text from public.team_members m
                  where m.id = (select mid from subj)), '(null)');

-- ---- one writer, three tables ----
-- Impersonate a real person who has a students row AND an auth account.
create temporary table who as
select s.kkumail, u.id as uid, s.person_id
  from public.students s
  join public.users u on lower(btrim(u.email)) = lower(btrim(s.kkumail))
 limit 1;
grant select on who to authenticated;
grant insert, select on probe to authenticated;

select set_config('role','authenticated',true),
       set_config('request.jwt.claims',
         json_build_object('sub',(select uid::text from who),'role','authenticated')::text, true);
set local role authenticated;

insert into probe
select 'A3. one call writes the registry', 'เขียนครั้งเดียว',
       coalesce((select x->>'nickname' from (
         select public.update_my_identity('{"nickname_self":"เขียนครั้งเดียว"}'::jsonb)->'identity' as x
       ) q), '(none)');

insert into probe
select 'A4. profile merges both halves', 'yes',
       case when public.get_my_profile()->'identity' ? 'in_house'
             and public.get_my_profile()->'identity' ? 'in_team'
            then 'yes' else 'no' end;

reset role;

-- …and the ทีม SAMO copy moved with it, if this person holds a posting.
insert into probe
select 'A3b. and every ทีม SAMO posting', 'ok',
       case when not exists (select 1 from public.team_members m
                              where lower(btrim(m.kkumail)) = lower(btrim((select kkumail from who))))
              then 'ok'   -- no posting to check; not a failure
            when exists (select 1 from public.team_members m
                          where lower(btrim(m.kkumail)) = lower(btrim((select kkumail from who)))
                            and coalesce(m.nickname,'') <> 'เขียนครั้งเดียว')
              then 'DRIFTED' else 'ok' end;

-- ---- global invariants ----
-- The gap the UI had: บ้านของฉัน saved through update_my_student_record, which
-- writes ระบบบ้าน and NOTHING else, so a ชื่อเล่น fixed there left ทีม SAMO saying
-- the old one. The card now goes through update_my_identity; this proves the
-- house entry point reaches the ทีม SAMO copy.
select set_config('role','authenticated',true),
       set_config('request.jwt.claims',
         json_build_object('sub',(select uid::text from who),'role','authenticated')::text, true);
set local role authenticated;
-- The write gets its OWN statement. Folding it into the CASE that then reads
-- team_members made the EXISTS run against the statement's snapshot, which
-- predates the write the same statement had just performed — the probe reported
-- DRIFTED for a row that was in fact correct. A proof that fails for the wrong
-- reason is worse than no proof: it gets explained away.
select public.update_my_identity('{"nickname_self":"สองทาง"}'::jsonb);

insert into probe
select 'A6. house-side save reaches ทีม SAMO', 'ok',
       case when not exists (select 1 from public.team_members m
                              where lower(btrim(m.kkumail)) = lower(btrim((select kkumail from who))))
              then 'ok'
            when exists (select 1 from public.team_members m
                          where lower(btrim(m.kkumail)) = lower(btrim((select kkumail from who)))
                            and coalesce(m.nickname,'') <> 'สองทาง')
              then 'DRIFTED' else 'ok' end;
reset role;

-- ---- 0133: the OTHER two doors ----
-- An admin editing in either workspace writes the placement table directly and
-- never touches the registry. Without a mirror UP, ทีม SAMO and ระบบบ้าน drift
-- apart the moment an admin fixes a name.
-- ⚠️ CONTRACT CHANGED IN 0135, and this step changed with it. It used to write
-- a COMBINED full_name and assert the registry took it. Since 0135 the registry
-- keeps a SPLIT it already holds rather than let a combined string overwrite it
-- — converting one to the other requires guessing where the surname starts, and
-- the member form now offers two boxes so an admin never has to. The ทีม SAMO
-- door still reaches the registry; it reaches it with the split.
update public.team_members
   set first_name_th = 'แก้จาก', last_name_th = 'ทีม SAMO'
 where id = (select mid from subj);
insert into probe
select 'A7. ทีม SAMO admin edit reaches the registry', 'แก้จาก ทีม SAMO',
       coalesce((select p.full_name from public.people p
                  where p.id = (select pid from subj)), '(none)');

-- …and a COMBINED edit still cannot clobber that split (0135 D1).
update public.team_members set full_name = 'ชื่อรวมช่องเดียว'
 where id = (select mid from subj);
insert into probe
select 'A7b. a combined edit does NOT overwrite the split', 'แก้จาก',
       coalesce((select p.first_name_th from public.people p
                  where p.id = (select pid from subj)), '(none)');
-- ⚠️ A COMBINED name edited in ทีม SAMO does NOT overwrite a SPLIT name in
-- ระบบบ้าน, and must not: splitting "สมชาย ณ อยุธยา" renames a real person, which
-- is why the CSV importer refuses a combined column and why 0132 did not split
-- the 303 inherited names. So the guarantee here is the narrower one — the
-- registry took the edit (A7) and ระบบบ้าน's split was left INTACT rather than
-- mangled. Closing this properly means giving the ทีม SAMO member form the same
-- ชื่อ/นามสกุล split, which is the next step in docs/PERSON-REGISTRY.md.
insert into probe
select 'A8. ระบบบ้าน took the split, never a guess', 'แก้จาก',
       coalesce((select s.first_name_th from public.students s
                  where s.id = (select sid from subj)), '(none)');

-- ชื่อเล่น, reported live: "when i change ชื่อเล่น in teamsamo, it doesn't change
-- in ระบบบ้าน". The up-mirror carried it to the registry; the DOWN-mirror had no
-- nickname branch at all, because students.nickname is GENERATED and the fix
-- had to write the column it is generated FROM (0134). A generated column is
-- not a reason to skip a field.
update public.team_members set nickname = 'ชื่อเล่นใหม่' where id = (select mid from subj);
insert into probe
select 'A8b. ชื่อเล่น reaches the registry', 'ชื่อเล่นใหม่',
       coalesce((select p.nickname from public.people p
                  where p.id = (select pid from subj)), '(none)');
insert into probe
select 'A8c. …and the EFFECTIVE ชื่อเล่น in ระบบบ้าน', 'ชื่อเล่นใหม่',
       coalesce((select s.nickname from public.students s
                  where s.id = (select sid from subj)), '(none)');

update public.students set major = 'MDI' where id = (select sid from subj);
insert into probe
select 'A9. ระบบบ้าน admin edit reaches the registry', 'MDI',
       coalesce((select p.major from public.people p
                  where p.id = (select pid from subj)), '(none)');
insert into probe
select 'B1. …and lands in ทีม SAMO', 'MDI',
       coalesce((select m.major from public.team_members m
                  where m.id = (select mid from subj)), '(none)');

-- A brand-new placement must be linked at birth (0108's owed contract step).
insert into public.team_members (node_id, full_name, kkumail)
values ((select node0 from subj), 'คนใหม่ ทดสอบ', 'brandnew0133@kkumail.com');
insert into probe values ('B2. a NEW member is linked at birth', 'linked',
  case when exists (select 1 from public.team_members
                     where kkumail = 'brandnew0133@kkumail.com' and person_id is not null)
       then 'linked' else 'ORPHAN' end);

insert into probe values ('D3. no duplicate humans by address', '0',
  (select count(*)::text from (
     select lower(btrim(kkumail)) from public.people
      where kkumail is not null and btrim(kkumail) <> ''
      group by 1 having count(*) > 1) d));

insert into probe values ('D3b. every placement is linked', '0',
  ((select count(*) from public.students where person_id is null)
   + (select count(*) from public.team_members where person_id is null))::text);

-- Somebody in neither system gets nothing at all.
select set_config('request.jwt.claims',
  json_build_object('sub', gen_random_uuid()::text, 'role','authenticated')::text, true);
set local role authenticated;
insert into probe values ('D4. stranger gets no profile', 'null',
  coalesce(public.get_my_profile()::text, 'null'));
reset role;

select step, expected, got,
       case when expected = got then 'PASS' else 'FAIL' end as verdict
  from probe order by step;

rollback;
`;

const file = join(tmpdir(), `house0132-${process.pid}.sql`);
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
