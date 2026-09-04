// ============================================================
// redirects-order.test.js — a catch-all makes every missing path look fine.
//
// public/_redirects ends with `/* /index.html 200`, which is what makes SPA
// routing work — and also what made /passport/ answer 200 with the PUBLIC
// APP'S OWN HTML on every Cloudflare preview. The Passport button opened a new
// tab showing the same site again, silently. Reported 2026-08-31: "i click the
// samopassport open button ... it doesnt go there".
//
// ⚠️ ORDER IS THE WHOLE MECHANISM. Cloudflare evaluates top→bottom and stops
// at the first match, so a rule placed BELOW the catch-all is dead markup that
// reads exactly like a working rule. That is why this asserts POSITION, not
// merely presence.
//
// ⚠️ WHAT CHANGED 2026-09-04, and why this file lost two assertions rather than
// having its numbers edited. This used to require `/passport/*` and `/passport`
// rules pointing at a splash page, because passport lived in a separate repo
// and genuinely was not in this build. The repo merge builds passport into
// dist/passport/, so REAL FILES now sit at that path — and Cloudflare serves a
// matching static asset ahead of a `_redirects` 200-rewrite, which is the same
// reason /assets/*.js and /admin/index.html are not swallowed by the catch-all
// today. The protection is therefore no longer "a rule above the catch-all", it
// is "the build emits files there", so that is what is asserted below.
//
// ⛔ The rule count floor moved 3 → 2 for that reason and ONLY that reason. If
// it ever needs moving again, check whether the SHAPE really changed or whether
// the fastest path to green is being taken — editing a guard's number to match
// whatever the code now does is how a guard stops meaning anything.
//
// nginx never reads this file — production serves /passport/ from its own
// location block — so nothing here can affect the live site.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const lines = readFileSync(join(ROOT, 'public/_redirects'), 'utf8')
  .split('\n').map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const indexOfRule = (prefix) => lines.findIndex((l) => l.split(/\s+/)[0] === prefix);

describe('_redirects rule order', () => {
  it('has rules to check (a sweep that finds nothing must prove it looked)', () => {
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('the SPA catch-all is last', () => {
    const catchAll = indexOfRule('/*');
    expect(catchAll, 'no `/*` catch-all — SPA deep links would 404').toBeGreaterThanOrEqual(0);
    expect(catchAll, 'a rule sits BELOW the catch-all and can never match')
      .toBe(lines.length - 1);
  });

  it('every specific rule sits above the catch-all', () => {
    const catchAll = indexOfRule('/*');
    for (const prefix of ['/admin/*']) {
      const at = indexOfRule(prefix);
      expect(at, `${prefix} is missing from _redirects`).toBeGreaterThanOrEqual(0);
      expect(at, `${prefix} is below the catch-all, so it never matches`).toBeLessThan(catchAll);
    }
  });

  // The replacement for the two deleted assertions. /passport/ is kept away
  // from the catch-all by REAL FILES now, so this asserts the thing that
  // actually emits them. Delete the passport build and this goes red — which is
  // the failure that would otherwise show up as "the Passport button opens the
  // public site again", the exact 2026-08-31 report.
  it('passport is served by real files, so it needs no rule and must not have one', () => {
    const stray = lines.filter((l) => l.split(/\s+/)[0].startsWith('/passport'));
    expect(stray, [
      'A /passport rule is back in _redirects. It would shadow the real files',
      'built into dist/passport/ and send visitors somewhere else — which is the',
      'bug the repo merge removed. Delete the rule.',
    ].join('\n')).toEqual([]);

    expect(existsSync(join(ROOT, 'passport/index.html')),
      'passport/index.html is gone — nothing will be emitted at /passport/ and the '
      + 'catch-all will answer it with the PUBLIC app, silently').toBe(true);

    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.build, 'the root build no longer runs the passport build, so '
      + 'dist/passport/ will be empty and /passport/ falls to the catch-all')
      .toContain('build:passport');
    expect(pkg.scripts['build:passport'], 'build:passport is missing').toBeTruthy();
  });

  it('every rule names a file that will exist in the build', () => {
    // A rule pointing at a missing file falls through to Cloudflare's own 404,
    // which looks like the rule was never written.
    const missing = [];
    for (const l of lines) {
      const dest = l.split(/\s+/)[1] || '';
      if (!dest.startsWith('/') || dest.includes('*')) continue;
      const inPublic = existsSync(join(ROOT, 'public', dest));
      const built = dest === '/index.html' || dest === '/admin/index.html'; // emitted by vite
      if (!inPublic && !built) missing.push(dest);
    }
    expect(missing, 'a _redirects destination has no source file').toEqual([]);
  });
});
