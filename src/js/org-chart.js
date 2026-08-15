// org-chart.js — the public ทีม SAMO page.
//
// FOUR surfaces over one dataset — every ตำแหน่ง and person, searchable:
//   • รายการ / แผนผัง — one renderer, one markup; only the CSS differs.
//   • ผังองค์กร / ผังรวม — d3-org-chart on a zoom/pan canvas (org-graph.js).
// The full note on which is which, and why, is at the `VIEWS` constant below.
//
// Data comes from ONE rpc: public.get_public_team_chart(year). That function is
// the only sanctioned publisher of team data (0086 → 0103 → 0104) — a SECURITY
// DEFINER projection whose jsonb keys are an explicit allow-list, over a
// recursive CTE so a non-public ตำแหน่ง hides its entire subtree. Neither
// team_members nor the archive tables have a public SELECT policy (verified:
// anon reads 0 rows from all three), so this page cannot show a field the
// projection does not name.
//
// YEARS: the current ปีการศึกษา renders from the live tree; past years render
// from a frozen archive. Same rpc, same jsonb shape, so nothing below this
// comment knows which it got.
//
// Read-only, anonymous, no writes.
import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import { faceHtml, TREE_SHAPE } from './org-face.js';
import {
  mountOrgGraph, destroyOrgGraph, setGraphRung, fitGraphs, zoomGraphs,
  toggleGraphFullscreen, anyGraphFullscreen, exitGraphFullscreen,
} from './org-graph.js';
import { RUNG, DEFAULT_RUNG, chartParentage } from './org-rung.js';
import { tintColor } from './dept-tint.js';

// One entry per year, so switching back to a year already viewed is instant and
// free. The dataset is ~280 nodes / ~400 people — small enough to just keep.
const charts = new Map();

let years = [];           // [{ year, label, is_current }]
let activeYear = null;
let chart = null;         // { year, is_current, nodes, members }
let byParent = new Map(); // parent_id ('' for root) -> node[]
let byNode = new Map();   // node_id -> member[]
let nodeById = new Map();
let subStats = new Map(); // node_id -> { nodes, people } for the whole subtree
let collapsibleIds = new Set();
let loading = false;
let query = '';

// Which ตำแหน่ง are open. Collapsed is the DEFAULT: 279 ตำแหน่ง / 402 people is
// several screens of continuous scroll, and the twelve ฝ่าย with their subtree
// counts read as an index you can actually navigate. Expanding is one tap, and
// "ขยายทั้งหมด" restores the old all-at-once view for anyone who wants it.
// Keyed by node id, reset per ปีการศึกษา (ids differ between the live tree and
// each frozen archive).
let expanded = new Set();

// FOUR surfaces over one dataset:
//   • รายการ  — the indented outline
//   • แผนผัง  — the CSS chart. Same markup as รายการ, only the CSS differs, so
//               it is a class on a wrapper rather than a second renderer.
//   • ผังองค์กร — a real top-down org chart on a zoom/pan canvas, drawn by
//               d3-org-chart. This one IS a separate renderer (org-graph.js),
//               because SVG layout is not something CSS can be talked into.
//               It shares the face element via org-face.js so the one thing the
//               two renderers both draw cannot drift. ONE CHART PER ฝ่าย.
//   • ผังรวม   — the SAME renderer and the same card, but ONE chart over the
//               whole organisation, hung off a synthetic องค์กร root. Wide by
//               construction; the แสดงถึง rung is what makes it navigable.
//
// Kept in localStorage because a reader who prefers one has that preference on
// every visit, and the choice costs nothing to honour.
const VIEWS = ['list', 'chart', 'graph', 'all'];
const GRAPH_VIEWS = ['graph', 'all'];
let view = 'list';
try {
  const saved = localStorage.getItem('samo.org.view');
  if (VIEWS.includes(saved)) view = saved;
} catch { /* private mode */ }

// The d3 views' "แสดงถึง" rung. A KIND, not a depth — the `RUNG` note in
// org-rung.js has the measurements and why a number could not express it.
//
// Kept PER VIEW because the two views want different starting pictures, not
// because the same rung means different things in them: it no longer does.
// ผังองค์กร opens at ตำแหน่ง (each ฝ่าย with the seats it holds); ผังรวม opens
// at ฝ่ายหลัก, its only rung that fits without panning.
const graphRung = { graph: DEFAULT_RUNG, all: RUNG.top };

/** Which rungs each view OFFERS. ผังองค์กร is already one chart per root ฝ่าย,
 *  so its "ฝ่ายหลัก" rung would be a single box — it starts at ฝ่ายย่อย
 *  instead. The labels say what you will SEE, not how deep it goes. */
