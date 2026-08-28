#!/usr/bin/env node
// ============================================================
// dev-grants.mjs — dev-only extra permissions, from a reviewable file
//
//   npm run dev:grants          # apply tools/dev-grants.json to samo-dev
//
// Also runs as the last step of `npm run dev:refresh`, because a rebuild wipes
// anything applied by hand — the same reason the email repoint lives there.
//
// WHY A FILE AND NOT A DASHBOARD CLICK (TEAM-WORKFLOW §3). A guest reviewer
// sometimes needs to SEE one feature for a week. Doing that by hand on the live
// system makes them an administrator of it, and nobody remembers to undo it.
// Here the grant is dev-only, reviewable in a pull request, and EXPIRES.
//
// ⚠️ IT WRITES `permissions`, NOT `managed_permissions`. On every login
// sync_my_team_permissions() rewrites every managed_* column from the team
// registry, so a grant written there vanishes the next time the person signs
// in — silently, which is the worst way for an access change to fail.
// current_user_has_permission() reads the UNION of both columns, so writing
// `permissions` grants the same access and survives the sync.
//
// BOTH DIRECTIONS, ALWAYS. It reports what it applied AND what it could not:
// an expired entry, and an email matching no account. A typo'd address that
// silently grants nothing looks exactly like a working tool.
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvLocal() {
  return Object.fromEntries(
    readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }));
}

const env = { ...loadEnvLocal(), ...process.env };
const refOf = (u) => (u || '').match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || '';

const PROD_REF = refOf(env.VITE_SUPABASE_URL);
const DEV_REF = refOf(env.SUPABASE_DEV_URL);
const TARGET = refOf(process.env.TARGET_URL || env.SUPABASE_DEV_URL);
const TOKEN = process.env.TARGET_TOKEN || env.SUPABASE_DEV_ACCESS_TOKEN;

// The refusal is by REF and comes first. "Pass the dev env var" is a
// convention; a convention is not a guard, and this one grants access.
if (!TARGET) {
  console.error('✗ no target project — SUPABASE_DEV_URL missing from .env.local');
  process.exit(2);
}
if (TARGET === PROD_REF) {
  console.error(`✗ REFUSING: ${TARGET} is the PRODUCTION project.`);
  console.error('  dev-grants.json exists so that guest access never touches production.');
  process.exit(2);
}
if (DEV_REF && TARGET !== DEV_REF) {
  console.error(`✗ REFUSING: ${TARGET} is neither production nor samo-dev (${DEV_REF}).`);
  console.error('  Refusing an unknown project rather than guessing it is disposable.');
  process.exit(2);
}
if (!TOKEN) {
  console.error('✗ no SUPABASE_DEV_ACCESS_TOKEN in .env.local');
  process.exit(2);
}

const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const arrLit = (a) => `array[${(a || []).map(sqlLit).join(',')}]::text[]`;

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${TARGET}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return []; }
}

const cfg = JSON.parse(readFileSync(join(ROOT, 'tools/dev-grants.json'), 'utf8'));
const grants = Array.isArray(cfg.grants) ? cfg.grants : [];
const today = new Date().toISOString().slice(0, 10);

console.log(`→ project: ${TARGET} (samo-dev)`);
console.log(`→ file:    tools/dev-grants.json — ${grants.length} entr${grants.length === 1 ? 'y' : 'ies'}`);

if (grants.length === 0) {
  // Not an error, and worth saying plainly: an empty list is the correct
  // steady state. The file exists so that a grant, when one is needed, is a
  // reviewable change rather than a click somebody forgets to undo.
  console.log('\n✓ no dev grants configured — nothing to apply.');
  process.exit(0);
}

let applied = 0;
const expired = [];
const unmatched = [];

for (const g of grants) {
  const who = String(g.email || '').toLowerCase().trim();
  if (!who) { console.error('✗ an entry has no email — skipped'); continue; }
  if (g.project_seats) {
    // Deliberately unsupported: managed_* columns are rewritten from the team
    // registry on every login, so a seat granted here vanishes silently.
    console.error(`✗ ${who}: project_seats is not supported — managed_* columns are`);
    console.error('  erased by sync_my_team_permissions() at next login. Use a team_members row.');
    continue;
  }
  if (!g.until || !/^\d{4}-\d{2}-\d{2}$/.test(g.until)) {
    console.error(`✗ ${who}: no valid "until" date — skipped. Every grant must expire.`);
    continue;
  }
  if (g.until < today) { expired.push(g); continue; }

  const perms = g.permissions || [];

  // ⚠️ THIS DISABLES THE TRIGGER, AND THAT IS THE TRADE-OFF, NOT AN OVERSIGHT.
  //
  // `users_self_update_guard` refuses any change to `permissions` unless
  // current_user_is_staff(). As the Management API superuser auth.uid() is
  // null, so it refuses — correctly.
  //
  // The better-looking fix is to impersonate a staff account the way the proof
  // scripts do. It was tried and does not work here: the Management API's query
  // endpoint does not carry a transaction-local `set_config('role', …)` across
  // statements, so the UPDATE runs back as superuser and the trigger fires
  // again. Verified, not assumed — the impersonation itself works (role
  // `authenticated`, is_staff true), it just does not survive to the next
  // statement.
  //
  // So this uses `session_replication_role = 'replica'`, which is what
  // dev-refresh.mjs already uses to load data: the standard administrative
  // escape hatch. What makes it acceptable here is not that it is convenient —
  // it is that this tool REFUSES any project that is not samo-dev, by ref,
  // before reaching this line. The guard it steps around protects the live
  // system; this never runs there.
  const rows = await q(`set session_replication_role = 'replica';
    update public.users set permissions = ${arrLit(perms)}
     where lower(email) = ${sqlLit(who)} returning email;`);
  // `returning` + a length check: an UPDATE matching no rows answers success.
  const got = Array.isArray(rows) ? rows.filter((r) => r && r.email) : [];
  if (!got.length) { unmatched.push(who); continue; }
  applied += 1;
  console.log(`  ✓ ${who} → ${perms.join(', ') || '(none)'}  until ${g.until}`);
}

if (expired.length) {
  console.log('\n⚠️  EXPIRED — not applied. Delete them, or extend `until` deliberately:');
  for (const g of expired) console.log(`  · ${g.email}  expired ${g.until}  (${g.why || 'no reason recorded'})`);
}
if (unmatched.length) {
  console.log('\n⚠️  NO SUCH ACCOUNT on dev — these granted nothing:');
  for (const e of unmatched) console.log(`  · ${e}`);
  console.log('  A typo here is silent: the tool succeeds and the person still cannot see the feature.');
}

console.log(`\n✓ ${applied} grant(s) applied to ${TARGET}.`);
if (expired.length || unmatched.length) console.log('  Review tools/dev-grants.json — it rots by design.');
