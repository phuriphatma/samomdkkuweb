#!/usr/bin/env node
// ============================================================
// migrate-from-sheets.mjs
//
// One-shot migration from the legacy Google Sheets data into Supabase.
// Idempotent — safe to rerun (upserts on primary keys).
//
// Usage:
//   1. Export each sheet as CSV:
//        File → Download → Comma-separated values (.csv)
//      Place the files in ./sheetexample/ (gitignored):
//        sheetexample/prform.csv          (Submissions sheet)
//        sheetexample/vssound.csv         (Tickets sheet from VS GAS)
//        sheetexample/announcements.csv   (Announcements sheet from PR GAS)
//   2. Set environment vars in .env.local:
//        VITE_SUPABASE_URL
//        SUPABASE_SERVICE_ROLE_KEY  (Settings → API → service_role)
//   3. Run:
//        npm run migrate
//
// What it does:
//   - Reads each CSV
//   - For each unique submitter identifier, creates an auth user via the
//     Admin API + matching public.users row (skips if already exists)
//   - Inserts every ticket/announcement, with submitter_id linked to the
//     user
//   - Reads supabase/migrations/0002... reserved_staff_usernames and
//     ensures each staff/dev account exists with the correct role
//
// Modes (set via env var):
//   default                        : upsert — overwrites existing rows
//   MIGRATE_RESTORE_ONLY=1         : insert missing rows only; leave
//                                    existing rows untouched. Use this to
//                                    recover a deleted ticket WITHOUT
//                                    reverting any other live edits made
//                                    via the staff dashboard.
// ============================================================

// Load env from both .env and .env.local. dotenv only reads .env by default;
// Vite loads .env.local natively but Node CLI scripts don't, so we have to
// be explicit here.
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env' });
dotenvConfig({ path: '.env.local', override: true });

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// Mode flags.
//   MIGRATE_RESTORE_ONLY     : only insert rows that don't already exist
//                              (recover deleted tickets without reverting
//                              live edits on other tickets)
//   MIGRATE_PATCH_ASSIGNEES  : only update the `assignees` field on
//                              existing pr_tickets rows. Useful when an
//                              earlier migration left assignees empty
//                              and you want to backfill them without
//                              touching status / remarks.
const RESTORE_ONLY = process.env.MIGRATE_RESTORE_ONLY === '1' || process.env.MIGRATE_RESTORE_ONLY === 'true';
const PATCH_ASSIGNEES = process.env.MIGRATE_PATCH_ASSIGNEES === '1' || process.env.MIGRATE_PATCH_ASSIGNEES === 'true';
if (RESTORE_ONLY) console.log('[mode] MIGRATE_RESTORE_ONLY — existing rows will NOT be overwritten');
if (PATCH_ASSIGNEES) console.log('[mode] MIGRATE_PATCH_ASSIGNEES — only the assignees column will be updated');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ============================================================
// CSV PARSER — tiny, handles quoted fields w/ commas + newlines
// ============================================================

function parseCSV(text) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else { field += c; }
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

