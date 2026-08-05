// 0109 proof: get_my_team_seat() answers about the CALLER and nobody else.
//
// The card it feeds ("ตำแหน่งของฉันในทีม SAMO") is the first surface that shows
// a person their own ทีม SAMO posting. The whole safety argument rests on one
// property — the function takes NO ARGUMENT, so identity comes from auth.uid()
// and there is no address to probe with. That property is easy to erase later
// (someone adds `p_email text default null` "for the admin view") and nothing
// else in the repo would notice, so it is asserted mechanically here.
//
// The resolvers this wraps — effective_team_*_for_email — were revoked from
// anon/authenticated in 0101 precisely because they DO take an email and were
// therefore an oracle over the whole roster. This proof exists to keep the
// wrapper from quietly becoming the same thing.
//
// Two layers, because they can disagree:
//   • SQL, via the Management API, impersonating real users (rolled back);
//   • real HTTPS through PostgREST with the bundled anon key, which is what an
//     attacker actually holds.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const PAT = env.SUPABASE_ACCESS_TOKEN;
const URL_BASE = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const REF = URL_BASE.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

let pass = 0; let fail = 0;
const check = (n, c, e = '') => {
  if (c) { pass++; console.log('  PASS', n); } else { fail++; console.log('  FAIL', n, String(e).slice(0, 240)); }
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
const val = (r, k) => rowsOf(r).map((x) => x[k]).find((v) => v !== undefined);

/** Run `sql` as a given user, then roll everything back. */
const asUser = (uid, sql) => mgmt(`
  begin;
  select set_config('request.jwt.claims',
    json_build_object('sub', ${lit(uid)}, 'role','authenticated')::text, true);
  set local role authenticated;
  ${sql}
  reset role;
  rollback;`);

async function main() {
  console.log('project', REF, '\n');

  // ── 1. the signature is the safety property ──────────────────────────────
  console.log('1) the function takes no argument, so it cannot be aimed');
  const sig = await mgmt(`
    select p.pronargs::int as nargs,
           pg_get_function_identity_arguments(p.oid) as args,
           p.prosecdef as definer,
           coalesce(p.proacl::text,'(default)') as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='get_my_team_seat';`);
  check('get_my_team_seat takes 0 arguments', val(sig, 'nargs') === 0,
    `args=${val(sig, 'args')}`);
  check('…and is SECURITY DEFINER', val(sig, 'definer') === true);
  const acl = String(val(sig, 'acl') || '');
  check('…granted to authenticated', acl.includes('authenticated=X'), acl);
  check('…NOT granted to anon', !acl.includes('anon=X'), acl);

  // The private helper. `revoke ... from public` does NOT strip the grant this
  // database's ALTER DEFAULT PRIVILEGES hands to anon and authenticated — that
  // has to be revoked per role, by name. Assert the outcome, not the intent.
  const helper = await mgmt(`
    select coalesce(p.proacl::text,'(default)') as acl
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='team_node_path';`);
  const hacl = String(val(helper, 'acl') || '');
  check('team_node_path is reachable by neither anon nor authenticated',
    !hacl.includes('anon=X') && !hacl.includes('authenticated=X'), hacl);

  // ── 2. it resolves the caller, and only the caller ───────────────────────
  console.log('\n2) it answers about the caller');
  const holder = rowsOf(await mgmt(`
    select u.id, u.email from public.users u
     join public.team_members m on lower(m.kkumail) = lower(u.email)
     where u.email is not null order by u.id limit 1;`))[0];
  if (!holder) { console.log('  (no account holds a posting — skipping)'); }
  else {
    console.log('  holder:', holder.email);
    const mine = await asUser(holder.id, `select public.get_my_team_seat() as s;`);
    const seat = val(mine, 's') || {};
    check('a posting holder gets at least one posting',
      Array.isArray(seat.postings) && seat.postings.length > 0, JSON.stringify(seat).slice(0, 200));
    check('…each posting names its ตำแหน่ง',
      (seat.postings || []).every((p) => typeof p.node === 'string' && p.node.length > 0));
    check('…and the ฝ่าย path is an array',
      (seat.postings || []).every((p) => Array.isArray(p.path)));
    check('…the email returned is the CALLER\'s own',
      String(seat.email || '').toLowerCase() === holder.email.toLowerCase(), seat.email);

    // The payload must carry nothing about anyone else. A future `select *` or
    // `returns setof team_members` would break exactly this.
    const blob = JSON.stringify(seat);
    // Only consider values that are actually ADDRESSES. Live data carries
    // placeholder kkumail values — one row holds the single character '-' —
    // and a bare substring test on those matches any uuid in the payload and
    // reports a leak that is not there. The first run of this script did
    // exactly that.
    const others = rowsOf(await mgmt(`
      select count(*)::int as n from public.team_members
       where kkumail like '%@%.%' and length(btrim(kkumail)) >= 6
         and lower(kkumail) <> lower(${lit(holder.email)})
         and position(lower(btrim(kkumail)) in lower(${lit(blob)})) > 0;`));
    check('the payload contains no other person\'s kkumail', others[0]?.n === 0,
      `leaked=${others[0]?.n}`);
    const sids = rowsOf(await mgmt(`
      select count(*)::int as n from public.team_members
       where student_id is not null and length(btrim(student_id)) > 3
         and position(student_id in ${lit(blob)}) > 0;`));
    check('…and no รหัสนักศึกษา at all', sids[0]?.n === 0, `leaked=${sids[0]?.n}`);
    check('…and no user_id / photo of anyone',
      !blob.includes('photo_url') && !blob.includes('user_id'));
  }

  // ── 3. an account with no posting gets an empty envelope, not an error ───
  console.log('\n3) an account with no posting');
  const plain = rowsOf(await mgmt(`
    select u.id, u.email from public.users u
     where u.email is not null
       and not exists (select 1 from public.team_members m
                        where lower(m.kkumail) = lower(u.email))
     order by u.id limit 1;`))[0];
  if (!plain) { console.log('  (every account holds a posting — skipping)'); }
  else {
    const empty = await asUser(plain.id, `select public.get_my_team_seat() as s;`);
    const seat = val(empty, 's') || {};
    check('gets an empty postings list rather than an error',
      Array.isArray(seat.postings) && seat.postings.length === 0, JSON.stringify(seat).slice(0, 160));
    check('…and no permissions', (seat.permissions || []).length === 0);
  }

  // ── 4. over real HTTPS, with the key an attacker actually has ────────────
  console.log('\n4) through PostgREST with the public anon key');
  const post = async (fn, body) => {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, text: (await r.text()).slice(0, 200) };
  };
  const a1 = await post('get_my_team_seat', {});
  check('anon is refused get_my_team_seat', a1.status === 403 || /permission denied/.test(a1.text),
    `${a1.status} ${a1.text}`);
  const a2 = await post('team_node_path', { p_node: '00000000-0000-0000-0000-000000000000' });
  check('anon is refused team_node_path', a2.status === 403 || /permission denied/.test(a2.text),
    `${a2.status} ${a2.text}`);
  // A caller who tries to aim it at somebody else must get a hard 404 from
  // PostgREST (no such overload), never a silent success.
  const a3 = await post('get_my_team_seat', { p_email: 'someone@kkumail.com' });
  check('passing an email finds no such function (it has no such parameter)',
    a3.status === 404 || /Could not find|permission denied/.test(a3.text),
    `${a3.status} ${a3.text}`);

  console.log(`\n${pass} passed, ${fail} failed — nothing was written`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
