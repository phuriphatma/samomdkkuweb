// 0111 proof: `master` carries every permission — and does NOT carry a role.
//
// The second half is the point. "Access everything" is easy to claim and hard
// to bound, so this asserts BOTH directions: every feature gate opens, and the
// three role-only surfaces stay shut, in particular that a master cannot
// promote themselves to role='dev' (which would be a permanent escalation the
// tree could no longer revoke).
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const PAT = env.SUPABASE_ACCESS_TOKEN;
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

let pass = 0; let fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, String(e).slice(0, 260)); }
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
const find = (r, k) => rows(r).find((x) => k in x) || {};
const blocked = (r) => r.status >= 400 || /policy|denied|permission|guard/i.test(JSON.stringify(r.body));

let UID; let EMAIL;

/** Seed the grant the REAL way — a node carrying `perms` plus a member row for
 *  the probe account — then sync, then run `sql` as that authenticated user. */
const asMaster = (perms, sql) => mgmt(`
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(UID)}, 'role','authenticated')::text, true);
  with n as (
    insert into public.team_nodes (name, kind, permissions)
    values ('ZZ-0111-NODE', 'role', ${perms}) returning id
  )
  insert into public.team_members (node_id, full_name, kkumail)
  select n.id, 'ZZ-0111-ME', ${lit(EMAIL)} from n;
  select public.sync_my_team_permissions();
  set local role authenticated;
  ${sql}
  reset role;
  rollback;`);

