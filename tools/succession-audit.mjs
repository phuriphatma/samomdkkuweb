#!/usr/bin/env node
// ============================================================
// succession-audit.mjs — WHO ELSE CAN RECOVER THIS, if one person disappears?
//
//   npm run succession:audit
//
// WHY. Everything about this project's continuity was being discussed as a
// GitHub question. GitHub is the smallest part. Production runs on a database,
// a hosting account, a Google OAuth client, a VM key and a `.env.local`, and
// each of those is held by SOMEONE. This prints who, for the ones an API can
// answer — and, just as importantly, NAMES THE ONES IT CANNOT SEE, because
// "the audit didn't mention it" must never read as "that one is fine".
//
// It is a REPORT, not a proof, and deliberately so. A proof that is red for a
// reason nobody is going to fix today teaches people to ignore proofs — this
// repo has already written that lesson down (tools/run-proofs.mjs). Promote it
// to `npm run proofs` once the gaps in docs/SUCCESSION.md are closed, so it
// then guards a good state instead of announcing a bad one.
// ============================================================
import { execFileSync } from 'node:child_process';
import { loadEnv } from './env-lib.mjs';
import { SLUG } from './repo-identity.mjs';

const { env } = loadEnv();
const get = (k) => env[k] || process.env[k];
const mask = (e) => String(e || '?').replace(/^(.{3}).*(@.*)$/, '$1***$2');

const rows = [];
const unknown = [];
const warnings = [];
const add = (system, holders, note) => rows.push({ system, holders, note });

// ---- GitHub -------------------------------------------------------------
try {
  const admins = JSON.parse(execFileSync('gh',
    ['api', `repos/${SLUG}/collaborators`, '--paginate'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    .filter((c) => c.permissions?.admin)
    .map((c) => c.login);
  add('GitHub repo (admin)', admins, `${SLUG}`);
} catch (e) {
  unknown.push(['GitHub repo', `gh failed: ${String(e.stderr || e.message).trim().slice(0, 80)}`]);
}

// ---- Supabase: the PRODUCTION DATABASE ----------------------------------
const sbTok = get('SUPABASE_ACCESS_TOKEN');
if (sbTok) {
  try {
    const orgs = await (await fetch('https://api.supabase.com/v1/organizations',
      { headers: { Authorization: `Bearer ${sbTok}` } })).json();
    for (const o of orgs) {
      const ms = await (await fetch(`https://api.supabase.com/v1/organizations/${o.slug}/members`,
        { headers: { Authorization: `Bearer ${sbTok}` } })).json();
      const owners = (Array.isArray(ms) ? ms : [])
        .filter((m) => /owner/i.test(m.role_name || m.role || ''))
        .map((m) => mask(m.email || m.user_name));
      const all = (Array.isArray(ms) ? ms : []).map((m) => `${mask(m.email || m.user_name)} (${m.role_name || m.role})`);
      add(`Supabase org "${o.name}" — THE DATABASE`, all, `${owners.length} owner(s)`);
    }
  } catch (e) { unknown.push(['Supabase', String(e.message).slice(0, 80)]); }
} else unknown.push(['Supabase', 'no SUPABASE_ACCESS_TOKEN in .env.local']);

// ---- Cloudflare: per-PR previews ---------------------------------------
const cfTok = get('CLOUDFLARE_API_TOKEN'), cfAcct = get('CLOUDFLARE_ACCOUNT_ID');
if (cfTok && cfAcct) {
  try {
    const j = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAcct}/members`,
      { headers: { Authorization: `Bearer ${cfTok}` } })).json();
    const acct = await (await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfAcct}`,
      { headers: { Authorization: `Bearer ${cfTok}` } })).json();
    const enforce2fa = acct?.result?.settings?.enforce_twofactor;
    add('Cloudflare account — PR previews',
      (j.result || []).map((m) => `${mask(m.user?.email)} [2FA ${m.user?.two_factor_authentication_enabled ? 'on' : 'OFF'}]`),
      `previews only; prod is the VM · account 2FA enforcement: ${enforce2fa ? 'on' : 'OFF'}`);
    // A password-only Super Administrator is a different risk from a
    // password-only viewer, so it is called out rather than counted.
    for (const m of j.result || []) {
      const su = (m.roles || []).some((r) => /super admin/i.test(r.name || ''));
      if (su && m.user?.two_factor_authentication_enabled === false) {
        warnings.push(`Cloudflare: ${mask(m.user.email)} holds Super Administrator with 2FA OFF — `
          + 'one gmail password is full control of the account.');
      }
    }
  } catch (e) { unknown.push(['Cloudflare', String(e.message).slice(0, 80)]); }
} else unknown.push(['Cloudflare', 'no CLOUDFLARE_* in .env.local']);

// ---- What no API here can answer ---------------------------------------
// Listing these is the point. An audit that silently omits what it could not
// reach is worse than no audit: it reads like a clean bill of health.
const BLIND = [
  ['THE RECOVERY SETTINGS on the two role gmails — the one that decides whether any of this works',
    'studbeta and samomdkku.ai are handed to each year\'s student, so they are meant not to '
    + 'expire. That is only TRUE if their recovery email is not a kkumail (KKU deletes it) and '
    + 'their 2FA is not solely on a graduating student\'s phone. Check both, on both accounts.'],
  ['Google Cloud project 593995881808 — the OAuth client behind STUDENT GOOGLE SIGN-IN',
    'Open console.cloud.google.com → IAM. If its only Owner is an account that '
    + 'expires (a graduating kkumail), every student loses Google sign-in when it does.'],
  ['Apps Script + the Drive tree (PR uploads, หนังสือโครงการ mail)',
    'security.md says these run as "the SAMO account". Confirm WHICH account, and '
    + 'that a second person can reach it.'],
  ['The KKU VM — PRODUCTION',
    'ssh key `~/.ssh/id_samo_vm` on one Mac, `IdentitiesOnly yes`. If that key exists '
    + 'nowhere else, nobody can ever deploy again. Check ~/.ssh/authorized_keys on the VM.'],
  ['`.env.local` — every credential this project has',
    'One file, one machine, gitignored and correctly so. It is the single richest '
    + 'point of failure here. Where is the second copy?'],
  ['KKU SSO registration + the samo.md.kku.ac.th DNS record',
    'Held by KKU against a named contact. Who is it after the handover?'],
  ['The Discord server',
    'Webhooks are in appscript/*.gs, but the SERVER has an owner. Who else is an admin?'],
];

console.log(`\nWHO CAN RECOVER THIS PROJECT — ${new Date().toISOString().slice(0, 10)}\n`);
for (const r of rows) {
  const solo = r.holders.length <= 1;
  console.log(`${solo ? '⚠ ' : '  '}${r.system}`);
  console.log(`     ${r.holders.length ? r.holders.join(', ') : '(none found)'}   — ${r.note}`);
  if (solo) console.log('     ⚠ ONE person. If that account is lost, so is this.');
}
if (warnings.length) {
  console.log('\nFOUND — act on these:\n');
  for (const w of warnings) console.log(`  ⚠ ${w}`);
}
console.log('\nNOT CHECKABLE FROM HERE — each still needs a human to look:\n');
for (const [what, how] of BLIND) console.log(`  • ${what}\n      ${how}`);
if (unknown.length) {
  console.log('\nCOULD NOT READ (not the same as "fine"):');
  for (const [what, why] of unknown) console.log(`  • ${what}: ${why}`);
}
console.log('\nThe plan for all of this is docs/SUCCESSION.md.\n');
