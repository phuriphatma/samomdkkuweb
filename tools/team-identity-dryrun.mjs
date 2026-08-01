#!/usr/bin/env node
// ============================================================
// team-identity-dryrun.mjs — READ-ONLY. What would happen if `team_members`
// rows were resolved into one record per PERSON.
//
// WHY: a person is currently stored once per ตำแหน่ง. 403 rows, ~285 humans.
// Their ชื่อเล่น / ชั้นปี / รูป / kkumail are duplicated per row with nothing
// keeping them in step, so they have already drifted apart for 15 people.
// Before any of that is merged, this prints exactly what WOULD merge and what
// would not — nothing is written.
//
// THE RESOLUTION RULE (kkumail is the identity; รหัสนักศึกษา is a field):
//   1. rows sharing a valid kkumail  → one person
//   2. rows with NO kkumail, sharing a รหัสนักศึกษา → one person
//   3. anything else → its own person
//   Never on name. Never merging two different emails because a รหัสนักศึกษา
//   happens to match — that case is a mistyped id, and merging it would fuse
//   two humans irreversibly once สิทธิ์ flowed through the joined record.
//
// Every SELECT. Safe to run against production any number of times. (Note that
// tools/db-query.mjs COMMITS whatever it is given — see mistakes.md — so the
// query below deliberately contains no DML at all rather than relying on a
// rollback.)
//
//   node tools/team-identity-dryrun.mjs           # summary + every conflict
//   node tools/team-identity-dryrun.mjs --merges  # also list each merge group
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

