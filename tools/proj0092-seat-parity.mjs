// 0092 proof: a หนังสือโครงการ SEAT must behave like the ROLE it stands for,
// and an EXPLICIT seat must beat an INHERITED one.
//
// Follows the rule the 0089/0090/0091 cycle cost us: test the OPERATION, not the
// predicate. Every write check here performs the real INSERT/UPDATE inside a
// transaction that is always rolled back, so a helper returning `true` while the
// policy never calls it cannot pass.
//
//   A  explicit member seat overrides the inherited node seat
//   B  the `staff` seat can run the signature workflow (sastaff parity)
//   C  the `vpa` seat can save settings (samomdkkuvpa parity)
//   D  a professor can resolve a notify audience (saprof — regressed by 0091)
//
// Usage: node tools/proj0092-seat-parity.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const PAT = env.SUPABASE_ACCESS_TOKEN;
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, String(e).slice(0, 240)); } };

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rows = (r) => (Array.isArray(r.body) ? r.body.flat().filter((x) => x && typeof x === 'object') : []);
const val = (r, k) => rows(r).map((x) => x[k]).find((v) => v !== undefined && v !== null);
const errText = (r) => (r.body && r.body.message) ? r.body.message : JSON.stringify(r.body).slice(0, 240);
const denied = (r) => /row-level security|42501|permission denied/i.test(errText(r));

/** Run `sql` as `email`, under the `authenticated` role so RLS actually applies,
 *  with an optional seat/permission grant staged first. Always rolled back. */
const asUser = (email, sql, { seats = null, perms = null } = {}) => mgmt(`
begin;
${seats || perms ? `select set_config('app.team_sync','1',true);` : ''}
${seats ? `update public.users set managed_project_seats = ${seats} where email = '${email}';` : ''}
${perms ? `update public.users set managed_permissions   = ${perms} where email = '${email}';` : ''}
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.users where email = '${email}'),
                    'role', 'authenticated')::text, true);
set local role authenticated;
${sql}
rollback;`);

const TREE_USER = 'phuriphat.ma@kkumail.com';
const PROF = 'saprof@samomdkku.app';
const STAFF = 'sastaff@samomdkku.app';
// The shared `samomdkkuvpa` account (role=vp_admin) was RETIRED 2026-08-17.
// The vpa subject is now resolved LIVE from whoever actually holds the seat
// (role vp_admin OR the `vpa` project seat), so this proof can never rot the
// way it did when it named the deleted account. Resolved in main().
let VPA = null;

