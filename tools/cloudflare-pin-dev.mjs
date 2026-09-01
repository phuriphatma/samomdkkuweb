#!/usr/bin/env node
// ============================================================
// cloudflare-pin-dev.mjs — point EVERY Cloudflare Pages project at samo-dev.
//
//   node tools/cloudflare-pin-dev.mjs              # report only (default)
//   CONFIRM=1 node tools/cloudflare-pin-dev.mjs    # write
//
// THE INVARIANT IT ENFORCES: **nothing on pages.dev may reach the production
// database.** Paid for on 2026-08-31, when Cloudflare built `main` as a
// PRODUCTION deployment whose env vars named the real Supabase project, so
// <hash>.samomdkkuweb.pages.dev served a fully working app over live student
// data — while the page displayed an orange PREVIEW ribbon, because
// VITE_ENV_NAME was unset and `ribbonLabel` fell back to guessing from the
// hostname. The one instrument that exists to say "this is not real" said the
// opposite, in the dangerous direction.
//
// ⚠️ WHY IT TAKES THE WHOLE ACCOUNT AND NOT A NAME. The guard written that day
// (`tools/repo-protection.mjs`) asserted the property for ONE project and
// reported all-green on 2026-09-01 while two OTHER projects in the same account
// were both wired elsewhere — `refactorsamomdkkuweb` to the LIVE production
// project with a production anon key, `samomdkkupassport` to the frozen old
// passport database. Neither is named in this repo. The property is a statement
// about the account, so both the guard and the fix enumerate the account.
//
// ⚠️ WHAT THIS CANNOT DO. Env vars apply to the NEXT build. Deployments that
// already exist keep whatever URL was baked into their bundle, and a
// per-deployment `<hash>.<project>.pages.dev` host serves them directly — the
// splash redirect on the apex does not cover those. **The only complete fix for
// a RETIRED project is deleting it**, which is destructive and the owner's
// call. This makes the next build safe; it does not rewrite the last one.
// ============================================================

import { loadEnv } from './env-lib.mjs';

const { env } = loadEnv();
const acc = env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const tok = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const devUrl = env.SUPABASE_DEV_URL || process.env.SUPABASE_DEV_URL;
const devKey = env.SUPABASE_DEV_ANON_KEY || process.env.SUPABASE_DEV_ANON_KEY;
const write = process.env.CONFIRM === '1';

for (const [name, v] of [['CLOUDFLARE_ACCOUNT_ID', acc], ['CLOUDFLARE_API_TOKEN', tok],
  ['SUPABASE_DEV_URL', devUrl], ['SUPABASE_DEV_ANON_KEY', devKey]]) {
  if (!v) { console.error(`✗ ${name} is not in .env.local — cannot proceed.`); process.exit(1); }
}

const api = async (path, init = {}) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/pages${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const b = await r.json();
  if (!b.success) throw new Error(JSON.stringify(b.errors));
  return b.result;
};

const WANT = {
  VITE_SUPABASE_URL: devUrl,
  VITE_SUPABASE_ANON_KEY: devKey,
  VITE_ENV_NAME: 'preview',
};

const projects = await api('/projects');
console.log(`${projects.length} Pages project(s); samo-dev = ${devUrl}\n`);

let drift = 0;
for (const p of projects) {
  const cfg = p.deployment_configs ?? {};
  const patch = {};

  for (const e of ['production', 'preview']) {
    const cur = cfg[e]?.env_vars ?? {};
    const wrong = Object.entries(WANT).filter(([k, want]) => (cur[k]?.value ?? null) !== want);
    if (!wrong.length) { console.log(`✓ ${p.name}/${e} already pinned`); continue; }
    drift += wrong.length;
    for (const [k, want] of wrong) {
      const from = cur[k]?.value;
      // Never print a key's value — say how it differs, not what it is.
      const shown = k.endsWith('_KEY') ? (from ? `<${from.length} chars>` : '(unset)') : (from ?? '(unset)');
      console.log(`  ${write ? '→' : '✗'} ${p.name}/${e}  ${k}: ${shown}`
        + (k.endsWith('_KEY') ? ' → <dev anon key>' : ` → ${want}`));
    }
    // Send the FULL desired map, not just the overrides: Cloudflare's merge
    // behaviour on a partial env_vars object is not something to rely on.
    const merged = {};
    for (const [k, v] of Object.entries(cur)) merged[k] = { type: v.type ?? 'plain_text', value: v.value };
    for (const [k, v] of Object.entries(WANT)) merged[k] = { type: 'plain_text', value: v };
    patch[e] = { env_vars: merged };
  }

  if (write && Object.keys(patch).length) {
    await api(`/projects/${p.name}`, { method: 'PATCH', body: JSON.stringify({ deployment_configs: patch }) });
    console.log(`  ✔ ${p.name} written`);
  }
}

if (!drift) { console.log('\n✔ every project already points at samo-dev.'); process.exit(0); }
if (!write) {
  console.log(`\n${drift} setting(s) would change. Re-run with CONFIRM=1 to write.`);
  process.exit(1);
}
console.log('\n✔ written. ⚠️ This applies to the NEXT build only — deployments that '
  + 'already exist keep the URL baked into their bundle, and <hash>.<project>.pages.dev '
  + 'serves them directly. Deleting a retired project is the only complete fix.');
