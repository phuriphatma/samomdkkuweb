#!/usr/bin/env node
// ============================================================
// preview-url.mjs — "where is my branch's preview?"
//
//   npm run preview:url                 # the branch you are on
//   npm run preview:url -- feat/thing   # any branch
//
// WHY. Cloudflare posts the preview link into the pull request, which means
// finding it costs a trip to GitHub every time. It does not have to: a preview
// gets a STABLE per-branch address derived from the branch name, so the link
// for a branch is knowable before the build even finishes, and it stays the
// same for every push to that branch. Bookmark it once.
//
//   branch  ci/prove-smoke-job
//   URL     https://ci-prove-smoke-job.samomdkkuweb.pages.dev
//
// TWO ANSWERS, AND THE AUTHORITATIVE ONE WINS. The derived name is a guess
// about Cloudflare's slug rules (lowercase, non-alphanumerics to '-', and a
// length cap this repo has not tested at the boundary). So when `gh` is
// available this also reads the URL out of the Cloudflare check on the
// branch's head commit — that is what Cloudflare actually built — and says so
// when the two disagree. Guessing a URL and reporting it as fact is how a
// person ends up testing a page that does not exist.
// ============================================================
import { execFileSync } from 'node:child_process';
import { REPO_NAME, SLUG } from './repo-identity.mjs';

// The owner/repo has ONE home — package.json's `repository.url`. See
// tools/repo-identity.mjs: this project is moving to an organisation account,
// and a hardcoded slug here would keep working (GitHub redirects) right up
// until it silently didn't.
const PROJECT = REPO_NAME;
const REPO = SLUG;

const sh = (cmd, args) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};

const branch = process.argv[2] || sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (!branch || branch === 'HEAD') {
  console.error('could not work out a branch — pass one: npm run preview:url -- my/branch');
  process.exit(2);
}

if (branch === 'main') {
  console.log(`\nYou are on main. main is PRODUCTION, and it does not get a preview.`);
  console.log(`  production   https://samo.md.kku.ac.th`);
  console.log(`\nMake a branch and open a pull request to get a preview.\n`);
  process.exit(0);
}

/** Cloudflare's branch alias: lowercase, non-alphanumerics to '-', capped. */
const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28);
const derived = `https://${slug}.${PROJECT}.pages.dev`;

// The authority: what Cloudflare says it built for this branch's head commit.
let actual = null;
let note = '';
const sha = sh('git', ['rev-parse', branch]) || sh('git', ['rev-parse', `origin/${branch}`]);
if (sha) {
  const raw = sh('gh', ['api', `repos/${REPO}/commits/${sha}/check-runs`,
    '--jq', '.check_runs[] | select(.name|test("Cloudflare")) | .output.summary']);
  if (raw) {
    const urls = [...raw.matchAll(/https:\/\/[a-z0-9.-]*pages\.dev/g)].map((m) => m[0]);
    actual = urls.find((u) => !/^https:\/\/[0-9a-f]{8}\./.test(u)) || urls[0] || null;
  } else {
    note = 'no Cloudflare build found for this commit yet — push it, or open the PR';
  }
}

console.log(`\nbranch     ${branch}`);
console.log(`preview    ${actual || derived}${actual ? '' : '   (derived — not yet confirmed by a build)'}`);
if (actual && actual !== derived) {
  console.log(`           ⚠️  derived ${derived} — Cloudflare used the address above, trust that one`);
}
if (note) console.log(`           ${note}`);

console.log(`
This address is STABLE for the branch — bookmark it, it updates on every push.
It runs against the samo-dev database, so nothing you do there touches real data.

⚠️  SIGNING IN: Google sign-in is OFF on samo-dev, so the Google button lands on
    a Supabase error page. Use a username/password account on previews until an
    OAuth client is set up for dev (docs/TEAM-WORKFLOW.md §3).
`);
