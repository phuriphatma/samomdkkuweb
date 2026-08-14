// ==============================================
// THE CARD HEIGHT IS ONE DECISION WRITTEN IN TWO FILES.
//
// ผังองค์กร draws its node cards into an SVG foreignObject, and d3-org-chart
// needs each card's HEIGHT before it lays anything out — it cannot measure the
// DOM, because at that point nothing is rendered. So `cardHeight()` in
// org-graph.js ADDS UP the card's vertical rhythm from constants:
//
//     PAD*2 + titleLines*TITLE_LH + rows*ROW_H + MORE_H + META_H
//
// Every one of those numbers is also written in org-graph.css, as the padding,
// line-height and heights the browser will actually use.
//
// WHY THIS NEEDS A TEST RATHER THAN A COMMENT. If the two drift, nothing
// throws. The CSS wins, the card renders taller than the box d3 reserved, and
// the last person's row is quietly clipped — or, drifting the other way, every
// card grows a band of dead space. `.claude/rules/mistakes.md` class 6 is
// exactly this shape ("two implementations of one rule drift"), and its entry
// on CSS is blunt about why it survives review: CSS fails SILENTLY. There is no
// undefined-reference error and no console warning for a stylesheet that
// disagrees with the script sizing it.
//
// The repo's own rule — "prefer a guard test over a paragraph: this repo has
// learned that writing a hazard down does not make anyone check it."
//
// WHY IT PARSES THE SOURCE instead of importing org-graph.js: that module pulls
// in uploads.js and, on mount, d3. Reading the two files as text keeps the guard
// to the one question it is asking, and means it still runs if the import graph
// changes. Comments are stripped with the SHARED scanner (strip-comments.js) —
// a hand-rolled block-comment regex is what blinded four other guards in this
// repo when it met `'image/*'`.
//
// TO CHECK THIS GUARD ACTUALLY GUARDS: change ROW_H to 40 in org-graph.js, or
// `.orgg-person { height: 38px }` to 40px in org-graph.css, and watch exactly
// one assertion below fail. Then put it back.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const js = stripComments(readFileSync(new URL('./org-graph.js', import.meta.url), 'utf8'));
const css = readFileSync(new URL('../css/org-graph.css', import.meta.url), 'utf8');

/** Read `const NAME = <number>;` out of the module source. */
function jsConst(name) {
  const m = js.match(new RegExp(`const\\s+${name}\\s*=\\s*(-?[0-9.]+)\\s*;`));
  expect(m, `org-graph.js must declare a numeric const ${name}`).toBeTruthy();
  return Number(m[1]);
}

/** Read one declaration out of a CSS rule block, e.g. cssProp('.orgg-person', 'height'). */
function cssProp(selector, prop) {
  const block = css.match(new RegExp(`\\n${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  expect(block, `org-graph.css must contain a rule for ${selector}`).toBeTruthy();
  const m = block[1].match(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`));
  expect(m, `${selector} must declare ${prop}`).toBeTruthy();
  return m[1].trim();
}

const px = (v) => {
  const m = String(v).match(/(-?[0-9.]+)px/);
  expect(m, `expected a px value, got "${v}"`).toBeTruthy();
  return Number(m[1]);
};

