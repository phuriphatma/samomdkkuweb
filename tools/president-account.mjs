#!/usr/bin/env node
/**
 * president-account.mjs — create the SAMO president account.
 *
 * Creates (or updates) the `samomdkkupresident` auth user and sets its
 * public.users row to role=dev (full access, "permission like dev") with
 * department='นายกสโม' so the VitalSound dashboard defaults its dept
 * filter to นายกสโม while still being able to browse every ฝ่าย
 * (dev/super keeps the picker — see src/js/vs-staff.js
 * enterVSStaffDashboard).
 *
 * Usage:
 *   node tools/president-account.mjs seed
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

const PRESIDENT = {
  username:   'samomdkkupresident',
  email:      'samomdkkupresident@samomdkku.app',
  password:   'samo69president',
  role:       'dev',          // full access — "permission like dev"
  department: 'นายกสโม',       // VS dashboard defaults its dept filter to this
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
  await confirmTarget('seed president');

  let user = await findUserByEmail(PRESIDENT.email);
  if (user) {
    console.log(`  · ${PRESIDENT.email.padEnd(40)}  exists, skipping create`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: PRESIDENT.email,
      password: PRESIDENT.password,
      email_confirm: true,
      user_metadata: {
        username: PRESIDENT.username,
        display_name: PRESIDENT.username,
        method: 'password',
      },
    });
    if (error) {
      console.log(`  ✗ ${PRESIDENT.email.padEnd(40)}  create failed: ${error.message}`);
      process.exit(1);
    }
    user = data.user;
    console.log(`  ✓ ${PRESIDENT.email.padEnd(40)}  created`);
  }

  // The on_auth_user_created trigger inserts a public.users row with
  // role='user'. We need role='dev'. A plain UPDATE is BLOCKED by the
  // users_self_update_guard trigger (migration 0028/0041): it only lets
  // STAFF change `role`, and the service-role JWT has auth.uid()=null so
  // current_user_is_staff() is false. The guard is BEFORE UPDATE only —
  // there is NO insert guard — so we re-seed the row: read it, delete it,
  // re-insert with role/department set. Service role bypasses RLS for both.
  const { data: rows, error: selErr } = await supabase
    .from('users').select('*').eq('id', user.id).limit(1);
  if (selErr) { console.log(`     ↳ ✗ read failed: ${selErr.message}`); process.exit(1); }
  const row = rows?.[0];
  if (!row) { console.log('     ↳ ✗ public.users row missing'); process.exit(1); }

  if (row.role === PRESIDENT.role && row.department === PRESIDENT.department) {
    console.log(`     ↳ already role=${PRESIDENT.role}  dept=${PRESIDENT.department}`);
  } else {
    const { error: delErr } = await supabase.from('users').delete().eq('id', user.id);
    if (delErr) { console.log(`     ↳ ✗ delete failed: ${delErr.message}`); process.exit(1); }
    const newRow = { ...row, role: PRESIDENT.role, department: PRESIDENT.department };
    const { error: insErr } = await supabase.from('users').insert(newRow);
    if (insErr) { console.log(`     ↳ ✗ insert failed: ${insErr.message}`); process.exit(1); }
    console.log(`     ↳ role=${PRESIDENT.role}  dept=${PRESIDENT.department}`);
  }

  console.log('\nDone. Sanity check with:');
  console.log("  select email, role, department from public.users where role = 'dev' order by email;\n");
}

const mode = process.argv[2];
if (mode === 'seed') await seed();
else {
  console.log('Usage:  node tools/president-account.mjs seed');
  console.log('Required env: SUPABASE_URL_TARGET, SUPABASE_SERVICE_ROLE_KEY, CONFIRM=1');
  process.exit(1);
}
