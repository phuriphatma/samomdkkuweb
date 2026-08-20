// org-rung.js — the two things a node's KIND decides on the public chart: what
// order siblings are drawn in, and how far down the chart opens.
//
// Pure: no DOM, no d3, no config. The rules live here rather than in the
// renderers because BOTH surfaces obey them — แผนผัง lays ระดับ out as rows in a
// panel, ผังรวม as ranks on a canvas, and they must not disagree about the ORDER
// — and because a pure module can be tested
// against a fixture directly. The guard the rung used to have read the SOURCE
// TEXT for `d.depth <= level`: it could check that one operator was the right
// way round, and nothing about whether the rung reaches what its label
// promises. That is the assertion that matters.
import { isDivision } from './node-kind.js';

/**
 * ตำแหน่ง before ฝ่าย, among siblings. Mutates in place.
 *
 * REQUESTED: "Navigate to role at that level first, then ฝ่าย will be under
 * it." Reading a ฝ่าย means reading WHO IS IN IT first — its หัวหน้า and its
 * seats — and only then descending into the sub-ฝ่าย. Left in `position` order
 * the two interleave, so a ฝ่าย's own people can sit below a sub-ฝ่าย that is
 * itself several rows tall, and the eye has to reassemble them.
 *
 * The sort is STABLE (ES2019 guarantees it), so `position` still decides the
 * order WITHIN each group — which is what keeps "position 0 is the head" true,
 * and is why this is a display rule rather than a rewrite of the data.
 */
export function sortSiblings(list) {
  list.sort((a, b) => (isDivision(a.kind) ? 1 : 0) - (isDivision(b.kind) ? 1 : 0));
  return list;
}

/**
 * A ฝ่าย's sub-ฝ่าย hang off its HEAD ตำแหน่ง, not off the ฝ่าย box.
 *
 * REPORTED, after a first attempt that only re-ORDERED the siblings: "currently
 * on ผังรวม it shows ฝ่ายดิจิทัลและสื่อสารองค์กร then 4 lines showing all
 * อุปนายกฝ่ายดิจิทัล, ฝ่าย PR, ฝ่าย ComArt, ฝ่าย IT. It should be
 * ฝ่ายดิจิทัลและสื่อสารองค์กร then ONE line to อุปนายกฝ่ายดิจิทัล then THREE
 * lines to ฝ่าย PR, ฝ่าย ComArt, ฝ่าย IT."
 *
 * Order was never the point — RANK was. Drawn as four siblings, the chart says
 * the อุปนายก and the three ฝ่าย are peers under the same box. They are not:
 * the อุปนายก HEADS the ฝ่าย and the three sub-ฝ่าย report to them. Putting the
 * seats and the units on one rank is the one thing an org chart exists to
 * distinguish, and no amount of left-to-right ordering fixes it.
 *
 * So, for a ฝ่าย with both seats and sub-ฝ่าย: the seats stay its children, and
 * the sub-ฝ่าย become children of the FIRST seat. First = `position` 0 = the
 * head — the tree already ranks its own children that way, verified across the
 * live tree, and it is the same fact the equal-sized cards rely on. Deriving
 * the head from the structure means no prefix list of ("หัวหน้า…", "อุปนายก…",
 * "ประธาน…") titles to rot the first time someone invents a new one.
 *
 * WHEN IT DOES NOT APPLY, and why the parent's kind is the test:
 *
 *   • the parent is a ตำแหน่ง (หัวหน้าฝ่าย PR holds both a seat and
 *     ฝ่าย Media management). Its seat-children are PEERS of the ฝ่าย, not the
 *     ฝ่าย's head — pushing the ฝ่าย under หัวหน้าฝ่าย Content creator would
 *     invent a reporting line that does not exist. They stay siblings, seats
 *     first, which is what `sortSiblings` is still for.
 *   • the ฝ่าย has no seats at all. Nothing to hang them off; they stay put
 *     rather than vanish.
 *
 * This is a DISPLAY parentage. `team_nodes.parent_id` is untouched, the admin
 * tree still shows what is actually stored, and this runs over the projection
 * on the way to the four public views so they cannot disagree with each other.
 *
 * @param byParent  parent id ('' for root) → node[], as org-chart.js indexes it
 * @param nodeById  id → node, to ask whether a parent is a ฝ่าย
 * @returns a NEW map; the input is not mutated
 */
