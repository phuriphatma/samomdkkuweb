// 0093 proof: SAMO Shop per-แหล่งที่มา scope from the ทีม SAMO tree, plus the
// three read policies that only knew about roles.
//
// Tests the OPERATION, not the predicate (the 0090 lesson) — every write check
// performs the real INSERT/UPDATE inside a rolled-back transaction.
//
//   A  shop scope resolves, and a scoped grant is NOT a full grant
//   B  product writes are confined to the granted แหล่งที่มา
//   C  a `creator` grantee can READ the drafts they can write (announcements)
//   D  a VS-scoped grantee can read followers + staff comments
//   E  analytics is readable by any grant holder, not just staff roles
//   F  current_user_is_staff() was NOT widened (it guards role escalation)
//
// Usage: node tools/shop0093-scope.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, String(e).slice(0, 220)); } };

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rows = (r) => (Array.isArray(r.body) ? r.body.flat().filter((x) => x && typeof x === 'object') : []);
const val = (r, k) => rows(r).map((x) => x[k]).find((v) => v !== undefined);
const errText = (r) => (r.body && r.body.message) ? r.body.message : JSON.stringify(r.body).slice(0, 220);
const denied = (r) => /row-level security|42501|permission denied/i.test(errText(r));

const U = 'phuriphat.ma@kkumail.com';   // a role='user' account in the tree

/** Run as U with a staged grant; RLS applies (`set local role authenticated`). */
const asGrant = (sql, { perms = `'{}'::text[]`, shop = `'{}'::text[]`, vs = `'{}'::text[]`,
                        seats = `'{}'::text[]`, passport = `'{}'::text[]` } = {}) => mgmt(`
begin;
select set_config('app.team_sync','1',true);
-- Clear EVERY grant column, not just the one under test: this account really
-- holds a project seat and a passport scope, so a partial reset would leave
-- "no grant" fixtures still granted (which is exactly how the first run of
-- this script reported a false failure).
update public.users set managed_permissions = ${perms},
                        managed_shop_sources = ${shop},
                        managed_vs_depts = ${vs},
                        managed_project_seats = ${seats},
                        managed_passport_scopes = ${passport}
 where email = '${U}';
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.users where email = '${U}'),
                    'role','authenticated')::text, true);
set local role authenticated;
${sql}
rollback;`);