function readCSV(filename) {
  const p = path.join(ROOT, 'sheetexample', filename);
  if (!fs.existsSync(p)) {
    console.warn(`[skip] ${filename} not found at ${p}`);
    return null;
  }
  const raw = fs.readFileSync(p, 'utf-8');
  const rows = parseCSV(raw);
  if (rows.length < 2) return { header: [], data: [] };
  const header = rows[0].map((h) => h.trim());
  const data = rows.slice(1)
    .filter((r) => r.some((c) => c && c.trim()))
    .map((r) => {
      // Expose both header-keyed access (obj['Status']) AND positional
      // access (obj._raw[20]). The latter matters for the PR sheet's
      // Assignees column which has an empty header in the export and
      // is otherwise unreachable.
      const obj = { _raw: r.map((c) => (c ?? '').trim()) };
      header.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
  return { header, data };
}

// ============================================================
// USER UPSERT
// Cache: identifier → user_id (UUID). Identifier is whatever the legacy
// system stored (email, "@username", or empty for guest).
// ============================================================

const userCache = new Map();

async function ensureUser({ identifier, displayName, method }) {
  if (!identifier) return null; // guest submission
  if (userCache.has(identifier)) return userCache.get(identifier);

  // Compute the canonical (email, username) pair for this identifier.
  //   "alice@kkumail.com" → email=alice@kkumail.com, username=null
  //   "@alice"            → email=alice@samomdkku.app, username=alice
  let email;
  let username = null;
  if (identifier.includes('@') && !identifier.startsWith('@')) {
    email = identifier.toLowerCase();
  } else {
    username = identifier.replace(/^@/, '');
    email = `${username.toLowerCase()}@samomdkku.app`;
  }

  // Look up by username first if applicable — that's the truly stable
  // key. (Email can change across migrations, e.g. when we renamed the
  // synthetic suffix from .local to .app.)
  if (username) {
    const { data: byUsername } = await admin
      .from('users')
      .select('id, email')
      .eq('username', username)
      .maybeSingle();
    if (byUsername?.id) {
      // If the auth row has a stale email, update it so future sign-ins
      // with the canonical email format work.
      if ((byUsername.email || '').toLowerCase() !== email) {
        const { error: updEmailErr } = await admin.auth.admin.updateUserById(byUsername.id, {
          email,
          email_confirm: true,
        });
        if (updEmailErr) {
          console.error(`[user] could not update email for ${identifier}:`, updEmailErr.message);
        } else {
          await admin.from('users').update({ email }).eq('id', byUsername.id);
          console.log(`[user] migrated ${identifier} email ${byUsername.email} → ${email}`);
        }
      }
      userCache.set(identifier, byUsername.id);
      return byUsername.id;
    }
  }

  // Fall back to email lookup (covers Google users where username is null).
  const { data: byEmail } = await admin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (byEmail?.id) {
    userCache.set(identifier, byEmail.id);
    return byEmail.id;
  }

  // Doesn't exist yet — create. Random password; the staff seed step
  // sets known ones afterwards.
  const tempPassword = crypto.randomUUID() + crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      method: method || (username ? 'password' : 'google'),
      username,
      display_name: displayName || username || email,
    },
  });

  if (error) {
    if (error.message?.toLowerCase().includes('already')) {
      // Race or username-conflict edge case: find the existing user by
      // listing and matching.
      const { data: list } = await admin.auth.admin.listUsers();
      const match = list?.users?.find((u) => u.email === email);
      if (match) {
        userCache.set(identifier, match.id);
        return match.id;
      }
    }
    console.error(`[user fail] ${identifier}:`, error.message);
    return null;
  }

  userCache.set(identifier, data.user.id);
  return data.user.id;
}

// ============================================================
// STAFF SEED
// ============================================================

// Staff passwords are set deterministically on every migration run so
// the staff can sign in with known credentials. Idempotent — re-running
// the script just refreshes the password to the canonical value.
const STAFF_PASSWORDS = {
  samomdkkupr: 'samo69pr',
  samomdkkuvssound: 'samo69vssound',
  samomdkkudev: 'samo69dev',
};

