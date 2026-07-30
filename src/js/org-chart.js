// org-chart.js — the public ทีม SAMO page.
//
// Two surfaces over one dataset:
//   • คณะกรรมการ — large 3:4 portrait cards for the ตำแหน่ง flagged is_board
//     (นายกฯ + the ten อุปนายกฝ่าย), read top-down in tree order.
//   • โครงสร้างทั้งหมด — the searchable spine tree, every ตำแหน่ง and person.
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
import {
  portraitSrc, portraitSrcSet, focusToObjectPosition,
  PORTRAIT_RATIO, AVATAR_RATIO,
} from './uploads.js';

// One entry per year, so switching back to a year already viewed is instant and
// free. The dataset is ~280 nodes / ~400 people — small enough to just keep.
const charts = new Map();

let years = [];           // [{ year, label, is_current }]
let activeYear = null;
let chart = null;         // { year, is_current, nodes, members }
let byParent = new Map(); // parent_id ('' for root) -> node[]
let byNode = new Map();   // node_id -> member[]
let nodeById = new Map();
let loading = false;
let query = '';

const $ = (id) => document.getElementById(id);

// The two shapes a face appears in, and the exact widths lh3 is asked for.
//
// This split is the whole point of the srcset: the board card renders at up to
// 250 CSS px and the tree avatar at 44, so handing the avatar the card's file
// would waste ~35 KB × 400 people. Widths cover 1x through 3x; the browser
// downloads exactly one per image using the `sizes` hint.
const BOARD_SHAPE = {
  cls: 'org-board',
  ratio: PORTRAIT_RATIO,
  widths: [260, 400, 520, 780],
  sizes: '(max-width: 560px) 42vw, (max-width: 1000px) 28vw, 250px',
  base: 520,
};
// Same card, smaller. The tree uses ONE visual language with the board grid —
// portrait over name over ตำแหน่ง — rather than a separate avatar treatment, so
// a person looks like the same kind of object wherever they appear.
const TREE_SHAPE = {
  cls: 'org-face',
  ratio: PORTRAIT_RATIO,
  widths: [130, 200, 260, 390],
  sizes: '(max-width: 560px) 28vw, 130px',
  base: 260,
};

/** The ten ฝ่าย already have colour identities in base.css; reuse them so a
 *  ฝ่าย looks the same here as it does on the ฝ่าย tab. Matched on the ฝ่าย name
 *  because the chart projection deliberately carries no dept id. */
const DEPT_TINT = [
  [/สำนักนายก/, 'admin'],
  [/บริหารองค์กร/, 'admin'],
  [/ดิจิทัล|สื่อสารองค์กร/, 'digital'],
  [/กิจการภายใน/, 'internal'],
  [/กิจการภายนอก/, 'external'],
  [/กิจการมหาวิทยาลัย/, 'university'],
  [/วิชาการ/, 'academic'],
  [/ยุทธศาสตร์|พัฒนาองค์กร/, 'strategy'],
  [/คุณภาพชีวิต|สิ่งแวดล้อม/, 'quality'],
  [/เวชนิทัศน์/, 'media'],
  [/รังสีเทคนิค/, 'projects'],
];

function tintFor(name) {
  const hit = DEPT_TINT.find(([re]) => re.test(name || ''));
  return hit ? hit[1] : null;
}

/** Initials for the no-photo state. Thai names have no case, so take the first
 *  glyph of the first two words — enough to differentiate at a glance without
 *  pretending to be a monogram. */
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] || '') + (parts[1] ? parts[1][0] : '');
}

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
  for (const m of chart.members || []) {
    if (!byNode.has(m.node_id)) byNode.set(m.node_id, []);
    byNode.get(m.node_id).push(m);
  }
}

// ── the photo element ───────────────────────────────────────────────────────
//
// Initials are ALWAYS rendered, with the photo layered over them. A Drive link
// can rot (file unshared, moved, deleted) and an <img alt=""> that fails to load
// draws nothing — so without this a broken photo would leave an empty box.
// Layering means it degrades to the same initials as someone who never uploaded
// one, with no error handler to wire up.
//
// `focus` decides HOW the 3:4 crop happens: 'center' lets lh3 crop server-side
// (half the bytes), 'top'/'bottom' fetch the uncropped frame and crop in CSS,
// because lh3 has no focal-point option and a centre crop of a landscape studio
// shot can slice the head.
function faceHtml(m, shape) {
  const { cls, ratio, widths, sizes, base } = shape;
  const photo = m.photo_url || '';
  const focus = m.photo_focus || 'center';
  const inner = `<span class="${cls}-initials" aria-hidden="true">${escHtml(initials(m.name))}</span>`;
  if (!photo) return inner;
  const set = portraitSrcSet(photo, widths, focus, ratio);
  const pos = focusToObjectPosition(focus);
  return `${inner}<img class="${cls}-img" src="${escHtml(portraitSrc(photo, base, focus, ratio))}"${
    set ? ` srcset="${escHtml(set)}" sizes="${sizes}"` : ''
  } alt="" loading="lazy" decoding="async"${
    focus === 'center' ? '' : ` style="object-position:${pos}"`
  } />`;
}