const VIEW_RUNGS = {
  graph: [[RUNG.fai, 'ฝ่าย'], [RUNG.role, 'ตำแหน่ง'], [RUNG.full, 'ทั้งหมด']],
  all: [[RUNG.top, 'ฝ่ายหลัก'], [RUNG.fai, 'ฝ่ายย่อย'], [RUNG.role, 'ตำแหน่ง'],
    [RUNG.full, 'ทั้งหมด']],
};

// A ตำแหน่ง with a couple of people and no sub-ตำแหน่ง is not worth hiding behind
// a disclosure — 106 of them hold exactly one person, and making those a click
// each would be worse than the scroll it saves.
const PEOPLE_INLINE_MAX = 3;

const $ = (id) => document.getElementById(id);

function index() {
  byParent = new Map();
  byNode = new Map();
  nodeById = new Map();
  for (const n of chart.nodes || []) {
    const k = n.parent_id || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
    nodeById.set(n.id, n);
  }
  // The four public views draw a REPORTING structure, not the storage tree:
  // a ฝ่าย's seats are its children and its sub-ฝ่าย hang off the head seat.
  // Done once, here, on the index every view reads — including the search,
  // which derives its parent map from this same structure below, so a filtered
  // chart cannot disagree with an unfiltered one about who reports to whom.
  byParent = chartParentage(byParent, nodeById);
  for (const m of chart.members || []) {
    if (!byNode.has(m.node_id)) byNode.set(m.node_id, []);
    byNode.get(m.node_id).push(m);
  }
  indexStats();
}

/** Subtree totals, so a collapsed ฝ่าย still says how much is inside it — a
 *  disclosure with nothing but a name gives no reason to open it. Walked once
 *  per year rather than per paint; `seen` guards against a cycle turning a
 *  render into an infinite loop (the projection is a tree, but this is the only
 *  walk whose cost is unbounded if that ever stops being true). */
function indexStats() {
  subStats = new Map();
  collapsibleIds = new Set();
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id)) return { nodes: 0, people: 0 };
    seen.add(id);
    const kids = byParent.get(id) || [];
    const own = (byNode.get(id) || []).length;
    let people = own;
    let nodes = 0;
    for (const c of kids) {
      const s = walk(c.id);
      people += s.people;
      nodes += s.nodes + 1;
    }
    const stat = { nodes, people };
    subStats.set(id, stat);
    if (kids.length || own > PEOPLE_INLINE_MAX) collapsibleIds.add(id);
    return stat;
  };
  for (const r of byParent.get('') || []) walk(r.id);
}

// The face element lives in org-face.js — see the note there on why it is
// shared rather than copied into the graph renderer.

// THE คณะกรรมการ GRID IS GONE, and deliberately.
//
// It rendered นายกฯ and the อุปนายก a second time, above the tree, at roughly
// twice the size of everyone else. The owner's call: "don't leave the อุปนายก up
// there, make them also be in the horizontal chart as everyone, don't make them
// too bigger than anyone."
//
// That is the same principle as the equal-sized cards below it. The chart states
// rank by POSITION — นายกฯ is the box at the top of the tree — so a second,
// larger rendering of the same people was both a duplicate and a competing
// ranking system. `is_board` still exists on the node (the admin sets it, the
// archive keeps it, my-seat.js draws a small award icon with it); this page just
// no longer builds a separate grid from it.

// ── the year picker ─────────────────────────────────────────────────────────