async function seedStaffAccounts() {
  const { data: reserved, error } = await admin
    .from('reserved_staff_usernames')
    .select('username, role, email');
  if (error || !reserved) {
    console.warn('[staff] could not read reserved_staff_usernames:', error?.message);
    return;
  }
  for (const r of reserved) {
    const id = await ensureUser({
      identifier: `@${r.username}`,
      displayName: r.username,
      method: 'password',
    });
    if (!id) continue;
    // Set the role explicitly.
    const { error: updErr } = await admin
      .from('users')
      .update({ role: r.role, username: r.username, method: 'password' })
      .eq('id', id);
    if (updErr) console.error(`[staff] ${r.username}:`, updErr.message);
    // Set the known password via Admin API. Do NOT pass `email` here —
    // ensureUser already set the email to "<username>@samomdkku.app" which
    // matches what the frontend sends at sign-in. Overwriting with the
    // `r.email` value from reserved_staff_usernames (which uses a
    // "staff-pr@" prefix) would break sign-in because the frontend has
    // no knowledge of the prefix.
    const pass = STAFF_PASSWORDS[r.username];
    if (pass) {
      const { error: pwErr } = await admin.auth.admin.updateUserById(id, {
        password: pass,
        email_confirm: true,
      });
      if (pwErr) console.error(`[staff] ${r.username} password:`, pwErr.message);
    }
    if (!updErr) console.log(`[staff] ensured ${r.username} (${r.role}) password=${pass}`);
  }
}

// ============================================================
// PR TICKETS
// ============================================================

