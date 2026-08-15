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
import { readFileSync } from 'node:fs';
import {
  RUNG, applyRung, sortSiblings, chartParentage, subtreeMeta, tierOf,
} from './org-rung.js';

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

describe('a ฝ่าย\'s sub-ฝ่าย hang off its HEAD ตำแหน่ง', () => {
  // ฝ่ายดิจิทัล exactly as stored, which is the case that was reported:
  // one seat and three sub-ฝ่าย, all four stored as children of the ฝ่าย.
  const N = {
    dig: { id: 'dig', kind: 'division', name: 'ฝ่ายดิจิทัลและสื่อสารองค์กร' },
    vp: { id: 'vp', kind: 'role', name: 'อุปนายกฝ่ายดิจิทัล' },
    pr: { id: 'pr', kind: 'division', name: 'ฝ่าย PR' },
    comart: { id: 'comart', kind: 'division', name: 'ฝ่าย ComArt' },
    it: { id: 'it', kind: 'division', name: 'ฝ่าย IT' },
    prhead: { id: 'prhead', kind: 'role', name: 'หัวหน้าฝ่าย PR' },
    content: { id: 'content', kind: 'role', name: 'หัวหน้าฝ่าย Content creator' },
    media: { id: 'media', kind: 'division', name: 'ฝ่าย Media management' },
  };
  const nodeById = new Map(Object.values(N).map((n) => [n.id, n]));
  const stored = () => new Map([
    ['', [N.dig]],
    // position order as the rpc returns it: the seat first, then the units.
    ['dig', [N.vp, N.pr, N.comart, N.it]],
    ['pr', [N.prhead]],
    // A ตำแหน่ง parent holding BOTH — stored units-first, to prove the sort runs.
    ['prhead', [N.media, N.content]],
  ]);
  const ids = (m, k) => (m.get(k) || []).map((n) => n.id);
  /** id → how many ranks below the root each node sits, in a given parentage. */
  const depths = (m) => {
    const out = new Map();
    const walk = (key, d) => (m.get(key) || []).forEach((n) => {
      out.set(n.id, d); walk(n.id, d + 1);
    });
    walk('', 0);
    return out;
  };

  it('draws ONE line to the head, then the sub-ฝ่าย below it', () => {
    // The report, verbatim: "It should be ฝ่ายดิจิทัลและสื่อสารองค์กร then one
    // line to อุปนายกฝ่ายดิจิทัล then three lines to ฝ่าย PR, ComArt, IT."
    const out = chartParentage(stored(), nodeById);
    expect(ids(out, 'dig')).toEqual(['vp']);
    expect(ids(out, 'vp')).toEqual(['pr', 'comart', 'it']);
  });

  it('leaves a ตำแหน่ง parent alone — its seats are PEERS, not the head', () => {
    // หัวหน้าฝ่าย PR holds a seat and a ฝ่าย. Pushing ฝ่าย Media under
    // หัวหน้าฝ่าย Content creator would invent a reporting line. They stay
    // siblings — seats first, which is the ordering rule still doing its job.
    const out = chartParentage(stored(), nodeById);
    expect(ids(out, 'prhead')).toEqual(['content', 'media']);
    expect(ids(out, 'content')).toEqual([]);
  });

  it('moves a ฝ่าย DOWN BY ONE RANK, never further', () => {
    // The invariant, not the mechanism. Today the parent-kind guard makes a
    // double move structurally impossible — the bucket a unit is moved INTO is
    // always keyed by a seat, and seats are skipped — so this cannot be
    // falsified by breaking the loop, and saying it could would be a lie about
    // what this test does. It is here for the version of this function that
    // relaxes that guard: "one rank down" is the whole claim the chart makes,
    // and a unit that lands two ranks down is a reporting line nobody drew.
    const before = depths(stored());
    const after = depths(chartParentage(stored(), nodeById));
    for (const [id, d] of after) {
      expect(d - before.get(id), `${id} moved ${d - before.get(id)} ranks`)
        .toBeLessThanOrEqual(1);
    }
    expect(after.get('pr') - before.get('pr'), 'ฝ่าย PR should have moved').toBe(1);
  });

  it('a ฝ่าย with NO seat keeps its sub-ฝ่าย rather than losing them', () => {
    const only = { id: 'only', kind: 'division', name: 'ฝ่ายไม่มีหัวหน้า' };
    const kid = { id: 'kid', kind: 'division', name: 'ฝ่ายย่อย' };
    const out = chartParentage(new Map([['only', [kid]]]),
      new Map([['only', only], ['kid', kid]]));
    expect(ids(out, 'only')).toEqual(['kid']);
  });

  it('every node still appears exactly once, and no node is orphaned', () => {
    // A re-parenting that DROPS a branch looks like a filter, and a chart that
    // quietly omits a ฝ่าย is worse than one that draws it in the wrong place.
    const out = chartParentage(stored(), nodeById);
    const placed = [...out.values()].flat().map((n) => n.id);
    expect(placed.sort()).toEqual([...new Set(placed)].sort());
    const all = [...stored().values()].flat().map((n) => n.id).sort();
    expect(placed.sort()).toEqual(all);
  });

  it('does not mutate the map it was given', () => {
    const input = stored();
    chartParentage(input, nodeById);
    expect(ids(input, 'dig')).toEqual(['vp', 'pr', 'comart', 'it']);
  });
});

