// 0110 proof: ทีม SAMO `team` (view) vs `team_edit` (write), and a member's
// right to fix their OWN row without gaining any power over anyone else's.
//
// Everything runs inside ONE rolled-back transaction per probe. Note the split
// between RAISE and ROW_COUNT assertions: RLS does NOT raise on UPDATE/DELETE —
// a row the policy hides is simply not visible, so the statement succeeds
// having touched nothing. A probe that asks "did it throw?" would score a
// fully-blocked update as PERMITTED (logged in docs/mistakes/tooling-proofs.md).
// INSERT and the column guard's explicit `raise` are the two that fail loudly.
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

/** Seed a REAL binding (node + member row carrying `perms`) for the test user,
 *  sync it into managed_permissions, then run `sql` as that authenticated user.
 *  Seeding the binding rather than poking users.managed_permissions is
 *  load-bearing: any write to the team tables fires the statement-level
 *  recompute trigger, which rebuilds managed_permissions from the tree and
 *  would wipe a grant with nothing behind it. */
const asMember = (perms, sql) => mgmt(`
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(UID)}, 'role','authenticated')::text, true);
  with n as (
    insert into public.team_nodes (name, kind, permissions)
    values ('ZZ-0110-NODE', 'role', ${perms}) returning id
  )
  insert into public.team_members (node_id, full_name, nickname, kkumail)
  select n.id, 'ZZ-0110-ME', 'ชื่อเล่นเดิม', ${lit(EMAIL)} from n;
  select public.sync_my_team_permissions();
  set local role authenticated;
  ${sql}
  reset role;
  rollback;`);

