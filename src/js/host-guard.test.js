// ============================================================
// host-guard.test.js — the retired hosts redirect, and NOTHING ELSE does.
//
// Both entry HTMLs carry an inline script that forwards the two retired
// pages.dev deployments to /moved.html. Until 2026-08-27 it tested
// /\.pages\.dev$/ — ANY pages.dev host — which was correct while pages.dev
// meant "retired", and became a trap the moment previews were planned onto
// pages.dev (docs/TEAM-WORKFLOW.md §1 + D8): every per-PR preview URL would
// have bounced to the "we've moved" splash, and the cause would have looked
// like a broken deploy rather than a four-year-old redirect.
//
// This tests the REGEX THAT SHIPS, pulled out of the HTML — not a copy of it
// living in the test, which would just agree with itself. And it tests BOTH
// entries: fixing one and not the other is this repo's most repeated shape.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url).pathname;
const ENTRIES = ['index.html', 'admin/index.html'];

/** The live predicate, extracted from the shipped inline script. */
function guardFor(file) {
  const html = readFileSync(ROOT + file, 'utf8');
  const m = /if \((\/[^\n]*?\/i)\.test\(location\.hostname\)/.exec(html);
  expect(m, `${file}: no hostname guard found — did the inline script move?`).toBeTruthy();
  // eslint-disable-next-line no-eval
  const re = eval(m[1]);
  return (host) => re.test(host);
}

const MUST_REDIRECT = [
  'samomdkkuweb.pages.dev',
  'refactorsamomdkkuweb.pages.dev',
  // Cloudflare preview builds of the RETIRED projects are still retired.
  'abc123.samomdkkuweb.pages.dev',
  'deadbeef.refactorsamomdkkuweb.pages.dev',
];

const MUST_NOT_REDIRECT = [
  'samo.md.kku.ac.th',        // production
  'localhost',                // dev
  '127.0.0.1',
  // The whole point of narrowing: previews live on pages.dev too.
  'samo-preview.pages.dev',
  '7f3a91c2.samo-preview.pages.dev',
  'some-other-project.pages.dev',
];

describe('the deprecated-host guard', () => {
  for (const file of ENTRIES) {
    describe(file, () => {
      const redirects = guardFor(file);

      it('redirects both retired hosts and their preview subdomains', () => {
        const missed = MUST_REDIRECT.filter((h) => !redirects(h));
        expect(missed, `${file}: a RETIRED host would no longer be forwarded to /moved.html`)
          .toEqual([]);
      });

      it('redirects nothing else — production, dev, or a preview URL', () => {
        const wrong = MUST_NOT_REDIRECT.filter((h) => redirects(h));
        expect(wrong, [
          `${file}: a host that must NOT be redirected is being sent to /moved.html.`,
          'If a preview URL is in this list, every per-PR preview is dead on arrival',
          'and it looks like a broken deploy rather than this redirect.',
        ].join('\n')).toEqual([]);
      });
    });
  }

  it('both entries carry the SAME predicate', () => {
    const [a, b] = ENTRIES.map((f) => {
      const html = readFileSync(ROOT + f, 'utf8');
      return /if \((\/[^\n]*?\/i)\.test\(location\.hostname\)/.exec(html)[1];
    });
    expect(a, 'the two entry HTMLs guard different hosts — one was edited alone').toBe(b);
  });
});