// ── the คณะกรรมการ grid ─────────────────────────────────────────────────────
//
// Depth-first over the tree rather than a flat filter, so the cards come out in
// org order (นายกฯ, then the อุปนายก in their sibling order) without needing a
// separate sort key that someone would have to maintain.
function collectBoard() {
  const out = [];
  const walk = (parentKey) => {
    for (const n of byParent.get(parentKey) || []) {
      if (n.is_board) {
        for (const m of byNode.get(n.id) || []) out.push({ node: n, member: m });
      }
      walk(n.id);
    }
  };
  walk('');
  return out;
}

function boardCard({ node, member }) {
  const tint = tintFor(node.name);
  return `
    <li class="org-board-card"${tint ? ` data-tint="${tint}"` : ''}>
      <span class="org-board-photo">${faceHtml(member, BOARD_SHAPE)}</span>
      <span class="org-board-name">${escHtml(member.name || '')}</span>
      ${member.nickname ? `<span class="org-board-nick">${escHtml(member.nickname)}</span>` : ''}
      <span class="org-board-role">${escHtml(node.name || '')}</span>
    </li>`;
}

function renderBoard() {
  const host = $('orgBoard');
  if (!host) return;
  // While a search is running the board is noise — the user asked for specific
  // people and the tree below is the answer.
  if (query) { host.innerHTML = ''; host.hidden = true; return; }
  const board = collectBoard();
  if (!board.length) { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = `
    <h2 class="org-board-heading">คณะกรรมการสโมสรนักศึกษา${
      activeYear ? ` ปีการศึกษา ${escHtml(String(activeYear))}` : ''
    }</h2>
    <ul class="org-board-grid">${board.map(boardCard).join('')}</ul>`;
}

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
  const parentOf = new Map((chart.nodes || []).map((n) => [n.id, n.parent_id || '']));
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

function nodeBlock(node, depth, filter) {
  if (filter && !filter.keepNodes.has(node.id)) return '';
  const kids = byParent.get(node.id) || [];
  let people = byNode.get(node.id) || [];
  if (filter) people = people.filter((m) => filter.keepMembers.has(m));

  const childHtml = kids.map((c) => nodeBlock(c, depth + 1, filter)).join('');
  // A branch that filtered down to nothing at all is noise — drop it.
  if (filter && !people.length && !childHtml) return '';

  const tint = tintFor(node.name);
  const count = people.length;
  // The dominant shape of this org is ONE person per ตำแหน่ง (279 ตำแหน่ง, 401
  // people), so that case gets a one-line treatment — position, then the person —
  // instead of a one-item grid with a screenful of empty space beside it. A
  // ตำแหน่ง with a real team still gets the face grid below its name.
  const solo = people.length === 1;
  return `
    <li class="org-node${solo ? ' is-solo' : ''}" data-depth="${depth}"${tint ? ` data-tint="${tint}"` : ''}>
      <div class="org-station">
        <span class="org-station-dot" aria-hidden="true"></span>
        <h${Math.min(depth + 3, 6)} class="org-station-name">${highlight(node.name || '', filter?.q)}</h${Math.min(depth + 3, 6)}>
        ${count > 1 ? `<span class="org-station-count">${count} คน</span>` : ''}
      </div>
      ${people.length ? `<ul class="org-people">${people.map((m) => memberCard(m, filter)).join('')}</ul>` : ''}
      ${childHtml ? `<ul class="org-branch">${childHtml}</ul>` : ''}
    </li>`;
}

function render() {
  const body = $('orgBody');
  if (!body || !chart) return;
  renderYears();
  renderBoard();

  const filter = computeFilter(query);
  const roots = byParent.get('') || [];
  const html = roots.map((n) => nodeBlock(n, 0, filter)).join('');

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
    body.innerHTML = `<p class="org-status">${
      filter ? `ไม่พบ “${escHtml(filter.q)}” ในโครงสร้างองค์กร` : 'ยังไม่มีข้อมูลโครงสร้างองค์กร'
    }</p>`;
    return;
  }
  body.innerHTML = `
    <h2 class="org-tree-heading">โครงสร้างทั้งหมด</h2>
    <ul class="org-tree">${html}</ul>`;
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

async function showYear(year) {
  const body = $('orgBody');
  if (!charts.has(year) && body) {
    body.innerHTML = '<p class="org-status">กำลังโหลด…</p>';
  }
  try {
    chart = await fetchChart(year);
    activeYear = year ?? chart.year ?? null;
    index();
    render();
  } catch (err) {
    console.warn('org chart load failed:', err);
    if (body) {
      body.innerHTML = '<p class="org-status is-error">โหลดโครงสร้างองค์กรไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง</p>';
    }
  }
}

/** Load once. Safe to call on every tab activation — the guard makes repeats free. */
export async function enterOrgChart() {
  if (chart || loading) { render(); return; }
  loading = true;
  try {
    // Anonymous is fine — dbRest falls back to the anon key when there is no
    // session, and both rpcs are granted to anon.
    const { data } = await dbRest('/rpc/get_public_team_years', { method: 'POST', body: {} });
    years = Array.isArray(data) ? data : [];
    // Default to the live year; fall back to the newest published one if the
    // admin has not marked a current term.
    const current = years.find((y) => y.is_current) || years[years.length - 1];
    await showYear(current ? current.year : null);
  } finally {
    loading = false;
  }
}

export function initOrgChart() {
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