/** Which rung of its ฝ่าย a ตำแหน่ง sits on. `null` — everything that has
 *  never been told otherwise — is rung 1, which is the shape the chart had
 *  before tiers existed, so nothing had to be backfilled. */
export function tierOf(node) {
  const t = Number(node?.tier);
  return Number.isFinite(t) && t > 1 ? Math.floor(t) : 1;
}

/**
 * ONE ฝ่าย's children, split the way BOTH public views read them: its ตำแหน่ง
 * grouped into ระดับ (lowest first), then its sub-ฝ่าย.
 *
 * REPORTED: "แผนผัง doesn't show order like the ผังรวม — it doesn't order in
 * the ฝ่าย from role then ฝ่าย, it doesn't care about ระดับ that i config in
 * the admin teamsamo." It did not: แผนผัง read the STORED parentage, where every
 * seat is a flat sibling and `tier` is never consulted, so ระดับ 2 seats drew
 * beside their own head and sub-ฝ่าย drew beside the อุปนายก who runs them.
 *
 * WHY THIS IS NOT JUST `chartParentage`. That function expresses ระดับ as
 * NESTING — rung 2 becomes a child of rung 1's head — which is right for a
 * top-down canvas and wrong for a page: measured on the live tree, re-parenting
 * แผนผัง took it from 25,847px to 52,163px and max depth from 5 to 9, a
 * staircase down the middle of an empty page. แผนผัง expresses the same ranking
 * as ROWS inside one ฝ่าย panel, which costs no depth at all.
 *
 * So the two views draw the same ORDER from the same two facts — `tier` and
 * `isDivision` — in two different geometries. `org-rung.test.js` holds the
 * differential: the seat sequence this returns must equal the sequence you get
 * by walking `chartParentage`'s rung chain. Two geometries, one ordering; if
 * they ever disagree the guard fails rather than the page quietly drifting.
 *
 * @param groupTiers  false when the PARENT is a ตำแหน่ง. Seats under a ตำแหน่ง
 *   are that ตำแหน่ง's own sub-seats, not rungs of a ฝ่าย — ranking them against
 *   each other would invent a hierarchy nobody stored. It is the same test
 *   `chartParentage` makes before it re-parents anything, written once here so
 *   the two cannot disagree about where ระดับ applies.
 * @returns { rungs: [tier, node[]][], units: node[] } — rungs sorted ascending
 */
export function orderChildren(kids, groupTiers = true) {
  const seats = [];
  const units = [];
  for (const n of kids || []) (isDivision(n.kind) ? units : seats).push(n);

  if (!groupTiers) return { rungs: seats.length ? [[1, seats]] : [], units };

  const byTier = new Map();
  for (const s of seats) {
    const t = tierOf(s);
    if (!byTier.has(t)) byTier.set(t, []);
    byTier.get(t).push(s);
  }
  const rungs = [...byTier.keys()].sort((a, b) => a - b).map((t) => [t, byTier.get(t)]);
  return { rungs, units };
}

