// ============================================================
// route-normalise.test.js — a shared link with a trailing slash must not
// silently land on the landing tab.
//
// `/tools/golden-period/` matched no PATH_ROUTES entry and fell through to
// home, which reads as "the link is broken" rather than as a routing gap.
// Nested paths make it far likelier because people paste URLs with a slash.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8');

describe('path routing', () => {
  it('strips a trailing slash before matching', () => {
    const fn = /function pathToTab\(pathname\)\s*\{[\s\S]*?\n\}/.exec(src)?.[0];
    expect(fn, 'pathToTab not found — did it move?').toBeTruthy();
    expect(fn, [
      'pathToTab must normalise a trailing slash before matching PATH_ROUTES,',
      'or every shared "/shop/" style link lands on the landing tab silently.',
    ].join('\n')).toMatch(/replace\(\/\\\/\+\$\//);
  });

  it('matches the normalised path, not the raw one, in every branch', () => {
    const fn = /function pathToTab\(pathname\)\s*\{[\s\S]*?\n\}/.exec(src)[0];
    // The regex branch must test the NORMALISED value too — testing `pathname`
    // there would leave /news/x/ broken while /shop/ was fixed.
    expect(fn.includes('test(pathname)'),
      'a branch still tests the raw pathname; it must test the normalised one').toBe(false);
  });
});
