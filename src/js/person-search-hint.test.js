// ==============================================
// THE PERSON PICKER'S HINT MUST HAVE AN EXIT, NOT JUST AN ENTRY.
//
// REPORTED (docs/NEXT.md §0b, item 2, seen while driving the admin UI):
// typing a second query in ค้นหาคนจากระบบ left
//
//   ไม่พบใครที่ตรงกับ “<the OLD query>” — กรอกข้อมูลเองด้านล่างได้เลย
//
// on screen while the NEW results were listed directly beneath it. The verdict
// was written on the empty-result path and withdrawn on none: the branch that
// FINDS rows never touched the hint, so a true sentence about a query that no
// longer exists sat above rows contradicting it.
//
// The class is `.claude/rules/mistakes.md` #4 — a rule applied on one path and
// not the others. A message that a renderer can turn ON must be turned OFF by
// every other outcome that renderer can reach: rows found, and a query too
// short to have been searched at all.
//
// The second half is class #6. The resting sentence is different for เพิ่ม and
// แก้ไข, and `src/html/tab-team.html` holds a THIRD copy — what the box says
// before any modal has opened. HTML cannot import a constant, so that copy is
// pinned here rather than by care.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PERSON_SEARCH_HINT_ADD, PERSON_SEARCH_HINT_EDIT } from './team/index.js';

const SRC = readFileSync(new URL('./team/index.js', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../html/tab-team.html', import.meta.url), 'utf8');

/** The body of `renderPersonResults`, from its signature to the next top-level `}`. */
function renderPersonResultsBody() {
  const start = SRC.indexOf('function renderPersonResults(');
  expect(start, 'renderPersonResults was renamed — this guard is now blind').toBeGreaterThan(-1);
  const end = SRC.indexOf('\n}\n', start);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

/**
 * The renderer's two outcomes, split at the line that reveals the results box —
 * everything before it runs when there is nothing to show, everything after it
 * runs when there is. Anchored on real statements, not line numbers.
 */
function splitBranches() {
  const body = renderPersonResultsBody();
  const emptyStart = body.indexOf('if (!hits.length)');
  const hitsStart = body.indexOf("box.classList.remove('d-none')");
  expect(emptyStart, 'the empty-result branch was renamed').toBeGreaterThan(-1);
  expect(hitsStart, 'the results box is no longer revealed here').toBeGreaterThan(emptyStart);
  return { empty: body.slice(emptyStart, hitsStart), withHits: body.slice(hitsStart) };
}

describe('the ค้นหาคนจากระบบ hint', () => {
  it('is withdrawn on the path that FINDS rows', () => {
    const { withHits } = splitBranches();
    expect(
      withHits,
      'renderPersonResults paints rows without resetting the hint — the '
      + '“ไม่พบใครที่ตรงกับ …” verdict from the previous query stays on screen '
      + 'above the results that contradict it (docs/NEXT.md §0b item 2)',
    ).toMatch(/hint\.textContent\s*=\s*personSearchResting/);
  });

  it('is withdrawn when the query drops below the 2-character floor', () => {
    const { empty } = splitBranches();
    // Under two characters nothing was searched, so no verdict is owed — but
    // one from a LONGER previous query is still on screen unless it is cleared.
    expect(
      empty,
      'a query shorter than 2 characters leaves the previous verdict standing',
    ).toMatch(/personSearchResting/);
  });

  it('keeps the resting sentence in ONE place, not retyped per call site', () => {
    // The literals may appear once each — in the constant. A second occurrence
    // means a call site retyped one, which is how the two spellings drift.
    for (const text of [PERSON_SEARCH_HINT_ADD, PERSON_SEARCH_HINT_EDIT]) {
      const hits = SRC.split(text).length - 1;
      expect(
        hits,
        `“${text}” is written ${hits} times in team/index.js — it belongs to a `
        + 'constant, so a call site is retyping it',
      ).toBe(1);
    }
  });

  it('agrees with the copy baked into tab-team.html', () => {
    // The HTML default is what the box says on the very first paint, before any
    // modal has opened and set `personSearchResting`. If the two disagree, the
    // sentence silently CHANGES the first time a modal opens.
    const el = HTML.match(/id="teamMemberSearchHint"[^>]*>([^<]*)</);
    expect(el, '#teamMemberSearchHint is gone from tab-team.html').toBeTruthy();
    expect(
      el[1].trim(),
      'the HTML default and PERSON_SEARCH_HINT_ADD have drifted — the hint '
      + 'would change wording the first time เพิ่มสมาชิก is opened',
    ).toBe(PERSON_SEARCH_HINT_ADD);
  });
});
