// ==============================================
// STATE MUST OUT-SPECIFY IDENTITY IN THE ทีม SAMO TREE.
//
// A ฝ่าย row carries a coloured band saying WHAT it is. "Selected" and "being
// dragged" say what is HAPPENING to it, and those have to win — but CSS
// resolves by specificity, not by which rule is about the more urgent thing.
//
// It shipped broken. The band is
// `.team-node[data-kind="…"][data-depth="…"] > .team-row` at (0,4,0); the state
// rules were `.team-node.is-selected > .team-row` at (0,3,0) and
// `.team-chosen > .team-row` at (0,2,0). On every ฝ่าย row the band won, so
// selecting one showed no highlight and long-pressing one to drag showed no
// ring — the exact silence `.team-chosen` exists to prevent.
//
// WHY THIS IS A TEST AND NOT A COMMENT. Nothing throws. The rule is still
// there, still valid, still parsed — it just never wins, and CSS has no
// diagnostic for that. `.claude/rules/mistakes.md` class 6 on CSS is blunt
// about it: a rule that stops matching looks like a feature nobody built.
//
// Ordering would not have been enough to assert, either: the state rules
// currently sit after the bands, so a source-order check would pass today and
// go quietly false the first time someone appends a band rule at the bottom of
// the file. The NUMBER is the invariant.
//
// TO CHECK IT GUARDS: drop `[data-depth]` from either state selector in
// team.css and watch this fail with both numbers printed. Then put it back.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const css = stripComments(readFileSync(new URL('../css/team.css', import.meta.url), 'utf8'));

/**
 * Specificity (b, c) of a compound selector — ids are not used anywhere in this
 * file, so the a-column is ignored deliberately rather than half-implemented.
 *   b = classes + attributes + pseudo-classes
 *   c = element names + pseudo-elements
 */
function specificity(sel) {
  const s = sel.replace(/::[\w-]+/g, ' ');           // pseudo-elements → c, none here
  const b = (s.match(/\.[\w-]+/g) || []).length      // .class
          + (s.match(/\[[^\]]+\]/g) || []).length    // [attr]
          + (s.match(/:(?!:)[\w-]+/g) || []).length; // :hover, :first-child
  return b;
}

/** Every selector in the file that targets `> .team-row`, in source order. */
function rowSelectors() {
  const out = [];
  const re = /(^|\})\s*([^{}]*?>\s*\.team-row(?::[\w-]+)?)\s*\{/gm;
  let m;
  while ((m = re.exec(css)) !== null) {
    for (const sel of m[2].split(',')) {
      const t = sel.trim();
      if (t) out.push({ sel: t, at: m.index, b: specificity(t) });
    }
  }
  return out;
}

describe('the ทีม SAMO tree: state rules out-specify the ฝ่าย band', () => {
  const rows = rowSelectors();
  const bands = rows.filter((r) => /data-kind="division"/.test(r.sel) && !/:hover/.test(r.sel));
  const states = rows.filter((r) => /\.is-selected|\.team-chosen/.test(r.sel));

  it('the scanner found both sets — otherwise every assertion below is vacuous', () => {
    // THE CONTROL. A regex that matches nothing satisfies "no band out-specifies
    // a state rule" perfectly, and that is how a sweep reports green over a live
    // hazard. Print what it found.
    expect(bands.length, `bands found: ${bands.map((b) => b.sel).join(' | ')}`)
      .toBeGreaterThan(0);
    expect(states.length, `state rules found: ${states.map((s) => s.sel).join(' | ')}`)
      .toBe(2);
  });

  it('every state rule beats every band rule on weight alone', () => {
    const worstBand = Math.max(...bands.map((b) => b.b));
    for (const st of states) {
      expect(
        st.b,
        `${st.sel} is (0,${st.b},0) but a band reaches (0,${worstBand},0) — `
        + 'the band will win and the state will not draw',
      ).toBeGreaterThan(worstBand);
    }
  });

  it('both states are covered — selection AND drag', () => {
    // The two were introduced by different features and broke together; naming
    // them individually stops a fix that only restores one.
    expect(states.some((s) => s.sel.includes('.is-selected')), 'no selected-row rule').toBe(true);
    expect(states.some((s) => s.sel.includes('.team-chosen')), 'no dragged-row rule').toBe(true);
  });

  it('the specificity function agrees with the values this file relies on', () => {
    // The instrument, checked before it is trusted — a counter that returns the
    // same number for everything would make the comparison above meaningless.
    expect(specificity('.team-node[data-kind="division"][data-depth="0"] > .team-row')).toBe(4);
    expect(specificity('.team-node.is-selected > .team-row')).toBe(3);
    expect(specificity('.team-chosen > .team-row')).toBe(2);
    expect(specificity('.team-node[data-kind][data-depth].is-selected > .team-row')).toBe(5);
    expect(specificity('.team-row:hover')).toBe(2);
  });
});
