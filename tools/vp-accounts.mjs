#!/usr/bin/env node
/**
 * vp-accounts.mjs — automate VP staff account create/cleanup.
 *
 * Two modes:
 *   node tools/vp-accounts.mjs cleanup     # delete all 10 VP auth users
 *   node tools/vp-accounts.mjs seed        # create + set role/dept/permissions
 *
 * Requires (in env or .env.local):
 *   SUPABASE_URL_TARGET        — the project to act on (use this to override
 *                                .env.local's VITE_SUPABASE_URL, important
 *                                when cleaning a different project than your
 *                                app normally points at).
 *   SUPABASE_SERVICE_ROLE_KEY  — service role key for that project
 *                                (Dashboard → Settings → API)
 *   CONFIRM=1                  — required; prevents accidental wrong-project
 *                                runs. The script prints the project ID first
 *                                and only proceeds when CONFIRM=1 is set.
 *
 * Example — clean up the WRONG project then seed the RIGHT one:
 *
 *   SUPABASE_URL_TARGET=https://wrong.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<wrong-service-key> \
 *   CONFIRM=1 \
 *   node tools/vp-accounts.mjs cleanup
 *
 *   SUPABASE_URL_TARGET=https://right.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<right-service-key> \
 *   CONFIRM=1 \
 *   node tools/vp-accounts.mjs seed
 *
 * Service-role key handling:
 *   NEVER commit it. .env.local is gitignored. If you paste keys at the
 *   shell, prefer the env-prefix form above (one-line) so they don't
 *   linger in shell history (or run `export HISTFILE=/dev/null` first).
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- env loader ----------

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
  console.error('       get it from Dashboard → Project Settings → API → service_role (secret)');
  process.exit(2);
}

const supabase = createClient(TARGET_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- canonical VP roster ----------

const VPs = [
  { username: 'samomdkkuvpa',        email: 'samomdkkuvpa@samomdkku.app',        password: 'samo69vpa',        dept: 'อุปนายกฝ่ายบริหารองค์กร',          permissions: ['projects', 'samoshop'] },
  { username: 'samomdkkudigital',    email: 'samomdkkudigital@samomdkku.app',    password: 'samo69digital',    dept: 'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร', permissions: ['pr', 'creator'] },
  { username: 'samomdkkuinternal',   email: 'samomdkkuinternal@samomdkku.app',   password: 'samo69internal',   dept: 'อุปนายกฝ่ายกิจการภายใน',          permissions: [] },
  { username: 'samomdkkuexternal',   email: 'samomdkkuexternal@samomdkku.app',   password: 'samo69external',   dept: 'อุปนายกฝ่ายกิจการภายนอก',          permissions: [] },
  { username: 'samomdkkuuniversity', email: 'samomdkkuuniversity@samomdkku.app', password: 'samo69university', dept: 'อุปนายกฝ่ายกิจการมหาวิทยาลัย',     permissions: [] },
  { username: 'samomdkkuacademic',   email: 'samomdkkuacademic@samomdkku.app',   password: 'samo69academic',   dept: 'อุปนายกฝ่ายวิชาการ',                  permissions: [] },
  { username: 'samomdkkustrategy',   email: 'samomdkkustrategy@samomdkku.app',   password: 'samo69strategy',   dept: 'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร', permissions: [] },
  { username: 'samomdkkuquality',    email: 'samomdkkuquality@samomdkku.app',    password: 'samo69quality',    dept: 'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม', permissions: [] },
  { username: 'samomdkkumdi',        email: 'samomdkkumdi@samomdkku.app',        password: 'samo69mdi',        dept: 'อุปนายกฝ่ายเวชนิทัศน์',                permissions: [] },
  { username: 'samomdkkuradiology',  email: 'samomdkkuradiology@samomdkku.app',  password: 'samo69radiology',  dept: 'อุปนายกฝ่ายรังสีเทคนิค',               permissions: [] },
];

// Old name of the media account before the rename. Cleanup AND seed
// both remove it so neither project ends up with stale records.
const LEGACY_EMAILS = ['samomdkkumedia@samomdkku.app'];

// ---------- helpers ----------

function projectIdFromUrl(url) {
  try { return new URL(url).hostname.split('.')[0]; }
  catch { return url; }
}

async function findUserByEmail(email) {
  // listUsers paginates. We'll page until we find or exhaust.
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
    console.error('Refusing to proceed without CONFIRM=1.');
    console.error('Re-run with CONFIRM=1 prefix once you have verified the project above.\n');
    process.exit(3);
  }
}

// ---------- modes ----------

async function cleanup() {
  await confirmTarget('cleanup');
  const emails = [...VPs.map((v) => v.email), ...LEGACY_EMAILS];
  for (const email of emails) {
    const user = await findUserByEmail(email);
    if (!user) {
      console.log(`  · ${email.padEnd(40)}  (not found)`);
      continue;
    }
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      console.log(`  ✗ ${email.padEnd(40)}  ${error.message}`);
    } else {
      console.log(`  ✓ ${email.padEnd(40)}  deleted`);
    }
  }
  console.log('\nDone. public.users rows cascaded automatically.\n');
}

async function seed() {
  await confirmTarget('seed');

  // First, drop the legacy media account if it's still here (so the
  // rename to samomdkkumdi takes hold).
  for (const email of LEGACY_EMAILS) {
    const u = await findUserByEmail(email);
    if (u) {
      const { error } = await supabase.auth.admin.deleteUser(u.id);
      if (error) console.log(`  ! could not remove legacy ${email}: ${error.message}`);
      else        console.log(`  · removed legacy ${email}`);
    }
  }

  for (const vp of VPs) {
    let user = await findUserByEmail(vp.email);
    if (user) {
      console.log(`  · ${vp.email.padEnd(40)}  exists, skipping create`);
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email: vp.email,
        password: vp.password,
        email_confirm: true,                       // ← equivalent to "Auto Confirm User"
        user_metadata: {
          username: vp.username,
          display_name: vp.username,
          method: 'password',
        },
      });
      if (error) {
        console.log(`  ✗ ${vp.email.padEnd(40)}  create failed: ${error.message}`);
        continue;
      }
      user = data.user;
      console.log(`  ✓ ${vp.email.padEnd(40)}  created`);
    }

    // The on_auth_user_created trigger inserts a public.users row.
    // Set role/department/permissions on it.
    const { error: updErr } = await supabase
      .from('users')
      .update({
        role: 'vp_admin',
        department: vp.dept,
        permissions: vp.permissions,
      })
      .eq('id', user.id);
    if (updErr) {
      console.log(`     ↳ ✗ update failed: ${updErr.message}`);
    } else {
      const permLabel = vp.permissions.length ? `[${vp.permissions.join(',')}]` : '(none)';
      console.log(`     ↳ role=vp_admin  dept=${vp.dept}  perms=${permLabel}`);
    }
  }

  console.log('\nDone. Sanity check with:');
  console.log("  select email, role, department, permissions from public.users where role = 'vp_admin' order by email;\n");
}

// ---------- entry ----------

const mode = process.argv[2];
if (mode === 'cleanup')      await cleanup();
else if (mode === 'seed')    await seed();
else {
  console.log('Usage:  node tools/vp-accounts.mjs <cleanup|seed>');
  console.log('Required env:');
  console.log('  SUPABASE_URL_TARGET        e.g. https://abcd.supabase.co');
  console.log('  SUPABASE_SERVICE_ROLE_KEY  service_role key for that project');
  console.log('  CONFIRM=1                  required');
  process.exit(1);
}
