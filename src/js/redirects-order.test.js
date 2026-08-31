// ============================================================
// redirects-order.test.js — a catch-all makes every missing path look fine.
//
// public/_redirects ends with `/* /index.html 200`, which is what makes SPA
// routing work — and also what made /passport/ answer 200 with the PUBLIC
// APP'S OWN HTML on every Cloudflare preview. Passport lives in a separate
// repo, so it is not in this build; the Passport button opened a new tab
// showing the same site again, silently. Reported 2026-08-31: "i click the
// samopassport open button ... it doesnt go there".
//
// ⚠️ ORDER IS THE WHOLE MECHANISM. Cloudflare evaluates top→bottom and stops
// at the first match, so a rule placed BELOW the catch-all is dead markup that
// reads exactly like a working rule. That is why this asserts POSITION, not
// merely presence.
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
    expect(lines.length).toBeGreaterThan(2);
  });

  it('the SPA catch-all is last', () => {
    const catchAll = indexOfRule('/*');
    expect(catchAll, 'no `/*` catch-all — SPA deep links would 404').toBeGreaterThanOrEqual(0);
    expect(catchAll, 'a rule sits BELOW the catch-all and can never match')
      .toBe(lines.length - 1);
  });

  it('every specific rule sits above the catch-all', () => {
    const catchAll = indexOfRule('/*');
    for (const prefix of ['/admin/*', '/passport/*', '/passport']) {
      const at = indexOfRule(prefix);
      expect(at, `${prefix} is missing from _redirects`).toBeGreaterThanOrEqual(0);
      expect(at, `${prefix} is below the catch-all, so it never matches`).toBeLessThan(catchAll);
    }
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
