// 0087 proof: SAMO Passport admin permission granted from the ทีม SAMO tree,
// scoped per department / sub-department (or total).
//
// Asserts the contract passport_admin_context() promises to the passport app:
//   no grant  → is_admin false
//   full      → is_admin, all_departments true
//   dept      → is_admin, all_departments FALSE, departments [id]
//   sub-dept  → is_admin, all_departments FALSE, sub_departments [id]
// Self-provisioning; every check runs in one rolled-back transaction.
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const PAT = env.SUPABASE_ACCESS_TOKEN;
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];
let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, String(e).slice(0, 200)); } };
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rowsOf = (r) => (Array.isArray(r.body) ? r.body.flat().filter((x) => x && typeof x === 'object') : []);
let UID;
const asGrant = (scopes, perms, sql) => mgmt(`
  select set_config('app.team_sync','1',true);
  update public.users set managed_passport_scopes = ${scopes},
                          managed_permissions = ${perms}
   where id = ${lit(UID)};
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(UID)}, 'role','authenticated')::text, true);
  ${sql}
  rollback;`);
const CTX = `select public.passport_admin_context() as ctx;`;

async function main() {
  console.log('project', REF);
  UID = (await mgmt(`select id from public.users where coalesce(role,'user')='user'
     and not ('passport' = any(coalesce(permissions,'{}'))) limit 1`)).body?.[0]?.id;
  if (!UID) { console.log('no plain user available'); process.exit(1); }

  const none = rowsOf(await asGrant(`'{}'::text[]`, `'{}'::text[]`, CTX))[0]?.ctx || {};
  check('no grant → not a passport admin', none.is_admin === false, JSON.stringify(none));

  const full = rowsOf(await asGrant(`'{}'::text[]`, `array['passport']`, CTX))[0]?.ctx || {};
  check('full grant → admin over all departments',
    full.is_admin === true && full.all_departments === true, JSON.stringify(full));

  const dept = rowsOf(await asGrant(`array['d:5']`, `'{}'::text[]`, CTX))[0]?.ctx || {};
  check('dept scope → admin, NOT all departments',
    dept.is_admin === true && dept.all_departments === false, JSON.stringify(dept));
  check('dept scope → resolves to that department id',
    JSON.stringify(dept.departments) === '[5]' && JSON.stringify(dept.sub_departments) === '[]',
    JSON.stringify(dept));

  const sub = rowsOf(await asGrant(`array['s:3']`, `'{}'::text[]`, CTX))[0]?.ctx || {};
  check('sub-department scope → only that sub-department',
    sub.is_admin === true && sub.all_departments === false
    && JSON.stringify(sub.sub_departments) === '[3]' && JSON.stringify(sub.departments) === '[]',
    JSON.stringify(sub));

  const multi = rowsOf(await asGrant(`array['d:5','s:1']`, `'{}'::text[]`, CTX))[0]?.ctx || {};
  check('several scopes accumulate',
    JSON.stringify(multi.departments) === '[5]' && JSON.stringify(multi.sub_departments) === '[1]',
    JSON.stringify(multi));

  // The 0083 invariant: a scoped grant must never also carry the blanket perm.
  const both = rowsOf(await asGrant(`array['d:5']`, `array['passport']`, CTX))[0]?.ctx || {};
  check('a blanket perm still wins if both are set (so the UI must never write both)',
    both.all_departments === true, JSON.stringify(both));

  // anon must not reach the context or the reference list at all.
  const anon = await mgmt(`
    set local role anon;
    select set_config('request.jwt.claims','',true);
    select public.passport_admin_context() as ctx;
    reset role;`);
  check('anon cannot call passport_admin_context', anon.status >= 400,
    JSON.stringify(anon.body));

  // resolver: a tree binding produces the right token.
  const resolver = await mgmt(`
    select public.passport_scope_tokens(5, null)::text as d,
           public.passport_scope_tokens(5, 3)::text    as s,
           public.passport_scope_tokens(null, null)::text as none_;`);
  const rr = resolver.body?.[0] || {};
  check('scope tokens: sub-department wins over department',
    rr.d === '{d:5}' && rr.s === '{s:3}' && rr.none_ === '{}', JSON.stringify(rr));

  const clean = (await mgmt(`select count(*) n from public.users
     where id = ${lit(UID)} and (managed_passport_scopes <> '{}' or 'passport' = any(managed_permissions))`)).body?.[0];
  check('rollback left no synthetic grant', Number(clean?.n) === 0, JSON.stringify(clean));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
