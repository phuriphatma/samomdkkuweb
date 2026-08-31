#!/usr/bin/env node
// ============================================================
// dev-google-signin.mjs — turn Google sign-in ON for samo-dev.
//
//   npm run dev:google          # apply
//   npm run dev:google -- --check   # report only, change nothing
//
// WHY THIS EXISTS, AND WHY IT DOES NOT DO THE WHOLE JOB.
// Asked on 2026-08-31: "can I make you automate it?" Half of it, and the half
// that is left out is left out by Google's design, not by laziness.
//
//   ❌ CREATING the OAuth client — CONSOLE ONLY, by design. Google's only
//      programmatic path is the IAP one, and clients created that way are
//      LOCKED to IAP: the redirect URI cannot be set, which is the single
//      field Supabase needs. So no tool, mine or anyone's, can create it.
//   ✅ Everything after that — enabling the provider on the right project,
//      installing the id/secret, and proving it took — is this file.
//
// ⛔ IT REFUSES TO TOUCH PRODUCTION. The ref is checked BEFORE any write, and
// against SUPABASE_DEV_URL rather than a hardcoded string, so a recreated
// project cannot quietly turn this into a tool that edits the live site's
// auth. Enabling Google on the wrong project with dev credentials would break
// sign-in for every student.
//
// ⛔ AND IT NEVER PRINTS THE SECRET. It reports whether one is set, never what
// it is — `.claude/rules/security.md` rule 1. The client secret exchanges an
// auth code for a person's Google profile.
// ============================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

function loadEnvLocal() {
  return Object.fromEntries(
    readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }));
}

const env = loadEnvLocal();
const devUrl = env.SUPABASE_DEV_URL;
const token = env.SUPABASE_DEV_ACCESS_TOKEN;
const clientId = env.GOOGLE_DEV_CLIENT_ID;
const clientSecret = env.GOOGLE_DEV_CLIENT_SECRET;

const die = (m) => { console.error(`\n✗ ${m}\n`); process.exit(1); };

if (!devUrl) die('SUPABASE_DEV_URL is not in .env.local — nothing identifies the dev project.');
if (!token) die('SUPABASE_DEV_ACCESS_TOKEN is not in .env.local.');

const ref = new URL(devUrl).hostname.split('.')[0];

// The refusal, before any write. A production ref here would mean .env.local's
// dev block points at the live project, which is a bigger problem than Google.
const prodHost = String(env.VITE_SUPABASE_URL || '');
if (prodHost && prodHost.includes(ref)) {
  die(`SUPABASE_DEV_URL and VITE_SUPABASE_URL name the SAME project (${ref}). `
    + 'Refusing to write auth config — that would be production.');
}

const api = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const read = async () => {
  const r = await fetch(api, { headers });
  if (!r.ok) die(`could not read auth config for ${ref}: ${r.status} ${await r.text()}`);
  return r.json();
};

const before = await read();
console.log(`\nproject : ${ref}   (samo-dev)`);
console.log(`google  : ${before.external_google_enabled ? 'ENABLED' : 'disabled'}`);
console.log(`client  : ${before.external_google_client_id ? 'set' : 'NOT set'}`);
console.log(`callback: ${devUrl}/auth/v1/callback`);

if (CHECK_ONLY) {
  console.log('\n(--check: nothing was changed)\n');
  process.exit(before.external_google_enabled ? 0 : 1);
}

if (!clientId || !clientSecret) {
  console.log(`
✗ GOOGLE_DEV_CLIENT_ID / GOOGLE_DEV_CLIENT_SECRET are not in .env.local.

  This is the CONSOLE-ONLY step — Google does not expose it to any API:

    1. console.cloud.google.com → APIs & Services → Credentials
    2. Create credentials → OAuth client ID → Web application
    3. Authorised redirect URI — exactly this, no trailing slash:

         ${devUrl}/auth/v1/callback

    4. Copy the id and secret into .env.local:

         GOOGLE_DEV_CLIENT_ID=...
         GOOGLE_DEV_CLIENT_SECRET=...

  ⛔ Create a NEW client. Do NOT reuse production's: samo-dev credentials are
     deliberately shared with the whole team, and production's secret would let
     any of them impersonate the real site's Google sign-in.

  Then run this again and it will do the rest.
`);
  process.exit(1);
}

const r = await fetch(api, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({
    external_google_enabled: true,
    external_google_client_id: clientId,
    external_google_secret: clientSecret,
  }),
});
if (!r.ok) die(`PATCH failed: ${r.status} ${await r.text()}`);

// Read back from the authority — never report success from the write's own
// status code. A 200 says the request was accepted, not that the setting took.
const after = await read();
const ok = after.external_google_enabled === true && !!after.external_google_client_id;
console.log(`\n${ok ? '✓' : '✗'} google on ${ref}: `
  + `enabled=${after.external_google_enabled} client=${after.external_google_client_id ? 'set' : 'NOT set'}`);
if (!ok) die('the setting did not take — check the token has access to this project.');

console.log(`
✓ Done. Sign in with Google on a preview now.

  If Google answers redirect_uri_mismatch, the URI in the console is not
  exactly:  ${devUrl}/auth/v1/callback
`);
