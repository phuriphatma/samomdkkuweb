// org-graph.js — ผังองค์กร, the third surface over the ทีม SAMO dataset.
//
// รายการ is an indented outline, แผนผัง is a CSS chart, and this is a real
// top-down org chart drawn by d3-org-chart (MIT) on a pannable, zoomable canvas
// with per-ตำแหน่ง collapse.
//
// ── WHY ONE CHART PER ฝ่าย, NOT ONE CHART ──────────────────────────────────
//
// Measured on the live 272-node tree, laid out as a SINGLE chart:
//
//     expand depth │ plain tree │ d3-flextree compact
//     ─────────────┼────────────┼────────────────────
//              2   │  14,290 px │   6,190 px
//              3   │  34,810 px │  20,770 px
//            all   │  48,040 px │  35,350 px
//
// Compact packing buys ~40%, and 20,770 px is still twenty screens. This is not
// a library limitation — twelve root ฝ่าย at a ~500 px minimum each is a
// ~6,000 px floor before anything is drawn. Dropping the สมาชิก buckets to leave
// only leadership still measured 17,530 px.
//
// Split per ฝ่าย, the widest SINGLE ฝ่าย is 2,140–2,680 px at the default depth.
// That is two screens — pannable, and zoom-to-fit lands at a readable scale. So
// the page stacks one chart per root ฝ่าย, which is also what แผนผัง already
// does, and what the owner asked for originally ("vstack{ hstack ฝ่ายบริหาร }
// then the next {hstack ฝ่ายดิจิทัล}").
//
// ── WHY IT OPENS AT LEVEL 2 ────────────────────────────────────────────────
//
// REQUESTED: "i want it to can view to some depth at the first time, like from
// นายกสโม to heads of it depth". Within one ฝ่าย chart the levels are
//
//     0  ฝ่ายดิจิทัลและสื่อสารองค์กร     (the chart's root)
//     1  ฝ่าย PR · ฝ่าย ComArt · ฝ่าย IT
//     2  หัวหน้าฝ่าย PR · หัวหน้าฝ่าย IT …   ← the heads
//     3  สมาชิกฝ่าย Backend …
//
// so level 2 IS "down to the heads", exactly. สำนักนายกฯ resolves the same way:
// level 1 is นายกฯ / อุปนายกฯ, level 2 is the ten อุปนายกฝ่าย.
//
// The library is loaded with a dynamic import so none of it — nor its d3
// subset, 33 KB gzipped together — is in the entry bundle. A reader who never
// opens ผังองค์กร never downloads it.
import { escHtml } from './utils.js';
import { faceHtml, GRAPH_SHAPE } from './org-face.js';

// d3-zoom is imported DYNAMICALLY, beside the chart library, and not with a
// static `import` at the top of this file. This module is reachable statically
// from org-chart.js (destroyOrgGraph runs on every paint of all three views), so
// a static import here puts d3-zoom in the ENTRY bundle — measured at +13.6 KB
// gzipped for every reader, including the ones who never open ผังองค์กร. Both
// dynamic imports resolve into the same lazy chunk instead.
let zoomIdentity = null;

// Every mounted chart, so a view/year switch can tear them all down. d3-org-chart
// attaches a zoom behaviour and a resize path per instance; dropping the host
// element without clearing these leaks the listener.
let charts = [];
let ro = null;
let host = null;

const NODE_W = 250;
const PAD = 11;          // card padding, top and bottom
const META_H = 17;       // the "n ตำแหน่ง · n คน" line
const MORE_H = 17;       // the "+N คน" line
const TITLE_LH = 17;     // one line of ตำแหน่ง name
const MAX_TITLE_LINES = 3;

// ── how big a face has to be here, and why 26px was wrong ───────────────────
//
// REPORTED: "the picture render wrong". The first version drew a 26px portrait,
// avatar-sized. But these are WAIST-UP STUDIO SHOTS, not head-and-shoulders
// crops: at 26px the head is about eight pixels and the card shows a torso.
// The control is the other views — รายการ renders the same photo at a 136px box,
// where it reads as a person.
//
// So the row is sized around a portrait that is actually legible. 44px wide at
// 3:4 is 58.7px tall, and ROW_H carries that plus breathing room. It makes a
// one-person card ~124px instead of ~90; that is the cost, and it is worth it,
// because a face nobody can recognise is not worth any pixels at all.
//
// ROW_H and .orgg-person's height in org-graph.css are ONE decision in two
// files — org-graph-metrics.test.js fails if they drift.
const ROW_H = 62;        // one person row (44px portrait at 3:4 = 58.7, + gap)

// How many faces a card shows before collapsing the rest into "+N คน". 214 of
// 272 ตำแหน่ง hold one person or none, so this only ever bites the ~20 large
// สมาชิก buckets — and with the bigger portrait, four stacked faces would make
// one card taller than the ฝ่าย beside it.
const PEOPLE_INLINE_MAX = 3;

