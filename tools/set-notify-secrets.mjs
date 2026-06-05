#!/usr/bin/env node
/**
 * set-notify-secrets.mjs — push the Discord-notify webhook secrets to a
 * Cloudflare Pages project via the API, in one shot, as ENCRYPTED secrets
 * (type: secret_text) on BOTH the production and preview configs.
 *
 * This is the automation for the `/notify` Cloudflare Function setup (see
 * skills/cloudflare-notify-function.md). Run it once per project:
 *   - preview:  --project refactorsamomdkkuweb
 *   - prod:     --project samomdkkuweb
 *
 * Requires (in env or .env.local — .env.local is gitignored):
 *   CLOUDFLARE_API_TOKEN             — token with "Cloudflare Pages: Edit"
 *                                      on the account (My Profile → API
 *                                      Tokens → Create → Pages:Edit)
 *   CLOUDFLARE_ACCOUNT_ID            — Cloudflare dashboard → any domain →
 *                                      Overview (right rail), or Workers&Pages
 *   NOTIFY_DISCORD_PR_WEBHOOK        — PR-team webhook (FRESH, rotated)
 *   NOTIFY_DISCORD_PROJECTS_WEBHOOK  — projects/VPA webhook (FRESH)
 *   NOTIFY_DISCORD_VS_WEBHOOKS       — JSON map {"SE":"...", "อุปนายก...":"..."}
 *                                      keys must match what the VS form sends
 *   CONFIRM=1                        — required to actually PATCH. Without it
 *                                      the script prints a masked dry-run.
 *
 * Usage:
 *   node tools/set-notify-secrets.mjs --project refactorsamomdkkuweb           # dry run
 *   CONFIRM=1 node tools/set-notify-secrets.mjs --project refactorsamomdkkuweb # apply
 *
 * ROTATE FIRST: the webhook URLs leaked in chat/repo history. Regenerate
 * them in Discord and put the FRESH URLs in .env.local before running.
 *
 * Secret handling: NEVER commit .env.local or the API token. Prefer the
 * env-prefix one-liner if pasting at the shell so it doesn't linger in
 * history (or `export HISTFILE=/dev/null` first).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- env loader (same shape as tools/vp-accounts.mjs) ----------

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
const env = (k) => process.env[k] ?? fileEnv[k];

// ---------- args ----------

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const project = argValue('--project');

// ---------- helpers ----------

const mask = (v) => {
  if (!v) return '(missing)';
  const s = String(v);
  return s.length <= 10 ? '****' : `${s.slice(0, 8)}…${s.slice(-6)} (len ${s.length})`;
};

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

// ---------- validate ----------

if (!project) die('Missing --project <name> (e.g. refactorsamomdkkuweb or samomdkkuweb)');

const token = env('CLOUDFLARE_API_TOKEN');
const accountId = env('CLOUDFLARE_ACCOUNT_ID');
const pr = env('NOTIFY_DISCORD_PR_WEBHOOK');
const projects = env('NOTIFY_DISCORD_PROJECTS_WEBHOOK');
const vsRaw = env('NOTIFY_DISCORD_VS_WEBHOOKS');

const missing = [];
if (!token) missing.push('CLOUDFLARE_API_TOKEN');
if (!accountId) missing.push('CLOUDFLARE_ACCOUNT_ID');
if (!pr) missing.push('NOTIFY_DISCORD_PR_WEBHOOK');
if (!projects) missing.push('NOTIFY_DISCORD_PROJECTS_WEBHOOK');
if (!vsRaw) missing.push('NOTIFY_DISCORD_VS_WEBHOOKS');
if (missing.length) die(`Missing in env/.env.local: ${missing.join(', ')}`);

let vsParsed;
try { vsParsed = JSON.parse(vsRaw); }
catch (e) { die(`NOTIFY_DISCORD_VS_WEBHOOKS is not valid JSON: ${e.message}`); }
if (!vsParsed || typeof vsParsed !== 'object' || !vsParsed.SE) {
  die('NOTIFY_DISCORD_VS_WEBHOOKS must be a JSON object that includes an "SE" key (the routing fallback).');
}

const vars = {
  DISCORD_PR_WEBHOOK: pr,
  DISCORD_PROJECTS_WEBHOOK: projects,
  DISCORD_VS_WEBHOOKS: vsRaw,  // store the JSON string verbatim
};

const envVarsBlock = Object.fromEntries(
  Object.entries(vars).map(([k, v]) => [k, { type: 'secret_text', value: v }]),
);

// ---------- dry run / confirm ----------

console.log(`\nCloudflare Pages project : ${project}`);
console.log(`Account                  : ${accountId}`);
console.log(`Targets                  : production + preview (both)`);
console.log(`\nWill set these as encrypted secrets (masked):`);
console.log(`  DISCORD_PR_WEBHOOK       = ${mask(pr)}`);
console.log(`  DISCORD_PROJECTS_WEBHOOK = ${mask(projects)}`);
console.log(`  DISCORD_VS_WEBHOOKS      = ${Object.keys(vsParsed).length} dept entries: ${Object.keys(vsParsed).join(', ')}`);

if (process.env.CONFIRM !== '1') {
  console.log(`\n(dry run) Re-run with CONFIRM=1 to apply:\n  CONFIRM=1 node tools/set-notify-secrets.mjs --project ${project}\n`);
  process.exit(0);
}

// ---------- apply ----------

const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project}`;
const body = {
  deployment_configs: {
    production: { env_vars: envVarsBlock },
    preview: { env_vars: envVarsBlock },
  },
};

const res = await fetch(url, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const json = await res.json().catch(() => ({}));

if (!res.ok || json.success === false) {
  console.error(`\n✗ Cloudflare API ${res.status}`);
  console.error(JSON.stringify(json.errors || json, null, 2));
  process.exit(1);
}

console.log(`\n✓ Set on "${project}" (production + preview).`);
console.log(`  Note: env-var changes apply to the NEXT deployment — trigger a`);
console.log(`  redeploy (Deployments → Retry, or push a commit) for them to take effect.\n`);
