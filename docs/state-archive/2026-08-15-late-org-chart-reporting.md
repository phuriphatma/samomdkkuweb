# 2026-08-15 (late) — the org chart becomes a reporting chart

Archived from `STATE.md`, which had grown to 350 lines against a ~200 target.
This is the reference for how `/team` is built after the ผังรวม session; the
one-paragraph version that stayed in `STATE.md` points here.

Shipped this session, all deployed and verified from the served artifacts:
migrations **0151** (two kinds), **0152** (ฝ่าย colour), **0153** (ระดับ).
Commits `2b01b44 · cb11323 · 7c5cd26 · e3fe236 · 31ec4b3 · 6423d4c · f73a6a4`.

## What the owner asked for, in the order they asked

1. "ฝ่าย / แผนก / ตำแหน่ง should be left only ฝ่าย and ตำแหน่ง" → 0151.
2. "Navigate to role at that level first, then ฝ่าย will be under it" → read as
   ORDER, shipped as a sort. **Wrong.** They meant RANK, and said so twice more
   ("one line to อุปนายก then three lines to ฝ่าย PR, ComArt, IT"). See the
   write-up in `docs/mistakes/frontend-ui.md`; the reusable half is that
   "under", from someone describing a drawing, means BELOW and not AFTER.
3. "every ฝ่าย got the same color … it's dizzy" → depth grading, rails removed.
4. "make admin can custom the color also" → 0152.
5. "ฝ่ายวิชาการ inside ฝ่ายรังสีเทคนิค shows different color" → derived colour
   is ROOT-ONLY.
6. "without having to put Role สมาชิกฝ่าย IT inside หัวหน้าฝ่าย IT" → 0153.

## The invariants, in full

### 1b. The public org chart (`/team`) — how it is built

FOUR views. **รายการ + แผนผัง share ONE renderer and ONE markup; only CSS
differs.** The wrapper carries `data-view`, and the toggle flips it WITHOUT
re-rendering so open ตำแหน่ง and scroll position survive. **Scope every rule on
`[data-view=…]`, never on a width.** แผนผัง fits 400 people via ONE SECTION PER
ฝ่าย, BRANCH SIDEWAYS ONCE, and a BOUNDED wrapping row (`flex-wrap` alone did
nothing — `.org-tree` is `width: max-content`; `justify-content: safe center`,
because plain `center` makes the start-side overflow unreachable). The
คณะกรรมการ grid is GONE on purpose: **rank is position in the chart, not card
size.**

**ผังองค์กร + ผังรวม share ONE SEPARATE renderer** — `src/js/org-graph.js`,
d3-org-chart (MIT) on a zoom/pan SVG canvas, differing ONLY in grouping. The
face element both renderers draw lives in `src/js/org-face.js`. **Why the
library, the measured widths, the three portrait bugs:
`docs/state-archive/2026-08-15-org-chart-views.md`.**

**THREE display rules the chart applies that the STORED tree does not**
(all in `src/js/org-rung.js`, applied once in `org-chart.js`'s `index()` so all
four views AND the search read one structure; guarded by `org-rung.test.js`):

- **`chartParentage()` — sub-ฝ่าย hang off the ฝ่าย's HEAD seat**, not beside
  it. Reported twice: four lines out of ฝ่ายดิจิทัล said the อุปนายก and ฝ่าย
  PR/ComArt/IT were peers. First = `position` 0 = the head. NOT applied when
  the parent is a ตำแหน่ง (หัวหน้าฝ่าย PR holds a seat AND ฝ่าย Media
  management; those are peers). `team_nodes.parent_id` is untouched.
- **`sortSiblings()` — ตำแหน่ง before ฝ่าย**, stable, so `position` still
  orders within each group.
- **The "แสดงถึง" rungs are a KIND, not a depth** — ฝ่ายหลัก / ฝ่ายย่อย /
  ตำแหน่ง / ทั้งหมด, measuring 14 / 136 / 290 / 298 cards. A number could not
  express it: depth 2 is a หัวหน้า in สำนักนายกฯ and a ฝ่าย in ฝ่ายดิจิทัล.
  A kind predicate is NOT ancestor-closed the way `depth <= n` was, so
  `applyRung` walks up; the ladder is asserted to be nested.

**TWO KINDS ONLY — ฝ่าย and ตำแหน่ง** (0151 folded 78 แผนก into ฝ่าย; all were
containers). `src/js/node-kind.js` still reads a stray `department` as a ฝ่าย
— old bundle, old export, hand-edited import. `node-kind.test.js` keeps the
`<select>` and every writer at two. **The CHECK constraint making `department`
unwritable was deliberately NOT shipped with 0151** and is still owed — it is
safe to add now that the new bundle is served.