export function chartParentage(byParent, nodeById) {
  const out = new Map();
  for (const [key, kids] of byParent) out.set(key, sortSiblings([...kids]));

  // Iterating the ORIGINAL map, not `out`. `out.set(head.id, …)` can add a key
  // that was not there, and adding keys to a Map you are iterating means the
  // loop visits them — so the decision would depend on insertion order. The
  // parent-kind test below happens to skip every such key today; this keeps
  // that from being the only thing standing between here and an order-dependent
  // drawing.
  for (const [key, kids] of byParent) {
    // '' is the organisation itself: a unit, so the rule applies to it too.
    // (Every root is a ฝ่าย today, so it is a no-op — but it is a no-op for the
    // right reason rather than by accident.)
    const parent = key === '' ? null : nodeById.get(key);
    if (key !== '' && !(parent && isDivision(parent.kind))) continue;

    // The SAME split แผนผัง draws — seats grouped by ระดับ, then the sub-ฝ่าย.
    // Shared rather than repeated: this loop used to build its own `byTier`, and
    // two copies of a grouping rule is the class this repo pays for most.
    const { rungs, units } = orderChildren(kids);
    // Nothing to hang anything off. The sub-ฝ่าย stay where they are rather
    // than vanishing.
    if (!rungs.length) continue;

    // The ฝ่าย keeps its TOP rung and nothing else...
    out.set(key, [...rungs[0][1]]);

    // ...each deeper rung hangs off the FIRST seat of the rung above it. First
    // = position 0 = the head, which the tree already ranks — the same fact the
    // equal-sized cards rely on, and the reason there is no list of Thai title
    // prefixes here to rot. `rungs[i - 1]`, not `i - 1`: rungs may be 1 and 3
    // with nothing at 2, and a gap must close rather than orphan the branch.
    for (let i = 1; i < rungs.length; i++) {
      const host = rungs[i - 1][1][0];
      out.set(host.id, [...(out.get(host.id) || []), ...rungs[i][1]]);
    }

    // ...and the sub-ฝ่าย hang off the head of the top rung.
    if (units.length) {
      const head = rungs[0][1][0];
      out.set(head.id, [...(out.get(head.id) || []), ...units]);
    }
  }

  // Re-sort AFTER the moves, not just before. A host can end up holding its own
  // sub-ฝ่าย and a seat moved onto it by the tier rule, and the append order
  // would put the ฝ่าย first — seats always come before units, at every level.
  for (const bucket of out.values()) sortSiblings(bucket);
  return out;
}

/** A flattened row, as org-graph.js builds it. The three fields this module
 *  reads are set once in `flatten()`:
 *
 *    isDiv        this node is a ฝ่าย
 *    parentIsDiv  its parent is a ฝ่าย — i.e. it is a seat OF a unit, not a
 *                 sub-seat under another seat
 *    divDepth     how many ฝ่าย deep in the chain (a root ฝ่าย is 1 in BOTH
 *                 views; ผังรวม's synthetic องค์กร box is 0)
 */

// ── the rungs: KIND, not depth ───────────────────────────────────────────────
//
// REQUESTED: "การแสดงบนหน้าเว็บเริ่มจากฝ่าย PR then draw line to 3: Role head
// PR, Role 2 PR, Role 3 PR. Role headpr can expand to show Role sub head1 …
// Then next will show 2 lines to ฝ่าย media, creator. Navigate to role at that
// level first, then ฝ่าย will be under it."
//
// The rungs used to be RAW DEPTH — `d.depth <= level`. On a tree this ragged
// that number means a different thing in every branch: level 2 is หัวหน้าฝ่าย
// เลขาฯนายกฯ in สำนักนายกฯ, ฝ่าย PR in ฝ่ายดิจิทัล, and สมาชิก somewhere else.
// A rung labelled "หัวหน้าฝ่าย" therefore reached the heads in some branches and
// stopped a level above them in others — the SAME failure the `<` bug caused,
// but one this repo could not fix by changing an operator, because the levels
// genuinely do not line up.
//
// So the rungs are defined on what a node IS:
//
//   top   ฝ่ายหลัก   the root ฝ่าย only                        (15 + the org box)
//   fai   ฝ่ายย่อย   every ฝ่าย, all the way down the chain    (93 measured)
//   role  ตำแหน่ง    every ฝ่าย, plus the ตำแหน่ง it holds     (290 measured)
//   full  ทั้งหมด     everything, ตำแหน่ง under ตำแหน่ง as well  (298)
//
// `role` is the picture the request describes: each ฝ่าย draws a line to each
// of its own ตำแหน่ง and to each of its sub-ฝ่าย, and a ตำแหน่ง that holds
// further ตำแหน่ง keeps its own expand button. It is not a depth — in
// ฝ่ายดิจิทัล it reaches four levels down and in สำนักนายกฯ two, which is the
// point.
export const RUNG = {
  top: 'top', fai: 'fai', role: 'role', full: 'full',
};