describe('ผังองค์กร card metrics: org-graph.js and org-graph.css agree', () => {
  it('PAD matches .orgg-card padding', () => {
    expect(px(cssProp('.orgg-card', 'padding'))).toBe(jsConst('PAD'));
  });

  it('ROW_H matches .orgg-person height — the one that clips a face when wrong', () => {
    expect(px(cssProp('.orgg-person', 'height'))).toBe(jsConst('ROW_H'));
  });

  it('META_H matches .orgg-meta height', () => {
    expect(px(cssProp('.orgg-meta', 'height'))).toBe(jsConst('META_H'));
  });

  it('MORE_H matches .orgg-more height', () => {
    expect(px(cssProp('.orgg-more', 'height'))).toBe(jsConst('MORE_H'));
  });

  it('TITLE_LH matches .orgg-name line-height', () => {
    expect(px(cssProp('.orgg-name', 'line-height'))).toBe(jsConst('TITLE_LH'));
  });

  it('MAX_TITLE_LINES matches .orgg-name -webkit-line-clamp', () => {
    // The clamp is the FAILSAFE for a wrong measurement, so it must not allow
    // more lines than the height calculation budgeted for.
    expect(Number(cssProp('.orgg-name', '-webkit-line-clamp')))
      .toBe(jsConst('MAX_TITLE_LINES'));
  });

  it('the title measurement uses the same font-size the stylesheet renders', () => {
    // titleLines() measures with a canvas at a hardcoded font. Measuring at a
    // different size than the browser paints gives the wrong line count, which
    // is the same clipped-card symptom by another route.
    const measured = js.match(/mctx\.font\s*=\s*["'`][^"'`]*?(\d+(?:\.\d+)?)px/);
    expect(measured, 'titleLines() must set mctx.font with a px size').toBeTruthy();
    expect(Number(measured[1])).toBe(px(cssProp('.orgg-name', 'font-size')));
  });

  it('the card width the layout reserves matches the width the title is measured against', () => {
    // NODE_W feeds nodeWidth() AND the wrap calculation in titleLines(). If the
    // two ever come from different numbers the line count is measured against a
    // box the card does not have.
    const w = jsConst('NODE_W');
    expect(js).toMatch(/nodeWidth\(\(\)\s*=>\s*NODE_W\)/);
    expect(js).toMatch(/NODE_W\s*-\s*PAD\s*\*\s*2/);
    expect(w).toBeGreaterThan(0);
  });
});

describe('ผังองค์กร portraits: the srcset must cover the MAX ZOOM, not the box', () => {
  // REPORTED: "the picture render wrong, and when zoom picture also bug".
  //
  // Two causes, and this block guards the second. `srcset` is resolved ONCE from
  // the element's CSS layout size, and an SVG transform never changes that — so
  // a card magnified 3× paints a bitmap chosen for 1×. Measured before the fix:
  // the box went 26×35 → 125×167 while `naturalWidth` stayed 34.
  //
  // The fix is arithmetic — `sizes` = portrait width × max zoom — spread across
  // TWO files plus a stylesheet. That is three ways to drift, and every one of
  // them fails silently as "the photos look a bit soft". Hence this guard.
  const face = readFileSync(new URL('./org-face.js', import.meta.url), 'utf8');

  const graphShape = (() => {
    const block = stripComments(face).match(/export const GRAPH_SHAPE = \{([\s\S]*?)\};/);
    expect(block, 'org-face.js must export GRAPH_SHAPE').toBeTruthy();
    return block[1];
  })();

  const facePx = () => px(cssProp('.orgg-person .org-face', 'width'));
  const maxZoom = () => {
    const m = js.match(/\.scaleExtent\(\[\s*[0-9.]+\s*,\s*([0-9.]+)\s*\]\)/);
    expect(m, 'org-graph.js must cap zoom with .scaleExtent([min, max])').toBeTruthy();
    return Number(m[1]);
  };
  const sizesPx = () => {
    const m = graphShape.match(/sizes:\s*'(\d+(?:\.\d+)?)px'/);
    expect(m, 'GRAPH_SHAPE.sizes must be a plain px value').toBeTruthy();
    return Number(m[1]);
  };
  const widths = () => {
    const m = graphShape.match(/widths:\s*\[([^\]]+)\]/);
    expect(m, 'GRAPH_SHAPE must declare widths').toBeTruthy();
    return m[1].split(',').map((s) => Number(s.trim()));
  };

  it('zoom is capped — without a ceiling no source size is ever enough', () => {
    expect(maxZoom()).toBeGreaterThan(1);
    // The library default is 20. That is not a usable cap for this: a 44px
    // portrait at 20× would need a 880px source per face.
    expect(maxZoom()).toBeLessThanOrEqual(4);
  });

  it('sizes covers the portrait at FULL zoom', () => {
    expect(sizesPx()).toBeGreaterThanOrEqual(facePx() * maxZoom());
  });

  it('candidates cover DPR 1, 2 and 3 at that size', () => {
    const w = widths();
    const need = sizesPx();
    for (const dpr of [1, 2, 3]) {
      expect(
        w.some((c) => c >= need * dpr),
        `no srcset candidate covers DPR ${dpr} (needs >= ${need * dpr}px, have ${w.join('/')})`,
      ).toBe(true);
    }
  });

  it('the zoom floor sits below frameChart MIN_SCALE, or its transform is clamped', () => {
    const m = js.match(/\.scaleExtent\(\[\s*([0-9.]+)/);
    expect(Number(m[1])).toBeLessThanOrEqual(jsConst('MIN_SCALE'));
  });

  it('the portrait is big enough to be a face, not a torso', () => {
    // These are waist-up studio shots. At 26px the head was ~8px — the bug as
    // reported. รายการ renders the same photo at a 136px box.
    expect(facePx()).toBeGreaterThanOrEqual(40);
  });
});

describe('ผังองค์กร / ผังรวม: the depth control must reach the level it names', () => {
  it('applyDepth is INCLUSIVE of `level` — `<` renders one level too shallow', () => {
    // The library's `_expanded` means "this node should be VISIBLE"
    // (expandSomeNodes walks UP and opens ancestors); it does NOT mean "open my
    // children". So `d.depth < level` renders depths 0..level-1, and the rung
    // labelled หัวหน้าฝ่าย stopped at the sub-ฝ่าย above them — measured as 65
    // cards with zero ตำแหน่ง named หัวหน้าฝ่าย on screen.
    const fn = js.slice(js.indexOf('function applyDepth'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toMatch(/_expanded\s*=\s*d\.depth\s*<=\s*level/);
    expect(body).not.toMatch(/_expanded\s*=\s*d\.depth\s*<\s*level/);
  });

  it('ผังรวม hangs everything off ONE synthetic root', () => {
    // d3.stratify() throws on multiple roots, so the twelve ฝ่าย cannot simply
    // be handed over as-is — and the root is synthetic because adding a real row
    // would put a fake ตำแหน่ง into the admin tree, the archive and the export.
    expect(js).toMatch(/const ORG_ROOT_ID\s*=/);
    expect(js).toMatch(/parentId:\s*ORG_ROOT_ID/);
    const root = js.slice(js.indexOf('function flattenCombined'));
    expect(root.slice(0, root.indexOf('\n}'))).toMatch(/parentId:\s*null/);
  });
});

describe('ผังองค์กร: the framing contract with d3-org-chart', () => {
  it('frameChart zeroes centerG as well as setting the zoom transform', () => {
    // FOUND BY DRIVING THE REAL PAGE: setting only the zoom transform left every
    // chart shifted by the library's own `translate(centerX, rootMargin)`
    // centering, drawing half of each ฝ่าย outside its section. The library's
    // zoomTreeBounds() zeroes centerG for this reason; frameChart replaces that
    // method and inherits the obligation.
    const fn = js.slice(js.indexOf('function frameChart'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).toMatch(/centerG\.attr\(\s*['"]transform['"]\s*,\s*['"]translate\(0,0\)['"]/);
    expect(body).toMatch(/zoomBehavior\.transform/);
  });

  it('d3-zoom is imported dynamically, never statically', () => {
    // org-graph.js is reachable STATICALLY from org-chart.js (destroyOrgGraph
    // runs on every paint of all three views), so a top-level `import` of
    // d3-zoom lands it in the entry bundle — measured at +13.6 KB gzipped for
    // every reader, including those who never open ผังองค์กร.
    expect(js).not.toMatch(/^\s*import\s+.*from\s+['"]d3-zoom['"]/m);
    expect(js).not.toMatch(/^\s*import\s+.*from\s+['"]d3-org-chart['"]/m);
    expect(js).toMatch(/await\s+Promise\.all\(\[[\s\S]*?import\(['"]d3-org-chart['"]\)[\s\S]*?import\(['"]d3-zoom['"]\)/);
  });
});