async function main() {
  console.log('project', REF, '\n');
  const who = (await mgmt(`select id, email from public.users
     where coalesce(role,'user')='user' and email is not null and btrim(email) <> ''
       and email not in (select lower(btrim(kkumail)) from public.team_members where kkumail like '%@%')
     order by id limit 1`)).body?.[0];
  UID = who?.id; EMAIL = who?.email;
  if (!UID || !EMAIL) { console.log('no plain user outside the tree'); process.exit(1); }
  console.log('principal:', EMAIL, '(role=user, no manual permissions)\n');

  // ---------- every permission gate answers yes ----------
  console.log('EVERY PERMISSION');
  const keys = ['pr', 'vs', 'samoshop', 'projects', 'creator', 'team', 'team_edit', 'passport', 'master'];
  const permSel = keys.map((k) => `public.current_user_has_permission(${lit(k)}) as "${k}"`).join(',\n           ');
  const perms = await asMaster(`array['master']`, `select ${permSel};`);
  const p = find(perms, 'pr');
  for (const k of keys) check(`master holds \`${k}\``, p[k] === true, JSON.stringify(p));

  // ---------- the scope helpers, which are where a flat key usually fails ----------
  console.log('\nSCOPES (a flat permission key is not a scope — 0083/0086)');
  const scopes = await asMaster(`array['master']`, `
    select public.current_user_vs_scope() is null            as vs_all_depts,
           public.current_user_project_seats()               as seats,
           (public.passport_admin_context()->>'all_departments')::boolean as passport_all,
           public.current_user_is_shop_admin()               as shop_admin,
           public.current_user_has_any_grant()               as any_grant,
           public.current_user_is_project_actor()            as proj_actor;`);
  const s = find(scopes, 'seats');
  check('VitalSound scope is NULL = every department', s.vs_all_depts === true, JSON.stringify(s));
  check('holds all three หนังสือโครงการ seats', String(s.seats || '').includes('vpa')
    && String(s.seats).includes('staff') && String(s.seats).includes('prof'), JSON.stringify(s.seats));
  check('…and is therefore a project actor', s.proj_actor === true, JSON.stringify(s));
  check('SAMO Passport covers all departments', s.passport_all === true, JSON.stringify(s));
  check('is a shop admin', s.shop_admin === true, JSON.stringify(s));
  check('counts as holding a grant (analytics)', s.any_grant === true, JSON.stringify(s));

  // ---------- real writes, not just predicates ----------
  // "A predicate test is not a permission test" — the helper can answer true
  // while the policy that was supposed to call it never does (0090).
  console.log('\nREAL WRITES (the operation, not the predicate)');
  const writes = [
    ['create a ตำแหน่ง', `insert into public.team_nodes (name, kind) values ('ZZ-0111-W','role');`],
    // year is CHECKed to the Buddhist-era range 2500..2700, and both id
    // columns below are app-generated text codes with no default — these are
    // fixture facts, not authorization. Getting them wrong produced 23514 /
    // 23502 rather than 42501, i.e. the policy had already let the write
    // through; the assertion is still worth making against a VALID row.
    ['create a ปีการศึกษา', `insert into public.team_terms (year, label) values (2699,'ZZ-0111');`],
    ['write the person register', `insert into public.people (full_name) values ('ZZ-0111-P');`],
    ['create a project', `insert into public.projects (id, name) values ('ZZ-0111-PRJ','ZZ-0111');`],
    ['write a VS tag', `insert into public.vs_tags (id, label, dept) values ('zz-0111-tag','ZZ-0111','SE');`],
  ];
  for (const [name, sql] of writes) {
    const r = await asMaster(`array['master']`, sql);
    check(`master CAN ${name}`, r.status < 400, JSON.stringify(r.body).slice(0, 200));
  }

  // ---------- the boundary ----------
  console.log('\nTHE BOUNDARY (master is a permission, NOT a role)');
  const notStaff = await asMaster(`array['master']`, `
    select public.current_user_is_staff() as is_staff,
           public.current_user_role()     as role;`);
  const ns = find(notStaff, 'is_staff');
  check('current_user_is_staff() is still FALSE', ns.is_staff === false, JSON.stringify(ns));
  check('…and the role is untouched', ns.role === 'user', JSON.stringify(ns));

  // The escalation that must not work: users_self_update_guard trusts
  // current_user_is_staff(), so widening it would have made this succeed and
  // the grant permanent + un-revokable from the tree.
  const promote = await asMaster(`array['master']`, `
    update public.users set role = 'dev' where id = ${lit(UID)};`);
  check('master CANNOT promote themselves to role=dev', blocked(promote),
    JSON.stringify(promote.body).slice(0, 200));
  const grantSelf = await asMaster(`array['master']`, `
    update public.users set permissions = array['master'] where id = ${lit(UID)};`);
  check('…nor write users.permissions directly', blocked(grantSelf),
    JSON.stringify(grantSelf.body).slice(0, 200));

  // Documented, accepted closures — asserted so they stay a decision.
  const roleOnly = await asMaster(`array['master']`, `
    create temp table out(k text, v text) on commit drop;
    do $$ declare rc int; begin
      insert into out select 'notify_log', count(*)::text from public.notify_log;
    exception when others then insert into out values ('notify_log','blocked'); end $$;
    select k, v from out;`);
  check('notify_log stays staff-only (documented, accepted)',
    find(roleOnly, 'k').v === '0' || find(roleOnly, 'k').v === 'blocked', JSON.stringify(rows(roleOnly)));

  // ---------- a NON-master is unaffected ----------
  console.log('\nNO SPILLOVER');
  const plain = await asMaster(`array['pr']`, `
    select public.current_user_has_permission('pr')     as has_pr,
           public.current_user_has_permission('master') as has_master,
           public.current_user_has_permission('vs')     as has_vs,
           public.current_user_project_seats()          as seats;`);
  const pl = find(plain, 'has_pr');
  check('a `pr` grantee still holds only pr', pl.has_pr === true && pl.has_vs === false, JSON.stringify(pl));
  check('…does not accidentally hold `master`', pl.has_master === false, JSON.stringify(pl));
  check('…and gets no project seat', String(pl.seats) === '{}' || !String(pl.seats).includes('vpa'),
    JSON.stringify(pl.seats));

  const anon = await mgmt(`
    set local role anon;
    select set_config('request.jwt.claims','',true);
    select public.current_user_has_permission('master') as m;
    reset role; rollback;`);
  check('anon holds nothing (fails closed)', find(anon, 'm').m === false, JSON.stringify(anon.body));

  // ---------- nothing left behind ----------
  const clean = (await mgmt(`select
    (select count(*) from public.team_nodes where name like 'ZZ-0111%') a,
    (select count(*) from public.team_terms where year = 2699) b,
    (select count(*) from public.projects where id like 'ZZ-0111%') c,
    (select count(*) from public.vs_tags where id like 'zz-0111%') e,
    (select role from public.users where id = ${lit(UID)}) d`)).body?.[0];
  check('every probe rolled back',
    Number(clean?.a) === 0 && Number(clean?.b) === 0 && Number(clean?.c) === 0
      && Number(clean?.e) === 0 && clean?.d === 'user',
    JSON.stringify(clean));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
