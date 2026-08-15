// ==============================================
// A TINT NAME WITH NO --dept-* BEHIND IT DISAPPEARS, SILENTLY.
//
// The ทีม SAMO admin tree sets `--node-tint: var(--dept-<name>)` on each root
// ฝ่าย and the whole subtree inherits it — the bar, the band and the guide
// rails are all drawn from that one property. If the custom property does not
// exist, `var()` resolves to nothing: no error, no console warning, no failed
// request. The bar is simply not painted, and a tree with no bars looks like a
// design decision rather than a typo.
//
// That is `.claude/rules/mistakes.md` class 6 in its CSS form — "a class in the
// markup with NO rule in any stylesheet is invisible in review" — and this repo
// has paid for it more than once.
//
// The subject is DERIVED from the table (TINT_NAMES), not listed again here, so
// a tint added tomorrow is checked tomorrow without anyone remembering to.
//
// TO CHECK IT GUARDS: add `[/ทดสอบ/, 'nosuchtint']` to DEPT_TINT in
// dept-tint.js and watch this fail naming it. Then remove it.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TINT_NAMES, tintFor } from './dept-tint.js';

const base = readFileSync(new URL('../css/base.css', import.meta.url), 'utf8');

describe('every tint the table can return exists in base.css', () => {
  it('has a --dept-<name> custom property for each', () => {
    expect(TINT_NAMES.length, 'the table returned no tints at all').toBeGreaterThan(0);
    const missing = TINT_NAMES.filter((t) => !new RegExp(`--dept-${t}\\s*:`).test(base));
    expect(missing, `no --dept-* in base.css for: ${missing.join(', ')}`).toEqual([]);
  });

  it('the control: the scanner would notice one that is absent', () => {
    // "Zero missing" is only evidence once the same test has been shown to find
    // a missing one. Otherwise a broken path or a bad regex prints zero too.
    expect(new RegExp('--dept-nosuchtint\\s*:').test(base)).toBe(false);
    expect(new RegExp('--dept-digital\\s*:').test(base)).toBe(true);
  });
});

describe('the table is shared, so both surfaces agree', () => {
  it('matches the real ฝ่าย names the tree carries', () => {
    // Named subjects rot (class 4 of the guard playbook), so these are the
    // stable stems the regexes are actually written against, not full titles
    // copied out of the live tree.
    expect(tintFor('ฝ่ายดิจิทัลและสื่อสารองค์กร')).toBe('digital');
    expect(tintFor('ฝ่ายวิชาการ')).toBe('academic');
    expect(tintFor('สำนักนายกฯ')).toBe('admin');
  });

  it('returns null for a ฝ่าย the palette has none for', () => {
    // 15 roots, 10 colours — this path is normal. Both consumers fall back to
    // the brand green, so it must be a clean null rather than undefined or ''.
    expect(tintFor('เอิงtesting')).toBeNull();
    expect(tintFor('')).toBeNull();
    expect(tintFor(null)).toBeNull();
  });
});
