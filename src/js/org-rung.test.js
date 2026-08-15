// ==============================================
// THE "แสดงถึง" RUNG MUST REACH WHAT ITS LABEL PROMISES.
//
// The rung this replaced was raw depth, and it shipped BROKEN twice for the
// same underlying reason: a number cannot name a level of THIS org. First as an
// off-by-one (`d.depth < level`, so the rung labelled หัวหน้าฝ่าย stopped one
// short of any หัวหน้าฝ่าย — 65 cards, none of them a head). Then, invisibly,
// because the tree is ragged: depth 2 is a หัวหน้า in สำนักนายกฯ, a ฝ่าย in
// ฝ่ายดิจิทัล and a สมาชิก elsewhere, so ONE number was simultaneously right and
// wrong depending on which branch you looked at.
//
// The old guard could not have caught either the second problem or the first
// properly: it read the source text for `<=` and asserted on an operator. This
// one runs the predicate over a fixture SHAPED LIKE THE LIVE TREE — including
// the one place where a ฝ่าย hangs off a ตำแหน่ง — and asserts on which boxes
// are visible.
//
// TO CHECK THIS GUARD ACTUALLY GUARDS: in org-rung.js, change the `role` rung
// to `return d.isDiv` (dropping the seats), or delete the ancestor `while` walk
// in applyRung, or flip `divDepth <= 1` to `< 1`. Each breaks a DIFFERENT
// assertion below. Then put it back.
// ==============================================
import { describe, it, expect } from 'vitest';
import { RUNG, applyRung, sortSiblings } from './org-rung.js';

// The live shape, in miniature — ฝ่ายดิจิทัล as it actually is on
// samo.md.kku.ac.th, plus the ผังรวม synthetic root above it.
//
//   org (synthetic)
//    └ ฝ่ายดิจิทัล            ฝ่าย,   divDepth 1
//       ├ อุปนายกฯ            ตำแหน่ง, parent is a ฝ่าย
//       └ ฝ่าย PR             ฝ่าย,   divDepth 2
//          ├ หัวหน้าฝ่าย PR    ตำแหน่ง, parent is a ฝ่าย
//          │  ├ สมาชิก PR      ตำแหน่ง UNDER a ตำแหน่ง  ← hidden until ทั้งหมด
//          │  └ ฝ่าย Media     ฝ่าย UNDER a ตำแหน่ง     ← the ancestor-walk case
//          │     └ หัวหน้า Media
//          └ เลขาฯ PR          ตำแหน่ง
const row = (id, parentId, name, isDiv, parentIsDiv, divDepth) => ({
  id, parentId, name, isDiv, parentIsDiv, divDepth,
});

function fixture() {
  return [
    row('org', null, 'สโมสรนักศึกษา', true, false, 0),
    row('dig', 'org', 'ฝ่ายดิจิทัล', true, false, 1),
    row('vp', 'dig', 'อุปนายกฝ่ายดิจิทัล', false, true, 1),
    row('pr', 'dig', 'ฝ่าย PR', true, true, 2),
    row('prhead', 'pr', 'หัวหน้าฝ่าย PR', false, true, 2),
    row('prmem', 'prhead', 'สมาชิกฝ่าย PR', false, false, 2),
    row('media', 'prhead', 'ฝ่าย Media management', true, false, 3),
    row('mhead', 'media', 'หัวหน้าฝ่าย Media', false, true, 3),
    row('prsec', 'pr', 'เลขานุการฝ่าย PR', false, true, 2),
  ];
}

const shownAt = (rung) => {
  const data = fixture();
  applyRung(data, rung);
  return data.filter((d) => d._expanded).map((d) => d.id).sort();
};

describe('the rungs show what they are labelled', () => {
  it('ฝ่ายหลัก — the org box and the root ฝ่าย, nothing below', () => {
    expect(shownAt(RUNG.top)).toEqual(['dig', 'org']);
  });

  it('ฝ่ายย่อย — every ฝ่าย, no seats', () => {
    // ...except prhead, which is dragged in as the only route to ฝ่าย Media.
    // That is the ancestor walk, and its absence is what would orphan the
    // branch — see the next test for the direct assertion.
    expect(shownAt(RUNG.fai)).toEqual(['dig', 'media', 'org', 'pr', 'prhead']);
  });

  it('ตำแหน่ง — every ฝ่าย PLUS the seats it holds directly', () => {
    // The requested picture: ฝ่าย PR draws a line to หัวหน้าฝ่าย PR and
    // เลขานุการฝ่าย PR *and* to ฝ่าย Media, while สมาชิกฝ่าย PR — a seat under a
    // seat — stays behind หัวหน้าฝ่าย PR's own expand button.
    const shown = shownAt(RUNG.role);
    expect(shown).toContain('prhead');
    expect(shown).toContain('prsec');
    expect(shown).toContain('media');
    expect(shown).toContain('mhead');
    expect(shown, 'a ตำแหน่ง under a ตำแหน่ง must stay collapsed').not.toContain('prmem');
  });

  it('ทั้งหมด — everything', () => {
    expect(shownAt(RUNG.full)).toHaveLength(fixture().length);
  });

  it('every rung is a SUPERSET of the one above it', () => {
    // A ladder whose rungs are not nested is not a ladder — pressing "deeper"
    // would take boxes away. Depth gave this for free; a kind predicate does
    // not, so it is asserted.
    const order = [RUNG.top, RUNG.fai, RUNG.role, RUNG.full];
    for (let i = 1; i < order.length; i++) {
      const prev = new Set(shownAt(order[i - 1]));
      const next = new Set(shownAt(order[i]));
      for (const id of prev) {
        expect(next.has(id), `${order[i]} dropped ${id}, which ${order[i - 1]} showed`).toBe(true);
      }
      expect(next.size).toBeGreaterThan(prev.size);
    }
  });
});

