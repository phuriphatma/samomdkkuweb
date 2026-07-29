// 0086 proof: หนังสือโครงการ seats granted through the SAMO Team tree, and the
// public org-chart projection.
//
// Seats:
//   vpa / staff → project ACTOR (may create + update projects/documents)
//   prof        → signing seat ONLY (must NOT be an actor)
//   none        → neither
// Org chart:
//   name/nickname/structure only, is_public subtrees only, never an email.
//
// Self-provisioning + non-destructive: each check runs in ONE Management-API
// call (= one transaction) that grants a synthetic seat, asserts, and ROLLs
// BACK. The Management API returns only the LAST row-producing statement, so
// every assertion of a call lives in one final SELECT.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const PAT = env.SUPABASE_ACCESS_TOKEN;
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

let pass = 0; let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, String(extra).slice(0, 220)); }
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
const rowsOf = (r) => (Array.isArray(r.body) ? r.body.flat().filter((x) => x && typeof x === 'object') : []);
const errText = (r) => JSON.stringify(r.body || '');

let UID;

/** Grant `seat` (or none) to the synthetic user, then run `sql` as them. */
const asSeat = (seat, sql) => mgmt(`
  select set_config('app.team_sync', '1', true);
  update public.users
     set managed_project_seats = ${seat ? `array[${lit(seat)}]` : `'{}'::text[]`}
   where id = ${lit(UID)};
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(UID)}, 'role', 'authenticated')::text, true);
  ${sql}
  rollback;`);

