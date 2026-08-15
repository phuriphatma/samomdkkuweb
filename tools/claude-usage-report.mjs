#!/usr/bin/env node
// ============================================================
// claude-usage-report.mjs — post MEASURED Claude usage into the board.
//
// WHY THIS IS A SCRIPT AND NOT A FEATURE OF THE WEB APP
// The numbers on /admin#claude are what people DECLARED they would use. Nobody
// knows in advance that they will use 30%, so without a measured counterpart
// the board drifts from reality within a week and stops being believed.
//
// The measurement exists, and is confirmed working against the live account:
//     GET https://api.anthropic.com/api/oauth/usage
//     Authorization: Bearer <token>
//     anthropic-beta: oauth-2025-04-20
//   → {"five_hour":{"utilization":51.0,"resets_at":"…"},
//      "seven_day":{"utilization":34.0,"resets_at":"2026-08-19T09:00:00Z"}, …}
// That seven_day reset is 19 Aug 16:00 ICT — exactly the Wed 16:00 the board
// computes, which is the cross-check that the two systems agree on the week.
//
// YOU LOG IN ONCE. Not every 2 hours, not every 12 days.
//
// The token is a USER credential, not an API key:
//   • the ACCESS token lives ~2 hours
//   • the REFRESH token lives ~12 days and ROTATES on every use — each refresh
//     returns a new one with a fresh window
// so this script owns the refresh: it reads the stored credentials, refreshes
// when they are near expiry, and writes the rotated pair back where it found
// them. Running every 15 minutes renews that 12-day window ~96 times a day, so
// it never approaches expiry. A re-login is needed only if the timer has been
// dead for ~12 consecutive days.
//
// The write-back is not optional. Dropping the rotated pair burns the refresh
// token and strands the account at the next run.
//
// AND NO, AN API KEY CANNOT DO THIS. An `sk-ant-…` key authenticates the pay-
// per-token API, which has no 5-hour session window and no weekly cap at all —
// it is metered by RPM/ITPM/OTPM against a bill. The 5-hour and 7-day windows
// this board books against exist only on the *subscription*, and the only
// credential that can read them is the subscription login. The Admin API
// (`sk-ant-admin-…`) reports API-organisation cost, not subscription limits,
// and needs a Team/Enterprise org. Neither substitutes for the OAuth token.
//
// WHERE THE CREDENTIALS LIVE (this differs by OS, and getting it wrong is why
// the first version of this script found nothing on a Mac):
//   macOS  → Keychain, service "Claude Code-credentials"  (NO file exists)
//   Linux  → ~/.claude/.credentials.json
//
// RUN IT ON THE MACHINE THAT HOLDS THE SAMO CLAUDE LOGIN. For SAMO that is the
// KKU VM, so it keeps reporting when nobody's laptop is open.
//
// TWO WAYS TO GIVE IT A CREDENTIAL. Prefer the first:
//
//   1. A LONG-LIVED TOKEN (recommended — set once, no rotation to think about)
//        ssh samo-vm && claude setup-token
//      Sign in as the SAMO Claude account; it prints a token. Put that in
//      /etc/samo-claude-usage.env as CLAUDE_OAUTH_TOKEN=… and this script uses
//      it directly — no refresh, no 12-day window, nothing to re-run. When it
//      does eventually expire the script says so in Discord.
//
//   2. A NORMAL LOGIN (fallback)
//        ssh samo-vm && claude login
//      Writes ~/.claude/.credentials.json. The script then owns the refresh
//      cycle described above. Works, but has more moving parts than (1).
// then install the timer (every 15 min):
//     sudo cp server/samo-claude-usage.{service,timer} /etc/systemd/system/
//     sudo systemctl enable --now samo-claude-usage.timer
//
// ENV (.env.local on a dev box, /etc/samo-claude-usage.env on the VM):
//     VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
//     CLAUDE_REPORTER_EMAIL     an account that HOLDS the `claude` permission
//     CLAUDE_REPORTER_PASSWORD  its password
//
// It signs in as an ordinary account and inserts under RLS — deliberately NOT
// service_role. A reporter that bypassed RLS would be a second, invisible write
// path into a table the app also writes, and this repo's rule is that the gate
// lives on the table.
//
// POLL EVERY 15 MINUTES, NOT IN A LOOP. The usage endpoint rate-limits hard.
// 15 min is well inside what it tolerates and is what the systemd timer does;
// a 429 is handled as a normal skipped tick, never as an incident.
//
// WHAT THIS DOES NOT DO, and cannot: attribute usage to a PERSON. The endpoint
// reports the whole subscription — "how close is the account to its cap" — and
// says nothing about who spent it. That breakdown lives in each person's own
// ~/.claude session logs, on their own laptop, which is what ccusage reads.
// Nothing on the VM can see those, because nobody runs Claude on the VM. If
// per-person truth is ever wanted, the shape is a small reporter each member
// runs, not a change here.
//
// FAILURE POSTURE: everything degrades to "no sample". The board renders a
// plain ledger and hides the measured strip rather than showing a zero — a zero
// reads as a reading. So every error path writes nothing.
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir, platform, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';
// Claude Code's own public OAuth client. Overridable because a client id is a
// deployment detail, not a law of nature.
const TOKEN_URL = process.env.CLAUDE_OAUTH_TOKEN_URL
  || 'https://console.anthropic.com/v1/oauth/token';