async function main() {
  console.log('project', REF, '\n');

  // ---------- ACLs: assert from the catalog, never from the migration text ----------
  console.log('ACL');
  const acl = await mgmt(`
    select proname, coalesce(proacl::text,'(default)') as acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public'
       and proname in ('team_members_self_update_guard','current_user_email',
                       'get_my_team_seat','effective_team_permissions_for_email')
     order by proname;`);
  const aclOf = (n) => (rows(acl).find((x) => x.proname === n) || {}).acl || '';
  check('team_members_self_update_guard is not callable by anon/authenticated',
    !/anon=X|authenticated=X/.test(aclOf('team_members_self_update_guard')), aclOf('team_members_self_update_guard'));
  check('current_user_email is not callable by anon',
    !/anon=X/.test(aclOf('current_user_email')), aclOf('current_user_email'));
  check('effective_team_permissions_for_email is not callable by anon/authenticated',
    !/anon=X|authenticated=X/.test(aclOf('effective_team_permissions_for_email')),
    aclOf('effective_team_permissions_for_email'));
  check('get_my_team_seat IS callable by authenticated, not anon',
    /authenticated=X/.test(aclOf('get_my_team_seat')) && !/anon=X/.test(aclOf('get_my_team_seat')),
    aclOf('get_my_team_seat'));

  // ---------- the data migration ----------
  console.log('\nMIGRATION (requirement 3: today\'s `team` holders became `team_edit`)');
  const mig = await mgmt(`
    select (select count(*) from public.team_nodes   where 'team' = any(coalesce(permissions,'{}'))) as nodes_team,
           (select count(*) from public.team_members where 'team' = any(coalesce(permissions,'{}'))) as members_team,
           (select count(*) from public.team_nodes   where 'team_edit' = any(coalesce(permissions,'{}'))) as nodes_edit,
           (select count(*) from public.team_members where 'team_edit' = any(coalesce(permissions,'{}'))) as members_edit;`);
  const m0 = find(mig, 'nodes_team');
  check('no `team` (view) grant is left stored in the tree',
    Number(m0.nodes_team) === 0 && Number(m0.members_team) === 0, JSON.stringify(m0));
  check('the 4 nodes + 2 members that held `team` now hold `team_edit`',
    Number(m0.nodes_edit) === 4 && Number(m0.members_edit) === 2, JSON.stringify(m0));

  // ---------- pick a plain user ----------
  const who = (await mgmt(`select id, email from public.users
     where coalesce(role,'user')='user' and email is not null and btrim(email) <> ''
       and email not in (select lower(btrim(kkumail)) from public.team_members where kkumail like '%@%')
     order by id limit 1`)).body?.[0];
  UID = who?.id; EMAIL = who?.email;
  if (!UID || !EMAIL) { console.log('no plain user outside the tree'); process.exit(1); }
  console.log('\nprincipal:', EMAIL);

  // ---------- the login path ----------
  // REGRESSION GUARD. sync_my_team_permissions() runs on every login and
  // UPDATEs team_members.user_id — a guarded column, from a definer function,
  // with a real auth.uid(). The first cut of the 0110 guard raised here and
  // would have locked out every member without `team_edit`. Keep this check
  // first: if it fails, nothing below it means anything, because the harness
  // itself calls sync.
  console.log('\nLOGIN PATH');
  const login = await asMember(`array[]::text[]`, `select 1 as ok;`);
  check('sync_my_team_permissions() succeeds for a plain member (login works)',
    login.status < 400, JSON.stringify(login.body).slice(0, 220));

  // ---------- requirement 1: membership alone grants VIEW ----------
  console.log('\nVIEW (requirement 1: a posting in the tree is the view grant)');
  const view = await asMember(`array[]::text[]`, `
    select public.current_user_has_permission('team')      as has_team,
           public.current_user_has_permission('team_edit') as has_edit,
           (select count(*) from public.team_members)      as members_seen,
           (select count(*) from public.team_nodes)        as nodes_seen;`);
  const v = find(view, 'has_team');
  check('a member with NO granted permission still resolves `team`', v.has_team === true, JSON.stringify(v));
  check('…and does NOT resolve `team_edit`', v.has_edit === false, JSON.stringify(v));
  check('…and can read the whole tree (all members)', Number(v.members_seen) > 300, JSON.stringify(v));
  check('…and can read every ตำแหน่ง', Number(v.nodes_seen) > 200, JSON.stringify(v));

  // ---------- view-only must not write ----------
  console.log('\nVIEW-ONLY CANNOT WRITE');
  const insNode = await asMember(`array[]::text[]`, `
    insert into public.team_nodes (name, kind) values ('ZZ-0110-EVIL','role');`);
  check('view-only cannot CREATE a ตำแหน่ง', blocked(insNode), JSON.stringify(insNode.body));

  // UPDATE is silently filtered, never raised — assert ROW_COUNT.
  const updOther = await asMember(`array[]::text[]`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare rc int; begin
      update public.team_members set nickname = 'HACKED'
       where lower(coalesce(kkumail,'')) <> lower(${lit(EMAIL)}) and full_name is not null;
      get diagnostics rc = ROW_COUNT;
      insert into out values ('other_rows', rc::text);
    exception when others then insert into out values ('other_rows','blocked:'||sqlerrm); end $$;
    select k, v from out;`);
  const uo = find(updOther, 'k');
  check("view-only cannot edit ANYONE ELSE's row (0 rows, not an error)",
    uo.v === '0' || String(uo.v).startsWith('blocked:'), JSON.stringify(rows(updOther)));

  const delNode = await asMember(`array[]::text[]`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare rc int; begin
      delete from public.team_nodes where name = 'ZZ-0110-NODE';
      get diagnostics rc = ROW_COUNT;
      insert into out values ('deleted', rc::text);
    exception when others then insert into out values ('deleted','blocked:'||sqlerrm); end $$;
    select k, v from out;`);
  const dn = find(delNode, 'k');
  check('view-only cannot DELETE a ตำแหน่ง',
    dn.v === '0' || String(dn.v).startsWith('blocked:'), JSON.stringify(rows(delNode)));

  // ---------- self-edit: the allowed half ----------
  console.log('\nSELF-EDIT (own row only, safe columns only)');
  const selfOk = await asMember(`array[]::text[]`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare rc int; begin
      update public.team_members
         set nickname = 'ชื่อเล่นใหม่', student_id = '123456789-0', year = '5', major = 'MD'
       where lower(coalesce(kkumail,'')) = lower(${lit(EMAIL)});
      get diagnostics rc = ROW_COUNT;
      insert into out values ('own_rows', rc::text);
    exception when others then insert into out values ('own_rows','blocked:'||sqlerrm); end $$;
    select k, v from out;`);
  const so = find(selfOk, 'k');
  check('a member CAN correct their own ชื่อเล่น / รหัส / ชั้นปี / สาขา',
    so.v === '1', JSON.stringify(rows(selfOk)));

  // ---------- self-edit: every escalation the guard must refuse ----------
  console.log('\nSELF-EDIT CANNOT ESCALATE (the class found on users/vs_tickets/shop_orders)');
  const attacks = [
    ['self-grant `team_edit` on own row', `permissions = array['team_edit']`],
    ['self-grant any permission at all', `permissions = array['pr','samoshop']`],
    ['self-assign a VitalSound dept', `vs_dept = 'อุปนายกฝ่ายวิชาการ'`],
    ['self-assign a หนังสือโครงการ seat', `project_seat = 'vpa'`],
    ['self-assign a SAMO Passport scope', `passport_dept_id = 1`],
    ['move own posting to another ตำแหน่ง', `node_id = (select id from public.team_nodes where name <> 'ZZ-0110-NODE' order by id limit 1)`],
    ['change own kkumail (the identity)', `kkumail = 'someone.else@kkumail.com'`],
    ['flip inherit_permissions', `inherit_permissions = false`],
    ['self-confirm the posting', `confirmed = true`],
  ];
  for (const [name, setExpr] of attacks) {
    const r = await asMember(`array[]::text[]`, `
      update public.team_members set ${setExpr}
       where lower(coalesce(kkumail,'')) = lower(${lit(EMAIL)});`);
    check(`refused: ${name}`, blocked(r), JSON.stringify(r.body).slice(0, 180));
  }

  // ---------- team_edit: the write half, incl. requirement 4 ----------
  console.log('\nEDIT (`team_edit` writes the tree AND grants permissions)');
  const edit = await asMember(`array['team_edit']`, `
    insert into public.team_nodes (name, kind) values ('ZZ-0110-OK','role');
    select public.current_user_has_permission('team_edit') as has_edit,
           public.current_user_has_permission('team')      as has_team,
           (select count(*) from public.team_nodes where name='ZZ-0110-OK') as wrote;`);
  const e = find(edit, 'wrote');
  check('`team_edit` CAN create a ตำแหน่ง', Number(e.wrote) === 1, JSON.stringify(edit.body));
  check('`team_edit` holder also reads (implicit `team` from their own posting)',
    e.has_team === true, JSON.stringify(e));

  const grant = await asMember(`array['team_edit']`, `
    insert into public.team_nodes (name, kind, permissions)
    values ('ZZ-0110-GRANTED','role', array['pr','creator','team_edit']);
    select (select permissions::text from public.team_nodes where name='ZZ-0110-GRANTED') as perms;`);
  check('requirement 4: `team_edit` can grant permissions, including `team_edit`',
    /team_edit/.test(find(grant, 'perms').perms || ''), JSON.stringify(grant.body));

  const editOther = await asMember(`array['team_edit']`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare rc int; begin
      update public.team_members set nickname = 'ADMIN EDIT'
       where lower(coalesce(kkumail,'')) <> lower(${lit(EMAIL)}) and full_name is not null;
      get diagnostics rc = ROW_COUNT;
      insert into out values ('rows', rc::text);
    exception when others then insert into out values ('rows','blocked:'||sqlerrm); end $$;
    select k, v from out;`);
  check('`team_edit` CAN edit other people (that is the job)',
    Number(find(editOther, 'k').v) > 0, JSON.stringify(rows(editOther)));

  // ---------- the OTHER team tables (§8) ----------
  // These were missed by the first cut of 0110 and became writable by every
  // member the moment `team` was demoted to a view rung. Asserted here so the
  // enumeration is a test, not a memory.
  console.log('\nTHE OTHER TEAM TABLES (archive / people / terms)');
  for (const t of ['team_terms', 'team_people', 'team_archive_nodes', 'team_archive_members']) {
    const r = await asMember(`array[]::text[]`, `
      create temp table out(k text, v text) on commit drop;
      do $$ declare rc int; begin
        insert into out select 'read', (count(*) >= 0)::text from public.${t};
      exception when others then insert into out values ('read','blocked:'||sqlerrm); end $$;
      select k, v from out;`);
    check(`view-only CAN read ${t}`, find(r, 'k').v === 'true', JSON.stringify(rows(r)));
  }
  const wTerms = await asMember(`array[]::text[]`, `
    insert into public.team_terms (year, label) values (2999, 'ZZ-0110');`);
  check('view-only CANNOT write team_terms', blocked(wTerms), JSON.stringify(wTerms.body).slice(0, 160));
  const wPeople = await asMember(`array[]::text[]`, `
    insert into public.team_people (full_name) values ('ZZ-0110-PERSON');`);
  check('view-only CANNOT write team_people', blocked(wPeople), JSON.stringify(wPeople.body).slice(0, 160));
  const pub = await asMember(`array[]::text[]`, `select public.publish_team_term(2999);`);
  check('view-only CANNOT publish an academic year', blocked(pub), JSON.stringify(pub.body).slice(0, 160));

  // ---------- outsiders ----------
  console.log('\nOUTSIDERS');
  const outsider = await mgmt(`
    select set_config('request.jwt.claims',
      json_build_object('sub', ${lit(UID)}, 'role','authenticated')::text, true);
    set local role authenticated;
    select (select count(*) from public.team_members) as members_seen,
           public.current_user_has_permission('team') as has_team;
    reset role;
    rollback;`);
  const os = find(outsider, 'members_seen');
  check('a signed-in user with NO posting reads 0 member rows',
    Number(os.members_seen) === 0 && os.has_team === false, JSON.stringify(os));

  // Over real HTTPS with the shipped anon key — not a simulated role.
  const anonRead = await fetch(`${URL_}/rest/v1/team_members?select=id,kkumail,student_id&limit=5`,
    { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  const anonBody = await anonRead.json().catch(() => null);
  check('anon reads 0 team_members over real HTTPS (public chart is a projection)',
    anonRead.status >= 400 || (Array.isArray(anonBody) && anonBody.length === 0),
    `${anonRead.status} ${JSON.stringify(anonBody).slice(0, 160)}`);

  const anonSeat = await fetch(`${URL_}/rest/v1/rpc/get_my_team_seat`,
    { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }, body: '{}' });
  check('anon cannot call get_my_team_seat over real HTTPS', anonSeat.status >= 400, `HTTP ${anonSeat.status}`);

  // ---------- the seat payload ----------
  console.log('\nget_my_team_seat PAYLOAD');
  const seat = await asMember(`array[]::text[]`, `select public.get_my_team_seat() as seat;`);
  const payload = find(seat, 'seat').seat || {};
  const p0 = (payload.postings || [])[0] || {};
  check('payload carries the caller\'s own details for the card',
    p0.member_id && 'student_id' in p0 && 'photo_url' in p0 && 'nickname' in p0, JSON.stringify(p0).slice(0, 200));
  check('payload reports can_view_team=true / can_edit_team=false for a plain member',
    payload.can_view_team === true && payload.can_edit_team === false,
    `view=${payload.can_view_team} edit=${payload.can_edit_team}`);
  // The card renders this payload; it must not become a roster of other people.
  const blob = JSON.stringify(payload);
  const others = (await mgmt(`select kkumail from public.team_members
     where kkumail like '%@%.%' and lower(kkumail) <> lower(${lit(EMAIL)}) limit 40`)).body || [];
  check('payload leaks nobody else\'s kkumail',
    !others.some((r) => r.kkumail && blob.includes(r.kkumail)), 'found a foreign address');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
