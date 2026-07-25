// 0095 proof: the อาจารย์ SEAT grants the อาจารย์ ROLE.
//
// A kkumail account granted อาจารย์ in ทีม SAMO must see exactly what the shared
// `saprof` account sees — same documents, same files, same signature queue —
// because อาจารย์ is one institutional role, like เจ้าหน้าที่คณะ.
//
// And it must NOT become a project actor: หนังสือ never sent for signature stay
// invisible to both. That is the line 0086 drew and 0095 keeps.
//
// Usage: node tools/prof0095-seat-parity.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, String(e).slice(0, 200)); } };

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
const errText = (r) => (r.body && r.body.message) ? r.body.message : JSON.stringify(r.body).slice(0, 200);
const denied = (r) => /row-level security|42501|permission denied/i.test(errText(r));

const SHARED = 'saprof@samomdkku.app';
const SEAT = 'phuriphat.ma@kkumail.com';

/** Run `sql` as `email` under RLS. `seat` stages managed_project_seats first. */
const as = (email, sql, seat = null) => mgmt(`
begin;
${seat ? `select set_config('app.team_sync','1',true);
update public.users set managed_project_seats = ${seat},
                        managed_permissions = array['projects'] where email = '${email}';` : ''}
select set_config('request.jwt.claims',
  json_build_object('sub', (select id from public.users where email = '${email}'),
                    'role','authenticated')::text, true);
set local role authenticated;
${sql}
rollback;`);

// What the professor's inbox is built from, mirroring scopeProjectsForRole():
// documents that carry at least one signature request AND are readable.
const INBOX = `
  select count(*)::int as docs from public.project_documents d
   where exists (select 1 from public.project_sign_requests r where r.document_id = d.id);`;

async function main() {
  console.log('project', REF, '\n');

  const total = await mgmt(`select count(*)::int as n from public.project_documents;`);
  const withReq = await mgmt(`select count(distinct document_id)::int as n from public.project_sign_requests;`);
  console.log(`corpus: ${val(total, 'n')} หนังสือ total, ${val(withReq, 'n')} sent for signature\n`);

  console.log('A) the seat sees the same desk as the shared account');
  const shared = await as(SHARED, INBOX);
  const seat = await as(SEAT, INBOX, `array['prof']`);
  check(`saprof sees ${val(shared, 'docs')} หนังสือ`, Number(val(shared, 'docs')) > 0, errText(shared));
  check('a tree-granted อาจารย์ sees the SAME count',
    Number(val(seat, 'docs')) === Number(val(shared, 'docs')),
    `saprof=${val(shared, 'docs')} seat=${val(seat, 'docs')}`);

  const sr = await as(SEAT, `select count(*)::int as n from public.project_sign_requests;`, `array['prof']`);
  const srShared = await as(SHARED, `select count(*)::int as n from public.project_sign_requests;`);
  check('…and the same signature queue',
    Number(val(sr, 'n')) === Number(val(srShared, 'n')) && Number(val(sr, 'n')) > 0,
    `saprof=${val(srShared, 'n')} seat=${val(sr, 'n')}`);

  const f1 = await as(SHARED, `select count(*)::int as n from public.project_files where prof_can_see_file(id);`);
  const f2 = await as(SEAT, `select count(*)::int as n from public.project_files where prof_can_see_file(id);`, `array['prof']`);
  check('…and the same signable files',
    Number(val(f1, 'n')) === Number(val(f2, 'n')),
    `saprof=${val(f1, 'n')} seat=${val(f2, 'n')}`);

  console.log('\nB) but a professor is still NOT a project actor');
  const actor = await as(SEAT, `select public.current_user_is_project_actor() as a;`, `array['prof']`);
  check('the seat is not an actor', val(actor, 'a') === false, JSON.stringify(rows(actor)[0]));
  check('so the desk is narrower than the whole corpus',
    Number(val(seat, 'docs')) < Number(val(total, 'n')),
    `desk=${val(seat, 'docs')} corpus=${val(total, 'n')}`);

  const create = await as(SEAT, `
    insert into public.projects (id, name) values ('TEST-'||substr(md5(random()::text),1,6), 'x')
    returning id;`, `array['prof']`);
  check('a professor still cannot create a project', denied(create), errText(create));

  const req = await as(SEAT, `
    insert into public.project_sign_requests (id, document_id, prof_id, requested_by)
    select 'SR-'||substr(md5(random()::text),1,8), d.id,
           (select id from public.users where email='${SHARED}'),
           (select id from public.users where email='${SEAT}')
      from public.project_documents d limit 1 returning id;`, `array['prof']`);
  check('a professor still cannot request a signature (that is เจ้าหน้าที่คณะ)',
    denied(req), errText(req));

  console.log('\nC) non-professors are unaffected');
  const plain = await as(SEAT, `select count(*)::int as n from public.project_sign_requests;`, `'{}'::text[]`);
  check('an account with no seat reads no sign requests',
    Number(val(plain, 'n')) === 0, errText(plain));
  const plainDoc = await as(SEAT, `select prof_can_see_document(
      (select document_id from public.project_sign_requests limit 1)) as v;`, `'{}'::text[]`);
  check('…and prof_can_see_document() is false for them',
    val(plainDoc, 'v') === false, JSON.stringify(rows(plainDoc)[0]));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
