# 2026-08-14/15 — the two d3 org-chart views, and three portrait bugs

Archive of the session that added ผังองค์กร and ผังรวม to the public ทีม SAMO
page. `STATE.md` keeps only the invariants; the reasoning and the measurements
live here. Commits: `2a0eb5b` → `b140578` → `2227335` → `f2a564a`.

---

## 1. Choosing the library

The owner asked for a plugin rather than hand-rolled CSS, and asked twice for
the field to be surveyed properly (yFiles and a StackBlitz demo were named).

reddit.com and stackoverflow.com both **block Anthropic's crawler** (hard 400 on
a domain-restricted search), so practitioner discussion was not reachable. The
decision was made on npm adoption, repo health and a head-to-head measurement on
the live 272-node tree instead.

| Library | Stars | npm/mo | Licence | Verdict |
|---|---|---|---|---|
| dabeng/OrgChart | 3,035 | 25k | MIT | rejected — see below |
| **d3-org-chart** | 1,205 | **441k** | MIT | **chosen** |
| antvis/G6 | 12,247 | 1.1M | MIT | general graph engine, org chart is a use case |
| apexcharts/apextree | **15** | 13k | unclear | too small, no community |
| treant-js | 891 | 3.3k | MIT | last push 2023, effectively dead |
| GoJS | — | 868k | ~$4,000 | commercial |
| yFiles | — | — | **$17,000/dev** | commercial |

**Why not dabeng/OrgChart**, despite 2.5× the stars and half the bundle
(16.1 KB gz vs 32.9): it lays out with nested flexbox
(`.orgchart .nodes { display:flex }`), so chart width is the **sum of all leaf
widths** — the identical failure the CSS แผนผัง already hit. Its `compact`
option is not a packing algorithm; it is a 140×50 grey stub that hides children
(`.compact > .node { display:none }`). Its sibling row also uses
`justify-content: center`, which this repo has already written up as making the
overflow of a scroll container unreachable.

Both commercial options were non-starters regardless of price: **both repos are
public**, and their licences forbid redistribution.

⚠️ **d3-org-chart's npm publish is stale** — v3.1.1, September 2023 — while the
repo is active (pushed July 2026). If a fix is ever needed it is one MIT file,
~2,000 lines, vendorable into `src/js/vendor/`. Not vendored preemptively.
Pinned without a caret for that reason.

## 2. Why one chart per ฝ่าย, and why ผังรวม is still fine

Measured on the live tree, as a SINGLE whole-org chart:

| expand depth | plain tree | d3-flextree compact |
|---|---|---|
| 2 | 14,290 px | 6,190 px |
| 3 | 34,810 px | 20,770 px |
| all | 48,040 px | 35,350 px |

Compact packing buys ~40% and 20,770 px is still twenty screens. Dropping the
สมาชิก buckets to leave only leadership still measured 17,530 px. Twelve root
ฝ่าย at a ~500 px floor each is a ~6,000 px floor before anything is drawn.

**I argued from this that a whole-org chart was unusable, and I was wrong.** The
estimate above used flexbox math. With real compact packing the top level of
ผังรวม is **540 px at scale 1.0** — the twelve ฝ่าย pack into two columns and the
whole organisation reads at a glance. Measured per rung:

| ผังรวม rung | cards | content width | scale |
|---|---|---|---|
| ฝ่ายหลัก (default) | 13 | **540 px** | 1.00 |
| ฝ่ายย่อย | 76 | 6,443 px | 0.52 |
| หัวหน้าฝ่าย | 185 | 24,226 px | 0.52 |
| ทั้งหมด | 283 | 39,112 px | 0.52 |

Only the first fits without panning; the rest are pan/zoom, which is what the
canvas is for. **Lesson: measure the real layout engine before ruling a design
out — the estimate was off by 6×.**

## 3. Framing: why `fit()` is not used

`fit()` scales to fit BOTH axes into a fixed-height svg, which is wrong at both
ends of this dataset — สำนักนายกฯ (3 boxes) left ~400 px of empty canvas ×12
sections, while ฝ่ายเวชนิทัศน์ (9 children) shrank to ~0.45 and became
unreadable. `frameChart()` picks the scale from WIDTH alone, clamps it to
`[0.52, 1]`, and sizes the section to whatever that produces.

`layoutChart()` then compacts **only if the ฝ่าย does not otherwise fit** —
compact packing folds three children into two columns, which reads as a broken
row rather than an org chart. Two layout passes × 12 charts is nothing, and it
beats any child-count heuristic because it asks the actual question.

## 4. The three portrait bugs

