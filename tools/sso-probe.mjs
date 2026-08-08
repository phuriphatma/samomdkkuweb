#!/usr/bin/env node
// ============================================================
// sso-probe.mjs — settle ONE question about KKU SSO without building anything:
//
//   does the profile contain the รหัสนักศึกษา, or does it not?
//
// Everything else about the "let SSO fill in the identity at login" design is
// decided (see docs/KKU-SSO.md); this is the single fact the manual does not
// state. `auth.token` returns `immutableId` / `employeeId` and `user.profile`
// returns `userId` — three undocumented identifiers, none of them named
// `studentId`, and only a real login can say which (if any) is the รหัส.
//
// WHY A THROWAWAY SCRIPT AND NOT A FEATURE. Answering this by building the SSO
// login first would be doing the expensive thing to learn whether the expensive
// thing is worth doing. This costs one login.
//
// HOW TO RUN IT (two minutes)
//   1. node tools/sso-probe.mjs           → prints the login URL to open
//   2. Open it, sign in with a STUDENT kkumail account (a staff account answers
//      a different question — `employeeId` will be populated for staff whatever
//      it means for students).
//   3. You land on https://samo.md.kku.ac.th/login?code=… — that page does not
//      exist yet, so it will 404 or show the app. That is FINE: the value we
//      need is the `code` in the address bar. Copy it.
//   4. node tools/sso-probe.mjs <code>
//
// WHAT IT PRINTS. Field NAMES always; values only for the fields that decide
// the question (the identifier-shaped ones), and `citizenId` / `phoneNumber` are
// redacted to a shape (`13 digits`) and never shown — receiving personal data is
// not a reason to put it in a terminal transcript. Nothing is stored anywhere.
//
// The `code` is single-use and short-lived; a used one is worthless.
// ============================================================
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    }),
);

const APP_ID = env.KKU_SSO_APP_ID;
const CLIENT_ID = env.KKU_SSO_CLIENT_ID;
const CLIENT_SECRET = env.KKU_SSO_CLIENT_SECRET;
const REDIRECT = env.KKU_SSO_REDIRECT_LOGIN;
const API = 'https://ssonext-api.kku.ac.th';

if (!APP_ID || !CLIENT_SECRET) {
  console.error('Missing KKU_SSO_* in .env.local');
  process.exit(1);
}

/** Never print a secret, an id card or a phone number — say its SHAPE instead. */
const SENSITIVE = new Set(['citizenId', 'accessToken', 'phoneNumber']);
function show(key, value) {
  if (value === null || value === undefined || value === '') return '(empty)';
  const s = String(value);
  if (SENSITIVE.has(key)) return `<redacted: ${s.length} chars${/^\d+$/.test(s) ? ', all digits' : ''}>`;
  return s;
}

const code = process.argv[2];
if (!code) {
  console.log(`
Open this, sign in with a STUDENT kkumail account, then copy the ?code= value
out of the address bar you land on and run this script again with it:

  ${`https://ssonext.kku.ac.th/login?app=${APP_ID}`}

  node tools/sso-probe.mjs <code>
`);
  process.exit(0);
}

const post = async (path, body, token) => {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text };
};

const dump = (label, obj) => {
  console.log(`\n── ${label} ──`);
  if (!obj || typeof obj !== 'object') { console.log('  (no object)'); return; }
  for (const [k, v] of Object.entries(obj)) {
    console.log(`  ${k.padEnd(20)} ${show(k, v)}`);
  }
};

const tok = await post('/auth.token', {
  code, redirectUrl: REDIRECT, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
});
console.log(`auth.token → HTTP ${tok.status}`);
if (!tok.json) { console.log(tok.text.slice(0, 400)); process.exit(1); }
if (tok.json.ok === false) {
  console.log(`  ok:false error=${tok.json.error}`);
  console.log('  (AUTH0001 usually means the code was already used or expired —'
    + ' log in again and use a fresh one.)');
  process.exit(1);
}
dump('auth.token', tok.json);

if (tok.json.accessToken) {
  const prof = await post('/user.profile', undefined, tok.json.accessToken);
  console.log(`\nuser.profile → HTTP ${prof.status}`);
  dump('user.profile', prof.json?.profile ?? prof.json);
}

console.log(`
THE QUESTION: does any field above hold this person's รหัสนักศึกษา
(10 digits, e.g. 653070317-0 or 6530703170)?

  yes → the file from Data Analytics can be TWO columns (kkumail, sai), and
        ชื่อ / นามสกุล / รหัส all arrive at first login.
  no  → รหัสนักศึกษา must stay in the file (รุ่น is derived from it), so the ask
        is kkumail, student_id, sai, major — and SSO only saves the two names.
`);