**COLOUR (0152).** A DERIVED colour is a **ROOT-ONLY** answer —
`tintColor(node, isRoot)`, `isRoot` defaulting to FALSE so a forgetful caller
inherits rather than guesses. Applied at every depth it made `ฝ่ายวิชาการ`
inside `ฝ่ายรังสีเทคนิค` blue; 27 of the 29 name-matching non-root nodes hit
their own root's colour BY COINCIDENCE, which is why it survived review.
`team_nodes.color`, null = derive from the name via the
shared `src/js/dept-tint.js`. Constrained to a hex literal in the DB **and** by
`isHexColor()` in JS, because the value lands in `style="--org-tint: …"` on an
anonymous page — `dept-tint.test.js` reads the regex OUT of the migration so
the two cannot drift. **Both read paths carry it**: `get_public_team_chart` has
a published-snapshot branch AND a live branch, and the CURRENT year reads the
snapshot once published, so publishing would otherwise revert every colour.
The 20 `[data-tint="x"]` CSS rules are gone; both renderers set `--org-tint`
inline from `tintColor()`.

Six things in the d3 renderer will still bite you, all guarded by
`org-graph-metrics.test.js`:

- **NOTHING inside a card may be `position`ed.** WebKit paints a positioned
  element in a `<foreignObject>` WITHOUT the ancestor SVG transform.
  `getBoundingClientRect()` reports the box CORRECT while this happens; only a
  decoded screenshot can see it (`skills/drive-the-browser.md`).
- **`initialExpandLevel` is NOT the depth control** — consumed once, then reset
  to 1 by the library. Visibility is `_expanded` on the data rows.
- **`frameChart()` replaces `fit()` and inherits its obligations**, including
  zeroing `centerG`.
- **`sizes` must be `portrait width × max zoom`, and zoom must be capped.**
  `srcset` resolves ONCE from the LAYOUT size.
- **เต็มหน้าจอ is a CSS overlay, never the Fullscreen API** — iOS only honours
  `requestFullscreen()` on `<video>`.
- **d3 is dynamically imported** — a static import put d3-zoom in the ENTRY
  bundle, +13.6 KB gz for everyone.

### 1c. ระดับ (`team_nodes.tier`, 0153) — rank without nesting

**The tree means CONTAINMENT; `tier` means RANK.** Seats on one tier draw on
one row; tier k+1 hangs off the FIRST seat of the tier above (position 0 = the
head). NULL means 1, so nothing was backfilled. A gap (1 and 3, no 2) closes
rather than orphaning — `rungs[i-1]`, never `i-1`.

**The eight pre-existing seat-under-seat nestings were converted** and the
drawing did not change: `tools/team0153-tier-parity.mjs` runs the committed
pre-migration snapshot (`tools/fixtures/team-tree-before-0153.json`) and the
live tree through the SAME `chartParentage()` the page uses and compares the
DRAWINGS. **Deliberately NOT in `npm run proofs`** — the snapshot is a moment,
so it will legitimately go red once the tree is edited, and a proof that cries
wolf teaches people to ignore proofs.

**Nesting still works.** This does not forbid a seat under a seat; it removes
the need for one. `chartParentage` reads both, and the ระดับ control is hidden
where nesting is already saying it.

### 1d. OPEN — asked, not yet answered

Nothing is outstanding from the org-chart work. Two things the owner has
ruled on that a future session should not re-raise:

- **The `master` grants that reach สมาชิกฝ่าย IT are INTENTIONAL** — confirmed
  again 2026-08-15 when the tier proposal cited them as a side effect. They
  are not an argument for anything. Do not raise them a third time.
- **แผนผัง and รายการ read the STORED tree; only the canvas views re-parent.**
  The owner's asks have all been about ผังรวม. Do not "unify" the four views.

## What a later session should know about the guards

- `org-rung.test.js` (32) — the rungs, the re-parenting, the tier rules, the
  meta wording. Every assertion in it was falsified by reintroducing the bug
  before being committed; two fixtures had to be rewritten because they could
  not reach the branch they claimed to cover.
- `dept-tint.test.js` (13) — root-only derivation, the call-site check, and a
  differential that reads the hex regex OUT of 0152 rather than retyping it.
- `node-kind.test.js` (12) · `team-state-specificity.test.js` (4).
- `tools/team0153-tier-parity.mjs` + `tools/fixtures/team-tree-before-0153.json`
  — one-shot, deliberately NOT in `npm run proofs`.