All three were reported by the owner testing live, in three separate rounds.

### 4a. "the picture render wrong" — 26 px was a design error

The first version drew a 26 px portrait. The source photos are **waist-up studio
shots**: at 26 px the head is ~8 px and the card shows a torso. The control was
the other views — รายการ renders the identical photo into a 136 px box. Now
44 px, with `ROW_H` sized around it (62 px) and `PEOPLE_INLINE_MAX` dropped to 3.

### 4b. "when zoom picture also bug" — `srcset` resolves once

`srcset` is resolved ONCE from the element's CSS **layout** size, and an SVG
transform never changes that — it only scales the painted result. Measured: six
zoom-in steps grew the box from 26×35 to **125×167** while `naturalWidth` stayed
**34** and `currentSrc` never changed — stretched 3.7× past its pixel data.

The rival hypothesis (foreignObject rasterising at fixed resolution) was
**disproved** by injecting a 400×533 source into the same box: it rendered sharp.

Fix: `sizes = portrait width × max zoom = 44 × 3 = 132px`, candidates at 1/2/3×
for DPR 1–3. **Both halves are required** — that only terminates because
`scaleExtent` caps zoom at 3; the library default `[0.001, 20]` admits no
sufficient source. A first attempt used `box × 2` and still measured 0.67× at
full zoom on retina. Verified at DPR 2: 3.00× headroom at rest, 1.00× at max zoom.

### 4c. "the picture on ipad still bug" — WebKit drops the SVG transform

Full write-up in `docs/mistakes/frontend-ui.md`. The short version: `.org-face`
carries `position: relative`, and WebKit paints a **positioned** element inside a
`<foreignObject>` without the ancestor SVG transform.

Isolated on real WebKit with a minimal page — `<g transform="translate(300,200)">`
over a foreignObject, one property flipped at a time, measuring **painted
pixels**:

```
overflow:hidden · aspect-ratio · display:grid · border-radius  →  312,214  ok
position:relative                                              →   12, 14  wrong
```

12,14 is 312−300, 214−200: off by exactly the transform.

**`getBoundingClientRect()` returned the CORRECT box in every variant**,
including the broken ones. No DOM measurement can see this. The first fix
removed the img's own `position: absolute` — the wrong one — and the bug simply
moved from the image to the whole face box.

## 5. The off-by-one that shipped

Found while measuring ผังรวม. `applyDepth` used `d.depth < level`, but the
library's `_expanded` means "this node is VISIBLE" (`expandSomeNodes()` walks UP
and opens ancestors), not "open my children". So every rung rendered **one level
shallower than its label** — the ผังองค์กร default was named หัวหน้าฝ่าย and
stopped at the sub-ฝ่าย above them, never reaching the heads the feature was
built for. Now `<=`; verified by asserting the default renders a ตำแหน่ง named
หัวหน้าฝ่าย (returned `false` before, `true` after).

## 6. Guards written

`src/js/org-graph-metrics.test.js`, 20 assertions, each falsified by
reintroducing the bug:

- card-height constants in JS ↔ the CSS they mirror (5 drifts)
- `sizes >= faceWidth × maxZoom`, DPR 1–3 coverage, the zoom cap's existence and
  its floor vs `MIN_SCALE`, the 40 px portrait minimum
- `applyDepth` is `<=`, and ผังรวม hangs everything off one synthetic root
- `frameChart` zeroes `centerG`; d3 is imported dynamically, never statically
- `.orgg-person .org-face` is `position: static` and stacks with grid

⚠️ **The paint guard was WRONG TWICE before it was right**: it first matched
`.org-face-initials` as a substring of `.org-face` and passed with the fix
deleted, then swallowed the preceding comment block into the selector and failed
with the fix present. Both caught only by running the falsification. A guard you
have not watched fail is not a guard.

## 7. Bundle

Entry bundle unchanged: **53.88 KB gz vs 53.38 before**. d3 lives in two lazy
chunks (~33 KB gz total) that only load when a reader opens one of the d3 views.
d3-zoom had to be moved to a dynamic import — a top-level `import` put it in the
entry bundle (+13.6 KB gz for everyone), because `org-graph.js` is reachable
statically from `org-chart.js`.

## 8. Not done

- **Never tested on a real iPad.** Everything was verified on Playwright's
  WebKit with an iPad Pro profile — same engine, not the same device. The
  touch-scroll behaviour around the pan/zoom canvas and the full-screen overlay
  are the parts most worth a real-device pass.
- Four view buttons now wrap on a narrow screen; never looked at on a phone.
