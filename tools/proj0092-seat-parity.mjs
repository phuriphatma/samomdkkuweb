// 0092 proof: a หนังสือโครงการ SEAT must behave like the ROLE it stands for,
// and an EXPLICIT seat must beat an INHERITED one.
//
// Follows the rule the 0089/0090/0091 cycle cost us: test the OPERATION, not the
// predicate. Every write check here performs the real INSERT/UPDATE inside a
// transaction that is always rolled back, so a helper returning `true` while the
// policy never calls it cannot pass.
//
//   A  explicit member seat overrides the inherited node seat
//   B  the `staff` seat can run the signature workflow (เจ้าหน้าที่คณะ parity)
//   C  the `vpa` seat can save settings (ผู้ส่งหนังสือ parity)
//   D  a professor can resolve a notify audience (regressed by 0091)
//
// Usage: node tools/proj0092-seat-parity.mjs
// Credentials and target come from env-lib so that `process.env` OVERRIDES
// .env.local — see the note in grant0093-reads.mjs; this file had the same bug.
import { loadEnv, announceTarget } from './env-lib.mjs';

const { ref: REF, token: PAT } = announceTarget(loadEnv());

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
// EVERY subject here is resolved LIVE from whoever holds the seat, never named.
// The three shared accounts this proof used to hardcode are all gone now —
// `samomdkkuvpa` (RETIRED 2026-08-17), and `sastaff` + `saprof` (RETIRED
// 2026-08-18, their work reassigned to the named เจ้าหน้าที่คณะ / อาจารย์ who
// already held the seat). A proof whose subject is a hardcoded name rots the
// day that account changes, and this one has now rotted twice for exactly that
// reason (docs/mistakes/tooling-proofs.md). Resolved in main().
let PROF = null;
let STAFF = null;
let VPA = null;

/** The live holder of a หนังสือโครงการ seat, by ROLE or by ทีม SAMO seat —
 *  the same union `list_project_seat_users()` uses, so the proof addresses
 *  its subjects by the rule the app addresses them by. */
const seatHolder = async (seat, role) => val(await mgmt(`
  select email from public.users
   where email is not null
     and (role in ('${role}', 'dev') or '${seat}' = any(coalesce(managed_project_seats, '{}')))
   order by (role = 'dev'), email limit 1;`), 'email');

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

  // ---- B. staff seat parity with the เจ้าหน้าที่คณะ desk ----
  console.log('\nB) the `staff` seat can run the signature workflow (เจ้าหน้าที่คณะ parity)');
  PROF = await seatHolder('prof', 'sa_prof');
  check('a live prof-seat holder exists to test with', !!PROF, 'no sa_prof/prof-seat account found');
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

  // ---- C. vpa seat parity with the ผู้ส่งหนังสือ desk ----
  console.log('\nC) the `vpa` seat can save การตั้งค่า (ผู้ส่งหนังสือ parity)');
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
  VPA   = await seatHolder('vpa', 'vp_admin');
  STAFF = await seatHolder('staff', 'uni_staff');
  check('a live vpa-seat holder exists to test with', !!VPA, 'no vp_admin/vpa-seat account found');
  check('a live staff-seat holder exists to test with', !!STAFF, 'no uni_staff/staff-seat account found');
  for (const [who, email] of [['อาจารย์ (prof seat)', PROF], ['เจ้าหน้าที่คณะ (staff seat)', STAFF], ['ผู้ส่งหนังสือ (vpa seat)', VPA]]) {
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