function renderYears() {
  const host = $('orgYears');
  if (!host) return;
  if (years.length < 2) { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = years.map((y) => `
    <button type="button" class="org-year${y.year === activeYear ? ' is-active' : ''}"
      data-year="${y.year}"${y.year === activeYear ? ' aria-current="true"' : ''}>${
        escHtml(y.label || String(y.year))
      }</button>`).join('');
}

// ── filtering ───────────────────────────────────────────────────────────────
// A match on a person keeps that person and every ANCESTOR ตำแหน่ง, so the result
// still reads as a structure rather than a flat list of hits. A match on a
// ตำแหน่ง name keeps that ตำแหน่ง and everything beneath it, because "show me
// ฝ่ายวิชาการ" should mean the whole branch.

function computeFilter(qRaw) {
  const q = qRaw.trim().toLowerCase();
  if (!q) return null;
  const keepNodes = new Set();
  const keepMembers = new Set();
  // From byParent, NOT from `chart.nodes` — the chart re-parents sub-ฝ่าย onto
  // their head ตำแหน่ง (chartParentage), and a search that walked the STORED
  // parents would keep an ancestor the chart no longer draws a line to, leaving
  // a result hanging off nothing.
  const parentOf = new Map();
  for (const [k, kids] of byParent) for (const n of kids) parentOf.set(n.id, k);
  const markUp = (id) => {
    let cur = id;
    while (cur && !keepNodes.has(cur)) { keepNodes.add(cur); cur = parentOf.get(cur); }
  };
  const markDown = (id) => {
    keepNodes.add(id);
    (byParent.get(id) || []).forEach((c) => markDown(c.id));
  };

  for (const n of chart.nodes || []) {
    if ((n.name || '').toLowerCase().includes(q)) { markUp(n.id); markDown(n.id); }
  }
  for (const m of chart.members || []) {
    const hay = `${m.name || ''} ${m.nickname || ''}`.toLowerCase();
    if (hay.includes(q)) { keepMembers.add(m); markUp(m.node_id); }
  }
  // Inside a ตำแหน่ง whose NAME matched, show all of its people — otherwise
  // searching a ฝ่าย returns a branch with empty rooms.
  for (const n of chart.nodes || []) {
    if ((n.name || '').toLowerCase().includes(q)) {
      (byNode.get(n.id) || []).forEach((m) => keepMembers.add(m));
      const walk = (id) => (byParent.get(id) || []).forEach((c) => {
        (byNode.get(c.id) || []).forEach((m) => keepMembers.add(m));
        walk(c.id);
      });
      walk(n.id);
    }
  }
  return { keepNodes, keepMembers, q: qRaw.trim() };
}

function highlight(text, q) {
  const safe = escHtml(text);
  if (!q) return safe;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return safe;
  return `${escHtml(text.slice(0, i))}<mark>${escHtml(text.slice(i, i + q.length))}</mark>${escHtml(text.slice(i + q.length))}`;
}

// ── rendering the tree ──────────────────────────────────────────────────────

// ── why every card is the SAME SIZE ─────────────────────────────────────────
//
// REPORTED: "the head of like each ฝ่าย got drowned inside many people in their
// own ฝ่าย" — and then, on how to fix it: "i thought like from top to bottom,
// the layout importancy already hierarchy based on importance" and "i thought
// like making everyone card big equally".
//
// A first attempt gave หัวหน้า a BIGGER card, detected from a list of Thai name
// prefixes (หัวหน้า…, อุปนายก…, ประธาน…). That was the wrong instrument, for the
// reason the owner gave: the tree ALREADY ranks people. Every ฝ่าย orders its
// children by `position`, and position 0 is the head — verified across the
// whole ฝ่ายดิจิทัล subtree, where หัวหน้าฝ่าย PR / IT / ComArt / Media
// management are each pos 0 and every สมาชิก node follows at 1, 2, 4… So a
// prefix list would have been a SECOND source of truth for a fact the structure
// already carries, and it would drift the first time somebody renamed a
// ตำแหน่ง or invented a title the list had never heard of.
//
// So: one card, one size, for everyone. What makes the head stand out is where
// they SIT — first in their ฝ่าย, alone under their own ตำแหน่ง heading, with a
// connector rail tying them to the parent — not how big their photo is.
// Hierarchy belongs to the layout; the card is just a person.

function memberCard(m, filter) {
  const name = m.name || '';
  const nick = m.nickname || '';
  return `
    <li class="org-person${m.photo_url ? '' : ' is-nophoto'}">
      <span class="org-face">${faceHtml(m, TREE_SHAPE)}</span>
      <span class="org-person-text">
        <span class="org-person-name">${highlight(name, filter?.q)}</span>
        ${nick ? `<span class="org-person-nick">${highlight(nick, filter?.q)}</span>` : ''}
      </span>
    </li>`;
}

/** "12 ตำแหน่ง · 48 คน" — the reason to open a collapsed branch. Suppressed
 *  while a search is running: those totals describe the WHOLE subtree, and next
 *  to a filtered view they would contradict what is on screen. */
function stationMeta(node) {
  const s = subStats.get(node.id) || { nodes: 0, people: 0 };
  // A ตำแหน่ง with nobody in it and nothing under it rendered as a bare name —
  // no count, no cards — which reads as a card that failed to load rather than
  // as a vacancy. 21 of them exist ("สมาชิกฝ่าย Production" is the one that got
  // reported). Say so: an empty ตำแหน่ง is real information, especially on a
  // page that doubles as recruitment.
  if (s.nodes === 0 && s.people === 0) return 'ยังไม่มีสมาชิก';
  const bits = [];
  if (s.nodes > 0) bits.push(`${s.nodes} ตำแหน่ง`);
  if (s.people > 1 || (s.people === 1 && s.nodes > 0)) bits.push(`${s.people} คน`);
  return bits.join(' · ');
}

function nodeBlock(node, depth, filter) {
  if (filter && !filter.keepNodes.has(node.id)) return '';
  const kids = byParent.get(node.id) || [];
  let people = byNode.get(node.id) || [];
  if (filter) people = people.filter((m) => filter.keepMembers.has(m));

  const childHtml = kids.map((c) => nodeBlock(c, depth + 1, filter)).join('');
  // A branch that filtered down to nothing at all is noise — drop it.
  if (filter && !people.length && !childHtml) return '';

  // A CSS COLOUR, not a palette key. Set inline so an admin-chosen colour and
  // a name-derived one arrive by the same route — a `data-tint` attribute could
  // only ever express the ten the stylesheet had a rule for.
  const tint = tintColor(node);
  const peopleHtml = people.length
    ? `<ul class="org-people">${people.map((m) => memberCard(m, filter)).join('')}</ul>`
    : '';
  // A ฝ่าย with a dozen sub-ฝ่าย still went 12 columns wide in แผนผัง, because
  // depth 1 is the one level that spreads. ฝ่ายเวชนิทัศน์ and ฝ่ายรังสีเทคนิค
  // have 12+ each and needed >1,100px of panning on an iPad. Past a handful the
  // row WRAPS into a grid: the single connector bar stops being meaningful
  // across wrapped lines, so `is-grid` drops it and each child keeps its own
  // drop tick instead.
  const branchHtml = childHtml
    ? `<ul class="org-branch${kids.length > 4 ? ' is-grid' : ''}">${childHtml}</ul>`
    : '';
  const inner = `${peopleHtml}${branchHtml}`;

  // A search result is always fully open — a disclosure the user has to expand
  // to find what they just searched for is the same as no result.
  const collapsible = !filter && !!inner && collapsibleIds.has(node.id);
  const open = !collapsible || expanded.has(node.id);
  const bodyId = `org-n-${node.id}`;
  const meta = filter ? '' : stationMeta(node);
  const hTag = `h${Math.min(depth + 3, 6)}`;

  const stationInner = `
        <span class="org-station-dot" aria-hidden="true"></span>
        <span class="org-station-name">${highlight(node.name || '', filter?.q)}</span>
        ${meta ? `<span class="org-station-meta">${meta}</span>` : ''}
        ${collapsible ? '<i class="bi bi-chevron-right org-station-chev" aria-hidden="true"></i>' : ''}`;

  // ARIA accordion pattern: the heading WRAPS the button, so the outline still
  // reads as a hierarchy and the control is the whole row.
  const station = collapsible
    ? `<button type="button" class="org-station-btn" aria-expanded="${open}" aria-controls="${escHtml(bodyId)}">${stationInner}</button>`
    : `<span class="org-station-btn is-static">${stationInner}</span>`;

  // MARKUP SHAPE, and why the box is its own element.
  //
  // The horizontal chart layout (>=1024px) needs a node's BOX — its ตำแหน่ง and
  // the people holding it — to be a layout sibling of the row of its children,
  // because that is the only arrangement the classic CSS connector technique can
  // draw: `li > .box + ul`, with the elbows hung off the box and the row.
  // Everything used to live inside one collapsible `.org-node-body`, which put a
  // wrapper between the `li` and the child `ul` and made that impossible.
  //
  // So: `.org-box` holds the station, and the body still wraps what collapses.
  // In chart mode the body becomes `display: contents` so it stops being a box
  // of its own while `hidden` keeps working (`[hidden]`'s display:none wins over
  // display:contents), and `.org-people` / `.org-branch` become direct children
  // of the node. One markup, two layouts, no second renderer to keep in step.
  return `
    <li class="org-node${collapsible ? ' is-collapsible' : ''}" data-depth="${depth}"${
      tint ? ` style="--org-tint:${tint}"` : ''}>
      <div class="org-box">
        <${hTag} class="org-station">${station}</${hTag}>
      </div>
      ${inner ? `<div class="org-node-body" id="${escHtml(bodyId)}"${open ? '' : ' hidden'}>${inner}</div>` : ''}
    </li>`;
}

/** The ขยาย/ย่อทั้งหมด control. Hidden while searching (results are already
 *  fully open, so it would do nothing) and when nothing on the page collapses. */
function renderExpandAll(searching) {
  const btn = $('orgExpandAll');
  if (!btn) return;
  if (searching || !collapsibleIds.size) { btn.hidden = true; return; }
  btn.hidden = false;
  const allOpen = expanded.size >= collapsibleIds.size;
  btn.setAttribute('aria-expanded', String(allOpen));
  const icon = btn.querySelector('i');
  if (icon) icon.className = `bi ${allOpen ? 'bi-chevron-contract' : 'bi-chevron-expand'}`;
  const label = btn.querySelector('.org-expand-all-label');
  if (label) label.textContent = allOpen ? 'ย่อทั้งหมด' : 'ขยายทั้งหมด';
}

/**
 * ONE SECTION PER ฝ่าย, STACKED — why แผนผัง is not a single chart.
 *
 * Rendered as one tree the fully-expanded chart measured 44,386px wide (~30
 * screens), because the twelve ฝ่าย sit SIDE BY SIDE and the total width is
 * their sum. The owner's fix, from SAMO's own recruitment poster:
 * "vstack{ {hstack ฝ่ายบริหาร} then the next {hstack ฝ่ายดิจิทัล} etc }".
 *
 * So each root ฝ่าย gets its own chart and its own horizontal scroller, stacked
 * down the page. Width is now the WIDEST SINGLE ฝ่าย instead of the sum of all
 * of them, which is the whole difference between usable and not — and it reads
 * the way the poster does, one ฝ่าย at a time.
 *
 * รายการ keeps the single tree with the synthetic root below, because there the
 * axis is vertical and one spine down the page is exactly right.
 */

/**
 * The organisation itself, as the ONE box everything hangs from — LIST VIEW.
 *
 * REQUESTED: "everyone of like สำนักนายกฯ … ฝ่ายบริหารองค์กร … ฝ่ายกิจการภายใน,
 * etc should be line link under สโมสรนักศึกษาแพทย์".
 *
 * Without it the twelve ฝ่าย are twelve ROOTS — siblings with no parent — so the
 * chart had nothing to draw a connector from and they floated as twelve
 * unrelated columns. Every reference org chart descends from a single box for
 * exactly this reason; the bar across the top only means something if it comes
 * from somewhere.
 *
 * Synthetic on purpose: there is no such row in `team_nodes`, and adding one
 * would put a fake ตำแหน่ง into the admin tree, the archive, the export and the
 * seat resolver to serve a drawing. It is not collapsible either — collapsing
 * the organisation would just blank the page.
 */
function rootBlock(childHtml, filter) {
  if (!childHtml) return '';
  const n = (chart.nodes || []).length;
  const p = (chart.members || []).length;
  const meta = filter ? '' : `${n} ตำแหน่ง · ${p} คน`;
  return `
    <li class="org-node is-org-root" data-depth="-1">
      <div class="org-box">
        <h2 class="org-station">
          <span class="org-station-btn is-static">
            <span class="org-station-dot" aria-hidden="true"></span>
            <span class="org-station-name">สโมสรนักศึกษาคณะแพทยศาสตร์</span>
            ${meta ? `<span class="org-station-meta">${meta}</span>` : ''}
          </span>
        </h2>
      </div>
      <div class="org-node-body"><ul class="org-branch">${childHtml}</ul></div>
    </li>`;
}

function render() {
  const body = $('orgBody');
  if (!body || !chart) return;
  renderYears();

  // แผนผัง OPENS THE SHAPE, NOT EVERYTHING — and the number is why.
  //
  // "it should be expand automatically" was right, and the first attempt opened
  // every ตำแหน่ง. Measured: 44,386px wide. That is not a chart anyone can read,
  // on any device — and it cannot be zoomed out of either, since fitting it to a
  // 1016px viewport is a 0.02x scale. 400 people laid out horizontally simply do
  // not fit, which is exactly why the reference charts show fifteen.
  //
  // So it opens องค์กร → ฝ่าย → ตำแหน่ง: enough to see the whole shape of the
  // organisation at a glance, which is what the layout is FOR, and every box
  // below that is one click away. Nobody is hidden; the depth is just not all
  // unrolled at once.
  if (view === 'chart') expanded = new Set(collapsibleIds);

  const filter = computeFilter(query);
  const roots = byParent.get('') || [];
  const html = roots.map((n) => nodeBlock(n, 0, filter)).join('');
  // ขยาย/ย่อทั้งหมด drives the DOM tree, which ผังองค์กร does not use — it has
  // its own depth control, because "expanded" there is a d3 layout state rather
  // than a `hidden` attribute. Hide it rather than leave a button that silently
  // does nothing in one of three views.
  renderExpandAll(!!filter || GRAPH_VIEWS.includes(view));

  const shownMembers = filter
    ? filter.keepMembers.size
    : (chart.members || []).length;
  const cnt = $('orgCount');
  if (cnt) {
    cnt.textContent = filter
      ? `พบ ${shownMembers} คน`
      : `${(chart.nodes || []).length} ตำแหน่ง · ${(chart.members || []).length} คน`;
  }

  if (!html) {
    destroyOrgGraph();
    body.innerHTML = `<p class="org-status">${
      filter ? `ไม่พบ “${escHtml(filter.q)}” ในโครงสร้างองค์กร` : 'ยังไม่มีข้อมูลโครงสร้างองค์กร'
    }</p>`;
    return;
  }

  // Every paint replaces #orgBody's markup, which would strand the charts'
  // ResizeObserver and zoom behaviours on detached nodes. Tear down first,
  // unconditionally — including when leaving ผังองค์กร for another view.
  destroyOrgGraph();

  body.innerHTML = `
    <div class="org-tree-head">
      <h2 class="org-tree-heading">โครงสร้างทั้งหมด</h2>
      <div class="org-view-switch" role="group" aria-label="รูปแบบการแสดงผล">
        <button type="button" class="org-view-btn${view === 'list' ? ' is-on' : ''}"
          data-org-view="list" aria-pressed="${view === 'list'}">
          <i class="bi bi-list-nested" aria-hidden="true"></i> รายการ
        </button>
        <button type="button" class="org-view-btn${view === 'chart' ? ' is-on' : ''}"
          data-org-view="chart" aria-pressed="${view === 'chart'}">
          <i class="bi bi-diagram-3" aria-hidden="true"></i> แผนผัง
        </button>
        <button type="button" class="org-view-btn${view === 'graph' ? ' is-on' : ''}"
          data-org-view="graph" aria-pressed="${view === 'graph'}">
          <i class="bi bi-diagram-2" aria-hidden="true"></i> ผังองค์กร
        </button>
        <button type="button" class="org-view-btn${view === 'all' ? ' is-on' : ''}"
          data-org-view="all" aria-pressed="${view === 'all'}">
          <i class="bi bi-bounding-box" aria-hidden="true"></i> ผังรวม
        </button>
      </div>
    </div>
    ${GRAPH_VIEWS.includes(view) ? graphShellHtml(filter) : ''}
    ${view === 'chart'
    ? roots.map((n) => {
      const one = nodeBlock(n, 0, filter);
      return one
        ? `<div class="org-tree-wrap" data-view="chart">
             <ul class="org-tree">${one}</ul>
           </div>`
        : '';
    }).join('')
    : view === 'list'
      ? `<div class="org-tree-wrap" data-view="list">
         <ul class="org-tree">${rootBlock(html, filter)}</ul>
       </div>`
      : ''}`;

  if (GRAPH_VIEWS.includes(view)) paintGraph(roots, filter);
}

/** ผังองค์กร's own toolbar + the host the charts mount into. The depth control
 *  is separate from ขยาย/ย่อทั้งหมด because it is a LEVEL, not a boolean — the
 *  whole point of the view is choosing how far down to look. */
function graphShellHtml(filter) {
  const cur = graphRung[view];
  const lvl = (r, label) => `<button type="button" class="orgg-depth-btn${
    cur === r ? ' is-on' : ''}" data-org-rung="${r}" aria-pressed="${cur === r}">${label}</button>`;
  return `
    <div class="orgg-toolbar">
      ${filter ? '' : `
      <div class="orgg-depth" role="group" aria-label="ระดับที่แสดง">
        <span class="orgg-depth-label">แสดงถึง</span>
        ${(VIEW_RUNGS[view] || VIEW_RUNGS.graph).map(([r, label]) => lvl(r, label)).join('')}
      </div>`}
      <div class="orgg-zoom" role="group" aria-label="ย่อ-ขยายมุมมอง">
        <button type="button" class="orgg-zoom-btn" data-org-zoom="out" aria-label="ซูมออก"><i class="bi bi-dash-lg" aria-hidden="true"></i></button>
        <button type="button" class="orgg-zoom-btn" data-org-zoom="in" aria-label="ซูมเข้า"><i class="bi bi-plus-lg" aria-hidden="true"></i></button>
        <button type="button" class="orgg-zoom-btn" data-org-zoom="fit" aria-label="พอดีหน้าจอ"><i class="bi bi-aspect-ratio" aria-hidden="true"></i></button>
      </div>
      <p class="orgg-hint">${view === 'all'
    ? 'ผังเดียวทั้งองค์กร — ลากเพื่อเลื่อน กดที่ตัวเลขเพื่อเปิดตำแหน่งข้างใน'
    : 'ลากเพื่อเลื่อน · กดที่ตัวเลขเพื่อเปิดตำแหน่งข้างใน'}</p>
    </div>
    <div class="orgg-host" id="orgGraphHost"></div>`;
}

/** Mount the charts. Async and fire-and-forget: the library is a dynamic import
 *  so the first switch into this view pays a network round trip, and awaiting it
 *  inside render() would freeze the other two views' repaint behind it. The
 *  token guards the case where the reader switches away (or changes year) while
 *  that import is still in flight — without it a late mount paints charts into a
 *  page that has moved on. */
let graphToken = 0;
async function paintGraph(roots, filter) {
  const mine = ++graphToken;
  const hostEl = $('orgGraphHost');
  if (!hostEl) return;
  hostEl.innerHTML = '<p class="org-status">กำลังวาดผังองค์กร…</p>';
  try {
    const ctx = {
      roots,
      byParent,
      byNode,
      subStats,
      filter,
      rung: graphRung[view],
      combined: view === 'all',
      chart,
    };
    if (mine !== graphToken) return;
    hostEl.innerHTML = '';
    const drawn = await mountOrgGraph(hostEl, ctx);
    if (mine !== graphToken) { destroyOrgGraph(); return; }
    if (!drawn) {
      hostEl.innerHTML = `<p class="org-status">${
        filter ? `ไม่พบ “${escHtml(filter.q)}” ในโครงสร้างองค์กร` : 'ยังไม่มีข้อมูลโครงสร้างองค์กร'
      }</p>`;
    }
  } catch (err) {
    // A failed dynamic import (offline, a stale chunk after a deploy) must not
    // leave the reader on a spinner — the other two views still work, so say so
    // rather than pretending the data is missing.
    console.warn('org graph failed to load:', err);
    if (mine === graphToken && hostEl) {
      hostEl.innerHTML = '<p class="org-status is-error">แสดงผังองค์กรไม่ได้ ลองใช้มุมมอง รายการ หรือ แผนผัง</p>';
    }
  }
}

// ── loading ─────────────────────────────────────────────────────────────────

/** NOTE dbRest resolves to { data, error } rather than to the payload; reading
 *  it as the payload makes `chart.nodes` undefined and renders a convincing
 *  "ยังไม่มีข้อมูล" empty state instead of an error. */
async function fetchChart(year) {
  if (charts.has(year)) return charts.get(year);
  const { data, error } = await dbRest('/rpc/get_public_team_chart', {
    method: 'POST',
    body: { p_year: year },
  });
  if (error) throw new Error(error.message || `HTTP ${error.status}`);
  const safe = (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.nodes))
    ? data
    : { nodes: [], members: [] };
  charts.set(year, safe);
  return safe;
}

