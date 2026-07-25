// 0089 proof: the `team` permission grants ทีม SAMO management, and nothing
// less does. Reported live — a tree-granted `team` holder could not write to
// team_nodes/team_members at all (0046 gated on role only), so from that
// account no permission could be handed out either.
//
// The grant is seeded the REAL way: a node carrying the permissions plus a
// member row matching the user's email, then sync_my_team_permissions().
// Poking users.managed_permissions directly does NOT survive here — any write
// to team_nodes fires the statement-level recompute trigger, which rebuilds
// managed_permissions from the tree and wipes a grant with no binding behind
// it. Seeding the binding is both correct and a truer end-to-end test.
//
// Self-provisioning; every check runs in one rolled-back transaction.
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const PAT = env.SUPABASE_ACCESS_TOKEN;
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];
let pass = 0; let fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, String(e).slice(0, 200)); } };
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rowsOf = (r) => (Array.isArray(r.body) ? r.body.flat().filter((x) => x && typeof x === 'object') : []);

let UID; let EMAIL;

const asTreeGrant = (perms, sql) => mgmt(`
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(UID)}, 'role','authenticated')::text, true);
  with n as (
    insert into public.team_nodes (name, kind, permissions)
    values ('ZZ-0089-GRANTOR', 'role', ${perms}) returning id
  )
  insert into public.team_members (node_id, full_name, kkumail)
  select n.id, 'ZZ-0089-GRANTEE', ${lit(EMAIL)} from n;
  select public.sync_my_team_permissions();
  set local role authenticated;
  ${sql}
  reset role;
  rollback;`);

async function main() {
  console.log('project', REF);
  const who = (await mgmt(`select id, email from public.users
     where coalesce(role,'user')='user' and email is not null order by id limit 1`)).body?.[0];
  UID = who?.id; EMAIL = who?.email;
  if (!UID || !EMAIL) { console.log('no plain user with an email'); process.exit(1); }
  console.log('grantee:', EMAIL);

  const write = `
    insert into public.team_nodes (name, kind) values ('ZZ-0089-NEW','role');
    select (select count(*) from public.team_nodes where name='ZZ-0089-NEW') as wrote,
           public.current_user_has_permission('team') as has_team;`;

  const withTeam = await asTreeGrant(`array['team']`, write);
  const w = rowsOf(withTeam).find((x) => 'wrote' in x) || {};
  check('role=user granted `team` via the tree CAN create a team node',
    Number(w.wrote) === 1 && w.has_team === true, JSON.stringify(withTeam.body));

  const without = await asTreeGrant(`array['pr','creator']`, write);
  check('other permissions alone CANNOT write the tree',
    without.status >= 400 && /policy|denied/i.test(JSON.stringify(without.body)),
    JSON.stringify(without.body));

  const members = await asTreeGrant(`array['team']`, `
    insert into public.team_members (node_id, full_name)
    values ((select id from public.team_nodes order by id limit 1), 'ZZ-0089-PERSON');
    select (select count(*) from public.team_members where full_name='ZZ-0089-PERSON') as wrote,
           public.current_user_has_permission('team') as has_team;`);
  const m = rowsOf(members).find((x) => 'wrote' in x) || {};
  check('`team` also covers team_members', Number(m.wrote) === 1, JSON.stringify(members.body));

  const anon = await mgmt(`
    set local role anon;
    select set_config('request.jwt.claims','',true);
    insert into public.team_nodes (name, kind) values ('ZZ-0089-ANON','role');
    reset role; rollback;`);
  check('anon still cannot write the tree', anon.status >= 400, JSON.stringify(anon.body));

  const clean = (await mgmt(`select
    (select count(*) from public.team_nodes where name like 'ZZ-0089%') a,
    (select count(*) from public.team_members where full_name like 'ZZ-0089%') b,
    (select count(*) from public.users where id = ${lit(UID)} and managed_permissions <> '{}') c`)).body?.[0];
  check('rollback left nothing behind',
    Number(clean?.a) === 0 && Number(clean?.b) === 0 && Number(clean?.c) === 0, JSON.stringify(clean));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