/** Text measurement for the card title, so a two-line ตำแหน่ง gets a two-line
 *  box. d3-org-chart needs the height BEFORE it lays out — it cannot ask the
 *  DOM, because nothing is rendered yet — so guessing here means either clipped
 *  names or a ragged gap under every short one. */
let mctx = null;
function titleLines(text) {
  if (!mctx) {
    const c = document.createElement('canvas');
    mctx = c.getContext('2d');
  }
  mctx.font = "600 13px Prompt, 'Noto Sans Thai', system-ui, sans-serif";
  const w = mctx.measureText(String(text || '')).width;
  return Math.min(MAX_TITLE_LINES, Math.max(1, Math.ceil(w / (NODE_W - PAD * 2))));
}

function cardHeight(d) {
  const shown = Math.min(d.people.length, PEOPLE_INLINE_MAX);
  return PAD * 2
    + titleLines(d.name) * TITLE_LH
    + (shown ? 6 + shown * ROW_H : 0)
    + (d.people.length > shown ? MORE_H : 0)
    + (d.meta ? META_H : 0);
}

function personHtml(m, q) {
  return `
    <div class="orgg-person">
      <span class="org-face">${faceHtml(m, GRAPH_SHAPE)}</span>
      <span class="orgg-p-text">
        <span class="orgg-p-name">${hi(m.name || '', q)}</span>
        ${m.nickname ? `<span class="orgg-p-nick">${hi(m.nickname, q)}</span>` : ''}
      </span>
    </div>`;
}

/** Same search highlight as the other two views. Kept tiny and local rather than
 *  imported from org-chart.js, which would make the import cycle real. */
function hi(text, q) {
  const safe = escHtml(text);
  if (!q) return safe;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return safe;
  return `${escHtml(text.slice(0, i))}<mark>${escHtml(text.slice(i, i + q.length))}</mark>${escHtml(text.slice(i + q.length))}`;
}

function cardHtml(d, q) {
  const shown = d.people.slice(0, PEOPLE_INLINE_MAX);
  const rest = d.people.length - shown.length;
  return `
    <div class="orgg-card"${d.tint ? ` data-tint="${d.tint}"` : ''}>
      <div class="orgg-name">${hi(d.name || '', q)}</div>
      ${shown.length ? `<div class="orgg-people">${shown.map((m) => personHtml(m, q)).join('')}</div>` : ''}
      ${rest > 0 ? `<div class="orgg-more">+${rest} คน</div>` : ''}
      ${d.meta ? `<div class="orgg-meta">${escHtml(d.meta)}</div>` : ''}
    </div>`;
}

/**
 * Flatten one root ฝ่าย into the {id, parentId} array d3-org-chart wants.
 *
 * The RPC already returns nodes as a flat list with parent_id, so this is a
 * projection rather than a transform — the shape matching is most of why this
 * library was chosen over the alternatives.
 */
function flatten(rootNode, ctx) {
  const { byParent, byNode, subStats, tintFor, filter } = ctx;
  const out = [];
  const tint = tintFor(rootNode.name);

  const walk = (node, parentId, depth) => {
    if (filter && !filter.keepNodes.has(node.id)) return;
    let people = byNode.get(node.id) || [];
    if (filter) people = people.filter((m) => filter.keepMembers.has(m));

    const s = subStats.get(node.id) || { nodes: 0, people: 0 };
    let meta = '';
    if (!filter) {
      if (s.nodes === 0 && s.people === 0) meta = 'ยังไม่มีสมาชิก';
      else {
        const bits = [];
        if (s.nodes > 0) bits.push(`${s.nodes} ตำแหน่ง`);
        if (s.people > 1 || (s.people === 1 && s.nodes > 0)) bits.push(`${s.people} คน`);
        meta = bits.join(' · ');
      }
    }

    const d = {
      id: node.id,
      parentId,
      name: node.name || '',
      people,
      meta,
      tint,
      depth,
      // The count on the expand button. Direct children, not the whole subtree —
      // the button opens ONE level, so promising the subtree total would be a
      // number the click does not deliver.
      kids: (byParent.get(node.id) || []).length,
    };
    d._h = cardHeight(d);
    out.push(d);
    (byParent.get(node.id) || []).forEach((c) => walk(c, node.id, depth + 1));
  };

  walk(rootNode, null, 0);
  return out;
}

/** Level 2 by default — see the header. A search overrides it: a result you
 *  have to expand to reach is the same as no result. */
function applyDepth(data, level) {
  data.forEach((d) => { d._expanded = d.depth < level; });
}

export const DEFAULT_DEPTH = 2;

