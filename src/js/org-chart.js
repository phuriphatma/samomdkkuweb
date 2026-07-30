// org-chart.js — the public ทีม SAMO structure page.
//
// Data comes from ONE rpc: public.get_public_org_chart(). That function is the only
// sanctioned publisher of team data (migration 0086, extended for photos in 0103) —
// a SECURITY DEFINER projection whose jsonb keys are an explicit allow-list, over a
// recursive CTE so a non-public ตำแหน่ง hides its entire subtree. `team_members` has
// no public SELECT policy at all, so there is no other route to this data and no way
// for a future column to leak through this page by accident.
//
// Read-only, anonymous, no writes. Rendered once per page load and filtered in
// memory afterwards.
import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import { convertDriveUrl } from './uploads.js';

let chart = null;         // { nodes, members } as returned by the rpc
let byParent = new Map(); // parent_id ('' for root) -> node[]
let byNode = new Map();   // node_id -> member[]
let loading = false;
let query = '';

const $ = (id) => document.getElementById(id);

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
  for (const n of chart.nodes || []) {
    const k = n.parent_id || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
  }
  for (const m of chart.members || []) {
    if (!byNode.has(m.node_id)) byNode.set(m.node_id, []);
    byNode.get(m.node_id).push(m);
  }
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

// ── rendering ───────────────────────────────────────────────────────────────

function memberCard(m, filter) {
  const name = m.name || '';
  const nick = m.nickname || '';
  const photo = m.photo_url ? convertDriveUrl(m.photo_url, 400) : '';
  // Initials are ALWAYS rendered, with the photo layered over them. A Drive link
  // can rot (file unshared, moved, deleted) and an <img alt=""> that fails to load
  // draws nothing — so without this the card would show an empty disc. Layering
  // means a broken photo degrades to the same initials as a member who never
  // uploaded one, with no error handler to wire up.
  const face = `
        <span class="org-face-initials" aria-hidden="true">${escHtml(initials(name))}</span>
        ${photo ? `<img class="org-face-img" src="${escHtml(photo)}" alt="" loading="lazy" decoding="async" />` : ''}`;
  return `
    <li class="org-person${photo ? '' : ' is-nophoto'}">
      <span class="org-face">${face}</span>
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
        <h${Math.min(depth + 2, 6)} class="org-station-name">${highlight(node.name || '', filter?.q)}</h${Math.min(depth + 2, 6)}>
        ${count > 1 ? `<span class="org-station-count">${count} คน</span>` : ''}
      </div>
      ${people.length ? `<ul class="org-people">${people.map((m) => memberCard(m, filter)).join('')}</ul>` : ''}
      ${childHtml ? `<ul class="org-branch">${childHtml}</ul>` : ''}
    </li>`;
}

function render() {
  const body = $('orgBody');
  if (!body || !chart) return;
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
  body.innerHTML = `<ul class="org-tree">${html}</ul>`;
}

// ── boot ────────────────────────────────────────────────────────────────────

/** Load once. Safe to call on every tab activation — the guard makes repeats free. */
export async function enterOrgChart() {
  if (chart || loading) { render(); return; }
  loading = true;
  try {
    // POST because it is an rpc; no arguments. Anonymous is fine — dbRest falls
    // back to the anon key when there is no session, and the rpc is granted to
    // anon. NOTE dbRest resolves to { data, error } rather than to the payload;
    // reading it as the payload makes `chart.nodes` undefined and renders a
    // convincing "ยังไม่มีข้อมูล" empty state instead of an error.
    const { data, error } = await dbRest('/rpc/get_public_org_chart', { method: 'POST', body: {} });
    if (error) throw new Error(error.message || `HTTP ${error.status}`);
    chart = (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.nodes))
      ? data
      : { nodes: [], members: [] };
    index();
    render();
  } catch (err) {
    console.warn('org chart load failed:', err);
    const body = $('orgBody');
    if (body) {
      body.innerHTML = '<p class="org-status is-error">โหลดโครงสร้างองค์กรไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง</p>';
    }
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
}
