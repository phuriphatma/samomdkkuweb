// 0072 isolation proof: guest (anon) vs kkumail (student) vs staff.
// Reads .env.local. Uses the Management API (superuser) for setup + raw checks,
// and the anon REST endpoint for the public-caller checks. Simulates a
// staff/student JWT via set_config('request.jwt.claims') inside a single mgmt tx.
import { readFileSync } from 'node:fs';

const real = Object.fromEntries(
  readFileSync('/Users/xeno/development/samodevmdkku69/refactorsamoweb/samomdkkuweb/.env.local', 'utf8')
    .split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const URL_ = real.VITE_SUPABASE_URL;
const ANON = real.VITE_SUPABASE_ANON_KEY;
const PAT = real.SUPABASE_ACCESS_TOKEN;
const REF = URL_.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  (cond ? (pass++, console.log('  PASS', name)) : (fail++, console.log('  FAIL', name, extra)));
}

async function mgmt(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await r.json().catch(() => null);
  return { status: r.status, body };
}
async function anonRpc(fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function anonGet(path) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const RAW_XSS = '<img src=x onerror=alert(1)> ตึกเรียนแอร์เสีย SECRET-RAW';
const A = 'VS-TST72A', B = 'VS-TST72B';

async function main() {
  console.log('project', REF);

  // ---- find a staff uid and a student (non-staff) uid ----
  const who = await mgmt(`select
    (select id from public.users where role in ('vs_staff','dev') order by role limit 1) as staff,
    (select id from public.users where coalesce(role,'') not in ('vs_staff','dev','vp_admin','shop_admin','pr_staff','creator') and role is not null limit 1) as student,
    (select id from public.users where role='vp_admin' limit 1) as vp`);
  const ids = who.body?.[0] || {};
  const STAFF = ids.staff, STUDENT = ids.student, VP = ids.vp;
  console.log('staff', STAFF, 'student', STUDENT, 'vp', VP);
  if (!STAFF) { console.log('no staff user found — abort'); process.exit(1); }

  // ---- setup: two throwaway canonicals. A=public/it, B=confidential/personal ----
  await mgmt(`
    delete from public.vs_followers where canonical_id in ('${A}','${B}');
    delete from public.vs_public_comments where canonical_id in ('${A}','${B}');
    delete from public.vs_tickets where id in ('${A}','${B}');
    insert into public.vs_tickets (id, problem, target_dept, status, category, created_at)
    values ('${A}', ${sqlLit(RAW_XSS)}, 'SE', 'กำลังดำเนินการ', 'it', now()),
           ('${B}', 'ความลับ ร้องเรียนบุคคล SECRET', 'SE', 'รอ SE รับเรื่อง', 'personal', now());
    -- simulate SE publish of A directly (raw UPDATE = what vs_set_public would do)
    update public.vs_tickets set is_public=true, public_title='ตึกเรียนแอร์เสีย ชั้น 4' where id='${A}';
    -- force-set B public too (bypassing the gate) to prove the READ layer still excludes confidential
    update public.vs_tickets set is_public=true, public_title='(should never show)' where id='${B}';
    -- seed a follower + a comment on A
    insert into public.vs_followers (canonical_id, user_id) values ('${A}', '${STUDENT || STAFF}') on conflict do nothing;
    insert into public.vs_public_comments (canonical_id, author_user_id, is_staff, body)
      values ('${A}', '${STUDENT || STAFF}', false, 'ชั้น 5 ก็เป็นครับ'),
             ('${A}', '${STAFF}', true, 'กำลังประสานงาน IT');
  `);

  // ================= INVARIANT 1: public reads are curated, never raw =================
  console.log('\n[1] curated projection (anon board/detail never leaks raw ticket)');
  const board = await anonRpc('get_public_vs_board', { p_sort: 'hot', p_limit: 100 });
  const rowA = (board.body || []).find(r => r.canonical_id === A);
  check('anon can read the board', board.status === 200 && !!rowA, JSON.stringify(board).slice(0, 200));
  check('board row has curated public_title', rowA?.public_title === 'ตึกเรียนแอร์เสีย ชั้น 4');
  check('board row exposes NO raw problem field', rowA && !('problem' in rowA) && !JSON.stringify(rowA).includes('SECRET-RAW'));
  check('board affected counts canonical+dup+follower (>=2)', Number(rowA?.affected) >= 2, `affected=${rowA?.affected}`);
  check('board comment_count = 2', Number(rowA?.comment_count) === 2, `cc=${rowA?.comment_count}`);

  const detail = await anonRpc('get_public_vs_problem', { p_id: A });
  const d = detail.body;
  check('anon detail returns curated object', detail.status === 200 && d?.canonical_id === A);
  check('detail exposes NO raw problem/submitter', d && !JSON.stringify(d).includes('SECRET-RAW') && !('problem' in d) && !('submitter_id' in d));
  check('detail comments are pseudonymous (alias, no user_id)', Array.isArray(d?.comments) && d.comments.length === 2
    && d.comments.every(c => c.alias && !('author_user_id' in c)) && d.comments.some(c => c.alias.startsWith('นศ.')) && d.comments.some(c => c.is_staff));

  // ================= INVARIANT 3: confidential never on the public surface =================
  console.log('\n[3] confidential lane hard-excluded even when is_public=true');
  check('confidential B NOT on board', !(board.body || []).some(r => r.canonical_id === B));
  const detB = await anonRpc('get_public_vs_problem', { p_id: B });
  check('confidential B detail returns null', detB.body === null, JSON.stringify(detB.body).slice(0,120));
  const searchB = await anonRpc('search_public_vs', { p_query: 'ร้องเรียนบุคคล SECRET' });
  check('confidential B not found via public search', !(searchB.body || []).some(r => r.canonical_id === B));

  // ================= direct table access is denied to anon =================
  console.log('\n[raw] anon cannot read the underlying tables directly');
  const rawT = await anonGet(`vs_tickets?id=eq.${A}&select=id,problem`);
  check('anon direct vs_tickets read = 0 rows', Array.isArray(rawT.body) && rawT.body.length === 0, JSON.stringify(rawT.body).slice(0,120));
  const rawF = await anonGet(`vs_followers?canonical_id=eq.${A}`);
  check('anon direct vs_followers read = 0 rows', Array.isArray(rawF.body) && rawF.body.length === 0);
  const rawC = await anonGet(`vs_public_comments?canonical_id=eq.${A}&select=body,author_user_id`);
  check('anon direct vs_public_comments read = 0 rows', Array.isArray(rawC.body) && rawC.body.length === 0);

  // ================= action RPCs require auth (anon fails closed) =================
  console.log('\n[auth] me-too / comment / publish reject anon');
  const meAnon = await anonRpc('vs_add_me_too', { p_canonical: A });
  check('anon vs_add_me_too rejected', meAnon.status >= 400, `status=${meAnon.status}`);
  const cmtAnon = await anonRpc('vs_post_public_comment', { p_canonical: A, p_body: 'x' });
  check('anon vs_post_public_comment rejected', cmtAnon.status >= 400, `status=${cmtAnon.status}`);
  const pubAnon = await anonRpc('vs_set_public', { p_id: A, p_public: true, p_title: 'x' });
  check('anon vs_set_public rejected', pubAnon.status >= 400, `status=${pubAnon.status}`);

  // ================= INVARIANT 2/3 gate: vs_set_public (simulated JWTs) =================
  console.log('\n[gate] vs_set_public: SE ok, confidential rejected, vp_admin rejected, student rejected');
  const asJwt = (uid, sql) => mgmt(
    `select set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true);\n${sql}`);

  // SE publishes a fresh non-confidential ticket → ok
  const seOk = await asJwt(STAFF, `select public.vs_set_public('${A}', true, 'หัวข้อโดย SE', 'หมายเหตุ', 'it');`);
  check('SE publish succeeds', seOk.status === 201 || seOk.status === 200, JSON.stringify(seOk.body).slice(0,160));
  // SE tries to publish the confidential category → rejected
  const seConf = await asJwt(STAFF, `select public.vs_set_public('${B}', true, 'x', null, 'personal');`);
  check('SE publish of confidential category rejected', isErr(seConf, 'ความลับ'), JSON.stringify(seConf.body).slice(0,160));
  // vp_admin tries to publish → rejected (SE-only publish)
  if (VP) {
    const vpPub = await asJwt(VP, `select public.vs_set_public('${A}', true, 'x', null, 'it');`);
    check('vp_admin publish rejected (SE-only)', isErr(vpPub, 'authorized'), JSON.stringify(vpPub.body).slice(0,160));
  }
  // student tries to publish → rejected
  if (STUDENT) {
    const stPub = await asJwt(STUDENT, `select public.vs_set_public('${A}', true, 'x', null, 'it');`);
    check('student publish rejected', isErr(stPub, 'authorized'), JSON.stringify(stPub.body).slice(0,160));
  }
  // student me-too on public A → ok; on confidential B → rejected
  if (STUDENT) {
    const stMe = await asJwt(STUDENT, `select public.vs_add_me_too('${A}');`);
    check('student me-too on public ok', stMe.status < 300 && Number(stMe.body?.[0]?.vs_add_me_too) >= 1, JSON.stringify(stMe.body).slice(0,120));
    const stMeB = await asJwt(STUDENT, `select public.vs_add_me_too('${B}');`);
    check('student me-too on confidential rejected', isErr(stMeB, 'ติดตาม'), JSON.stringify(stMeB.body).slice(0,120));
  }

  // ---- cleanup ----
  await mgmt(`
    delete from public.vs_followers where canonical_id in ('${A}','${B}');
    delete from public.vs_public_comments where canonical_id in ('${A}','${B}');
    delete from public.vs_tickets where id in ('${A}','${B}');`);

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  process.exit(fail ? 1 : 0);
}

function sqlLit(s) { return `'${String(s).replace(/'/g, "''")}'`; }
function isErr(res, needle) {
  const s = JSON.stringify(res.body || '');
  return (res.status >= 400 || /error|message/i.test(s)) && (!needle || s.includes(needle));
}
main().catch(e => { console.error(e); process.exit(1); });
