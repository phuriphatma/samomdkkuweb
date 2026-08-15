// org-rung.js — the two things a node's KIND decides on the public chart: what
// order siblings are drawn in, and how far down the chart opens.
//
// Pure: no DOM, no d3, no config. Both rules live here rather than in the
// renderers because all four views obey them and four copies of one rule is the
// class this repo pays for most — and because a pure module can be tested
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