export function rungVisible(d, rung) {
  if (rung === RUNG.full) return true;
  if (rung === RUNG.role) return d.isDiv || d.parentIsDiv;
  if (rung === RUNG.fai) return d.isDiv;
  return d.isDiv && d.divDepth <= 1;
}

/**
 * Mark the rows this rung shows.
 *
 * The library's `_expanded` flag means "this node should be VISIBLE"; it does
 * NOT mean "open my children". The old depth predicate was ancestor-closed by
 * construction — if `depth <= n` then so is every ancestor — and a KIND
 * predicate is not: ฝ่าย Media management hangs off หัวหน้าฝ่าย PR, a ตำแหน่ง,
 * so showing "every ฝ่าย" has to drag that ตำแหน่ง in with it or the branch is
 * orphaned. Hence the explicit walk up. It is one live case today and it will
 * be more the moment somebody rearranges the tree.
 *
 * A search overrides the rung entirely: a result you have to expand to reach is
 * the same as no result.
 */
export function applyRung(data, rung) {
  const byId = new Map(data.map((d) => [d.id, d]));
  const show = new Set();
  const mark = (row) => {
    let cur = row;
    while (cur && !show.has(cur.id)) { show.add(cur.id); cur = byId.get(cur.parentId); }
  };
  for (const d of data) {
    // The chart's own root is never hidden — a section drawn empty because its
    // root failed a predicate is indistinguishable from a broken chart.
    if (d.parentId === null || rungVisible(d, rung)) mark(d);
  }
  for (const d of data) d._expanded = show.has(d.id);
}

export const DEFAULT_RUNG = RUNG.role;

/**
 * The "n ตำแหน่ง · n คน" line under a card.
 *
 * REVIEWED, and it was a new claim nobody made on purpose: once sub-ฝ่าย hang
 * off the head seat, `อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร` rendered
 * **"17 ตำแหน่ง · 41 คน"**. On a ฝ่าย that line means CONTENTS and reads
 * correctly. On a person it reads as though the person contains forty-one
 * people — and it counted the อุปนายก themselves among them.
 *
 * So the line means different things on the two kinds, and says which:
 *
 *   ฝ่าย                    `18 ตำแหน่ง · 41 คน`            — what is inside it
 *   ตำแหน่ง with a subtree   `ใต้สังกัด 17 ตำแหน่ง · 40 คน`   — what reports below
 *   ตำแหน่ง with none        `9 คน`                          — who holds the seat
 *   nothing at all           `ยังไม่มีสมาชิก`
 *
 * `own` is excluded from the seat figure, because the holders of a seat are not
 * under it. That is the off-by-one the old wording hid: 41 included the one
 * person the card is about.
 *
 * ONE function, because both renderers drew this line and had hand-rolled the
 * same four branches — `.claude/rules/mistakes.md` class 6, found while it was
 * still only a wording bug.
 *
 * @param isDiv   this node is a ฝ่าย
 * @param nodes   ตำแหน่ง in the subtree, NOT counting this node
 * @param people  people in the subtree, INCLUDING those holding this node
 * @param own     people holding this node itself
 */
export function subtreeMeta({ isDiv, nodes, people, own = 0 }) {
  if (nodes === 0 && people === 0) return 'ยังไม่มีสมาชิก';

  // A seat with nothing under it is not making a claim about a subtree — the
  // number is simply who holds it, which is what it has always meant.
  const below = !isDiv && nodes > 0;
  const shown = below ? people - own : people;

  const bits = [];
  if (nodes > 0) bits.push(`${nodes} ตำแหน่ง`);
  if (shown > 1 || (shown === 1 && nodes > 0)) bits.push(`${shown} คน`);
  if (!bits.length) return '';
  return below ? `ใต้สังกัด ${bits.join(' · ')}` : bits.join(' · ');
}