function showError() {
  const body = $('orgBody');
  if (body) {
    body.innerHTML = '<p class="org-status is-error">โหลดโครงสร้างองค์กรไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง</p>';
  }
}

// Tapping two years quickly starts two fetches. Without a token the SLOWER one
// wins whenever it resolves last, so the highlighted year and the rendered chart
// disagree — and it is not reproducible on a fast connection, which is the worst
// kind of bug to be handed. Only the newest request is allowed to paint.
let showToken = 0;

async function showYear(year) {
  const body = $('orgBody');
  const mine = ++showToken;
  if (!charts.has(year) && body) {
    body.innerHTML = '<p class="org-status">กำลังโหลด…</p>';
  }
  try {
    const next = await fetchChart(year);
    if (mine !== showToken) return;   // a newer click already took over
    chart = next;
    activeYear = year ?? chart.year ?? null;
    // Node ids are per-tree (the live tree and each frozen archive are different
    // rows), so a stale expanded set would silently open nothing.
    expanded = new Set();
    index();
    render();
  } catch (err) {
    console.warn('org chart load failed:', err);
    if (mine === showToken) showError();
  }
}

/** Load once. Safe to call on every tab activation — the guard makes repeats free. */
export async function enterOrgChart() {
  if (chart || loading) { render(); return; }
  loading = true;
  try {
    // Anonymous is fine — dbRest falls back to the anon key when there is no
    // session, and both rpcs are granted to anon.
    //
    // The year list is OPTIONAL: if it fails we still want the chart, because
    // get_public_team_chart(null) resolves the current term server-side. Failing
    // the whole page over a missing picker would be a worse outcome than a page
    // with no picker.
    let current = null;
    try {
      const { data } = await dbRest('/rpc/get_public_team_years', { method: 'POST', body: {} });
      years = Array.isArray(data) ? data : [];
      current = years.find((y) => y.is_current) || years[years.length - 1] || null;
    } catch (err) {
      console.warn('org chart: year list failed, falling back to current term:', err);
      years = [];
    }
    await showYear(current ? current.year : null);
  } catch (err) {
    // showYear handles its own failures; this catches anything above it. Without
    // it the page sits on "กำลังโหลด…" forever and the only trace is an
    // unhandled rejection — the pre-0104 code had this catch and it was lost in
    // the rewrite.
    console.warn('org chart init failed:', err);
    showError();
  } finally {
    loading = false;
  }
}

