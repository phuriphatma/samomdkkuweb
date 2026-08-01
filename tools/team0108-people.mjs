#!/usr/bin/env node
// ============================================================
// team0108-people.mjs — proof for 0108 (team_people expand step).
//
// Runs the REAL migration file against the REAL data inside a transaction that
// ROLLS BACK, then asserts the outcome. Nothing is written. Run it before
// applying, and again after (the assertions hold either way — a second apply is
// a no-op because the backfill only considers unlinked rows).
//
//   node tools/team0108-people.mjs
//
// The Management API runs a multi-statement string as ONE implicit transaction
// over the simple-query protocol, so the explicit begin/rollback here is what
// keeps a failed assertion from leaving the schema half-changed — and what makes
// it safe to run this against production. (tools/db-query.mjs COMMITS; that is
// the trap logged in mistakes.md, and the reason this file is not just a .sql.)
// ============================================================
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }));

const REF = (env.VITE_SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!REF || !env.SUPABASE_ACCESS_TOKEN) {
  console.error('need VITE_SUPABASE_URL + SUPABASE_ACCESS_TOKEN in .env.local');
  process.exit(1);
}

const MIGRATION = readFileSync(
  new URL('../supabase/migrations/0108_team_people_expand.sql', import.meta.url), 'utf8');

const SQL = `
begin;

-- Snapshot BEFORE the migration so "did the backfill touch anything a resolver
-- reads?" can be answered by diffing the actual columns, rather than inferred
-- from updated_at — which is itself one of the things that must not move.
create temp table before_snap on commit drop as
  select id, prefix, full_name, nickname, year, major, photo_url, photo_focus,
         student_id, kkumail, user_id, node_id, position, permissions,
         inherit_permissions, vs_dept, project_seat, updated_at
    from public.team_members;

${MIGRATION}

create temp table out (k text, v text) on commit drop;

-- ── shape ──────────────────────────────────────────────────────────────────
insert into out
select 'rows', count(*)::text from public.team_members;
insert into out
select 'people', count(*)::text from public.team_people;
insert into out
select 'members linked', count(*)::text from public.team_members where person_id is not null;
insert into out
select 'members UNLINKED', count(*)::text from public.team_members where person_id is null;

-- ── the resolution rule held ───────────────────────────────────────────────
-- Every placement of one person must agree on the email that identified them.
insert into out
select 'people with >1 kkumail among their placements',
       count(*)::text from (
  select p.id from public.team_people p
    join public.team_members m on m.person_id = p.id
   where coalesce(btrim(m.kkumail), '') <> '' and position('@' in m.kkumail) > 0
   group by p.id having count(distinct lower(btrim(m.kkumail))) > 1) x;

-- The unique index must actually be doing something.
insert into out
select 'duplicate kkumail across people', count(*)::text from (
  select lower(btrim(kkumail)) from public.team_people
   where coalesce(btrim(kkumail), '') <> ''
   group by 1 having count(*) > 1) x;

-- 673070332-6: two humans, one mistyped รหัส, correct distinct emails. They MUST
-- remain two people. This is the assertion the whole key choice rests on.
insert into out
select 'people sharing รหัส 673070332-6', count(distinct m.person_id)::text
  from public.team_members m where btrim(m.student_id) = '673070332-6';

-- A name is never a key: no two people were fused on it.
insert into out
select 'same-name rows fused into one person', count(*)::text from (
  select btrim(m.full_name) nm
    from public.team_members m
   where coalesce(btrim(m.full_name),'') <> ''
     and coalesce(btrim(m.kkumail),'') = '' and coalesce(btrim(m.student_id),'') = ''
   group by 1 having count(distinct m.person_id) = 1 and count(*) > 1) x;

-- ── nothing existing changed ───────────────────────────────────────────────
-- The backfill must be READ-ONLY with respect to every column a resolver or
-- policy reads. Only person_id may differ. NOTE this runs BEFORE the mirror
-- test below, which deliberately does mutate.
insert into out
select 'identity columns altered by the backfill', count(*)::text
  from public.team_members m join before_snap b on b.id = m.id
 where (m.prefix, m.full_name, m.nickname, m.year, m.major, m.photo_url,
        m.photo_focus, m.student_id, m.kkumail, m.user_id, m.node_id, m.position,
        m.permissions, m.inherit_permissions, m.vs_dept, m.project_seat)
       is distinct from
       (b.prefix, b.full_name, b.nickname, b.year, b.major, b.photo_url,
        b.photo_focus, b.student_id, b.kkumail, b.user_id, b.node_id, b.position,
        b.permissions, b.inherit_permissions, b.vs_dept, b.project_seat);

-- updated_at is not cosmetic: team_term_status (0105) derives
-- "ผังสดเปลี่ยนแล้ว · ควรเผยแพร่ซ้ำ" from max(updated_at) across the team tables,
-- so a backfill that bumps it flags every published year as needing a re-publish.
insert into out
select 'rows whose updated_at moved', count(*)::text
  from public.team_members m join before_snap b on b.id = m.id
 where m.updated_at is distinct from b.updated_at;

-- …and the trigger that does that must be back ON afterwards.
insert into out
select 'touch trigger re-enabled',
       case when tgenabled = 'O' then 'yes' else 'NO (' || tgenabled::text || ')' end
  from pg_trigger where tgrelid = 'public.team_members'::regclass
   and tgname = 'touch_team_members_updated_at';

-- The permission engine still resolves exactly as before.
insert into out
select 'accounts whose managed_permissions would change', count(*)::text
  from public.users u
 where coalesce(u.email, '') <> ''
   and coalesce(u.managed_permissions, '{}')
       is distinct from public.effective_team_permissions_for_email(u.email);

-- ── the mirror works, and only downward ────────────────────────────────────
do $$
declare v_pid uuid; v_before text; v_after text; v_n int;
begin
  select p.id into v_pid from public.team_people p
    join public.team_members m on m.person_id = p.id
   group by p.id having count(*) > 1 limit 1;
  if v_pid is null then
    insert into out values ('mirror', 'SKIPPED — no multi-placement person');
    return;
  end if;
  select count(*) into v_n from public.team_members where person_id = v_pid;

  update public.team_people set nickname = 'ทดสอบมิเรอร์' where id = v_pid;
  select count(*)::text into v_after from public.team_members
   where person_id = v_pid and nickname = 'ทดสอบมิเรอร์';
  insert into out values ('mirror wrote to all placements', v_after || '/' || v_n);

  -- The reverse must NOT happen: a placement edit stays local, or the two
  -- tables would fight each other on every write.
  update public.team_members set nickname = 'เฉพาะแถวนี้'
   where person_id = v_pid and id = (select min(id::text)::uuid from public.team_members where person_id = v_pid);
  select nickname into v_before from public.team_people where id = v_pid;
  insert into out values ('placement edit did NOT mirror up',
    case when v_before = 'ทดสอบมิเรอร์' then 'yes' else 'NO — ' || coalesce(v_before,'null') end);
end $$;

-- ── RLS ────────────────────────────────────────────────────────────────────
insert into out
select 'team_people RLS enabled',
       case when relrowsecurity then 'yes' else 'NO' end
  from pg_class where oid = 'public.team_people'::regclass;
insert into out
select 'team_people policies', count(*)::text
  from pg_policies where schemaname = 'public' and tablename = 'team_people';
insert into out
select 'anon can read team_people',
       case when has_table_privilege('anon', 'public.team_people', 'select')
            then 'has SELECT grant (RLS still gates rows)' else 'no' end;

-- ── the FK cannot block a delete ───────────────────────────────────────────
insert into out
select 'person_id FK on delete action',
       case confdeltype when 'n' then 'set null (ok, column is nullable)'
                        when 'c' then 'cascade' when 'a' then 'no action'
                        else confdeltype::text end
  from pg_constraint
 where conrelid = 'public.team_members'::regclass and conname like '%person_id%';

select k, v from out order by k;

rollback;
`;

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: SQL }),
});
const text = await r.text();
if (!r.ok) { console.error(`HTTP ${r.status}:`, text.slice(0, 4000)); process.exit(1); }

