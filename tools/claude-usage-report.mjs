#!/usr/bin/env node
// ============================================================
// claude-usage-report.mjs — post MEASURED Claude usage into the board.
//
// WHY THIS IS A SCRIPT AND NOT A FEATURE OF THE WEB APP
// The numbers on /admin#claude are what people DECLARED they would use. Nobody
// knows in advance that they will use 30%, so without a measured counterpart
// the board drifts from reality within a week and stops being believed.
//
// The measurement exists:
//     GET https://api.anthropic.com/api/oauth/usage
//     Authorization: Bearer <token>
//     anthropic-beta: oauth-2025-04-20
// It returns the live `five_hour` and `seven_day` utilization with their reset
// timestamps. But the token lives in ~/.claude/.credentials.json on a MACHINE,
// so a browser can never fetch it — no amount of frontend work changes that.
// Hence a script, run where the credentials already are.
//
// RUN IT ON the machine signed in to the SAMO Claude account:
//     node tools/claude-usage-report.mjs
//
// Every 15 minutes, via cron (crontab -e):
//     */15 * * * * cd /path/to/samomdkkuweb && /usr/bin/node tools/claude-usage-report.mjs >> /tmp/claude-usage.log 2>&1
//
// ENV (.env.local, gitignored — see .claude/rules/security.md):
//     VITE_SUPABASE_URL           already there
//     VITE_SUPABASE_ANON_KEY      already there
//     CLAUDE_REPORTER_EMAIL       an account that HOLDS the `claude` permission
//     CLAUDE_REPORTER_PASSWORD    its password
//
// It signs in as an ordinary account and inserts under RLS — deliberately NOT
// service_role. A reporter that bypassed RLS would be a second, invisible write
// path into a table the app also writes, and this repo's rule is that the gate
// lives on the table.
//
// FAILURE POSTURE: everything degrades to "no sample". The board renders a
// plain ledger and says the measured strip is absent, rather than showing a
// zero — a zero reads as a reading. So every error path here exits non-zero
// with a message and writes nothing.
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const OAUTH_BETA = 'oauth-2025-04-20';

// ---- tiny .env.local parser (same shape as tools/apply-migration.mjs) ----
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
 * The OAuth access token Claude Code stores locally.
 *
 * Shapes seen in the wild differ across versions, so read defensively and say
 * WHICH key was missing rather than throwing a TypeError three frames deep.
 */
function readLocalToken(env) {
  if (env.CLAUDE_OAUTH_TOKEN) return env.CLAUDE_OAUTH_TOKEN;

  const candidates = [
    join(homedir(), '.claude', '.credentials.json'),
    join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.config', 'claude'), '.credentials.json'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    let json;
    try {
      json = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      die(`${path} is not valid JSON (${e.message})`);
    }
    const tok = json?.claudeAiOauth?.accessToken
      || json?.accessToken
      || json?.access_token;
    if (tok) return tok;
    die(`${path} has no accessToken — sign in with Claude Code first, or set CLAUDE_OAUTH_TOKEN`);
  }
  die('no ~/.claude/.credentials.json found. Run this on the machine signed in to '
    + 'the SAMO Claude account, or set CLAUDE_OAUTH_TOKEN.');
  return null;
}

/** Pull `utilization` + `resets_at` out of whichever shape the API returns.
 *  Anthropic has added windows before (per-model weekly caps), so this reads
 *  the named window and leaves the rest to the `raw` column. */
function readWindow(usage, key) {
  const w = usage?.[key]
    || (Array.isArray(usage?.limits) ? usage.limits.find((l) => l?.name === key) : null);
  if (!w) return { pct: null, resetsAt: null };
  const pct = w.utilization ?? w.used_pct ?? w.percent ?? null;
  const resetsAt = w.resets_at ?? w.reset_at ?? w.resetsAt ?? null;
  return {
    pct: pct == null ? null : Number(pct),
    resetsAt: resetsAt ? new Date(resetsAt).toISOString() : null,
  };
}

async function main() {
  const env = loadEnv();
  const supaUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const anonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;
  const email = env.CLAUDE_REPORTER_EMAIL;
  const password = env.CLAUDE_REPORTER_PASSWORD;

  if (!supaUrl || !anonKey) die('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env.local');
  if (!email || !password) {
    die('CLAUDE_REPORTER_EMAIL / CLAUDE_REPORTER_PASSWORD missing from .env.local. '
      + 'Use an account that holds the `claude` permission.');
  }

  // ---- 1. read the measurement ----
  const token = readLocalToken(env);
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': OAUTH_BETA,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    die(`usage API HTTP ${res.status} — ${body.slice(0, 300)}`);
  }
  const usage = await res.json();

  const fiveHour = readWindow(usage, 'five_hour');
  const sevenDay = readWindow(usage, 'seven_day');
  if (fiveHour.pct == null && sevenDay.pct == null) {
    die(`neither five_hour nor seven_day found in the response. Keys: ${Object.keys(usage).join(', ')}`);
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
  const accessToken = session?.access_token;
  const userId = session?.user?.id;
  if (!accessToken || !userId) die('Supabase sign-in returned no session');

  // ---- 3. write the sample ----
  const row = {
    five_hour_pct: fiveHour.pct,
    five_hour_resets_at: fiveHour.resetsAt,
    seven_day_pct: sevenDay.pct,
    seven_day_resets_at: sevenDay.resetsAt,
    raw: usage,
    reported_by: userId,
  };
  const ins = await fetch(`${supaUrl}/rest/v1/claude_usage_samples`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const body = await ins.text().catch(() => '');
  if (!ins.ok) die(`insert failed: HTTP ${ins.status} ${body.slice(0, 300)}`);
  // RLS returns zero rows rather than an error on a blocked INSERT, so an
  // empty array here is a REFUSAL, not a success. Same rule as the app's
  // delete guard: check the rows, never just the status.
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