// ── framing: why this does NOT use the library's fit() ──────────────────────
//
// `fit()` scales to fit BOTH axes into a fixed-height svg, which is wrong at
// both ends of this dataset:
//
//   • สำนักนายกฯ has 3 boxes. Fitted into a 620 px box it left ~400 px of empty
//     canvas — times twelve stacked sections, most of the page was blank.
//   • ฝ่ายเวชนิทัศน์ has 9 children. Fitting ~2,000 px of content into 1,014 px
//     scaled it to ~0.45, and a 250 px card at 0.45 is 112 px of unreadable
//     Thai.
//
// So instead: pick the scale from the WIDTH alone, clamp it to something
// legible, and then size the section to whatever height that scale produces. A
// ฝ่าย too wide to fit legibly stays legible and pans sideways — which is what
// the zoom/pan canvas is for, and the reason this view exists at all.
const MIN_SCALE = 0.52;   // below this a 250 px card stops being readable
const MAX_SCALE = 1;      // never enlarge; a 3-box ฝ่าย should not render huge
const MIN_H = 190;
const MAX_H = 620;
const FRAME_PAD = 26;

/** Bounding box of the VISIBLE nodes, in layout units. */
function bounds(chart) {
  const st = chart.getChartState();
  const nodes = st.root ? st.root.descendants() : [];
  if (!nodes.length) return null;
  const lb = st.layoutBindings[st.layout];
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, n.x + lb.nodeLeftX(n));
    x1 = Math.max(x1, n.x + lb.nodeRightX(n));
    y0 = Math.min(y0, n.y + lb.nodeTopY(n));
    y1 = Math.max(y1, n.y + lb.nodeBottomY(n));
  }
  return {
    x0, x1, y0, y1, w: (x1 - x0) + FRAME_PAD * 2, h: (y1 - y0) + FRAME_PAD * 2,
  };
}

/**
 * Lay out, compacting ONLY if the ฝ่าย is too wide without it.
 *
 * Compact packing folds a row of children into two columns. That is what keeps
 * ฝ่ายรังสีเทคนิค (10 children) and ฝ่ายเวชนิทัศน์ (9) inside one screen — but
 * applied to ฝ่ายดิจิทัล's THREE children it stacks two on the left and one on
 * the right, which reads as a broken row rather than an org chart. A chart that
 * fits should look like the reference charts everyone pictures: children in a
 * single row under their parent.
 *
 * So measure it. Lay out uncompacted, and keep that if it fits the container;
 * compact only when it does not. Twelve charts × at most two layout passes is
 * nothing, and it beats any heuristic on child count because it asks the actual
 * question — does this fit?
 */
function layoutChart(chart) {
  chart.compact(false).render();
  const b = bounds(chart);
  const w = chart.getChartState().svgWidth;
  if (b && b.w > w) chart.compact(true).render();
}

function frameChart(chart) {
  // Null until mountOrgGraph resolves its dynamic imports. Every caller runs
  // after that, but a resize firing mid-import would otherwise throw here.
  if (!zoomIdentity) return;
  const st = chart.getChartState();
  const b = bounds(chart);
  if (!b) return;
  const {
    x0, x1, y0, y1, w: cw, h: ch,
  } = b;

  const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, st.svgWidth / cw));
  const h = Math.max(MIN_H, Math.min(MAX_H, Math.round(ch * scale)));

  // Node coordinates come from the flextree layout and do not depend on the
  // svg height, so the bounds measured above stay valid across this re-render.
  // The guard is what stops a ResizeObserver tick from re-rendering forever.
  if (Math.abs(h - st.svgHeight) > 1) chart.svgHeight(h).render();

  const s2 = chart.getChartState();
  const t = zoomIdentity
    .translate(s2.svgWidth / 2, s2.svgHeight / 2)
    .scale(scale)
    .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);

  // BOTH halves, or the chart lands off-screen. render() gives centerG its own
  // `translate(centerX, rootMargin) scale(...)` centering transform, which
  // COMPOSES with the zoom transform — set only the zoom and every box is
  // shifted by centerX and drawn half outside the section. The library's own
  // zoomTreeBounds() zeroes centerG for exactly this reason; frameChart replaces
  // that method, so it inherits the obligation.
  s2.centerG.attr('transform', 'translate(0,0)');
  s2.svg.call(s2.zoomBehavior.transform, t);
}

/**
 * Draw one chart per root ฝ่าย into `hostEl`.
 *
 * Returns the number of charts drawn so the caller can decide whether to show
 * the empty state. Awaits `document.fonts.ready` first: the card height is
 * computed from a canvas text measurement, and measuring before Prompt loads
 * returns the fallback face's metrics, which under-measures Thai and clips the
 * second line of every long ตำแหน่ง.
 */
