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
