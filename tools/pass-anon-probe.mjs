// External probe: what can the BUNDLED ANON KEY actually do to the passport
// schema over real HTTPS?
//
// tools/pass-hardening.mjs proves the policies inside Postgres. This proves the
// layer that test cannot reach: PostgREST, the schema exposure, and the role
// grants as an actual attacker experiences them — with nothing but the anon key
// that ships in the JS bundle of a public website.
//
// SAFETY — this script must be runnable against production at any time:
//   * every read is a bounded SELECT;
//   * the ONE write probe is an idempotent no-op — it PATCHes a scan's
//     points_awarded to the value it already has. If RLS permits the write we
//     learn that (the row comes back) without changing a single byte; if RLS
//     denies it we get 0 rows or 401.
//   * there is deliberately NO insert/delete probe. An INSERT cannot be made
//     idempotent, and this file is not allowed to create rows in a live system to
//     prove a point — the in-database proof covers INSERT policies.
//
// Run:  node tools/pass-anon-probe.mjs
// Before db/0011 this is expected to FAIL loudly (that is the vulnerability).
// After  db/0011 every line must pass.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const URL_BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

let pass = 0; let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, '->', String(extra).slice(0, 180)); }
};

// Content-Profile / Accept-Profile select the schema; app.js pins the client to
// `passport` the same way.
async function rest(path, { method = 'GET', body, prefer } = {}) {
  const h = {
    apikey: ANON, Authorization: `Bearer ${ANON}`,
    'Accept-Profile': 'passport', 'Content-Profile': 'passport',
  };
  if (body) h['Content-Type'] = 'application/json';
  if (prefer) h.Prefer = prefer;
  const r = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method, headers: h, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}

(async () => {
  console.log(`external anon probe -> ${URL_BASE} (schema: passport)\n`);

  // ---------------------------------------------------------------- reads ----
  const profiles = await rest('profiles?select=id,full_name,email&limit=5');
  const gotEmails = Array.isArray(profiles.json)
    && profiles.json.some((r) => typeof r.email === 'string' && r.email.includes('@'));
  check('profiles: no student email readable',
    !gotEmails, `status=${profiles.status} rows=${Array.isArray(profiles.json) ? profiles.json.length : '?'} ` +
    (gotEmails ? `LEAKED e.g. ${String(profiles.json[0].email).replace(/(.{2}).*(@.*)/, '$1***$2')}` : profiles.text));

  const tiers = await rest('user_tiers?select=id,full_name,total_km&limit=5');
  check('user_tiers: view does not leak the roster',
    !Array.isArray(tiers.json) || tiers.json.length === 0,
    `status=${tiers.status} rows=${Array.isArray(tiers.json) ? tiers.json.length : '?'}`);

  const sr = await rest('season_results?select=full_name,email&limit=5');
  check('season_results: not readable',
    !Array.isArray(sr.json) || sr.json.length === 0,
    `status=${sr.status} rows=${Array.isArray(sr.json) ? sr.json.length : '?'}`);

  // These two MUST stay readable: the scan page resolves an activity before the
  // user signs in, and the public ranking needs the points.
  const acts = await rest('activities?select=id,name&limit=3');
  check('activities: still readable (needed pre-login)',
    Array.isArray(acts.json) && acts.json.length > 0, `status=${acts.status}`);
  const scans = await rest('scans?select=user_id,points_awarded&limit=3');
  check('scans: still readable (public ranking)',
    Array.isArray(scans.json) && scans.json.length > 0, `status=${scans.status}`);

  // --------------------------------------------------------- RPC exposure ----
  const stamp = await rest('rpc/stamp_scan', {
    method: 'POST',
    body: { p_activity_id: '00000000-0000-0000-0000-000000000000', p_token: 'x' },
  });
  check('stamp_scan: not callable by anon',
    stamp.status === 401 || stamp.status === 403 || /permission denied/i.test(stamp.text),
    `status=${stamp.status} ${stamp.text}`);

  const names = await rest('rpc/leaderboard_names', { method: 'POST', body: {} });
  check('leaderboard_names: not callable by anon',
    names.status === 401 || names.status === 403 || /permission denied/i.test(names.text),
    `status=${names.status} ${names.text}`);

  const lb = await rest('rpc/admin_leaderboard', { method: 'POST', body: {} });
  check('admin_leaderboard: refused for anon',
    names.status === 401 || lb.status === 401 || lb.status === 403
      || /permission denied|NOT_AUTHORIZED/i.test(lb.text),
    `status=${lb.status} ${lb.text}`);

  // ------------------------------------------------- one idempotent write ----
  // Rewrite a real scan's points_awarded to the value it already holds. Harmless
  // whichever way RLS decides; decisive either way.
  if (Array.isArray(scans.json) && scans.json.length) {
    const victim = await rest('scans?select=id,points_awarded&limit=1');
    const row = Array.isArray(victim.json) ? victim.json[0] : null;
    if (row) {
      const w = await rest(`scans?id=eq.${row.id}`, {
        method: 'PATCH',
        body: { points_awarded: row.points_awarded },   // same value = no-op
        prefer: 'return=representation',
      });
      const accepted = Array.isArray(w.json) && w.json.length > 0;
      check('scans: anon cannot UPDATE (no-op probe)',
        !accepted, `status=${w.status} ${accepted ? 'WRITE ACCEPTED — anon can edit any scan' : w.text}`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nA failure here is a live, externally reachable finding: everything');
    console.log('above uses only the anon key published in the site bundle.');
  }
  process.exit(fail ? 1 : 0);
})();