const SQL = `
with norm as (
  select m.id, m.node_id, n.name as node_name,
         nullif(btrim(m.full_name), '') as full_name,
         nullif(btrim(m.prefix), '')    as prefix,
         nullif(btrim(m.nickname), '')  as nickname,
         nullif(btrim(m.major), '')     as major,
         nullif(btrim(m.year::text),'') as yr,
         nullif(btrim(m.photo_url), '') as photo_url,
         nullif(btrim(m.student_id), '') as sid,
         -- an "email" with no @ is not an email. One row literally holds '-'.
         case when position('@' in coalesce(m.kkumail,'')) > 0
              then lower(btrim(m.kkumail)) end as em,
         nullif(btrim(m.kkumail), '') as raw_mail,
         m.updated_at
    from public.team_members m
    left join public.team_nodes n on n.id = m.node_id
),
-- Rule 1 then 2 then 3, in that order. 'e:'/'s:'/'r:' keeps the key space
-- disjoint so a รหัสนักศึกษา can never collide with an email.
keyed as (
  select *, case when em is not null then 'e:' || em
                 when sid is not null then 's:' || sid
                 else 'r:' || id::text end as person_key
    from norm
),
grp as (
  select person_key,
         count(*) as placements,
         count(distinct sid) as n_sid,
         count(distinct full_name) as n_name,
         count(distinct nickname) filter (where nickname is not null) as n_nick,
         count(distinct prefix)   filter (where prefix   is not null) as n_prefix,
         count(distinct yr)       filter (where yr       is not null) as n_year,
         count(distinct major)    filter (where major    is not null) as n_major,
         count(distinct photo_url) filter (where photo_url is not null) as n_photo,
         min(full_name) as a_name,
         array_agg(distinct node_name) as nodes,
         array_agg(distinct sid)       filter (where sid is not null)      as sids,
         array_agg(distinct full_name) filter (where full_name is not null) as names,
         array_agg(distinct nickname)  filter (where nickname is not null) as nicks,
         array_agg(distinct prefix)    filter (where prefix   is not null) as prefixes,
         array_agg(distinct yr)        filter (where yr       is not null) as years,
         bool_or(em is not null) as has_email,
         bool_or(sid is not null) as has_sid
    from keyed group by person_key
),
-- A รหัสนักศึกษา that turns up under two DIFFERENT people. Either a typo or a
-- reused id; either way it must not drive a merge.
sid_across as (
  select sid, count(distinct person_key) as people,
         array_agg(distinct person_key) as keys
    from keyed where sid is not null
   group by sid having count(distinct person_key) > 1
),
-- Same name landing in two groups: not merged (by design), but worth eyes.
name_across as (
  select full_name, count(distinct person_key) as people
    from keyed where full_name is not null
   group by full_name having count(distinct person_key) > 1
)
select json_build_object(
  'rows',            (select count(*) from keyed),
  'people_after',    (select count(*) from grp),
  'groups_merging',  (select count(*) from grp where placements > 1),
  'rows_absorbed',   (select coalesce(sum(placements - 1), 0) from grp),
  'merged_on_email', (select count(*) from grp where placements > 1 and has_email),
  'merged_on_sid',   (select count(*) from grp where placements > 1 and not has_email),

  'needs_eyes', json_build_object(
    'no_key_at_all',   (select count(*) from keyed where em is null and sid is null),
    'invalid_email',   (select coalesce(json_agg(json_build_object(
                          'name', full_name, 'value', raw_mail, 'node', node_name)), '[]'::json)
                          from keyed where raw_mail is not null and em is null),
    'sid_under_two_people', (select coalesce(json_agg(json_build_object(
                          'sid', s.sid, 'people', s.people,
                          'names', (select array_agg(distinct k.full_name) from keyed k
                                     where k.sid = s.sid))), '[]'::json) from sid_across s),
    'sid_conflict_within_person', (select coalesce(json_agg(json_build_object(
                          'name', a_name, 'sids', sids)), '[]'::json)
                          from grp where n_sid > 1),
    'name_in_two_groups', (select coalesce(json_agg(json_build_object(
                          'name', full_name, 'groups', people)), '[]'::json) from name_across),
    'keyless_rows', (select coalesce(json_agg(json_build_object(
                          'name', full_name, 'node', node_name)), '[]'::json)
                          from keyed where em is null and sid is null)
  ),

  'field_drift', json_build_object(
    'prefix',   (select count(*) from grp where n_prefix > 1),
    'nickname', (select count(*) from grp where n_nick   > 1),
    'year',     (select count(*) from grp where n_year   > 1),
    'major',    (select count(*) from grp where n_major  > 1),
    'photo',    (select count(*) from grp where n_photo  > 1),
    'name',     (select count(*) from grp where n_name   > 1),
    'detail',   (select coalesce(json_agg(json_build_object(
                   'name', a_name, 'prefixes', prefixes, 'nicknames', nicks,
                   'years', years, 'names', names)), '[]'::json)
                   from grp where n_nick > 1 or n_prefix > 1 or n_year > 1 or n_name > 1)
  ),

  -- How many ROWS the จัดการทีม flag will appear on. Different from the finding
  -- count: one drifting person flags all of their placements.
  'flagged_rows', (
    select count(*) from keyed k join grp g on g.person_key = k.person_key
     where (k.raw_mail is not null and k.em is null)
        or g.n_nick > 1 or g.n_prefix > 1 or g.n_year > 1
        or g.n_major > 1 or g.n_photo > 1 or g.n_name > 1
        or (not g.has_email and not g.has_sid)
        or g.n_sid > 1
        or exists (select 1 from sid_across sa where sa.sid = k.sid)),
  'flagged_root_divisions', (
    select coalesce(json_agg(json_build_object('name', x.rn, 'flagged', x.c) order by x.c desc), '[]'::json)
      from (
        select coalesce(r.name, '(ไม่ทราบ)') rn, count(*) c
          from keyed k join grp g on g.person_key = k.person_key
          left join lateral (
            with recursive up as (
              select n.id, n.parent_id, n.name from public.team_nodes n where n.id = k.node_id
              union all
              select p.id, p.parent_id, p.name from public.team_nodes p join up on up.parent_id = p.id)
            select name from up where parent_id is null limit 1) r on true
         where (k.raw_mail is not null and k.em is null)
            or g.n_nick > 1 or g.n_prefix > 1 or g.n_year > 1
            or g.n_major > 1 or g.n_photo > 1 or g.n_name > 1
            or (not g.has_email and not g.has_sid)
            or g.n_sid > 1
            or exists (select 1 from sid_across sa where sa.sid = k.sid)
         group by 1) x),

  'merges', (select coalesce(json_agg(json_build_object(
                'name', a_name, 'placements', placements, 'nodes', nodes)
                order by placements desc), '[]'::json)
                from grp where placements > 1)
) as report;
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
if (!r.ok) { console.error(`HTTP ${r.status}:`, text); process.exit(1); }

const rep = JSON.parse(text)[0].report;
const n = (x) => String(x).padStart(4);

console.log('\n=== DRY RUN — nothing was written ===\n');
console.log(`${n(rep.rows)}  team_members rows today`);
console.log(`${n(rep.people_after)}  people after resolution`);
console.log(`${n(rep.rows_absorbed)}  rows folded into an existing person`);
console.log(`${n(rep.groups_merging)}  people holding more than one ตำแหน่ง`);
console.log(`${n(rep.flagged_rows)}  rows the จัดการทีม ต้องตรวจสอบ flag lands on`);
console.log(`      · ${rep.merged_on_email} matched by kkumail, ${rep.merged_on_sid} by รหัสนักศึกษา only\n`);

const d = rep.field_drift;
console.log('--- fields that DISAGREE between one person\'s rows ---');
console.log(`  prefix ${d.prefix}   ชื่อเล่น ${d.nickname}   ชั้นปี ${d.year}   `
  + `สาขา ${d.major}   รูป ${d.photo}   ชื่อ ${d.name}`);
for (const x of d.detail) {
  const bits = [];
  if ((x.names || []).length > 1) bits.push(`ชื่อ: ${x.names.join(' | ')}`);
  if ((x.prefixes || []).length > 1) bits.push(`คำนำหน้า: ${x.prefixes.join(' | ')}`);
  if ((x.nicknames || []).length > 1) bits.push(`ชื่อเล่น: ${x.nicknames.join(' | ')}`);
  if ((x.years || []).length > 1) bits.push(`ชั้นปี: ${x.years.join(' | ')}`);
  console.log(`   • ${x.name} — ${bits.join('  ·  ')}`);
}

const e = rep.needs_eyes;
console.log('\n--- NEEDS YOUR EYES (not merged, nothing guessed) ---');
console.log(`  ${e.no_key_at_all} rows with neither kkumail nor รหัสนักศึกษา`);
for (const x of e.keyless_rows) console.log(`   • ${x.name || '(ไม่มีชื่อ)'} — ${x.node}`);
if (e.invalid_email.length) {
  console.log(`  ${e.invalid_email.length} rows whose kkumail is not an email`);
  for (const x of e.invalid_email) console.log(`   • ${x.name} — "${x.value}" (${x.node})`);
}
if (e.sid_under_two_people.length) {
  console.log(`  ${e.sid_under_two_people.length} รหัสนักศึกษา shared by DIFFERENT people`);
  for (const x of e.sid_under_two_people) console.log(`   • ${x.sid} → ${x.names.join(' / ')}`);
}
if (e.sid_conflict_within_person.length) {
  console.log(`  ${e.sid_conflict_within_person.length} people whose rows carry different รหัสนักศึกษา`);
  for (const x of e.sid_conflict_within_person) console.log(`   • ${x.name} → ${x.sids.join(' / ')}`);
}
if (e.name_in_two_groups.length) {
  console.log(`  ${e.name_in_two_groups.length} names appearing in two separate people (NOT merged — names are never a key)`);
  for (const x of e.name_in_two_groups) console.log(`   • ${x.name} (${x.groups} groups)`);
}

console.log('\n--- flagged rows per ฝ่ายหลัก (the rolled-up count on each root row) ---');
for (const x of rep.flagged_root_divisions) console.log(`   ${String(x.flagged).padStart(4)}  ${x.name}`);

if (process.argv.includes('--merges')) {
  console.log('\n--- every merge ---');
  for (const m of rep.merges) console.log(`   • ${m.name} (${m.placements}) — ${m.nodes.join(' · ')}`);
}
console.log('');