async function main() {
  console.log('project', REF, '\n');

  // ---- A. scope resolution ----
  console.log('A) scope resolves, and scoped is not full');
  const full = await asGrant(`select public.current_user_shop_scope() as s,
                                     public.current_user_is_shop_admin() as admin;`,
    { perms: `array['samoshop']` });
  check('blanket samoshop → scope NULL (every source) + is admin',
    val(full, 's') === null && val(full, 'admin') === true, JSON.stringify(rows(full)[0]));

  const scoped = await asGrant(`select public.current_user_shop_scope() as s,
                                       public.current_user_is_shop_admin() as admin;`,
    { shop: `array['mdi']` });
  check('mdi scope → scope {mdi}, still a shop admin',
    JSON.stringify(val(scoped, 's')) === '["mdi"]' && val(scoped, 'admin') === true,
    JSON.stringify(rows(scoped)[0]));

  const none = await asGrant(`select public.current_user_shop_scope() as s,
                                     public.current_user_is_shop_admin() as admin;`);
  check('no grant → scope {} and NOT a shop admin (fails closed)',
    JSON.stringify(val(none, 's')) === '[]' && val(none, 'admin') === false,
    JSON.stringify(rows(none)[0]));

  // ---- B. product writes confined to the granted source ----
  console.log('\nB) product writes are confined to the granted แหล่งที่มา');
  // id/name/type/source/price are NOT NULL with no default.
  const ins = (src) => `
    insert into public.shop_products (id, name, type, source, price, is_active)
    values ('TEST-' || substr(md5(random()::text),1,8), 'scope test', 'apparel-shirt', '${src}', 1, false)
    returning id;`;

  const mdiOwn = await asGrant(ins('mdi'), { shop: `array['mdi']` });
  check('mdi grant CAN create an mdi product', mdiOwn.status === 201 && !denied(mdiOwn), errText(mdiOwn));

  const mdiOther = await asGrant(ins('md'), { shop: `array['mdi']` });
  check('mdi grant CANNOT create an md product', denied(mdiOther), errText(mdiOther));

  const fullAny = await asGrant(ins('md'), { perms: `array['samoshop']` });
  check('blanket grant CAN create in any source', fullAny.status === 201 && !denied(fullAny), errText(fullAny));

  const noneIns = await asGrant(ins('md'));
  check('no grant CANNOT create a product', denied(noneIns), errText(noneIns));

  const upd = await asGrant(
    `update public.shop_products set name = name where source = 'md' returning id;`,
    { shop: `array['mdi']` });
  check('mdi grant CANNOT update an md product (0 rows touched)',
    !rows(upd).some((x) => x.id !== undefined), errText(upd));

  // ---- C. announcements: write it, then be able to read it ----
  console.log('\nC) a creator grantee can read the drafts they can write');
  const draft = await asGrant(`
    insert into public.announcements (title, content, department, status)
    values ('scope test', 'x', 'ทดสอบ', 'draft') returning id;
    select count(*)::int as n from public.announcements where status <> 'approved';`,
    { perms: `array['creator']` });
  check('creator can INSERT a non-approved announcement',
    draft.status === 201 && !denied(draft), errText(draft));
  check('creator can then SEE it (this was the bug — write-only)',
    Number(val(draft, 'n')) > 0, errText(draft));

  const outsider = await asGrant(
    `select count(*)::int as n from public.announcements where status <> 'approved';`);
  check('someone with NO grant still sees only approved',
    Number(val(outsider, 'n')) === 0, errText(outsider));

  // ---- D. VS scoped reads ----
  console.log('\nD) a VS-scoped grantee can read followers + staff comments');
  const vs = await asGrant(`select public.current_user_is_vs_handler() as h;`,
    { vs: `array['อุปนายกฝ่ายวิชาการ']` });
  check('vs dept scope → is a VS handler', val(vs, 'h') === true, JSON.stringify(rows(vs)[0]));
  for (const t of ['vs_followers', 'vs_public_comments']) {
    const r = await mgmt(`select qual from pg_policies
      where schemaname='public' and tablename='${t}' and policyname='${t}_read_staff';`);
    check(`${t} read policy goes through current_user_is_vs_handler()`,
      /current_user_is_vs_handler/.test(String(val(r, 'qual') || '')), String(val(r, 'qual')));
  }

  // ---- E. analytics ----
  console.log('\nE) analytics readable by any grant holder');
  const anal = await asGrant(`select public.current_user_has_any_grant() as g;`,
    { shop: `array['mdi']` });
  check('a shop-scoped grantee counts as an admin-app user', val(anal, 'g') === true, JSON.stringify(rows(anal)[0]));
  const analNone = await asGrant(`select public.current_user_has_any_grant() as g;`);
  check('a plain user does not', val(analNone, 'g') === false, JSON.stringify(rows(analNone)[0]));

  // ---- F. the escalation guard must NOT have been widened ----
  console.log('\nF) current_user_is_staff() stays a role list (guards role escalation)');
  const staff = await asGrant(`select public.current_user_is_staff() as s;`,
    { perms: `array['creator','samoshop']`, shop: `array['mdi']` });
  check('a fully tree-granted account is still NOT "staff"', val(staff, 's') === false,
    JSON.stringify(rows(staff)[0]));
  const esc = await asGrant(
    `update public.users set role = 'dev' where email = '${U}' returning id;`,
    { perms: `array['creator','samoshop','team']` });
  check('…so it cannot self-promote to dev', denied(esc) || /users_self_update_guard/.test(errText(esc)),
    errText(esc));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