const rows = JSON.parse(text);
const got = Object.fromEntries(rows.map((x) => [x.k, x.v]));

// Expected outcomes. `rows`/`people` are informational; the rest are assertions.
const MUST = {
  'members UNLINKED': '0',
  'people with >1 kkumail among their placements': '0',
  'duplicate kkumail across people': '0',
  'people sharing รหัส 673070332-6': '2',        // two humans, still two
  'same-name rows fused into one person': '0',   // a name is never a key
  'identity columns altered by the backfill': '0',
  'rows whose updated_at moved': '0',
  'touch trigger re-enabled': 'yes',
  'accounts whose managed_permissions would change': '0',
  'placement edit did NOT mirror up': 'yes',
  'team_people RLS enabled': 'yes',
  'team_people policies': '1',
};

let pass = 0; let fail = 0;
console.log(`\nproject ${REF} — 0108 dry run (ROLLED BACK)\n`);
console.log(`  ${got.rows} team_members rows → ${got.people} people\n`);
for (const [k, want] of Object.entries(MUST)) {
  const ok = got[k] === want;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${k} = ${got[k]}${ok ? '' : `  (expected ${want})`}`);
  ok ? pass++ : fail++;
}
for (const k of ['mirror wrote to all placements', 'anon can read team_people',
  'person_id FK on delete action', 'members linked']) {
  if (got[k] !== undefined) console.log(`  ..    ${k} = ${got[k]}`);
}
console.log(`\n${pass} passed, ${fail} failed — nothing was written\n`);
process.exit(fail ? 1 : 0);
