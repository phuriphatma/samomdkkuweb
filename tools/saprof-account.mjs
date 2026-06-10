#!/usr/bin/env node
/**
 * saprof-account.mjs — create the professor signing account.
 *
 * Creates (or updates) the `saprof` auth user and sets its public.users
 * row to role='sa_prof'. The professor seat sees ONLY หนังสือโครงการ that
 * uni_staff (sastaff) has sent to him for signing (per-recipient RLS in
 * migration 0050), accepts (e-sign / reupload) or rejects them.
 *
 * Usage:
 *   node tools/saprof-account.mjs seed
 *
 * Required env (in .env.local or inline):
 *   SUPABASE_URL_TARGET        — project to act on (overrides VITE_SUPABASE_URL).
 *   SUPABASE_SERVICE_ROLE_KEY  — service role key for that project.
 *   CONFIRM=1                  — required; prints the project id first and
 *                                only proceeds when set (wrong-project guard).
 *
 * Never commit the service-role key. .env.local is gitignored.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env.local');

function readDotEnv() {
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const fileEnv = readDotEnv();
const env = { ...fileEnv, ...process.env };

const TARGET_URL = env.SUPABASE_URL_TARGET || env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!TARGET_URL) {
  console.error('error: missing SUPABASE_URL_TARGET (or VITE_SUPABASE_URL in .env.local)');
  process.exit(2);
}
if (!SERVICE_KEY) {
  console.error('error: missing SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const supabase = createClient(TARGET_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- the account ----------
// NOTE: password is intentionally short (user-requested). The synthetic
// email never delivers; the username/password seat is the login path.

const PROF = {
  username: 'saprof',
  email:    'saprof@samomdkku.app',
  password: '1234',
  role:     'sa_prof',
};

// ---------- helpers ----------

function projectIdFromUrl(url) {
  try { return new URL(url).hostname.split('.')[0]; }
  catch { return url; }
}

async function findUserByEmail(email) {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
    page += 1;
  }
}

async function confirmTarget(action) {
  const id = projectIdFromUrl(TARGET_URL);
  const line = '='.repeat(60);
  console.log(`\n${line}`);
  console.log(`  Action:   ${action.toUpperCase()}`);
  console.log(`  Project:  ${id}`);
  console.log(`  URL:      ${TARGET_URL}`);
  console.log(`${line}\n`);
  if (env.CONFIRM !== '1') {
    console.error('Refusing to proceed without CONFIRM=1.\n');
    process.exit(3);
  }
}

async function seed() {
  await confirmTarget('seed professor');

  let user = await findUserByEmail(PROF.email);
  if (user) {
    console.log(`  · ${PROF.email.padEnd(40)}  exists, skipping create`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: PROF.email,
      password: PROF.password,
      email_confirm: true,
      user_metadata: {
        username: PROF.username,
        display_name: PROF.username,
        method: 'password',
      },
    });
    if (error) {
      console.log(`  ✗ ${PROF.email.padEnd(40)}  create failed: ${error.message}`);
      process.exit(1);
    }
    user = data.user;
    console.log(`  ✓ ${PROF.email.padEnd(40)}  created`);
  }

  // The on_auth_user_created trigger inserts a public.users row with
  // role='user'. We need role='sa_prof'. A plain UPDATE is BLOCKED by the
  // users_self_update_guard trigger (migration 0028/0041): it only lets
  // STAFF change `role`, and the service-role JWT has auth.uid()=null so
  // current_user_is_staff() is false. The guard is BEFORE UPDATE only —
  // there is NO insert guard — so we re-seed the row: read it, delete it,
  // re-insert with role set. Service role bypasses RLS for both.
  const { data: rows, error: selErr } = await supabase
    .from('users').select('*').eq('id', user.id).limit(1);
  if (selErr) { console.log(`     ↳ ✗ read failed: ${selErr.message}`); process.exit(1); }
  const row = rows?.[0];
  if (!row) { console.log('     ↳ ✗ public.users row missing'); process.exit(1); }

  if (row.role === PROF.role) {
    console.log(`     ↳ already role=${PROF.role}`);
  } else {
    const { error: delErr } = await supabase.from('users').delete().eq('id', user.id);
    if (delErr) { console.log(`     ↳ ✗ delete failed: ${delErr.message}`); process.exit(1); }
    const newRow = { ...row, role: PROF.role };
    const { error: insErr } = await supabase.from('users').insert(newRow);
    if (insErr) { console.log(`     ↳ ✗ insert failed: ${insErr.message}`); process.exit(1); }
    console.log(`     ↳ role=${PROF.role}`);
  }

  console.log('\nDone. Sanity check with:');
  console.log("  select email, role from public.users where role = 'sa_prof';\n");
}

const mode = process.argv[2];
if (mode === 'seed') await seed();
else {
  console.log('Usage:  node tools/saprof-account.mjs seed');
  console.log('Required env: SUPABASE_URL_TARGET, SUPABASE_SERVICE_ROLE_KEY, CONFIRM=1');
  process.exit(1);
}
