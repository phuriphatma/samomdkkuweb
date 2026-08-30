#!/usr/bin/env node
// ============================================================
// repo-protection.mjs — are the branch-protection settings still ON?
//
//   node tools/repo-protection.mjs          (part of `npm run proofs`)
//
// WHY THIS EXISTS. On 2026-08-27 `main` was set to require the `build` check
// and code-owner review. **Those settings live on GitHub, outside git.** Turn
// them off and nothing goes red: the tests still pass, the site still works,
// and every contributor rule written that day silently becomes advisory. The
// whole ฝ่าย-contribution design (docs/DEPT-TOOLS.md) rests on them.
//
// BOTH DIRECTIONS. Two of the assertions below are "must be ON" and two are
// "must stay OFF" — `enforce_admins` in particular MUST remain false, because
// it is what lets the owner push `main`, which is this repo's normal flow
// (CLAUDE.md authority model). A proof that only checks the ON half would
// happily pass a configuration that had locked the owner out of their own repo.
//
// Reads from the AUTHORITY — the GitHub API — never from a local file that
// merely describes the intent.
// ============================================================

import { execFileSync } from 'node:child_process';
import { SLUG, OWNER, REPO_NAME } from './repo-identity.mjs';
import { loadEnv } from './env-lib.mjs';

// SLUG comes from package.json's `repository.url` — the ONE home for this
// repo's identity (tools/repo-identity.mjs). Overridable for a fork.
const REPO = process.env.SAMO_REPO || SLUG;
const BRANCH = process.env.SAMO_BRANCH || 'main';

let p;
try {
  p = JSON.parse(execFileSync('gh',
    ['api', `repos/${REPO}/branches/${BRANCH}/protection`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch (e) {
  console.log(`✗ could not read protection for ${REPO}@${BRANCH}: ${String(e.stderr || e.message).trim().slice(0, 160)}`);
  console.log('\n1 FAILED');
  console.log('  A 404 here does not mean "fine" — it means protection is GONE.');
  process.exit(1);
}

const checks = [
  ['CI blocks a merge',
    (p.required_status_checks?.contexts || []).includes('build'), true,
    'a pull request with the whole suite red would be mergeable'],
  ['code-owner review blocks',
    p.required_pull_request_reviews?.require_code_owner_reviews, true,
    'CODEOWNERS would only REQUEST the owner; any collaborator could approve auth.js'],
  ['at least one approval required',
    (p.required_pull_request_reviews?.required_approving_review_count ?? 0) >= 1, true,
    'anything could merge unreviewed'],
  ['force-push blocked',
    p.allow_force_pushes?.enabled, false,
    'history could be rewritten under everyone'],
  ['branch deletion blocked',
    p.allow_deletions?.enabled, false,
    'main could be deleted'],
  // The OFF half. Deliberate, and re-asserted so nobody "tidies" it on.
  ['enforce_admins stays OFF',
    p.enforce_admins?.enabled, false,
    'the OWNER could no longer push main — it is what makes their normal flow work, '
    + 'and it is the escape hatch when their own PR cannot self-approve'],
];

// ---------------------------------------------------------------------------
// The SECOND place this repo's owner is written down, and it is not in git.
//
// Cloudflare Pages binds the preview builder to `source.config.owner` +
// `repo_name` in ITS OWN config. A repository transfer does not follow: the
// project keeps pointing at the old path, per-PR previews simply STOP being
// built, and nothing in this repository goes red — the pull request just never
// gets a preview comment, which looks like Cloudflare being slow.
//
// This project is moving to an organisation account, so that day is coming.
// Reading it here turns an invisible outside-git fact into a failing proof.
// ---------------------------------------------------------------------------
const { env } = loadEnv();
const cfAccount = env.CLOUDFLARE_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const cfToken = env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;

if (cfAccount && cfToken) {
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/pages/projects/${REPO_NAME}`,
      { headers: { Authorization: `Bearer ${cfToken}` } });
    const body = await res.json();
    const src = body?.result?.source?.config ?? {};
    checks.push(
      ['Cloudflare previews still point at this repo',
        `${src.owner}/${src.repo_name}`, `${OWNER}/${REPO_NAME}`,
        'the Pages project builds a repository that is no longer this one — per-PR '
        + 'previews stop, silently, and no test in this repo can see it. Reconnect the '
        + 'project (and install the Cloudflare GitHub App on the new account).'],
    );
  } catch (e) {
    // An unreachable API is UNKNOWN, never PASS.
    checks.push(['Cloudflare previews still point at this repo',
      `unreachable: ${String(e.message).slice(0, 60)}`, `${OWNER}/${REPO_NAME}`,
      'could not ask Cloudflare; this is not evidence that it is fine']);
  }
} else {
  console.log('– Cloudflare owner check SKIPPED: no CLOUDFLARE_ACCOUNT_ID / '
    + 'CLOUDFLARE_API_TOKEN in .env.local. After a repo transfer, run this WITH them.');
}

let failed = 0;
for (const [name, got, want, consequence] of checks) {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}: expected ${want}, got ${got}`
    + (ok ? '' : `\n    → ${consequence}`));
}
console.log(failed ? `\n${failed} FAILED` : `\nall ${checks.length} pass`);
process.exit(failed ? 1 : 0);
