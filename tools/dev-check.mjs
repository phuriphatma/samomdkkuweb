#!/usr/bin/env node
// ============================================================
// dev-check.mjs — does samo-dev behave the SAME as production?
//
//   npm run dev:check
//
// WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL
// docs/TEAM-WORKFLOW.md D2: the preview URL has NO door gate. What makes that
// safe is that RLS and the table GRANTs behave identically on dev — §7.3. If
// dev is even slightly more permissive, an unpublished URL is serving real
// rows to anyone who finds it.
//
// It compares the SHAPE of the answer (HTTP status), not the rows: dev may be
// empty, and an empty 200 and a full 200 are the same permission decision.
//
// BOTH DIRECTIONS, ALWAYS. Half the subjects below MUST be allowed and half
// MUST be denied. A probe that only asserts "denied" cannot tell a working
// guard from a broken URL — this repo has paid for that more than once.
// ============================================================

import { loadEnvLocal } from './migrations-lib.mjs';

const env = { ...loadEnvLocal(), ...process.env };

// subject → what an ANONYMOUS caller must get. Chosen from the gate's own
// predicate, not from a list of tables that looked interesting:
//   allow  — the public site genuinely reads this signed out
//   deny   — no grant to anon at all; PostgREST answers 401 before RLS runs
const SUBJECTS = [
  ['announcements',          'allow'],
  ['team_nodes',             'allow'],
  ['students',               'deny'],
  ['people',                 'deny'],
  ['student_change_requests','deny'],
  ['schema_migrations',      'deny'],
  ['_timeline_backup_0166',  'deny'],
];

async function probe(base, key, table) {
  try {
    const r = await fetch(`${base}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    return r.status;
  } catch (e) {
    return `ERR ${e.message.slice(0, 40)}`;
  }
}

const targets = [
  ['PRODUCTION', env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY],
  ['samo-dev',   env.SUPABASE_DEV_URL,  env.SUPABASE_DEV_ANON_KEY],
];

for (const [name, url, key] of targets) {
  if (!url || !key) {
    console.error(`✗ ${name}: URL or anon key missing from .env.local`);
    process.exit(1);
  }
}

const rows = [];
for (const [table, expect] of SUBJECTS) {
  const [prod, dev] = await Promise.all([
    probe(targets[0][1], targets[0][2], table),
    probe(targets[1][1], targets[1][2], table),
  ]);
  rows.push({ table, expect, prod, dev });
}

const ok = (status, expect) =>
  expect === 'allow' ? status === 200 : status === 401 || status === 403;

let bad = 0;
console.log('subject                       expect   prod   dev');
for (const r of rows) {
  const drift = r.prod !== r.dev;
  const wrong = !ok(r.prod, r.expect) || !ok(r.dev, r.expect);
  if (drift || wrong) bad++;
  console.log(
    `${r.table.padEnd(28)}  ${r.expect.padEnd(6)}  ${String(r.prod).padEnd(5)}  ${String(r.dev).padEnd(5)}` +
    (drift ? '  ← DRIFT' : wrong ? '  ← WRONG ON BOTH' : ''),
  );
}

const allowed = rows.filter((r) => r.expect === 'allow').length;
const denied = rows.length - allowed;
console.log(`\n${allowed} allow-subjects, ${denied} deny-subjects — both halves present.`);

if (bad) {
  console.error(
    `\n✗ ${bad} subject(s) differ or are wrong.\n` +
    '  DRIFT means dev and production disagree about who may read what. The\n' +
    '  preview URL has no door gate, so that is a real exposure, not a test\n' +
    '  nuisance. Most likely cause: a pg_dump restore re-granted anon through\n' +
    "  Supabase's ALTER DEFAULT PRIVILEGES — see skills/build-the-dev-database.md.",
  );
  process.exit(1);
}
console.log('✓ dev and production answer identically on every subject.');

// ---- AUTH CONFIG PARITY ------------------------------------------------
//
// The probes above compare RLS and GRANTs. They say NOTHING about the auth
// settings, and on 2026-08-28 those had drifted in a way that broke previews
// and would have surprised anyone testing there:
//
//   mailer_autoconfirm  false on dev, true on production — and src/js/auth.js
//                       DEPENDS on true: with it false, updateEmail() leaves
//                       the change pending instead of applying it, so a
//                       preview behaves differently from the app it previews
//   site_url            http://localhost:3000, a port this repo never used
//   uri_allow_list      EMPTY, so every redirect fell back to that wrong URL
//                       and no preview could finish signing in
//
// Fixed by hand. A hand fix has no memory, so it is checked here.
//
// NOT EVERYTHING SHOULD MATCH. site_url and the allow list are SUPPOSED to
// differ — dev is not production. So this asserts PROPERTIES, not equality:
// the settings the app's behaviour depends on must match, and the ones that
// must never be true on dev must not be.
const PAT = process.env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_ACCESS_TOKEN;
const DEVPAT = env.SUPABASE_DEV_ACCESS_TOKEN;
const refOf = (u) => (u || '').match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (!PAT || !DEVPAT) {
  console.log('\n(skipping auth-config parity — needs both PATs in .env.local)');
} else {
  const cfg = async (ref, tok) => (await fetch(
    `https://api.supabase.com/v1/projects/${ref}/config/auth`,
    { headers: { Authorization: `Bearer ${tok}` } })).json();
  const prod = await cfg(refOf(env.VITE_SUPABASE_URL), PAT);
  const dev = await cfg(refOf(env.SUPABASE_DEV_URL), DEVPAT);

  const problems = [];
  // MUST MATCH — the app's own code branches on these.
  for (const k of ['mailer_autoconfirm', 'mailer_secure_email_change_enabled', 'disable_signup']) {
    if (prod[k] !== dev[k]) {
      problems.push(`${k}: production ${JSON.stringify(prod[k])}, dev ${JSON.stringify(dev[k])}`);
    }
  }
  // MUST BE SET on dev — an empty allow list means no preview can sign in.
  if (!String(dev.uri_allow_list || '').trim()) {
    problems.push('uri_allow_list is EMPTY on dev — no preview can complete a redirect');
  }
  // MUST NOT point at production.
  if (dev.site_url && dev.site_url.includes('samo.md.kku.ac.th')) {
    problems.push(`site_url on dev points at PRODUCTION (${dev.site_url})`);
  }

  if (problems.length) {
    console.error('\n✗ auth config drift:');
    for (const p of problems) console.error(`  · ${p}`);
    console.error('  These are dashboard settings, outside git — nothing else notices them.');
    process.exit(1);
  }
  console.log('✓ auth config: the settings the app branches on match; dev-only ones are set.');
}