/** Toggle in the DOM rather than re-rendering. A full repaint of 279 ตำแหน่ง
 *  would drop the scroll position — and the row you clicked would jump out from
 *  under the pointer, which is exactly the wrong feel for a disclosure. */
function toggleNode(btn) {
  const li = btn.closest('.org-node');
  const panel = li && li.querySelector(':scope > .org-node-body');
  if (!li || !panel) return;
  const willOpen = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(willOpen));
  panel.hidden = !willOpen;
  const id = panel.id.replace(/^org-n-/, '');
  if (willOpen) expanded.add(id); else expanded.delete(id);
  renderExpandAll(false);
}

export function initOrgChart() {
  // ESC leaves เต็มหน้าจอ. The overlay is ours, not the Fullscreen API (iOS and
  // iPadOS only honour requestFullscreen on <video>), so the browser will not
  // provide this for free — and an overlay with no keyboard exit is a trap on a
  // desktop, where ESC is the reflex.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && anyGraphFullscreen()) {
      exitGraphFullscreen();
      $('orgBody')?.querySelectorAll('[data-orgg-full] i').forEach((i) => {
        i.className = 'bi bi-arrows-fullscreen';
      });
    }
  });

  const search = $('orgSearch');
  const clear = $('orgSearchClear');
  let t = null;
  search?.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      query = search.value.trim();
      clear?.classList.toggle('d-none', !query);
      if (chart) render();
    }, 120);
  });
  clear?.addEventListener('click', () => {
    search.value = ''; query = '';
    clear.classList.add('d-none');
    if (chart) render();
    search.focus();
  });

  // Delegated: every station is re-rendered on each paint, and #orgBody itself
  // is the one element that survives.
  $('orgBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.org-station-btn');
    if (btn && btn.tagName === 'BUTTON') { toggleNode(btn); return; }

    // ผังองค์กร's "แสดงถึง" control. A full re-layout rather than a DOM toggle:
    // the rung decides d3's LAYOUT, not just visibility, so every box moves.
    const db = e.target.closest('[data-org-rung]');
    if (db) {
      const next = db.dataset.orgRung;
      if (!RUNG[next] || next === graphRung[view]) return;
      graphRung[view] = next;
      setGraphRung(next);
      $('orgBody')?.querySelectorAll('[data-org-rung]').forEach((b) => {
        const on = b.dataset.orgRung === next;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      return;
    }

    // เต็มหน้าจอ. The button lives on the section, which org-graph.js builds —
    // delegated here because #orgBody is the one element that survives a paint.
    const fb = e.target.closest('[data-orgg-full]');
    if (fb) {
      const on = toggleGraphFullscreen(fb.closest('.orgg-section'));
      fb.querySelector('i')?.setAttribute('class',
        `bi bi-${on ? 'fullscreen-exit' : 'arrows-fullscreen'}`);
      fb.setAttribute('aria-label', on ? 'ออกจากเต็มหน้าจอ' : 'ดูเต็มหน้าจอ');
      return;
    }

    const zb = e.target.closest('[data-org-zoom]');
    if (zb) {
      const how = zb.dataset.orgZoom;
      if (how === 'fit') fitGraphs();
      else zoomGraphs(how === 'in' ? 1 : -1);
      return;
    }

    // รายการ ⇄ แผนผัง ⇄ ผังองค์กร.
    const vb = e.target.closest('[data-org-view]');
    if (!vb) return;
    const next = VIEWS.includes(vb.dataset.orgView) ? vb.dataset.orgView : 'list';
    if (next === view) return;
    view = next;
    try { localStorage.setItem('samo.org.view', view); } catch { /* private mode */ }
    // A full re-render, because entering แผนผัง expands everything and leaving
    // it must not strand the reader in a 400-person wall of open ตำแหน่ง.
    if (view === 'list') expanded = new Set();
    render();
  });

  $('orgExpandAll')?.addEventListener('click', () => {
    const allOpen = expanded.size >= collapsibleIds.size;
    expanded = allOpen ? new Set() : new Set(collapsibleIds);
    if (chart) render();
  });

  // Delegated: the year buttons are re-rendered on every paint.
  $('orgYears')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-year]');
    if (!btn) return;
    const y = Number(btn.dataset.year);
    if (!Number.isFinite(y) || y === activeYear) return;
    // Switching year while a search is active would show a filtered view of a
    // year the user has not seen yet — confusing. Clear it.
    if (query) {
      query = '';
      if (search) search.value = '';
      clear?.classList.add('d-none');
    }
    showYear(y);
  });
}
