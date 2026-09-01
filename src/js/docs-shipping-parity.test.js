import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { collect } from '../../docs/.vitepress/config.mjs';

// ============================================================
// "What production serves" has TWO spellings, and they drifted.
//
//   docs/.vitepress/config.mjs  — decides what is BUILT and PUBLISHED
//   tools/deploy-owed.mjs       — decides what counts as a DEPLOY BEING OWED
//
// On 2026-08-31 `deploy-owed` learned about `docs/` at all, after answering
// "production is current" while /docs was an entire restructure behind. On
// 2026-09-01 the same failure was found one directory deeper: it excluded
// `docs/state/**`, VitePress did not, and samo.md.kku.ac.th/docs/state/<handle>
// was serving a stale page while the tool said nothing was owed.
//
// Both times the tool failed GREEN — it under-reported rather than
// over-reported — which is the direction nobody investigates.
//
// This is the differential test the repo prescribes for two spellings of one
// rule (mistakes class 6): assert the PROPERTY — every page VitePress actually
// publishes is a page deploy-owed can see — rather than comparing two lists,
// which would pass if both were wrong in the same way.
// ============================================================
const OWED = readFileSync(new URL('../../tools/deploy-owed.mjs', import.meta.url), 'utf8');

/** The `:!<pathspec>` exclusions inside deploy-owed's SHIPPED list. */
function shippedExclusions() {
  const block = OWED.slice(OWED.indexOf('const SHIPPED = ['), OWED.indexOf('];', OWED.indexOf('const SHIPPED = [')));
  return [...block.matchAll(/':!([^']+)'/g)].map((m) => m[1]);
}

describe('deploy-owed can see everything the docs site publishes', () => {
  it('deploy-owed watches docs/ at all — the 2026-08-31 regression', () => {
    // The control. Every assertion below is vacuous if `docs/` is not watched.
    const block = OWED.slice(OWED.indexOf('const SHIPPED = ['), OWED.indexOf('];', OWED.indexOf('const SHIPPED = [')));
    expect(block).toContain("'docs/'");
  });

  it('the docs site publishes pages — collect() is not returning nothing', () => {
    // Second control: if collect() ever returned [], the parity check below
    // would pass over an empty set and prove nothing.
    expect(collect().length).toBeGreaterThan(10);
  });

  it('no page VitePress publishes is excluded from deploy-owed', () => {
    const pages = collect();                    // paths relative to docs/
    const excl  = shippedExclusions()
      .filter((p) => p.startsWith('docs/'))
      .map((p) => p.replace(/^docs\//, '').replace(/\/?\*\*$/, ''));

    const blind = pages.filter((page) => excl.some((e) => page === e || page.startsWith(`${e}/`)));

    expect(
      blind,
      'these pages are SERVED at samo.md.kku.ac.th/docs but deploy-owed cannot '
      + 'see them change, so it will report "nothing owed" over a stale page. '
      + 'Either drop the exclusion from tools/deploy-owed.mjs, or stop '
      + 'publishing them via srcExclude in docs/.vitepress/config.mjs — but the '
      + 'two must agree.',
    ).toEqual([]);
  });
});
