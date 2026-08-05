// 0113 proof: คำนำหน้า is gone, the สาขา vocabulary is readable-by-all and
// writable only by ทีม SAMO editors, and the canonical field forms hold.
//
// Two disciplines this repo has paid for, both applied here:
//   • BOTH DIRECTIONS. A probe that can only report "denied" cannot tell a
//     working guard from a broken service, so every deny check has an allow
//     twin (a `team_edit` member CAN write team_majors; a plain member CAN read
//     it).
//   • ASSERT FROM THE AUTHORITY. Column absence is read from
//     information_schema, function bodies from pg_get_functiondef, ACLs from
//     pg_proc.proacl — never from the migration file that was just applied.
//     (Note `prokind='f'`: pg_get_functiondef RAISES 42809 on an aggregate, and
//     the Management API reports that as a whole-query failure. The enumeration
//     recipe written into 0110's comments has exactly that bug, which is why it
//     silently returns nothing.)
//
// Everything runs inside ONE rolled-back transaction per probe.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const PAT = env.SUPABASE_ACCESS_TOKEN;
const URL_ = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const REF = URL_.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

let pass = 0; let fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, String(e).slice(0, 300)); }
};
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rows = (r) => (Array.isArray(r.body) ? r.body.flat().filter((x) => x && typeof x === 'object') : []);
const find = (r, key) => rows(r).find((x) => key in x) || {};
const blocked = (r) => r.status >= 400 || /policy|denied|permission|guard/i.test(JSON.stringify(r.body));

let UID; let EMAIL;

/** Seed a real binding for the test user, sync it, then run `sql` as them.
 *  Copied from tools/team0110-view-edit.mjs — seeding the TREE rather than
 *  poking users.managed_permissions is load-bearing, because any write to the
 *  team tables fires the recompute trigger and would wipe a grant with nothing
 *  behind it. */
const asMember = (perms, sql) => mgmt(`
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(UID)}, 'role','authenticated')::text, true);
  with n as (
    insert into public.team_nodes (name, kind, permissions)
    values ('ZZ-0113-NODE', 'role', ${perms}) returning id
  )
  insert into public.team_members (node_id, full_name, nickname, kkumail)
  select n.id, 'ZZ-0113-ME', 'ชื่อเล่นเดิม', ${lit(EMAIL)} from n;
  select public.sync_my_team_permissions();
  set local role authenticated;
  ${sql}
  reset role;
  rollback;`);