describe('the count line says whether it means INSIDE or BELOW', () => {
  it('a ฝ่าย states its CONTENTS, people included', () => {
    expect(subtreeMeta({ isDiv: true, nodes: 18, people: 41, own: 0 }))
      .toBe('18 ตำแหน่ง · 41 คน');
  });

  it('a ตำแหน่ง with a subtree says ใต้สังกัด, and does not count ITSELF', () => {
    // THE FINDING: อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร rendered
    // "17 ตำแหน่ง · 41 คน" — a person appearing to contain 41 people, one of
    // whom was the person the card is about.
    expect(subtreeMeta({ isDiv: false, nodes: 17, people: 41, own: 1 }))
      .toBe('ใต้สังกัด 17 ตำแหน่ง · 40 คน');
  });

  it('a ตำแหน่ง with NO subtree still means who HOLDS it', () => {
    // No subtree, no claim to get wrong — the number is the seat's holders and
    // has always meant that. Prefixing this one would be a new mistake.
    expect(subtreeMeta({ isDiv: false, nodes: 0, people: 9, own: 9 })).toBe('9 คน');
  });

  it('an empty ตำแหน่ง says so — it is a vacancy, not a broken card', () => {
    expect(subtreeMeta({ isDiv: false, nodes: 0, people: 0, own: 0 }))
      .toBe('ยังไม่มีสมาชิก');
  });

  it('a seat whose whole subtree is empty names the ตำแหน่ง only', () => {
    expect(subtreeMeta({ isDiv: false, nodes: 3, people: 1, own: 1 }))
      .toBe('ใต้สังกัด 3 ตำแหน่ง');
  });

  it('never renders a negative or a bare zero', () => {
    // `people - own` is a subtraction over two independently computed numbers.
    // If they ever disagree, a card must not say "-1 คน".
    for (const own of [0, 1, 5, 99]) {
      const out = subtreeMeta({ isDiv: false, nodes: 2, people: 3, own });
      expect(out, `own=${own} produced ${out}`).not.toMatch(/-\d|\b0 คน/);
    }
  });

  it('both renderers call it — neither keeps a hand-rolled copy', () => {
    // It was hand-rolled TWICE with the same four branches before this existed,
    // which is how one wording bug shipped to two views at once.
    for (const rel of ['./org-chart.js', './org-graph.js']) {
      const src = readFileSync(new URL(rel, import.meta.url), 'utf8');
      expect(src, `${rel} does not call subtreeMeta`).toMatch(/subtreeMeta\(/);
      expect(src, `${rel} still builds the line itself`)
        .not.toMatch(/bits\.push\(`\$\{[^}]+\} ตำแหน่ง`\)/);
    }
  });
});

describe('ระดับ — rank inside a ฝ่าย, without nesting', () => {
  // REQUESTED: "I want in the main web to show หัวหน้าฝ่าย IT and
  // เลขานุการฝ่าย IT at the same level then next level be สมาชิกฝ่าย IT
  // without having to put Role สมาชิกฝ่าย IT inside หัวหน้าฝ่าย IT."
  //
  // ฝ่าย IT stored FLAT — every seat a direct child, which is where they
  // actually belong — with the rank carried by `tier`.
  const N = {
    it: { id: 'it', kind: 'division', name: 'ฝ่าย IT' },
    head: { id: 'head', kind: 'role', name: 'หัวหน้าฝ่าย IT' },
    sec: { id: 'sec', kind: 'role', name: 'เลขานุการฝ่าย IT' },
    mem: { id: 'mem', kind: 'role', name: 'สมาชิกฝ่าย IT', tier: 2 },
  };
  const nodeById = new Map(Object.values(N).map((n) => [n.id, n]));
  const flat = () => new Map([['', [N.it]], ['it', [N.head, N.sec, N.mem]]]);
  const ids = (m, k) => (m.get(k) || []).map((n) => n.id);

  it('draws two lines to ระดับ 1 and one line below to ระดับ 2', () => {
    const out = chartParentage(flat(), nodeById);
    expect(ids(out, 'it')).toEqual(['head', 'sec']);
    expect(ids(out, 'head')).toEqual(['mem']);
  });

  it('matches what the NESTED version drew — the point is the admin, not the chart', () => {
    // Same picture from the storage shape it replaces. If these ever diverge,
    // converting the live tree would silently redraw it.
    const nested = new Map([['', [N.it]], ['it', [N.head, N.sec]], ['head', [N.mem]]]);
    const nestedIds = { it: ids(chartParentage(nested, nodeById), 'it'),
      head: ids(chartParentage(nested, nodeById), 'head') };
    const out = chartParentage(flat(), nodeById);
    expect(ids(out, 'it')).toEqual(nestedIds.it);
    expect(ids(out, 'head')).toEqual(nestedIds.head);
  });

  it('a deeper rung hangs off the FIRST seat of the rung above', () => {
    // ฝ่าย ComArt, as stored: two ระดับ 2 heads, and the ระดับ 3 members belong
    // to the first of them.
    const A = { id: 'a', kind: 'role', name: 'หัวหน้าฝ่าย Art/Graphic', tier: 2 };
    const P = { id: 'p', kind: 'role', name: 'หัวหน้าฝ่าย production', tier: 2 };
    const M = { id: 'm', kind: 'role', name: 'สมาชิกฝ่าย Art/Graphic', tier: 3 };
    const H = { id: 'h', kind: 'role', name: 'หัวหน้าฝ่าย ComArt' };
    const C = { id: 'c', kind: 'division', name: 'ฝ่าย ComArt' };
    const out = chartParentage(
      new Map([['', [C]], ['c', [H, A, M, P]]]),
      new Map([[C.id, C], [H.id, H], [A.id, A], [P.id, P], [M.id, M]]),
    );
    expect(ids(out, 'c')).toEqual(['h']);
    expect(ids(out, 'h')).toEqual(['a', 'p']);
    expect(ids(out, 'a')).toEqual(['m']);
    expect(ids(out, 'p')).toEqual([]);
  });

  it('a GAP in the rungs closes instead of orphaning the branch', () => {
    // ระดับ 1 and ระดับ 3 with nothing at 2 — an admin can produce this by
    // deleting the middle seat. It must draw, not disappear.
    const H = { id: 'h', kind: 'role', name: 'หัวหน้า' };
    const D = { id: 'd', kind: 'role', name: 'ลึก', tier: 3 };
    const F = { id: 'f', kind: 'division', name: 'ฝ่าย' };
    const out = chartParentage(new Map([['', [F]], ['f', [H, D]]]),
      new Map([[F.id, F], [H.id, H], [D.id, D]]));
    expect(ids(out, 'f')).toEqual(['h']);
    expect(ids(out, 'h')).toEqual(['d']);
  });

  it('a ฝ่าย with ONLY deep seats hangs them off the ฝ่าย, not nowhere', () => {
    const D = { id: 'd', kind: 'role', name: 'ลึก', tier: 4 };
    const F = { id: 'f', kind: 'division', name: 'ฝ่าย' };
    const out = chartParentage(new Map([['', [F]], ['f', [D]]]),
      new Map([[F.id, F], [D.id, D]]));
    expect(ids(out, 'f')).toEqual(['d']);
  });

  it('a host holding a STORED sub-ฝ่าย keeps seats first when a rung lands on it', () => {
    // ฝ่าย PR's real shape: หัวหน้าฝ่าย PR already owns ฝ่าย Media management,
    // and then a ระดับ 2 seat is moved onto it. The bucket is built [ฝ่าย Media]
    // and the seat is APPENDED, so without a re-sort after the moves the ฝ่าย
    // comes out first — the exact inverse of the ordering rule. The first
    // version of this test used a host with no stored children and could not
    // fail; a fixture that cannot reach the branch is not coverage.
    const F = { id: 'f', kind: 'division', name: 'ฝ่าย PR' };
    const H = { id: 'h', kind: 'role', name: 'หัวหน้าฝ่าย PR' };
    const M = { id: 'm', kind: 'role', name: 'หัวหน้าฝ่าย Content creator', tier: 2 };
    const S = { id: 's', kind: 'division', name: 'ฝ่าย Media management' };
    const out = chartParentage(
      new Map([['', [F]], ['f', [H, M]], ['h', [S]]]),
      new Map([[F.id, F], [H.id, H], [M.id, M], [S.id, S]]),
    );
    expect(ids(out, 'f')).toEqual(['h']);
    expect(ids(out, 'h'), 'the seat must come before the ฝ่าย').toEqual(['m', 's']);
  });

  it('tierOf: anything not a number above 1 is rung 1', () => {
    for (const v of [null, undefined, 0, 1, -3, 'x', NaN, {}]) {
      expect(tierOf({ tier: v })).toBe(1);
    }
    expect(tierOf({ tier: 2 })).toBe(2);
    expect(tierOf({ tier: '3' })).toBe(3);
    expect(tierOf({ tier: 2.7 })).toBe(2);
    expect(tierOf(undefined)).toBe(1);
  });

  it('every node still appears exactly once', () => {
    const out = chartParentage(flat(), nodeById);
    const placed = [...out.values()].flat().map((n) => n.id).sort();
    expect(placed).toEqual(['head', 'it', 'mem', 'sec']);
  });
});