const CLIENT_ID = process.env.CLAUDE_OAUTH_CLIENT_ID
  || '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const REFRESH_MARGIN_MS = 10 * 60 * 1000;   // refresh when <10 min of life left

function loadEnv() {
  const out = { ...process.env };
  const f = new URL('../.env.local', import.meta.url);
  if (!existsSync(f)) return out;
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (out[m[1]] === undefined) out[m[1]] = v;
  }
  return out;
}

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/**
 * Tell a human, in Discord, that the reporter needs a re-login.
 *
 * A monitor that fails silently is worse than no monitor: the board would go on
 * showing the last sample, quietly ageing, and the first sign of trouble would
 * be someone noticing weeks later that the number looked wrong. The one failure
 * that needs a person is the refresh token expiring, and the fix (`claude
 * login` on the VM) is something only a person can do.
 *
 * THROTTLED to once per 6 hours via a stamp file: the timer runs every 15
 * minutes, so an un-throttled alert would post ~96 times a day and be muted
 * within the hour — which is the same as not alerting at all.
 */
async function alertHuman(env, reason, detail) {
  const stamp = join(tmpdir(), 'samo-claude-usage-alert.stamp');
  try {
    if (existsSync(stamp)
        && Date.now() - Number(readFileSync(stamp, 'utf8')) < 6 * 60 * 60 * 1000) {
      return;
    }
  } catch { /* unreadable stamp → alert anyway, better twice than never */ }

  const url = env.NOTIFY_URL || 'http://127.0.0.1:8787/notify';
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'notifyClaudeAlert', reason, detail }),
    });
    writeFileSync(stamp, String(Date.now()));
  } catch (e) {
    console.error(`  (could not reach ${url} to raise an alert: ${e.message})`);
  }
}

/** die(), but tell Discord first — for the failures a person must fix. */
async function dieLoudly(env, reason, detail) {
  await alertHuman(env, reason, detail);
  die(`${reason} — ${detail}`);
}

// ---------- credential store (two backends, one shape) ----------

function credFilePath(env) {
  return env.CLAUDE_CREDENTIALS_PATH
    || join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), '.credentials.json');
}