async function main() {
  console.log('project', REF, '\n');

  // ---------- §1 คำนำหน้า is gone, everywhere ----------
  console.log('คำนำหน้า REMOVED');
  const cols = await mgmt(`
    select
      (select count(*) from information_schema.columns
        where table_schema='public' and table_name='team_members' and column_name='prefix') as tm,
      (select count(*) from information_schema.columns
        where table_schema='public' and table_name='team_people' and column_name='prefix') as tp,
      (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.prokind='f'
          and pg_get_functiondef(p.oid) ~ '\\mprefix\\M') as funcs;`);
  const c0 = find(cols, 'tm');
  check('team_members.prefix is dropped', Number(c0.tm) === 0, JSON.stringify(c0));
  check('team_people.prefix is dropped', Number(c0.tp) === 0, JSON.stringify(c0));
  check('no function body still names prefix', Number(c0.funcs) === 0, JSON.stringify(c0));

  // The mirror trigger names its columns in `after update of …`; a drop column
  // would have cascade-dropped it, which fails SILENTLY — the mirror would stop
  // firing for the other eight columns too.
  const trg = await mgmt(`
    select t.tgname, pg_get_triggerdef(t.oid) as def
      from pg_trigger t
     where not t.tgisinternal
       and t.tgname in ('team_people_mirror_down','team_members_self_update_guard')
     order by 1;`);
  const defOf = (n) => (rows(trg).find((x) => x.tgname === n) || {}).def || '';
  check('team_people_mirror_down still exists after the drop',
    defOf('team_people_mirror_down').length > 0);
  check('…and no longer lists prefix in its column list',
    !/\bprefix\b/.test(defOf('team_people_mirror_down')), defOf('team_people_mirror_down'));
  check('…and still fires on the nine columns it does mirror',
    /full_name/.test(defOf('team_people_mirror_down'))
    && /kkumail/.test(defOf('team_people_mirror_down'))
    && /photo_focus/.test(defOf('team_people_mirror_down')), defOf('team_people_mirror_down'));
  check('team_members_self_update_guard trigger survives',
    defOf('team_members_self_update_guard').length > 0);

  // ---------- §2 canonical stored data ----------
  console.log('\nCANONICAL DATA');
  const data = await mgmt(`
    select
      (select count(*) from public.team_members
        where student_id is not null and btrim(student_id) <> ''
          and student_id !~ '^[0-9]{9}-[0-9]$') as sid_off_format,
      (select count(*) from public.team_members
        where year is not null and year !~ '^[1-6]$') as year_off_format,
      (select count(*) from public.team_members m
        where m.major is not null and btrim(m.major) <> ''
          and not exists (select 1 from public.team_majors t where t.code = m.major)) as major_off_list,
      (select count(*) from public.team_majors) as vocab;`);
  const d0 = find(data, 'sid_off_format');
  // 66666666-2 is nine digits: which digit is missing is not knowable, so it is
  // deliberately NOT rewritten — the card and the admin pane both report it.
  check('at most one รหัสนักศึกษา is off-format (the unfixable live row)',
    Number(d0.sid_off_format) <= 1, JSON.stringify(d0));
  check('every stored ชั้นปี is a bare 1–6', Number(d0.year_off_format) === 0, JSON.stringify(d0));
  check('every stored สาขา matches a vocabulary code EXACTLY (case included)',
    Number(d0.major_off_list) === 0, JSON.stringify(d0));
  check('the vocabulary is seeded', Number(d0.vocab) >= 3, JSON.stringify(d0));

  // Case-insensitive uniqueness is the whole point of the table — `MD` and `md`
  // in the picker is the problem it exists to end.
  const dupe = await mgmt(`
    insert into public.team_majors (code) values ('md');`);
  check('the vocabulary refuses a case-variant duplicate of MD',
    blocked(dupe) || /duplicate|unique/i.test(JSON.stringify(dupe.body)), JSON.stringify(dupe.body));

  // ---------- pick a plain user ----------
  const who = (await mgmt(`select id, email from public.users
     where coalesce(role,'user')='user' and email is not null and btrim(email) <> ''
       and email not in (select lower(btrim(kkumail)) from public.team_members where kkumail like '%@%')
     order by id limit 1`)).body?.[0];
  UID = who?.id; EMAIL = who?.email;
  if (!UID || !EMAIL) { console.log('no plain user outside the tree'); process.exit(1); }
  console.log('\nprincipal:', EMAIL);

  // ---------- §3 team_majors RLS, BOTH directions ----------
  console.log('\nteam_majors RLS');
  const read = await asMember(`array[]::text[]`, `
    select count(*) as seen from public.team_majors;`);
  check('a plain member CAN read the vocabulary (the chooser needs it)',
    Number(find(read, 'seen').seen) >= 3, JSON.stringify(rows(read)));

  const insDeny = await asMember(`array[]::text[]`, `
    insert into public.team_majors (code) values ('ZZ-0113-EVIL');`);
  check('a plain member CANNOT add a สาขา', blocked(insDeny), JSON.stringify(insDeny.body));

  // UPDATE and DELETE are silently FILTERED by RLS, never raised — assert
  // ROW_COUNT. A probe asking "did it throw?" scores a blocked write as allowed.
  const updDeny = await asMember(`array[]::text[]`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare rc int; begin
      update public.team_majors set code = 'ZZ' where code = 'MD';
      get diagnostics rc = ROW_COUNT;
      insert into out values ('renamed', rc::text);
    exception when others then insert into out values ('renamed','blocked:'||sqlerrm); end $$;
    select k, v from out;`);
  const u0 = find(updDeny, 'k');
  check('a plain member CANNOT rename a สาขา (0 rows, not an error)',
    u0.v === '0' || String(u0.v).startsWith('blocked:'), JSON.stringify(rows(updDeny)));

  const delDeny = await asMember(`array[]::text[]`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare rc int; begin
      delete from public.team_majors where code = 'MD';
      get diagnostics rc = ROW_COUNT;
      insert into out values ('deleted', rc::text);
    exception when others then insert into out values ('deleted','blocked:'||sqlerrm); end $$;
    select k, v from out;`);
  const dl = find(delDeny, 'k');
  check('a plain member CANNOT remove a สาขา',
    dl.v === '0' || String(dl.v).startsWith('blocked:'), JSON.stringify(rows(delDeny)));

  // THE ALLOW TWIN. Without this, all four checks above would still "pass" if
  // the table were simply unwritable by everyone.
  const insAllow = await asMember(`array['team_edit']`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare rc int; begin
      insert into public.team_majors (code, label) values ('ZZ-0113-OK','ทดสอบ');
      get diagnostics rc = ROW_COUNT;
      insert into out values ('added', rc::text);
    exception when others then insert into out values ('added','blocked:'||sqlerrm); end $$;
    select k, v from out;`);
  check('a `team_edit` member CAN add a สาขา', find(insAllow, 'k').v === '1',
    JSON.stringify(rows(insAllow)));

  const renameAllow = await asMember(`array['team_edit']`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare rc int; begin
      update public.team_majors set code = 'ZZRT' where code = 'RT';
      get diagnostics rc = ROW_COUNT;
      insert into out values ('renamed', rc::text);
    exception when others then insert into out values ('renamed','blocked:'||sqlerrm); end $$;
    select k, v from out;`);
  check('a `team_edit` member CAN rename a สาขา', find(renameAllow, 'k').v === '1',
    JSON.stringify(rows(renameAllow)));

  // Removing reference data must not touch the people who carry it. This is the
  // reason major is plain TEXT with no FK — the "adding a DELETE to reference
  // data" class in docs/mistakes/authz-rls.md.
  const orphan = await asMember(`array['team_edit']`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare n int; begin
      delete from public.team_majors where code = 'MD';
      select count(*) into n from public.team_members where major = 'MD';
      insert into out values ('members_still_MD', n::text);
    exception when others then insert into out values ('members_still_MD','err:'||sqlerrm); end $$;
    select k, v from out;`);
  check('removing MD from the list leaves every member row untouched',
    Number(find(orphan, 'k').v) > 300, JSON.stringify(rows(orphan)));

  // ---------- §4 anon sees nothing it should not ----------
  console.log('\nANON (over real HTTPS)');
  const anonMajors = await fetch(`${URL_}/rest/v1/team_majors?select=*`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const anonBody = await anonMajors.json().catch(() => null);
  check('anon reads 0 rows from team_majors (read is authenticated-only)',
    anonMajors.status >= 400 || (Array.isArray(anonBody) && anonBody.length === 0),
    `${anonMajors.status} ${JSON.stringify(anonBody).slice(0, 160)}`);

  // ---------- §5 the card payload ----------
  console.log('\nget_my_team_seat PAYLOAD');
  const seat = await asMember(`array[]::text[]`, `select public.get_my_team_seat() as seat;`);
  const payload = find(seat, 'seat').seat || {};
  const p0 = (payload.postings || [])[0] || {};
  check('no posting carries a prefix key any more', !('prefix' in p0), JSON.stringify(p0).slice(0, 200));
  check('payload still carries the fields the card renders',
    'student_id' in p0 && 'year' in p0 && 'major' in p0 && 'photo_url' in p0 && 'path' in p0,
    JSON.stringify(p0).slice(0, 200));
  // term_year is what files a self-uploaded portrait into Team/<ปี>/<ฝ่าย>/.
  // Without it the public card would have to read team_terms directly, or guess.
  check('payload carries term_year for the photo upload folder',
    'term_year' in payload && Number(payload.term_year) > 2500,
    `term_year=${payload.term_year}`);
  check('path is ANCESTORS ONLY — the card appends the ตำแหน่ง itself',
    Array.isArray(p0.path) && !p0.path.includes(p0.node), JSON.stringify(p0.path));

  // ---------- §6 the self-update guard still allows exactly the right columns ----------
  console.log('\nSELF-EDIT COLUMN SCOPE (0113 rewrote the allow-list)');
  const selfOk = await asMember(`array[]::text[]`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare rc int; begin
      update public.team_members
         set full_name = 'ZZ ชื่อใหม่', nickname = 'ใหม่', student_id = '123456789-0',
             year = '5', major = 'MD', photo_url = 'https://lh3.googleusercontent.com/d/zz=w1200',
             photo_focus = 'center'
       where lower(coalesce(kkumail,'')) = lower(${lit(EMAIL)});
      get diagnostics rc = ROW_COUNT;
      insert into out values ('own', rc::text);
    exception when others then insert into out values ('own','blocked:'||sqlerrm); end $$;
    select k, v from out;`);
  check('a member CAN still write name / nickname / รหัส / ชั้นปี / สาขา / photo',
    find(selfOk, 'k').v === '1', JSON.stringify(rows(selfOk)));

  const escalate = await asMember(`array[]::text[]`, `
    update public.team_members set permissions = array['team_edit']
     where lower(coalesce(kkumail,'')) = lower(${lit(EMAIL)});`);
  check('…and STILL cannot grant themselves team_edit', blocked(escalate),
    JSON.stringify(escalate.body).slice(0, 200));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