describe('nothing is ever left orphaned', () => {
  it('a ฝ่าย hanging off a ตำแหน่ง drags that ตำแหน่ง in with it', () => {
    // THE LIVE CASE, and the reason applyRung walks up at all: ฝ่าย Media
    // management's parent is หัวหน้าฝ่าย PR, a seat. At the ฝ่ายย่อย rung the
    // predicate says "ฝ่าย only", which alone would show ฝ่าย Media with its
    // parent hidden — d3 draws a line to a box that is not there.
    const shown = new Set(shownAt(RUNG.fai));
    expect(shown.has('media')).toBe(true);
    expect(shown.has('prhead'), 'the seat between them must be pulled in').toBe(true);
  });

  it('every visible row at every rung has a visible parent', () => {
    // The general form of the above, so a future rung cannot reintroduce it.
    for (const rung of Object.values(RUNG)) {
      const data = fixture();
      applyRung(data, rung);
      const shown = new Set(data.filter((d) => d._expanded).map((d) => d.id));
      for (const d of data.filter((x) => x._expanded && x.parentId !== null)) {
        expect(shown.has(d.parentId), `${rung}: ${d.id} is shown but its parent is not`).toBe(true);
      }
      expect(shown.size, `${rung} rendered nothing at all`).toBeGreaterThan(0);
    }
  });

  it('the chart root survives a rung its own kind would fail', () => {
    // ผังองค์กร draws one chart per root ฝ่าย. If a root were ever stored as a
    // ตำแหน่ง, the ฝ่าย rungs would hide it and the section would render empty —
    // which looks exactly like a broken chart, not like a filter.
    const data = [
      row('root', null, 'a root stored as a ตำแหน่ง', false, false, 0),
      row('kid', 'root', 'ฝ่ายย่อย', true, false, 1),
    ];
    applyRung(data, RUNG.top);
    expect(data.find((d) => d.id === 'root')._expanded).toBe(true);
  });
});

describe('a ฝ่าย draws its own ตำแหน่ง before its sub-ฝ่าย', () => {
  const names = (list) => sortSiblings(list).map((n) => n.name);

  it('puts every ตำแหน่ง above every ฝ่าย', () => {
    // The requested order, on the shape it was requested for.
    expect(names([
      { name: 'ฝ่าย Media', kind: 'division' },
      { name: 'หัวหน้าฝ่าย PR', kind: 'role' },
      { name: 'ฝ่าย Creator', kind: 'division' },
      { name: 'เลขานุการฝ่าย PR', kind: 'role' },
    ])).toEqual(['หัวหน้าฝ่าย PR', 'เลขานุการฝ่าย PR', 'ฝ่าย Media', 'ฝ่าย Creator']);
  });

  it('keeps `position` order WITHIN each group — position 0 is still the head', () => {
    // The rpc returns rows ordered by position, so the incoming array order IS
    // the position order. A non-stable sort would scramble หัวหน้า / รองหัวหน้า
    // / สมาชิก among themselves, and the chart states rank BY POSITION — that is
    // the whole reason every card is the same size.
    const seats = ['หัวหน้า', 'รองหัวหน้า', 'เลขานุการ', 'สมาชิก']
      .map((name) => ({ name, kind: 'role' }));
    const mixed = [seats[0], { name: 'ฝ่ายย่อย ก', kind: 'division' }, seats[1],
      seats[2], { name: 'ฝ่ายย่อย ข', kind: 'division' }, seats[3]];
    expect(names(mixed)).toEqual(['หัวหน้า', 'รองหัวหน้า', 'เลขานุการ', 'สมาชิก',
      'ฝ่ายย่อย ก', 'ฝ่ายย่อย ข']);
  });

  it('treats a legacy `department` row as the ฝ่าย it always was', () => {
    // Migration 0151 rewrote the live and archived rows, but an export file or
    // a stale bundle can still deliver one. Sorted as a ตำแหน่ง it would jump
    // ABOVE the real seats — the exact opposite of the rule.
    expect(names([
      { name: 'ฝ่าย PR (เก่า)', kind: 'department' },
      { name: 'หัวหน้า', kind: 'role' },
    ])).toEqual(['หัวหน้า', 'ฝ่าย PR (เก่า)']);
  });
});