async function main() {
  console.log('project', REF);

  const pick = await mgmt(`select u.id from public.users u
     where coalesce(u.role,'user') = 'user'
       and not ('projects' = any(coalesce(u.permissions,'{}')))
     limit 1`);
  UID = pick.body?.[0]?.id;
  if (!UID) { console.log('no plain user to use as the synthetic grantee'); process.exit(1); }
  console.log('synthetic grantee:', UID);

  // ---- seat → capability matrix ----
  const probe = `select public.current_user_project_seats()::text as seats,
                        public.current_user_is_project_actor()   as actor,
                        public.current_user_is_prof()            as prof;`;

  const none = rowsOf(await asSeat(null, probe))[0] || {};
  check('no seat → not an actor, not a prof',
    none.actor === false && none.prof === false, JSON.stringify(none));

  const vpa = rowsOf(await asSeat('vpa', probe))[0] || {};
  check('seat vpa → project actor', vpa.actor === true, JSON.stringify(vpa));
  check('seat vpa → NOT the signing seat', vpa.prof === false, JSON.stringify(vpa));

  const staff = rowsOf(await asSeat('staff', probe))[0] || {};
  check('seat staff → project actor', staff.actor === true, JSON.stringify(staff));
  check('seat staff → NOT the signing seat', staff.prof === false, JSON.stringify(staff));

  // The important negative: a professor must never become a project actor,
  // or they would see every project instead of only what was sent to them.
  const prof = rowsOf(await asSeat('prof', probe))[0] || {};
  check('seat prof → signing seat', prof.prof === true, JSON.stringify(prof));
  check('seat prof → NOT a project actor', prof.actor === false, JSON.stringify(prof));

  // ---- a predicate test is not a permission test: exercise a real INSERT.
  //      0090 — projects_insert/delete were role-only, so the vpa seat could
  //      update but not CREATE, which is what ผู้ส่งหนังสือ exists to do. ----
  const canCreate = async (seat) => {
    const r = await asSeat(seat, `
      set local role authenticated;
      insert into public.projects (id, name, created_by)
      values ('PRJ-ZZ0090', 'seat probe', ${lit(UID)});
      select (select count(*) from public.projects where id='PRJ-ZZ0090') as made;
      reset role;`);
    return { ok: r.status < 400, rows: rowsOf(r), body: errText(r) };
  };
  const vpaCreate = await canCreate('vpa');
  check('seat vpa CAN create a project',
    vpaCreate.ok && Number(vpaCreate.rows.find((x) => 'made' in x)?.made) === 1, vpaCreate.body);
  const profCreate = await canCreate('prof');
  check('seat prof CANNOT create a project', !profCreate.ok, profCreate.body);
  const noneCreate = await canCreate(null);
  check('no seat CANNOT create a project', !noneCreate.ok, noneCreate.body);

  // ---- 0097: project_files DELETE was the last role-only policy on the
  //      table, so a seat could upload a file and then not delete it. Again
  //      a real DELETE, not a check of current_user_is_project_actor(). ----
  const canDeleteFile = async (seat) => {
    const r = await asSeat(seat, `
      insert into public.projects (id, name, created_by)
        values ('PRJ-ZZ0097', 'file seat probe', ${lit(UID)}) on conflict do nothing;
      insert into public.project_documents (id, project_id, title, type_id, created_by)
        values ('DOC-ZZ0097', 'PRJ-ZZ0097', 'probe',
                (select id from public.project_doc_types order by id limit 1), ${lit(UID)})
        on conflict do nothing;
      -- id is a bigint identity; let the default assign it and scope the
      -- DELETE by our throwaway document so a fixed id can never collide
      -- with (and destroy) a real file row.
      insert into public.project_files (document_id, file_name, drive_view_url, uploaded_by)
        values ('DOC-ZZ0097', 'probe.pdf', 'https://example.invalid/probe', ${lit(UID)});
      set local role authenticated;
      delete from public.project_files where document_id = 'DOC-ZZ0097';
      select (select count(*) from public.project_files
               where document_id = 'DOC-ZZ0097') as left_;
      reset role;`);
    return { ok: r.status < 400, rows: rowsOf(r), body: errText(r) };
  };
  const vpaDel = await canDeleteFile('vpa');
  check('seat vpa CAN delete a project file (0097)',
    vpaDel.ok && Number(vpaDel.rows.find((x) => 'left_' in x)?.left_) === 0, vpaDel.body);
  const staffDel = await canDeleteFile('staff');
  check('seat staff CAN delete a project file (0097)',
    staffDel.ok && Number(staffDel.rows.find((x) => 'left_' in x)?.left_) === 0, staffDel.body);
  const noneDel = await canDeleteFile(null);
  check('no seat CANNOT delete a project file',
    !noneDel.ok || Number(noneDel.rows.find((x) => 'left_' in x)?.left_) === 1, noneDel.body);

  // ---- the seat is what makes them show up as a possible signer ----
  const listed = await asSeat('prof', `
    select set_config('app.team_sync','1',true);
    update public.users set managed_project_seats = array['prof'] where id = ${lit(UID)};
    select exists (select 1 from public.list_project_profs() p where p.id = ${lit(UID)}) as listed,
           (select count(*) from public.list_project_profs()) as n,
           (select public.list_project_profs()::text like '%@%') as leaks_email;`);
  const l = rowsOf(listed).find((x) => 'listed' in x) || {};
  // list_project_profs is actor-gated, and a bare 'prof' seat is not an actor,
  // so the prof themself sees an empty list — assert from an ACTOR instead.
  const asActor = await mgmt(`
    select set_config('app.team_sync','1',true);
    update public.users set managed_project_seats = array['prof'] where id = ${lit(UID)};
    select set_config('request.jwt.claims', json_build_object(
      'sub', (select id from public.users where role='uni_staff' limit 1),
      'role','authenticated')::text, true);
    select exists (select 1 from public.list_project_profs() p where p.id = ${lit(UID)}) as listed,
           public.list_project_profs()::text like '%@%' as leaks_email;
    rollback;`);
  const a = rowsOf(asActor).find((x) => 'listed' in x) || {};
  check('a prof-seat person is offered as a signing recipient', a.listed === true, errText(asActor));
  check('the signer list never exposes an email', a.leaks_email === false, errText(asActor));
  check('a prof (not an actor) cannot enumerate signers', Number(l.n || 0) === 0, JSON.stringify(l));

  // ---- public org chart ----
  const chart = await mgmt(`select
      jsonb_array_length(public.get_public_org_chart()->'nodes')   as nodes,
      jsonb_array_length(public.get_public_org_chart()->'members') as members,
      public.get_public_org_chart()::text like '%@%'          as leaks_email,
      public.get_public_org_chart()::text like '%student_id%' as leaks_sid,
      public.get_public_org_chart()::text like '%kkumail%'    as leaks_kkumail,
      public.get_public_org_chart()::text like '%project_seat%' as leaks_seat,
      (select count(*) from public.team_nodes)   as all_nodes,
      (select count(*) from public.team_members) as all_members,
      (select count(*) from public.team_nodes where not is_public) as hidden_nodes`);
  const c = chart.body?.[0] || {};
  check('org chart exposes no email', c.leaks_email === false, JSON.stringify(c));
  check('org chart exposes no student_id / kkumail / seat',
    c.leaks_sid === false && c.leaks_kkumail === false && c.leaks_seat === false, JSON.stringify(c));
  check('org chart hides the non-public subtrees',
    Number(c.hidden_nodes) > 0 && Number(c.nodes) < Number(c.all_nodes), JSON.stringify(c));

  // Hiding a PARENT must hide its whole subtree, not just the parent row.
  const inherit = await mgmt(`
    with root as (
      select id from public.team_nodes where parent_id is null and is_public
        and exists (select 1 from public.team_nodes c where c.parent_id = team_nodes.id) limit 1
    )
    select (select count(*) from jsonb_array_elements(public.get_public_org_chart()->'nodes')) as before_,
           (select id from root) as root_id;`);
  const rootId = inherit.body?.[0]?.root_id;
  const before = Number(inherit.body?.[0]?.before_ || 0);
  if (rootId) {
    const after = await mgmt(`
      update public.team_nodes set is_public = false where id = ${lit(rootId)};
      select (select count(*) from jsonb_array_elements(public.get_public_org_chart()->'nodes')) as after_,
             (select count(*) from public.team_nodes where parent_id = ${lit(rootId)}) as kids;
      rollback;`);
    const r = rowsOf(after).find((x) => 'after_' in x) || {};
    check('hiding a parent hides its children too',
      Number(r.after_) <= before - 1 - Number(r.kids), `${before} → ${JSON.stringify(r)}`);
  }

  // ---- anon may read the chart, and nothing else from the tree ----
  const anon = await mgmt(`
    set local role anon;
    select set_config('request.jwt.claims', '', true);
    select (public.get_public_org_chart() is not null) as chart_ok,
           (select count(*) from public.team_members) as members_visible;
    reset role;`);
  const an = rowsOf(anon).find((x) => 'chart_ok' in x) || {};
  check('anon can read the chart projection', an.chart_ok === true, errText(anon));
  check('anon still cannot read team_members directly',
    Number(an.members_visible) === 0, errText(anon));

  // ---- nothing left behind ----
  const clean = await mgmt(`select
    (select count(*) from public.users where id = ${lit(UID)} and managed_project_seats <> '{}') as granted,
    (select count(*) from public.team_nodes where not is_public) as hidden`);
  const cl = clean.body?.[0] || {};
  check('rollback left no synthetic grant', Number(cl.granted) === 0, JSON.stringify(cl));
  check('the two intended nodes are still hidden', Number(cl.hidden) === 2, JSON.stringify(cl));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