/** Read the stored credentials. Returns { store, data, path } or null. */
function loadCreds(env) {
  const path = credFilePath(env);
  if (existsSync(path)) {
    try {
      return { store: 'file', path, data: JSON.parse(readFileSync(path, 'utf8')) };
    } catch (e) {
      die(`${path} is not valid JSON (${e.message})`);
    }
  }
  if (platform() === 'darwin') {
    try {
      const raw = execFileSync(
        'security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      if (raw) return { store: 'keychain', path: null, data: JSON.parse(raw) };
    } catch { /* not in the Keychain either */ }
  }
  return null;
}

/** Write rotated credentials back. Not optional: the refresh token rotates, so
 *  dropping the new one strands the account at the next run. */
function saveCreds(creds) {
  const json = JSON.stringify(creds.data);
  if (creds.store === 'file') {
    mkdirSync(dirname(creds.path), { recursive: true });
    writeFileSync(creds.path, json, { mode: 0o600 });
    chmodSync(creds.path, 0o600);
    return;
  }
  // -U updates the existing item in place rather than erroring on duplicate.
  execFileSync('security', [
    'add-generic-password', '-U', '-s', KEYCHAIN_SERVICE,
    '-a', process.env.USER || 'claude', '-w', json,
  ], { stdio: ['ignore', 'ignore', 'ignore'] });
}

/** Exchange the refresh token for a fresh pair, and persist the rotation. */
async function refresh(creds) {
  const o = creds.data.claudeAiOauth || creds.data;
  const refreshToken = o.refreshToken || o.refresh_token;
  if (!refreshToken) die('stored credentials have no refreshToken — run `claude login` again');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // This is THE failure a person has to fix, so it does not just exit 1 into
    // a log nobody reads.
    await dieLoudly(creds.env || process.env,
      'ต่ออายุสิทธิ์เข้าถึง Claude ไม่สำเร็จ',
      `HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const t = await res.json();
  const next = {
    ...o,
    accessToken: t.access_token,
    refreshToken: t.refresh_token || refreshToken,
    expiresAt: Date.now() + (Number(t.expires_in || 0) * 1000),
  };
  if (creds.data.claudeAiOauth) creds.data.claudeAiOauth = next;
  else creds.data = next;
  saveCreds(creds);
  console.log('  (refreshed the access token and saved the rotated pair)');
  return next.accessToken;
}

/** A token good for at least REFRESH_MARGIN_MS, refreshing if needed. */
async function freshToken(env) {
  if (env.CLAUDE_OAUTH_TOKEN) return env.CLAUDE_OAUTH_TOKEN;
  const creds = loadCreds(env);
  if (creds) creds.env = env;
  if (!creds) {
    await alertHuman(env, 'ไม่พบข้อมูลเข้าสู่ระบบ Claude บนเซิร์ฟเวอร์',
      `looked for ${credFilePath(env)}`);
    die('no Claude credentials found.\n'
      + `  Looked for ${credFilePath(env)}`
      + (platform() === 'darwin' ? ` and Keychain service "${KEYCHAIN_SERVICE}".` : '.')
      + '\n  Run this on the machine signed in to the SAMO Claude account '
      + '(`claude login`), or set CLAUDE_OAUTH_TOKEN.');
  }
  const o = creds.data.claudeAiOauth || creds.data;
  const token = o.accessToken || o.access_token;
  const expiresAt = Number(o.expiresAt || 0);
  if (!token) die('stored credentials have no accessToken — run `claude login` again');
  if (expiresAt && expiresAt - Date.now() < REFRESH_MARGIN_MS) return refresh(creds);
  return token;
}

// ---------- reading the measurement ----------

/** Pull `utilization` + `resets_at` out of whichever shape the API returns.
 *  Anthropic has added windows before (the live response carries eight more,
 *  most of them null), so read the named window and leave the rest to `raw`. */
function readWindow(usage, key, limitKind) {
  const w = usage?.[key];
  if (w && w.utilization != null) {
    return {
      pct: Number(w.utilization),
      resetsAt: w.resets_at ? new Date(w.resets_at).toISOString() : null,
    };
  }
  const l = Array.isArray(usage?.limits)
    ? usage.limits.find((x) => x?.kind === limitKind) : null;
  if (l) {
    return {
      pct: l.percent == null ? null : Number(l.percent),
      resetsAt: l.resets_at ? new Date(l.resets_at).toISOString() : null,
    };
  }
  return { pct: null, resetsAt: null };
}

async function main() {
  const env = loadEnv();
  const supaUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  const email = env.CLAUDE_REPORTER_EMAIL;
  const password = env.CLAUDE_REPORTER_PASSWORD;

  if (!supaUrl || !anonKey) die('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing');
  if (!email || !password) {
    die('CLAUDE_REPORTER_EMAIL / CLAUDE_REPORTER_PASSWORD missing. '
      + 'Use an account that holds the `claude` permission.');
  }

  // ---- 1. the measurement ----
  const token = await freshToken(env);
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': OAUTH_BETA,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // 429 is EXPECTED, not a fault. The usage endpoint rate-limits hard, and a
    // missed tick costs nothing — the next one is 15 minutes away and the board
    // simply keeps the previous sample. Critically it must NOT reach
    // alertHuman(): a throttling blip that pages someone about re-logging in is
    // how an alert channel gets muted, and then the real expiry goes unseen.
    // Exit 0 so systemd does not record a failed unit for a normal event.
    if (res.status === 429) {
      const retry = res.headers.get('retry-after');
      console.log(`· rate-limited by the usage API${retry ? ` (retry-after ${retry}s)` : ''}`
        + ' — skipping this tick, the board keeps the previous sample');
      process.exit(0);
    }
    // 401/403 on a STATIC long-lived token is the one failure that path has,
    // and nothing here can fix it — a person must issue a new token. So it is
    // loud, like the refresh failure.
    if (res.status === 401 || res.status === 403) {
      await dieLoudly(env, 'สิทธิ์เข้าถึงข้อมูลการใช้งาน Claude หมดอายุ',
        `usage API HTTP ${res.status}. ออกโทเคนใหม่ด้วย \`claude setup-token\` `
        + 'บนเซิร์ฟเวอร์ แล้วใส่ค่าใน /etc/samo-claude-usage.env');
    }
    die(`usage API HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
  const usage = await res.json();

  const fiveHour = readWindow(usage, 'five_hour', 'session');
  const sevenDay = readWindow(usage, 'seven_day', 'weekly_all');
  if (fiveHour.pct == null && sevenDay.pct == null) {
    die(`neither five_hour nor seven_day found. Keys: ${Object.keys(usage).join(', ')}`);
  }

  // ---- 2. sign in as an ordinary account (RLS applies) ----
  const signIn = await fetch(`${supaUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signIn.ok) {
    die(`Supabase sign-in failed: HTTP ${signIn.status} ${await signIn.text().catch(() => '')}`);
  }
  const session = await signIn.json();
  if (!session?.access_token || !session?.user?.id) die('Supabase sign-in returned no session');

  // ---- 3. write the sample ----
  const ins = await fetch(`${supaUrl}/rest/v1/claude_usage_samples`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      five_hour_pct: fiveHour.pct,
      five_hour_resets_at: fiveHour.resetsAt,
      seven_day_pct: sevenDay.pct,
      seven_day_resets_at: sevenDay.resetsAt,
      raw: usage,
      reported_by: session.user.id,
    }),
  });
  const body = await ins.text().catch(() => '');
  if (!ins.ok) die(`insert failed: HTTP ${ins.status} ${body.slice(0, 300)}`);
  // RLS returns zero rows rather than an error on a blocked INSERT, so an empty
  // array is a REFUSAL, not a success. Same rule as the app's delete guard:
  // check the rows, never just the status.
  let parsed = [];
  try { parsed = JSON.parse(body); } catch { /* leave empty → treated as refusal */ }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    die('insert returned no row — the reporter account probably lacks the `claude` permission');
  }

  console.log(`✓ sample written · 5h ${fmt(fiveHour.pct)} · 7d ${fmt(sevenDay.pct)}`);
  if (sevenDay.resetsAt) console.log(`  weekly resets ${sevenDay.resetsAt}`);
}
const fmt = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

main().catch((e) => die(e?.stack || String(e)));
