// ============================================================
// repo-identity.mjs — WHO OWNS THIS REPOSITORY, in exactly one place.
//
// The owner is `package.json`'s `repository.url`. Nothing else may hardcode it.
//
// WHY THIS EXISTS. The project moved off a personal GitHub account onto the
// `samomdkku` organisation on 2026-08-31. The old personal slug stopped being
// true that day — this comment does not spell it out, because THIS FILE IS
// SWEPT BY ITS OWN RULE — and the day before the move that string had
// FORTY-TWO homes across nineteen files: two tools, the docs-site config, five workflows and links,
// and a long tail of prose. GitHub redirects the repo URL after a transfer, so
// most of them would keep WORKING while being wrong, until the old account is
// renamed or deleted and they all die at once. That is this repo's single most
// expensive bug shape (.claude/rules/mistakes.md class 6): one fact, many
// homes, and only some of them corrected.
//
// So: a transfer should be `npm version`-style mechanical — change ONE field,
// run `npm test`, and be told every prose reference that still disagrees
// (`src/js/repo-identity.test.js`).
//
// ⚠️ A PERSON is not the REPOSITORY. `@phuriphatma` in `.github/CODEOWNERS`,
// the reviewer named in `CONTRIBUTING.md`, and `docs/state/phuriphatma.md`
// name a HUMAN, who is still that human after the move. A blind find-and-
// replace across the repo would break all three. The guard knows the
// difference; a `sed` does not.
// ============================================================
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const m = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(pkg.repository?.url ?? '');
if (!m) {
  throw new Error(
    'package.json needs `"repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" }`'
    + ' — it is the ONE home for this repository\'s identity (tools/repo-identity.mjs).',
  );
}

/** The GitHub account or organisation that owns the repo. */
export const OWNER = m[1];
/** The repository name — also the GitHub Pages path segment. */
export const REPO_NAME = m[2];
/** `owner/repo`, the form `gh` takes. */
export const SLUG = `${OWNER}/${REPO_NAME}`;
export const GITHUB_URL = `https://github.com/${SLUG}`;
/** Where a GitHub Pages PROJECT site is served from. A custom domain changes this. */
export const PAGES_BASE = `/${REPO_NAME}/`;
export const PAGES_URL = `https://${OWNER}.github.io/${REPO_NAME}/`;
/** Cloudflare Pages names preview subdomains after the project, not the owner. */
export const PREVIEW_HOST_SUFFIX = `${REPO_NAME}.pages.dev`;

/**
 * Repositories that move WITH this one — same account, same transfer, same day
 * every stale link to them rots. Declared HERE rather than in the test that
 * first needed it, because a second consumer arrived (repo-protection.mjs
 * guards the sibling's branch protection) and two hand-kept lists of one fact
 * is the shape this module exists to prevent.
 */
// ⛔ EMPTY SINCE 2026-09-04, deliberately — do not "restore" it.
// samomdkkupassport was merged into this repo (git subtree, docs/PASSPORT-MONOREPO.md)
// and then ARCHIVED. Every check that looped over it is now either meaningless
// (branch protection on a read-only repo) or covered locally and better:
// src/js/host-guard.test.js reads all SIX built entries from disk, in this repo,
// instead of fetching four of them over the GitHub API.
//
// A guard whose SUBJECT has rotted is worse than no guard — it runs, it passes,
// and it proves nothing about anything anyone can still change (house0116,
// proj0092). If a genuine sibling repo ever exists again, add it here and the
// loops below light up.
export const SIBLING_REPOS = [];