export async function mountOrgGraph(hostEl, ctx) {
  const [{ OrgChart }, zoom] = await Promise.all([
    import('d3-org-chart'),
    import('d3-zoom'),
  ]);
  zoomIdentity = zoom.zoomIdentity;
  try { await document.fonts?.ready; } catch { /* no font loading API */ }

  destroyOrgGraph();
  host = hostEl;

  const depth = ctx.filter ? 99 : (ctx.depth ?? DEFAULT_DEPTH);
  const q = ctx.filter?.q || '';
  let drawn = 0;

  for (const root of ctx.roots) {
    const data = flatten(root, ctx);
    // A ฝ่าย the search filtered down to nothing is noise — drop the section
    // rather than render a chart with a lone empty root.
    if (!data.length) continue;
    applyDepth(data, depth);

    const section = document.createElement('section');
    section.className = 'orgg-section';
    const canvas = document.createElement('div');
    canvas.className = 'orgg-canvas';
    section.appendChild(canvas);
    hostEl.appendChild(section);

    const chart = new OrgChart()
      .container(canvas)
      .data(data)
      .nodeId((d) => d.id)
      .parentNodeId((d) => d.parentId)
      .svgWidth(canvas.clientWidth || hostEl.clientWidth || 900)
      .svgHeight(Math.max(360, Math.min(680, Math.round(window.innerHeight * 0.68))))
      .nodeWidth(() => NODE_W)
      .nodeHeight((d) => d.data._h)
      .childrenMargin(() => 46)
      .siblingsMargin(() => 22)
      .neighbourMargin(() => 22)
      .compactMarginPair(() => 40)
      .compactMarginBetween(() => 18)
      .nodeButtonWidth(() => 58)
      .nodeButtonHeight(() => 26)
      .nodeButtonX(() => -29)
      .nodeButtonY(() => -13)
      .compact(true)
      .layout('top')
      // A CEILING ON ZOOM, and it is half of the portrait fix.
      //
      // The library defaults to [0.001, 20]. Twenty times is not a feature on a
      // 250px card — and because `srcset` is resolved once from the LAYOUT size
      // and never re-evaluated under an SVG transform (see GRAPH_SHAPE in
      // org-face.js), unbounded zoom means no source image is ever big enough.
      // Capping the zoom is what makes "request a bigger portrait up front" a
      // complete answer rather than a bet on how far someone drags.
      //
      // The floor sits below MIN_SCALE (0.52) so frameChart's own transform is
      // never clamped by it.
      .scaleExtent([0.3, 3])
      .defaultFont("'Noto Sans Thai', system-ui, sans-serif")
      // initialExpandLevel is consumed once and then reset to 1 by the library,
      // so it is NOT the depth control — `_expanded` on the data rows is. Set to
      // 0 here so the library never overrides what applyDepth() just decided.
      .initialExpandLevel(0)
      .nodeContent((d) => cardHtml(d.data, q))
      .buttonContent(({ node }) => {
        const open = !!node.children;
        return `<div class="orgg-btn${open ? ' is-open' : ''}">
          <i class="bi bi-chevron-${open ? 'up' : 'down'}"></i>${
  node.data.kids ? `<span>${node.data.kids}</span>` : ''}</div>`;
      })
      .render();

    layoutChart(chart);
    frameChart(chart);
    charts.push({ chart, canvas });
    drawn += 1;
  }

  // Re-fit on width change. Charts live in a stacked column, so a phone rotation
  // or a desktop resize otherwise leaves every one of them clipped at the old
  // width with no way to recover but a reload.
  if (typeof ResizeObserver !== 'undefined') {
    let t = null;
    ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        charts.forEach(({ chart, canvas }) => {
          const w = canvas.clientWidth;
          if (w > 0) { chart.svgWidth(w); layoutChart(chart); frameChart(chart); }
        });
      }, 160);
    });
    ro.observe(hostEl);
  }

  return drawn;
}

/** Expand / collapse every chart on the page at once. */
export function setGraphDepth(level) {
  charts.forEach(({ chart }) => {
    const data = chart.getChartState().data || [];
    applyDepth(data, level);
    chart.initialExpandLevel(0);
    layoutChart(chart);
    frameChart(chart);
  });
}

export function fitGraphs() {
  charts.forEach(({ chart }) => frameChart(chart));
}

export function zoomGraphs(dir) {
  charts.forEach(({ chart }) => (dir > 0 ? chart.zoomIn() : chart.zoomOut()));
}

/** Tear every chart down. d3-org-chart holds a zoom behaviour per instance and
 *  this module holds a ResizeObserver on the host; dropping the markup without
 *  clearing both leaks a listener per view switch, and a year switch can happen
 *  many times in one visit. */
export function destroyOrgGraph() {
  if (ro) { try { ro.disconnect(); } catch { /* already gone */ } ro = null; }
  charts = [];
  if (host) host.innerHTML = '';
  host = null;
}