function parseTimestamp(s) {
  if (!s) return null;
  // Sheet exports use "M/D/YYYY HH:mm:ss" or "DD/MM/YYYY HH:mm".
  // Try both, prefer DD/MM if month > 12.
  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]?(\d{1,2}:\d{2}(:\d{2})?)?/);
  if (m1) {
    let [, a, b, year, time] = m1;
    a = parseInt(a, 10); b = parseInt(b, 10);
    // Disambiguate: if a > 12, it must be DD/MM; if b > 12, it's M/D.
    let day, month;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { month = a; day = b; }
    else { month = a; day = b; } // default M/D when ambiguous (Google Sheets default)
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time || '00:00:00'}+07:00`;
    const d = new Date(iso);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function splitList(s) {
  if (!s || s === '-' || s === 'ไม่มีไฟล์แนบ') return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

async function migratePRTickets() {
  const csv = readCSV('prform.csv');
  if (!csv) return;
  console.log(`[pr] ${csv.data.length} rows`);

  let ok = 0, fail = 0;
  for (const r of csv.data) {
    const submitter = r['SubmitterEmail'] || '';
    const submitter_id = submitter && submitter !== 'Guest'
      ? await ensureUser({
          identifier: submitter,
          displayName: submitter.split('@')[0],
          method: submitter.includes('@samomdkku.local') ? 'password' : 'google',
        })
      : null;

    let remarks = [];
    try { if (r['Remarks']) remarks = JSON.parse(r['Remarks']); } catch {}
    let assignees = [];
    // Assignees lives in the column AFTER Remarks (index 20, 0-based).
    // The CSV export has an empty header for it, so we can't reach it
    // via r['Assignees']. Use the positional _raw array.
    const rawAssign = r._raw?.[20] || r['Assignees'] || '';
    try {
      if (rawAssign && rawAssign.trim().startsWith('[')) {
        const parsed = JSON.parse(rawAssign);
        if (Array.isArray(parsed)) assignees = parsed;
      }
    } catch (e) { console.warn(`[pr ${r['Ticket ID']}] assignees parse failed:`, e.message); }

    const row = {
      id: r['Ticket ID'],
      timestamp: parseTimestamp(r['Timestamp']),
      department: r['Department'] || 'โครงการอื่นๆ',
      contact: r['Contact'] || null,
      content_name: r['Content'] || '(untitled)',
      job_type: r['JobType'] || null,
      platforms: splitList(r['Platforms']),
      posting_channel: r['PostingChannel'] || null,
      publish_date: parseTimestamp(r['PublishDate']),
      deadline_status: r['DeadlineStatus'] || 'ปกติ',
      rush_reason: r['RushReason'] || null,
      brief: r['Brief'] || null,
      caption: r['Caption'] || null,
      file_url: r['FileURL'] || null,
      silent_notify: r['SilentNotify'] === 'Silent',
      project_account: r['ProjectAccount'] || null,
      copost_with: r['CopostWith'] || null,
      submitter_id,
      submitter_label: submitter || null,
      status: r['Status'] || 'รอ PR รับเรื่อง',
      remarks,
      assignees,
      other_platforms: [],
      other_platform_reason: null,
    };

    if (!row.id) { fail++; continue; }

    let error;
    if (PATCH_ASSIGNEES) {
      // Surgical: just write the assignees column. Leave status,
      // remarks, etc. untouched in case the staff has been working
      // tickets via the dashboard since the original migration.
      ({ error } = await admin
        .from('pr_tickets')
        .update({ assignees })
        .eq('id', row.id));
    } else {
      ({ error } = await admin
        .from('pr_tickets')
        .upsert(row, { onConflict: 'id', ignoreDuplicates: RESTORE_ONLY }));
    }
    if (error) { console.error(`[pr fail] ${row.id}:`, error.message); fail++; }
    else { ok++; }
  }
  console.log(`[pr] ${ok} ok, ${fail} failed`);
}

// ============================================================
// VS TICKETS
// ============================================================

async function migrateVSTickets() {
  const csv = readCSV('vssound.csv');
  if (!csv) return;
  console.log(`[vs] ${csv.data.length} rows`);

  let ok = 0, fail = 0;
  for (const r of csv.data) {
    const username = r['Username'] || '';
    const submitter_id = username
      ? await ensureUser({ identifier: `@${username}`, displayName: r['Name'] || username, method: 'password' })
      : null;

    let remarks = [];
    try { if (r['Remarks']) remarks = JSON.parse(r['Remarks']); } catch {}

    const row = {
      id: r['Ticket ID'],
      timestamp: parseTimestamp(r['Timestamp']),
      display_name: r['Name'] || null,
      year: r['Year'] || null,
      submitter_id,
      submitter_label: username || null,
      problem: r['Problem'] || '',
      target_dept: r['Target Department'] || 'SE',
      requested_dept: r['Requested Department'] || null,
      status: r['Status'] || 'รอ SE รับเรื่อง',
      is_emergency: /ด่วน|ฉุกเฉิน/.test(r['Status'] || ''),
      remarks,
    };

    if (!row.id) { fail++; continue; }
    const { error } = await admin
      .from('vs_tickets')
      .upsert(row, { onConflict: 'id', ignoreDuplicates: RESTORE_ONLY });
    if (error) { console.error(`[vs fail] ${row.id}:`, error.message); fail++; }
    else { ok++; }
  }
  console.log(`[vs] ${ok} ok, ${fail} failed`);
}

// ============================================================
// ANNOUNCEMENTS
// ============================================================

async function migrateAnnouncements() {
  const csv = readCSV('announcements.csv');
  if (!csv) return;
  console.log(`[ann] ${csv.data.length} rows`);

  let ok = 0, fail = 0;
  for (const r of csv.data) {
    const row = {
      title: r['Title'] || r['title'] || '(untitled)',
      content: r['Content'] || r['content'] || '',
      department: r['Department'] || r['department'] || 'สโมสรนักศึกษา',
      thumbnail_url: r['Thumbnail'] || r['thumbnail'] || null,
      status: 'approved',
      created_at: parseTimestamp(r['Timestamp'] || r['timestamp']) || new Date().toISOString(),
    };
    if (!row.title) { fail++; continue; }
    // No primary key in the source; insert (idempotency = match title+created_at).
    const { data: existing } = await admin
      .from('announcements')
      .select('id')
      .eq('title', row.title)
      .eq('created_at', row.created_at)
      .maybeSingle();
    if (existing?.id) { ok++; continue; }
    const { error } = await admin.from('announcements').insert(row);
    if (error) { console.error(`[ann fail] ${row.title}:`, error.message); fail++; }
    else { ok++; }
  }
  console.log(`[ann] ${ok} ok, ${fail} failed`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log(`Migrating to ${SUPABASE_URL}`);
  await seedStaffAccounts();
  await migrateAnnouncements();
  await migrateVSTickets();
  await migratePRTickets();
  console.log('done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
