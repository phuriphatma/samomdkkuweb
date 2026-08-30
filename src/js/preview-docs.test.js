// ============================================================
// preview-docs.test.js — the contributor guide must agree with the pipeline.
//
// WHY THIS EXISTS. Per-PR previews shipped as phase 3 of the dev system
// (docs/TEAM-WORKFLOW.md §8): Cloudflare builds every branch, comments the link
// on the pull request, and points the build at `samo-dev` rather than
// production. `CONTRIBUTING.md` went on saying **"There is no preview deploy"**
// afterwards — the single sentence a new ฝ่าย contributor reads before deciding
// how to test their change. §9 of that same design lists this file as one that
// must be corrected "when the phase lands", and nothing enforced it.
//
// This repo has a name for that shape: PROSE IS AN IMPLEMENTATION TOO
// (.claude/rules/mistakes.md, class 6). One fact with two homes, one of them
// corrected. A document has no compiler, so it gets a test instead.
//
// WHAT IT ASSERTS, and why it is not just a grep for a phrase:
//
//   1. the matcher can find a denial at all              (control — §2 of
//      skills/write-a-guard.md: a sweep returning zero has said nothing until
//      it is shown returning something)
//   2. the repo really does ship preview tooling          (the premise; if this
//      ever stops being true the test says so LOUDLY rather than quietly
//      exempting itself — an exemption that outlives the absence is trap #4)
//   3. no contributor-facing doc denies previews          (the correction)
//   4. CONTRIBUTING.md positively TELLS you they exist    (the property — 3
//      alone is satisfied by deleting the paragraph, which is how a reader ends
//      up knowing nothing instead of knowing something false)
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

/**
 * Ways a document can tell a contributor that previews do not exist.
 *
 * Deliberately NOT anchored to the exact sentence that was wrong — matching one
 * spelling of a hazard is how `definer-authz.test.js` stayed green over the bug
 * it was written for. These match the CLAIM, however it is phrased.
 */
const DENIALS = [
  /\bno preview\b/i,
  /\bnothing (?:builds|comments|deploys)\b[^.\n]*\bbranch\b/i,
  /previews?\b[^.\n]*\b(?:are|is|was|were)\s+(?:not|never)\s+(?:available|built|enabled)/i,
];

/** The docs a contributor actually reads before their first pull request. */
const CONTRIBUTOR_DOCS = ['CONTRIBUTING.md', 'README.md', 'docs/CONTRIBUTE.md'];

describe('the contributor guide agrees with the preview pipeline', () => {
  it('the denial matcher can find a denial (control)', () => {
    const fixture = 'There is **no preview deploy** — Cloudflare Pages is retired, so nothing\n'
      + 'comments a per-branch URL. Review visually by running `npm run dev` locally.';
    const hits = DENIALS.filter((re) => re.test(fixture));
    // The exact text that sat in CONTRIBUTING.md. If this stops matching, every
    // assertion below is vacuous and would report green over the same sentence.
    expect(hits.length, 'the matcher no longer recognises the original wrong sentence').toBeGreaterThan(0);
  });

  it('the repo ships per-branch preview tooling (the premise)', () => {
    // Stated as an assertion, not a skip condition. If previews are genuinely
    // withdrawn one day this goes RED and a human decides what the docs should
    // say — rather than the test silently excusing itself and the docs drifting
    // in the other direction.
    expect(existsSync(join(ROOT, 'tools/preview-url.mjs')),
      'tools/preview-url.mjs is gone — if previews were removed, say so in CONTRIBUTING.md and update this test').toBe(true);
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['preview:url'], 'the preview:url script is gone').toBeTruthy();
  });

  for (const doc of CONTRIBUTOR_DOCS) {
    it(`${doc} does not tell a contributor previews do not exist`, () => {
      const text = read(doc);
      const found = DENIALS
        .map((re) => text.match(re))
        .filter(Boolean)
        .map((m) => m[0]);
      expect(found, `${doc} denies previews: ${JSON.stringify(found)}`).toEqual([]);
    });
  }

  it('the guide tells a contributor how to reach their preview', () => {
    // The canonical home is docs/CONTRIBUTE.md — one page for both audiences.
    // CONTRIBUTING.md is a POINTER on purpose (it held a stale copy of this
    // very fact until 2026-08-30), so it is swept for denials above but is not
    // where the explanation has to live.
    const text = read('docs/CONTRIBUTE.md');
    expect(text, 'the guide never mentions npm run preview:url').toMatch(/preview:url/);
  });

  it('CONTRIBUTING.md points at the guide instead of copying it', () => {
    const text = read('CONTRIBUTING.md');
    expect(text, 'CONTRIBUTING.md does not link the guide').toMatch(/CONTRIBUTE/);
  });

  it('and says a preview points at the dev database, not production', () => {
    // The reason a preview is safe to submit forms on. A contributor who does
    // not know this either avoids testing writes at all, or assumes the same of
    // production. Both are worse than knowing.
    const text = read('docs/CONTRIBUTE.md');
    expect(text, 'the guide does not say a preview points at the dev database')
      .toMatch(/(preview|ทดลอง)[\s\S]{0,600}(samo-dev|สำเนา)/i);
  });
});
