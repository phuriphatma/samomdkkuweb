#!/usr/bin/env node
// ============================================================
// email-smoke.mjs — send ONE clearly-marked test email, and prove the
// recipient allow-list is doing its job.
//
//   npm run email:smoke                          # to the dev test inbox
//   npm run email:smoke -- --to a@kku.ac.th      # to a specific allowed address
//   npm run email:smoke -- --no-control          # skip the refusal probe
//
// WHY THIS EXISTS. `npm run notify:smoke` covers Discord. Nothing covered
// EMAIL, so on 2026-08-28 the only end-to-end test was a throwaway script in a
// scratchpad — which is another way of saying the next person has to rediscover
// how. The email path is the one that reaches a NAMED HUMAN, so it is the one
// most worth being able to test deliberately.
//
// ⚠️ IT DOES SEND. That is the point. It sends to the dev test inbox unless you
// name a recipient, and the subject is marked so it cannot be mistaken for a
// real notification.
//
// BOTH DIRECTIONS, ALWAYS. It also attempts one send to an address that is NOT
// on the Apps Script allow-list and requires that to be REFUSED. Without that
// control a success proves only that something answered — not that the guard
// protecting a public, unauthenticated endpoint still works. That endpoint's
// `/exec` URL ships in the browser bundle; without the allow-list it is an open
// relay that can send mail as "MDKKU SAMO" to anyone.
// ============================================================

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };

// Read the endpoint from the app's own config, so this cannot drift from what
// the site actually calls. A hardcoded copy is the bug this repo keeps paying
// for; there is no reason to make a second one here.
const cfg = readFileSync(new URL('../src/js/config.js', import.meta.url), 'utf8');
const GAS = cfg.match(/GAS_API_URL\s*=\s*\n?\s*'([^']+)'/)?.[1];
if (!GAS) {
  console.error('✗ could not read GAS_API_URL from src/js/config.js');
  process.exit(2);
}

const TO = opt('to', 'mdstuddata.beta@gmail.com');
const stamp = new Date().toISOString();

async function send(to, subject, why) {
  const r = await fetch(GAS, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'notifyProjectEmail',
      to,
      subject,
      htmlBody: `<h2>ทดสอบระบบอีเมล</h2>
        <p>อีเมลฉบับนี้มาจากการทดสอบระบบ <b>ไม่ใช่การแจ้งเตือนจริง</b></p>
        <ul><li>ส่งเมื่อ: ${stamp}</li><li>ปลายทาง: ${to}</li>
        <li>เหตุผล: ${why}</li></ul>`,
    }),
  });
  const text = await r.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* GAS can answer HTML on error */ }
  return { http: r.status, ok: parsed?.success === true, message: parsed?.message || text.slice(0, 160) };
}

console.log(`→ endpoint: ${GAS.slice(0, 60)}…`);
console.log(`→ to:       ${TO}\n`);

const real = await send(TO, `[TEST] [MDKKU SAMO] ทดสอบระบบอีเมล — ${stamp}`, 'email-smoke');
console.log(real.ok
  ? `✓ ALLOWED  ${TO} — HTTP ${real.http}, success:true`
  : `✗ REFUSED  ${TO} — HTTP ${real.http}: ${real.message}`);

let control = null;
if (!args.includes('--no-control')) {
  // An address on no allow-list, at a domain that cannot exist.
  control = await send('control@invalid.example',
    '[TEST] allow-list control — this MUST be refused', 'email-smoke control');
  console.log(control.ok
    ? `✗ CONTROL SENT — the allow-list did NOT refuse an unlisted address.`
    : `✓ REFUSED  control@invalid.example — ${control.message.slice(0, 90)}`);
}

console.log('');
if (!real.ok) {
  console.error('The allowed send failed. Either the address is not on the Apps Script');
  console.error('allow-list (EMAIL_DOMAIN_ALLOWLIST / its default), or the deployment is down.');
  process.exit(1);
}
if (control && control.ok) {
  console.error('⛔ THE ALLOW-LIST IS NOT REFUSING UNLISTED ADDRESSES.');
  console.error('   The /exec URL is public and unauthenticated, so this is an OPEN RELAY');
  console.error('   able to send mail as "MDKKU SAMO". Fix before anything else.');
  process.exit(1);
}
console.log(`✓ Sent, and the allow-list refused an unlisted address.`);
console.log(`  Check ${TO} for the subject above (including Spam).`);
console.log('  Nothing here proves DELIVERY — only that Apps Script accepted it.');
