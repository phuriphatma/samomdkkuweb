// ==============================================
// A DIAGRAM IS A VIEW YOU HAVE NOT OPENED UNTIL SOMETHING LOOKS AT IT.
//
// REPORTED: "the picture on When your work depends on other work — the orange
// highlight box is not aligned". It was not an alignment error. `x` was correct
// and text-anchor was correct; the BOX was 56px too narrow, so a 268px sentence
// hung out of both ends of a 212px chip. A second, unreported one was found the
// moment an instrument existed: a caption in branches.svg started at x=640,
// needed 289px, and ran 29px past the 900px frame — its last two words were
// simply not on the picture.
//
// Nothing catches this on its own. An SVG whose text overflows its rect is
// valid SVG, renders without warning, and passes every test in this repo. The
// build does not read it, and prose review does not measure it.
//
// ⚠️ THE INSTRUMENT IS AN ESTIMATE AND SAYS SO — there is no font metric here,
// only a per-character width table (tools/svg-text-fit.mjs). It is built to err
// on the wide side, so a label it passes has room. It CANNOT see two shapes
// overlapping, which is the other half of this class and was also present: an
// orange caption crossing a green curve, and a leader line struck through a
// caption. Both were found by rendering the file and looking at it. **This test
// narrows what you have to look for; it does not replace looking.**
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { overflows, textWidth, span } from '../../tools/svg-text-fit.mjs';

const DIAGRAMS = join(import.meta.dirname, '..', '..', 'docs', 'diagrams');
const files = readdirSync(DIAGRAMS).filter((n) => n.endsWith('.svg'));

describe('the instrument itself', () => {
  it('catches the exact overflow that was reported (control)', () => {
    // The dependent-features box as it shipped: a 212px chip holding the real
    // sentence. If this stops being flagged, the sweep below is vacuous.
    const svg = '<svg><rect x="0" y="0" width="900" height="200"/>'
      + '<rect x="472" y="52" width="212" height="27"/>'
      + '<text x="578" y="70" text-anchor="middle" font-size="12.5">'
      + 'feat/b — branched off feat/a, not off main</text></svg>';
    const hits = overflows(svg);
    expect(hits.length).toBe(1);
    expect(hits[0].need).toBeGreaterThan(hits[0].have);
  });

  it('does NOT flag a label that fits (control in the other direction)', () => {
    // A deny-only probe cannot tell a working guard from a broken one.
    const svg = '<svg><rect x="0" y="0" width="900" height="200"/>'
      + '<rect x="400" y="52" width="316" height="28"/>'
      + '<text x="558" y="70" text-anchor="middle" font-size="12.5">'
      + 'feat/b — branched off feat/a, not off main</text></svg>';
    expect(overflows(svg)).toEqual([]);
  });

  it('measures an anchored label from the right edge, not the left', () => {
    // text-anchor="end" was how the clipped caption in branches.svg was fixed,
    // so the instrument has to understand it or it re-flags the fix.
    expect(span({ x: 800, size: 12, anchor: 'end', text: 'abc' })[1]).toBe(800);
    expect(span({ x: 800, size: 12, anchor: 'start', text: 'abc' })[0]).toBe(800);
  });

  it('does not count Thai marks that advance no width', () => {
    // Thai vowels and tone marks sit above and below the line. Counting them
    // would over-estimate every Thai label by roughly a third and push each box
    // wider than it needs to be — a guard that makes the diagrams worse.
    expect(textWidth('ที่', 12)).toBeLessThan(textWidth('ทีอ', 12));
  });
});

describe('every diagram in docs/diagrams', () => {
  it('has diagrams to check at all (control)', () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files)('%s — no label overflows its box or the frame', (name) => {
    const hits = overflows(readFileSync(join(DIAGRAMS, name), 'utf8'));
    const report = hits
      .map((h) => `  ${h.kind}: “${h.text}” needs ~${h.need}px, box is ${h.have}px [${h.box}]`)
      .join('\n');
    expect(hits, `${name} has text that does not fit:\n${report}\n`
      + 'Widen the rect or shorten the label — do not just move x, which is what '
      + '“not aligned” tempts you to do.').toEqual([]);
  });

  it('gives every diagram a <title>, which is its alt text for a screen reader', () => {
    for (const name of files) {
      const svg = readFileSync(join(DIAGRAMS, name), 'utf8');
      expect(svg, `${name} has no <title>`).toMatch(/<title>[^<]{10,}<\/title>/);
    }
  });

  it('is referenced by a docs page — an unused diagram is a diagram nobody maintains', () => {
    const pages = readdirSync(join(DIAGRAMS, '..', 'start'))
      .filter((n) => n.endsWith('.md'))
      .map((n) => readFileSync(join(DIAGRAMS, '..', 'start', n), 'utf8'))
      .join('\n');
    for (const name of files) {
      expect(pages, `docs/diagrams/${name} is referenced by no page under docs/start/`)
        .toContain(name);
    }
  });
});