async function main() {
  console.log('project', REF, '\n');

  // ---- A. explicit seat beats inherited ----
  //
  // The INHERITING member is resolved from the tree, never hardcoded. It used to
  // be TREE_USER, and when the org chart was reorganised that person ended up
  // under two ตำแหน่ง that carry no project_seat — so this section failed with
  // `[]` for an entirely CORRECT reason. A proof that cries wolf gets ignored,
  // and then it guards nothing (mistakes.md, tooling-proofs). Sections B–D still
  // use TREE_USER because they STAGE an explicit seat and so do not depend on
  // where anybody sits.
  console.log('A) explicit member seat overrides the inherited ตำแหน่ง seat');
  const pick = await mgmt(`
    select lower(tm.kkumail) as email
      from public.team_members tm
      join public.team_nodes tn on tn.id = tm.node_id
     where tn.project_seat is not null
       and tm.project_seat is null
       and nullif(btrim(coalesce(tm.kkumail, '')), '') is not null
     order by 1 limit 1;`);
  const heir = val(pick, 'email');
  check('baseline: SOMEBODY in the tree inherits a seat from their ตำแหน่ง',
    !!heir, heir || 'no ตำแหน่ง with a project_seat has an un-overridden member');

  if (heir) {
    const inherited = await mgmt(
      `select public.effective_team_project_seats_for_email('${heir}') as s;`);
    check(`baseline: ${heir} inherits a non-empty seat set`,
      Array.isArray(val(inherited, 's')) && val(inherited, 's').length > 0,
      JSON.stringify(val(inherited, 's')));

    const picked = await mgmt(`
begin;
select set_config('app.team_sync','1',true);
update public.team_members set project_seat = 'staff' where lower(kkumail) = '${heir}';
select public.effective_team_project_seats_for_email('${heir}') as s;
rollback;`);
    const got = val(picked, 's') || [];
    check('picking "เจ้าหน้าที่คณะ" resolves to exactly {staff} — not {staff,vpa}',
      JSON.stringify(got) === '["staff"]', JSON.stringify(got));
  }

  // ---- B. staff seat parity with sastaff ----
  console.log('\nB) the `staff` seat can run the signature workflow (sastaff parity)');
  // `id` is a client-supplied text key (no default) — mirror what sign.js sends.
  const insSql = `
    insert into public.project_sign_requests (id, document_id, prof_id, requested_by)
    select 'SR-TEST-' || substr(md5(random()::text), 1, 8), d.id,
           (select id from public.users where email = '${PROF}'),
           (select id from public.users where email = '${TREE_USER}')
      from public.project_documents d limit 1
    returning id;`;
  const staffIns = await asUser(TREE_USER, insSql, { seats: `array['staff']`, perms: `array['projects']` });
  check('staff seat CAN create a sign request', staffIns.status === 201 && !denied(staffIns), errText(staffIns));

  const vpaIns = await asUser(TREE_USER, insSql, { seats: `array['vpa']`, perms: `array['projects']` });
  check('vpa seat CANNOT create a sign request (only คณะ requests a signature)',
    denied(vpaIns), errText(vpaIns));

  const profIns = await asUser(TREE_USER, insSql, { seats: `array['prof']`, perms: `array['projects']` });
  check('prof seat CANNOT create a sign request', denied(profIns), errText(profIns));

  const noSeat = await asUser(TREE_USER, insSql, { seats: `'{}'::text[]`, perms: `array['projects']` });
  check('projects permission with NO seat cannot create a sign request',
    denied(noSeat), errText(noSeat));

  // ---- C. vpa seat parity with samomdkkuvpa ----
  console.log('\nC) the `vpa` seat can save การตั้งค่า (samomdkkuvpa parity)');
  const setSql = `update public.project_settings set uni_staff_label = uni_staff_label where id = 1 returning id;`;
  const vpaSet = await asUser(TREE_USER, setSql, { seats: `array['vpa']`, perms: `array['projects']` });
  check('vpa seat CAN write project_settings',
    vpaSet.status === 201 && rows(vpaSet).some((x) => x.id !== undefined), errText(vpaSet));

  const staffSet = await asUser(TREE_USER, setSql, { seats: `array['staff']`, perms: `array['projects']` });
  check('staff seat canNOT write project_settings (matches uni_staff today)',
    !rows(staffSet).some((x) => x.id !== undefined), errText(staffSet));

  // ---- D. the professor's notify audience ----
  console.log('\nD) a professor can resolve a notify audience (regressed by 0091)');
  // Resolve the vpa subject LIVE — a real project actor who holds the seat.
  VPA = val(await mgmt(`select email from public.users
     where email is not null
       and (role in ('vp_admin','dev') or 'vpa' = any(coalesce(managed_project_seats,'{}')))
     order by email limit 1;`), 'email');
  check('a live vpa-seat holder exists to test with', !!VPA, 'no vp_admin/vpa-seat account found');
  for (const [who, email] of [['saprof (role)', PROF], ['sastaff', STAFF], ['vpa', VPA]]) {
    if (!email) { check(`${who} resolves BOTH audiences`, false, 'subject email is null'); continue; }
    const s = await asUser(email, `select count(*)::int as n from public.list_project_seat_users('staff');`);
    const v = await asUser(email, `select count(*)::int as n from public.list_project_seat_users('vpa');`);
    check(`${who} resolves BOTH audiences (staff=${val(s, 'n')}, vpa=${val(v, 'n')})`,
      Number(val(s, 'n')) > 0 && Number(val(v, 'n')) > 0);
  }
  const profSeat = await asUser(TREE_USER,
    `select count(*)::int as n from public.list_project_seat_users('vpa');`,
    { seats: `array['prof']`, perms: `array['projects']` });
  check('a tree-granted prof seat resolves the vpa audience too', Number(val(profSeat, 'n')) > 0, errText(profSeat));

  const outsider = await asUser(TREE_USER,
    `select count(*)::int as n from public.list_project_seat_users('vpa');`,
    { seats: `'{}'::text[]`, perms: `'{}'::text[]` });
  check('someone with NO projects grant still resolves nothing',
    Number(val(outsider, 'n')) === 0, errText(outsider));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
