// ==============================================
// SAMO TEAM — org tree manager (admin section "team", vp_admin + dev)
//
// Two modes, toggled in the toolbar so the page never gets crowded:
//   • "team"  — roles + people: add/edit/move/delete nodes & members,
//               drag-and-drop reorder, plus an explicit "ย้าย" (move) picker
//               for promoting/demoting across levels without fiddly drag.
//   • "perms" — per-role app-permission assignment with inheritance
//               (org metadata only — NOT yet wired into live login; see STATE).
//
// Mutations are optimistic: update the in-memory model + re-render first,
// then persist; on a write failure we reload from the server and toast.
// ==============================================

import {
  PERM_CATALOG, PERM_LABEL, VS_DEPTS, VS_DEPT_LABEL,
  PROJECT_SEATS, PROJECT_SEAT_LABEL, IMPLICIT_PERMS,
} from '../team-vocab.js';
import { escHtml } from '../utils.js';
import { uploadTeamPhoto, portraitSrc, focusToObjectPosition } from '../uploads.js';
import { cropImage } from '../image-crop.js';
import { dbRest } from '../db.js';
import {
  fetchTree, createNode, updateNode, deleteNode,
  createMember, updateMember, deleteMember,
  patchNodePositions, patchMemberPositions, deleteTeamPhotoIfUnused,
  fetchMajors, createMajor, updateMajor, deleteMajor,
  countMembersWithMajor, renameMajorOnMembers, lookupStudentByKkumail,
} from './api.js';
// The one definition of what a รหัสนักศึกษา / ชั้นปี / สาขา may look like,
// shared with the CSV importer and the public ตำแหน่งของฉัน card.
import {
  normalizeIdentityFields, majorKey, YEARS, SID_HINT,
} from './fields.js';
import { userCanAccess, getUser } from '../auth.js';
// The ONE ตำแหน่งของฉัน card. /admin/ shows the same component the public home
// page does — see enterMySeatPane().
import { loadMySeat, renderMySeat } from '../my-seat.js';
import { subscribeTeam } from './realtime.js';
import { initTerms, enterTerms, primeTerms } from './terms.js';
import { initHealth, enterHealth, issuesByMember } from './health.js';
import {
  buildExportJson, buildMembersCsv, parseMembersCsv, splitPath, PATH_SEP,
  normalizeYear, isLikelyEmail, validateExportJson,
} from './io.js';

// App permissions that can be attached to a node (keys match userCanAccess).
// The grant vocabulary (permission keys, VS depts, project seats) lives in
// src/js/team-vocab.js so the PUBLIC "ตำแหน่งของฉัน" card names them the same
// way this admin UI does. Behaviour here is unchanged — same lists, one home.

const KIND_ICON = { division: 'bi-diagram-2', department: 'bi-folder2', role: 'bi-person-badge' };

// ---- module state ----
let initialized = false;
let loaded = false;
let loading = null;            // in-flight load promise (single-flight)
let mode = 'team';             // 'team' | 'perms' | 'years'
// The live term's year — used to file photo uploads into Team/<ปี>/… and
// shown nowhere else. Populated by terms.js, which owns the registry.
let currentTermYear = null;
const nodesById = new Map();   // id -> node
let childrenByParent = new Map(); // parentId|'' -> [nodes]
const membersByNode = new Map(); // nodeId -> [members]
const expanded = new Set();     // expanded node ids
let searchQ = '';
let selectionMode = false;     // multi-select for bulk move / delete
const selectedNodes = new Set();
const selectedMembers = new Set();
let pendingPlan = null;        // CSV import plan awaiting per-conflict resolution
let sortables = [];            // live Sortable instances, destroyed on re-render
let rtStarted = false;         // realtime subscription established once
let dragging = false;          // a drag is in progress — defer remote re-renders
let pendingRender = false;     // a remote change arrived mid-drag
let renderTimer = null;        // debounce coalescing bursts of remote events
// memberId -> Set of reasons that row needs ตรวจสอบ, recomputed once per render
// and read by both renderMember() and the mode-button badge. Cheap: ~400 rows
// over 6 fields, no query — findIssues() is pure and the data is already here.
let healthFlags = new Map();
// nodeId -> how many flagged members sit anywhere BELOW it, so a collapsed
// branch still says there is something inside worth opening.
let healthNodeCounts = new Map();
// photo_focus of the member currently open in the editor. No longer a form
// control (the crop dialog replaced it) — carried so saving an unrelated field
// preserves a legacy row's 'top'/'bottom', and reset to 'center' on re-upload.
let memberPhotoFocus = 'center';
// The สาขา vocabulary (migration 0113). Loaded once per session, kept here so
// every chooser and every normalise call reads the SAME list — a select filled
// from a stale copy would offer a code the validator then rejects.
let majors = [];

const $ = (id) => document.getElementById(id);

/** The vocabulary as plain codes, for fields.js normalisation. */
function majorCodes() {
  return majors.map((m) => m.code);
}

// ============================================================
// DATA / INDEXES
// ============================================================

function rebuildIndexes(nodes, members) {
  nodesById.clear();
  childrenByParent = new Map();
  membersByNode.clear();
  nodes.forEach((n) => nodesById.set(n.id, n));
  rebuildChildrenIndexFromNodes();
  members.forEach((m) => {
    if (!membersByNode.has(m.node_id)) membersByNode.set(m.node_id, []);
    membersByNode.get(m.node_id).push(m);
  });
  for (const arr of membersByNode.values()) {
    arr.sort((a, b) => (a.position - b.position) || a.full_name.localeCompare(b.full_name, 'th'));
  }
}

function childrenOf(id) { return childrenByParent.get(id || '') || []; }
function membersOf(id) { return membersByNode.get(id) || []; }

function subtreeMemberCount(id) {
  let n = membersOf(id).length;
  for (const c of childrenOf(id)) n += subtreeMemberCount(c.id);
  return n;
}

/** "Division / Dept / Role" breadcrumb for a node (for select labels). */
function nodePath(id) {
  const parts = [];
  let cur = nodesById.get(id);
  while (cur) { parts.unshift(cur.name); cur = cur.parent_id ? nodesById.get(cur.parent_id) : null; }
  return parts.join(' / ');
}

function inheritedPermsFor(nodeId, inheritOn = null) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (!node) return out;
  const on = inheritOn === null ? node.inherit_permissions !== false : inheritOn;
  if (!on) return out;
  let cur = node.parent_id ? nodesById.get(node.parent_id) : null;
  while (cur) {
    (cur.permissions || []).forEach((p) => out.add(p));
    if (!cur.inherit_permissions) break;
    cur = cur.parent_id ? nodesById.get(cur.parent_id) : null;
  }
  return out;
}

/** A node's full effective perms = its own perms ∪ what it inherits. */
function nodeEffectivePerms(nodeId) {
  const out = new Set(nodesById.get(nodeId)?.permissions || []);
  inheritedPermsFor(nodeId).forEach((p) => out.add(p));
  return out;
}

/** A member's effective app-permissions = their own extras ∪ (if the
 *  member inherits) the node's effective perms. Mirrors the SQL
 *  effective_team_permissions_for_email (migration 0081). */
function memberEffectivePerms(m) {
  const out = new Set(m.permissions || []);
  if (m.inherit_permissions !== false) nodeEffectivePerms(m.node_id).forEach((p) => out.add(p));
  return out;
}

/** VS depts a node inherits from its ancestors (mirrors inheritedPermsFor).
 *  `inheritOn` overrides the node's own inherit flag for live modal preview. */
function inheritedVsDeptsFor(nodeId, inheritOn = null) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (!node) return out;
  const on = inheritOn === null ? node.inherit_permissions !== false : inheritOn;
  if (!on) return out;
  let cur = node.parent_id ? nodesById.get(node.parent_id) : null;
  while (cur) {
    if (cur.vs_dept) out.add(cur.vs_dept);
    if (!cur.inherit_permissions) break;
    cur = cur.parent_id ? nodesById.get(cur.parent_id) : null;
  }
  return out;
}

/** A node's full effective VS depts = its own binding ∪ inherited. */
function nodeEffectiveVsDepts(nodeId) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (node?.vs_dept) out.add(node.vs_dept);
  inheritedVsDeptsFor(nodeId).forEach((d) => out.add(d));
  return out;
}

/** Project seats a node inherits from its ancestors. Unlike permissions and
 *  VS depts, seats are NOT additive: the NEAREST ancestor that names one is the
 *  answer, because a seat is a single role in one workflow and holding two is
 *  ambiguous rather than wider (migration 0092 — mirrors
 *  node_effective_project_seats). `inheritOn` overrides the node's own flag so
 *  the modal can preview a toggle before it is saved. */
function inheritedSeatsFor(nodeId, inheritOn = null) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (!node) return out;
  const on = inheritOn === null ? node.inherit_permissions !== false : inheritOn;
  if (!on) return out;
  let cur = node.parent_id ? nodesById.get(node.parent_id) : null;
  while (cur) {
    if (cur.project_seat) { out.add(cur.project_seat); break; }   // nearest wins
    if (!cur.inherit_permissions) break;
    cur = cur.parent_id ? nodesById.get(cur.parent_id) : null;
  }
  return out;
}

/** A node's effective project seat. Its OWN binding replaces what it would
 *  otherwise inherit (0092) — so a ฝ่าย that says "เจ้าหน้าที่คณะ" is not
 *  widened back to "ผู้ส่งหนังสือ" by its parent. */
function nodeEffectiveSeats(nodeId) {
  const node = nodesById.get(nodeId);
  if (node?.project_seat) return new Set([node.project_seat]);
  return inheritedSeatsFor(nodeId);
}

function isAncestor(maybeAncestor, nodeId) {
  let cur = nodesById.get(nodeId);
  while (cur) {
    if (cur.id === maybeAncestor) return true;
    cur = cur.parent_id ? nodesById.get(cur.parent_id) : null;
  }
  return false;
}

// ============================================================
// LOAD
// ============================================================

export function initTeam() {
  if (initialized) return;
  initialized = true;
  wireToolbar();
  wireNodeModal();
  wirePicker();
  wirePermModal();
  wireMemberPermModal();
  wireMemberModal();
  wireModalSave();
  wireTreeDelegation();
  wireIO();
  wireMajors();
  initTerms(document.getElementById('teamTermsPane'), {
    onChange: (year) => { currentTermYear = year; },
  });
  // health.js reads through getData rather than being handed a snapshot, so it
  // always sees the live in-memory tree — including rows another pane just
  // changed — without index.js having to push updates at it.
  initHealth(document.getElementById('teamHealthPane'), {
    getData: () => ({
      loaded,
      members: allMembersFlat(),
      nodeName: (id) => nodesById.get(id)?.name || '',
    }),
    onChanged: () => reload(),
  });
}

/** Surface the outstanding count on the mode button. Cheap — it runs over the
 *  members already in memory, no query. */
function refreshHealthFlags() {
  if (!loaded) { healthFlags = new Map(); healthNodeCounts = new Map(); return 0; }
  const { map, total } = issuesByMember(allMembersFlat(), (id) => nodesById.get(id)?.name || '');
  healthFlags = map;

  // Roll each flagged member up its ancestor chain. `seen` guards against a
  // cycle in parent_id — the tree should not contain one, but an infinite loop
  // inside render() would hang the whole tab rather than show a wrong number.
  healthNodeCounts = new Map();
  const nodeOf = new Map();
  for (const [nodeId, arr] of membersByNode) for (const mm of arr) nodeOf.set(mm.id, nodeId);
  for (const memberId of map.keys()) {
    let cur = nodeOf.get(memberId);
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      healthNodeCounts.set(cur, (healthNodeCounts.get(cur) || 0) + 1);
      cur = nodesById.get(cur)?.parent_id || null;
    }
  }
  const badge = $('teamHealthBadge');
  if (badge) {
    badge.textContent = total ? String(total) : '';
    badge.classList.toggle('d-none', !total);
  }
  return total;
}

export function enterTeamWorkspace() {
  if (loaded || loading) return loading || undefined;
  return reload();
}

async function reload() {
  loading = (async () => {
    try {
      setStatus('กำลังโหลด…');
      const { nodes, members } = await fetchTree();
      rebuildIndexes(nodes, members);
      if (!loaded) childrenOf(null).forEach((n) => expanded.add(n.id));
      loaded = true;
      render();
      ensureRealtime();
      // Fire-and-forget: only needed to name the Drive upload folder, so it must
      // never delay or fail the tree load.
      primeTerms();
    } catch (e) {
      console.warn('[team] load failed:', e?.message || e);
      const tree = $('teamTree');
      if (tree) tree.innerHTML = `<div class="team-empty team-empty-error">โหลดไม่สำเร็จ: ${escHtml(e?.message || '')}</div>`;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

// ============================================================
// REALTIME (live multi-editor sync)
// ============================================================

function ensureRealtime() {
  if (rtStarted) return;
  rtStarted = true;
  subscribeTeam(applyRemoteChange);
}

/** Coalesce remote-change re-renders; never render mid-drag (it would cancel
 *  the user's in-flight SortableJS gesture). */
function scheduleRemoteRender() {
  if (dragging) { pendingRender = true; return; }
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render(), 120);
}

function removeMemberEverywhere(id) {
  for (const [nid, arr] of membersByNode) {
    const i = arr.findIndex((m) => m.id === id);
    if (i >= 0) { arr.splice(i, 1); if (!arr.length) membersByNode.delete(nid); return; }
  }
}

/** Coerce a realtime node row: `permissions` can arrive as a Postgres array
 *  literal ("{pr,vs}") on some realtime versions instead of a JS array. */
function normalizeNodeRow(n) {
  let perms = n.permissions;
  if (typeof perms === 'string') {
    perms = perms.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).filter(Boolean);
  }
  return { ...n, permissions: Array.isArray(perms) ? perms : [], inherit_permissions: n.inherit_permissions !== false };
}

/** Same array-literal coercion for a realtime member row (0081 added
 *  team_members.permissions / inherit_permissions). */
function normalizeMemberRow(m) {
  let perms = m.permissions;
  if (typeof perms === 'string') {
    perms = perms.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).filter(Boolean);
  }
  return { ...m, permissions: Array.isArray(perms) ? perms : [], inherit_permissions: m.inherit_permissions !== false };
}

function applyRemoteChange(table, payload) {
  const type = payload.eventType || payload.type;
  if (table === 'team_nodes') {
    if (type === 'DELETE') {
      const id = payload.old?.id;
      if (id) { nodesById.delete(id); membersByNode.delete(id); expanded.delete(id); }
    } else if (payload.new) {
      nodesById.set(payload.new.id, normalizeNodeRow(payload.new));
    }
    rebuildChildrenIndexFromNodes();
  } else if (table === 'team_members') {
    if (type === 'DELETE') {
      if (payload.old?.id) removeMemberEverywhere(payload.old.id);
    } else if (payload.new) {
      removeMemberEverywhere(payload.new.id);
      const nid = payload.new.node_id;
      if (!membersByNode.has(nid)) membersByNode.set(nid, []);
      membersByNode.get(nid).push(normalizeMemberRow(payload.new));
      rebuildMembersIndex();
    }
  }
  scheduleRemoteRender();
}

// ============================================================
// RENDER
// ============================================================

function destroySortables() {
  sortables.forEach((s) => { try { s.destroy(); } catch (_) {} });
  sortables = [];
}

function setStatus(msg) { const el = $('teamStatus'); if (el) el.textContent = msg || ''; }

function render() {
  // Read-only chrome (0110). Toggled on every render rather than once at boot,
  // because onAuthChange can hand us a different account mid-session (the
  // account switcher swaps the session in place) and a stale ADD button would
  // be a live-looking control that always 42501s.
  // The write controls ship HIDDEN in the markup and are revealed here. That
  // direction matters: a scheme that hides by ADDING a class shows everything
  // to everyone if this code never runs (the logged data-projects-role trap),
  // and "everything" here means the buttons a viewer must not be offered.
  const writable = canEdit();
  document.querySelectorAll('[data-team-write]').forEach((el) => el.classList.toggle('d-none', !writable));
  document.getElementById('teamReadOnlyNote')?.classList.toggle('d-none', writable);
  document.querySelectorAll('[data-team-modal-save]').forEach((el) => el.classList.toggle('d-none', !writable));

  const tree = $('teamTree');
  if (!tree) return;
  destroySortables();

  // The ปีการศึกษา pane is a different surface, not a different rendering of the
  // tree — hide the tree and its toolbar rather than trying to express years
  // inside the node list.
  const isYears = mode === 'years';
  const isHealth = mode === 'health';
  const isMe = mode === 'me';
  const isPane = isYears || isHealth || isMe;
  tree.classList.toggle('d-none', isPane);
  $('teamTermsPane')?.classList.toggle('d-none', !isYears);
  $('teamHealthPane')?.classList.toggle('d-none', !isHealth);
  $('teamMePane')?.classList.toggle('d-none', !isMe);
  document.querySelector('.team-toolbar')?.classList.toggle('d-none', isPane);
  // BEFORE the tree paints — renderMember reads healthFlags.
  refreshHealthFlags();
  if (isPane) {
    document.querySelectorAll('.team-mode-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.teamMode === mode);
    });
    const h = $('teamModeHint');
    if (h) h.textContent = '';
    setStatus('');
    // Deliberately does NOT repaint the terms pane. render() is also the target
    // of scheduleRemoteRender(), so another admin editing the live tree would
    // innerHTML-rebuild this pane and destroy whatever the user is typing in the
    // archive editor — the same class of bug the `dragging` guard exists for.
    // terms.js owns its own pane and repaints on its own actions; the archive is
    // independent of the live tree, so a tree change is not news to it.
    //
    // Same for ตรวจสอบข้อมูล: health.js holds half-typed emails and รหัสนักศึกษา
    // in its inputs, and a remote tree edit rebuilding that pane would throw
    // them away. It repaints after its own writes.
    //
    // And the same, most sharply, for ข้อมูลของฉัน: its form is the person's own
    // half-typed record. showMySeat() runs from switchMode/enterTeam only.
    return;
  }

  // toolbar reflects mode
  $('teamAddRoot')?.classList.toggle('d-none', mode !== 'team');
  document.querySelectorAll('.team-mode-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.teamMode === mode);
  });
  const hint = $('teamModeHint');
  if (hint) {
    // On touch, say that reordering needs a deliberate hold. Without this the
    // new long-press requirement just reads as "dragging is broken now".
    const touchHint = coarsePointer() && !searchQ && !selectionMode
      ? 'จัดลำดับ: กดค้างที่ปุ่มลาก แล้วลาก — ปัดเพื่อเลื่อนหน้าได้ตามปกติ'
      : '';
    hint.textContent = mode === 'perms'
      ? 'แตะที่ตำแหน่งเพื่อกำหนดสิทธิ์ของทั้งตำแหน่ง หรือแตะที่ชื่อบุคคลเพื่อกำหนดสิทธิ์รายบุคคล — สีทึบคือสิทธิ์ที่กำหนดเอง สีเส้นประคือสิทธิ์ที่รับมาจากตำแหน่ง'
      : touchHint;
  }

  const roots = childrenOf(null);
  const filter = searchQ ? computeFilter(searchQ) : null;
  setStatus(`${nodesById.size} ตำแหน่ง · ${[...membersByNode.values()].reduce((a, b) => a + b.length, 0)} สมาชิก`);

  if (!roots.length) {
    tree.innerHTML = '<div class="team-empty">ยังไม่มีฝ่าย — กด “เพิ่มฝ่าย” เพื่อเริ่ม</div>';
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'team-children team-root';
  ul.dataset.parentId = '';
  roots.forEach((n) => { const li = renderNode(n, filter); if (li) ul.appendChild(li); });
  tree.innerHTML = '';
  tree.appendChild(ul);

  // Drag is for fine reordering, so it belongs to จัดการทีม only — dragging in
  // จัดการสิทธิ์ could only ever reorder the tree by accident while the user is
  // there to edit permissions. Also off while filtering or selecting. The "ย้าย"
  // picker / bulk-move bar handle cross-level + multi moves.
  if (mode === 'team' && canEdit() && !searchQ && !selectionMode) attachSortables(tree);

  tree.classList.toggle('is-selectmode', selectionMode);
  $('teamSelectMode')?.classList.toggle('is-active', selectionMode);
  updateSelectionBar();
}

function renderNode(node, filter) {
  if (filter && !filter.visible.has(node.id)) return null;
  const kids = childrenOf(node.id);
  const mem = membersOf(node.id);
  // Both modes list people now. Team mode = identity/structure (add/move/edit
  // the person); perms mode = per-person permission editor rows under each node.
  const showMembers = true;
  // In team mode EVERY node is expandable — a role can always hold members, so
  // you must be able to open even an empty one to reveal its drop zone / add
  // button. In perms mode a node expands when it has child nodes OR people to
  // grant perms to.
  const expandable = mode === 'team' ? true : (kids.length > 0 || mem.length > 0);
  const isOpen = filter ? true : expanded.has(node.id);
  const count = subtreeMemberCount(node.id);

  const li = document.createElement('li');
  li.className = 'team-node' + (selectionMode && selectedNodes.has(node.id) ? ' is-selected' : '');
  li.dataset.nodeId = node.id;
  li.dataset.kind = node.kind;

  const checkbox = selectionMode
    ? `<input type="checkbox" class="team-check" data-act="select" ${selectedNodes.has(node.id) ? 'checked' : ''} aria-label="เลือกตำแหน่ง" />`
    : '';

  let permChips = '';
  if (mode === 'perms') {
    const own = new Set(node.permissions || []);
    const inh = inheritedPermsFor(node.id);
    [...own].forEach((p) => { permChips += `<span class="team-perm-chip is-own">${escHtml(PERM_LABEL[p] || p)}</span>`; });
    [...inh].forEach((p) => { if (!own.has(p)) permChips += `<span class="team-perm-chip is-inherited">${escHtml(PERM_LABEL[p] || p)}</span>`; });
    // VitalSound per-ฝ่าย binding: own dept solid, inherited dashed (0082).
    const ownDept = node.vs_dept;
    if (ownDept) permChips += `<span class="team-perm-chip is-vs is-own" title="VitalSound: ${escHtml(ownDept)}"><i class="bi bi-soundwave"></i> ${escHtml(VS_DEPT_LABEL[ownDept] || ownDept)}</span>`;
    [...inheritedVsDeptsFor(node.id)].forEach((d) => { if (d !== ownDept) permChips += `<span class="team-perm-chip is-vs is-inherited" title="VitalSound: ${escHtml(d)}"><i class="bi bi-soundwave"></i> ${escHtml(VS_DEPT_LABEL[d] || d)}</span>`; });
    // หนังสือโครงการ seat (0086): own solid, inherited dashed — and an own seat
    // REPLACES the inherited one (0092), so only one chip ever shows.
    const ownSeat = node.project_seat;
    if (ownSeat) {
      permChips += `<span class="team-perm-chip is-seat is-own" title="หนังสือโครงการ: ${escHtml(PROJECT_SEAT_LABEL[ownSeat] || ownSeat)}"><i class="bi bi-file-earmark-text"></i> ${escHtml(PROJECT_SEAT_LABEL[ownSeat] || ownSeat)}</span>`;
    } else {
      [...inheritedSeatsFor(node.id)].forEach((x) => { permChips += `<span class="team-perm-chip is-seat is-inherited" title="หนังสือโครงการ: ${escHtml(PROJECT_SEAT_LABEL[x] || x)}"><i class="bi bi-file-earmark-text"></i> ${escHtml(PROJECT_SEAT_LABEL[x] || x)}</span>`; });
    }
    if (!permChips) permChips = '<span class="team-perm-none">ไม่มีสิทธิ์</span>';
  }

  const nameHtml = filter ? highlight(node.name, filter.q) : escHtml(node.name);
  const actions = !canEdit() ? '' : mode === 'team' ? `
        <button type="button" class="team-act" data-act="add-member" title="เพิ่มสมาชิก"><i class="bi bi-person-plus"></i></button>
        <button type="button" class="team-act" data-act="add-child" title="เพิ่มตำแหน่งย่อย"><i class="bi bi-plus-square"></i></button>
        <button type="button" class="team-act" data-act="move" title="ย้าย"><i class="bi bi-arrows-move"></i></button>
        <button type="button" class="team-act" data-act="edit" title="แก้ไข"><i class="bi bi-pencil"></i></button>
        <button type="button" class="team-act team-act-danger" data-act="delete" title="ลบ"><i class="bi bi-trash"></i></button>`
    : `
        <button type="button" class="team-act team-act-perm" data-act="edit-perms" title="กำหนดสิทธิ์"><i class="bi bi-shield-lock"></i></button>`;

  li.innerHTML = `
    <div class="team-row" data-node-id="${node.id}">
      ${checkbox}
      ${canEdit() ? '<span class="team-handle" title="ลากเพื่อจัดลำดับ"><i class="bi bi-grip-vertical"></i></span>' : ''}
      <button type="button" class="team-caret ${expandable ? '' : 'is-leaf'}" data-act="toggle"
        aria-label="ขยาย/ย่อ">${expandable ? `<i class="bi bi-chevron-${isOpen ? 'down' : 'right'}"></i>` : ''}</button>
      <i class="bi ${KIND_ICON[node.kind] || KIND_ICON.role} team-node-icon"></i>
      <span class="team-node-name" data-act="primary">${nameHtml}</span>
      ${count ? `<span class="team-count" title="สมาชิกในสายนี้">${count}</span>` : ''}
      ${healthNodeCounts.get(node.id)
        ? `<button type="button" class="team-count team-count-warn" data-act="check-member"
             title="มี ${healthNodeCounts.get(node.id)} รายชื่อในสายนี้ที่ต้องตรวจสอบข้อมูล"
             aria-label="ต้องตรวจสอบ ${healthNodeCounts.get(node.id)} รายการ"
           ><i class="bi bi-exclamation-triangle-fill"></i> ${healthNodeCounts.get(node.id)}</button>`
        : ''}
      <span class="team-perms">${permChips}</span>
      <span class="team-row-actions">${actions}</span>
    </div>`;

  const body = document.createElement('div');
  body.className = 'team-node-body';
  if (!isOpen) body.classList.add('d-none');

  if (showMembers) {
    const mul = document.createElement('ul');
    mul.className = 'team-members';
    mul.dataset.nodeId = node.id;
    mem.forEach((m) => { const mli = renderMember(m, filter); if (mli) mul.appendChild(mli); });
    // Empty-role drop zone: on a LEAF role with no members, a placeholder gives
    // the (otherwise zero-height) list a droppable area AND tells the user they
    // can drag a person here or add one. Skipped on structural nodes (they have
    // child nodes) to avoid noise — use the + button to add a direct member.
    if (mode === 'team' && canEdit() && !mem.length && !kids.length && !filter) {
      const ph = document.createElement('li');
      ph.className = 'team-members-empty';
      ph.dataset.act = 'add-member';
      ph.innerHTML = '<i class="bi bi-arrow-down-circle"></i> ลากสมาชิกมาวางที่นี่ หรือกดเพื่อเพิ่ม';
      mul.appendChild(ph);
    }
    body.appendChild(mul);
  }

  const cul = document.createElement('ul');
  cul.className = 'team-children';
  cul.dataset.parentId = node.id;
  kids.forEach((c) => { const cli = renderNode(c, filter); if (cli) cul.appendChild(cli); });
  body.appendChild(cul);

  li.appendChild(body);
  return li;
}

function renderMember(m, filter) {
  if (filter && !filter.memberIds.has(m.id)) return null;
  const li = document.createElement('li');
  li.className = 'team-member' + (selectionMode && selectedMembers.has(m.id) ? ' is-selected' : '');
  li.dataset.memberId = m.id;
  li.dataset.nodeId = m.node_id;
  const name = m.full_name || '';
  const nameHtml = filter ? highlight(name, filter.q) : escHtml(name);
  const nick = m.nickname ? (filter ? highlight(m.nickname, filter.q) : escHtml(m.nickname)) : '';
  const mailHtml = m.kkumail ? (filter ? highlight(m.kkumail, filter.q) : escHtml(m.kkumail)) : '';
  const checkbox = selectionMode
    ? `<input type="checkbox" class="team-check" data-act="select" ${selectedMembers.has(m.id) ? 'checked' : ''} aria-label="เลือกสมาชิก" />`
    : '';

  if (mode === 'perms') {
    // Per-person permission row: name + effective chips (own solid,
    // node-inherited dashed) + a shield button opening the person's editor.
    const own = new Set(m.permissions || []);
    const inh = m.inherit_permissions !== false ? nodeEffectivePerms(m.node_id) : new Set();
    let chips = '';
    [...own].forEach((p) => { chips += `<span class="team-perm-chip is-own">${escHtml(PERM_LABEL[p] || p)}</span>`; });
    [...inh].forEach((p) => { if (!own.has(p)) chips += `<span class="team-perm-chip is-inherited">${escHtml(PERM_LABEL[p] || p)}</span>`; });
    // VitalSound scope: the person's OWN binding (0083, solid) + whatever
    // their ตำแหน่ง passes down (0082, dashed).
    const ownDept = m.vs_dept || null;
    if (ownDept) chips += `<span class="team-perm-chip is-vs is-own" title="VitalSound: ${escHtml(ownDept)}"><i class="bi bi-soundwave"></i> ${escHtml(VS_DEPT_LABEL[ownDept] || ownDept)}</span>`;
    const vsDepts = m.inherit_permissions !== false ? nodeEffectiveVsDepts(m.node_id) : new Set();
    [...vsDepts].forEach((d) => { if (d !== ownDept) chips += `<span class="team-perm-chip is-vs is-inherited" title="VitalSound: ${escHtml(d)}"><i class="bi bi-soundwave"></i> ${escHtml(VS_DEPT_LABEL[d] || d)}</span>`; });
    // หนังสือโครงการ seat: an own binding REPLACES the inherited one (0092), so
    // show one chip or the other — never both, or the row would advertise a
    // grant ("ผู้ส่งหนังสือ") the person does not actually resolve to.
    const ownSeat = m.project_seat || null;
    if (ownSeat) {
      chips += `<span class="team-perm-chip is-seat is-own" title="หนังสือโครงการ: ${escHtml(PROJECT_SEAT_LABEL[ownSeat] || ownSeat)}"><i class="bi bi-file-earmark-text"></i> ${escHtml(PROJECT_SEAT_LABEL[ownSeat] || ownSeat)}</span>`;
    } else if (m.inherit_permissions !== false) {
      [...nodeEffectiveSeats(m.node_id)].forEach((x) => { chips += `<span class="team-perm-chip is-seat is-inherited" title="หนังสือโครงการ: ${escHtml(PROJECT_SEAT_LABEL[x] || x)}"><i class="bi bi-file-earmark-text"></i> ${escHtml(PROJECT_SEAT_LABEL[x] || x)}</span>`; });
    }
    if (!chips) chips = '<span class="team-perm-none">ไม่มีสิทธิ์</span>';
    li.innerHTML = `
      ${checkbox}
      ${canEdit() ? '<span class="team-handle team-handle-sm" title="ลากเพื่อจัดลำดับ"><i class="bi bi-grip-vertical"></i></span>' : ''}
      <span class="team-member-main" data-act="edit-member-perms">
        <span class="team-member-name">${nameHtml}${nick ? ` <span class="team-member-nick">(${nick})</span>` : ''}</span>
        ${mailHtml ? `<span class="team-member-mail"><i class="bi bi-envelope"></i> ${mailHtml}</span>` : ''}
        <span class="team-perms team-member-perms">${chips}</span>
      </span>
      <span class="team-member-actions">
        ${healthFlags.has(m.id)
          ? `<button type="button" class="team-act team-act-warn" data-act="check-member"
               title="ต้องตรวจสอบ: ${escHtml([...healthFlags.get(m.id)].join(' · '))}"
               aria-label="ต้องตรวจสอบข้อมูล"><i class="bi bi-exclamation-triangle-fill"></i></button>`
          : ''}
        ${canEdit() ? '<button type="button" class="team-act team-act-perm" data-act="edit-member-perms" title="กำหนดสิทธิ์รายบุคคล"><i class="bi bi-shield-lock"></i></button>' : ''}
      </span>`;
    return li;
  }

  li.innerHTML = `
    ${checkbox}
    <span class="team-handle team-handle-sm" title="ลากเพื่อจัดลำดับ"><i class="bi bi-grip-vertical"></i></span>
    <span class="team-member-main" data-act="edit-member">
      <span class="team-member-name">${nameHtml}${nick ? ` <span class="team-member-nick">(${nick})</span>` : ''}</span>
      ${mailHtml ? `<span class="team-member-mail"><i class="bi bi-envelope"></i> ${mailHtml}</span>` : ''}
      <span class="team-member-meta">
        ${m.major ? `<span class="team-tag team-tag-major">${escHtml(m.major)}</span>` : ''}
        ${m.year ? `<span class="team-tag">ปี ${escHtml(m.year)}</span>` : ''}
        ${m.student_id ? `<span class="team-tag team-tag-sid">${escHtml(m.student_id)}</span>` : ''}
        ${m.confirmed
          ? '<span class="team-tag team-tag-ok"><i class="bi bi-check-circle-fill"></i> ยืนยัน</span>'
          : '<span class="team-tag team-tag-pending">รอยืนยัน</span>'}
        ${(() => {
          const eff = [...memberEffectivePerms(m)];
          return eff.length
            ? `<span class="team-tag team-tag-perm" title="${escHtml(eff.map((p) => PERM_LABEL[p] || p).join(', '))}"><i class="bi bi-shield-lock"></i> ${eff.length} สิทธิ์</span>`
            : '';
        })()}
      </span>
    </span>
    <span class="team-member-actions">
      ${healthFlags.has(m.id)
        ? `<button type="button" class="team-act team-act-warn" data-act="check-member"
             title="ต้องตรวจสอบ: ${escHtml([...healthFlags.get(m.id)].join(' · '))}"
             aria-label="ต้องตรวจสอบข้อมูล"><i class="bi bi-exclamation-triangle-fill"></i></button>`
        : ''}
      ${canEdit() ? `
      <button type="button" class="team-act" data-act="move-member" title="ย้ายตำแหน่ง"><i class="bi bi-arrows-move"></i></button>
      <button type="button" class="team-act" data-act="edit-member" title="แก้ไข"><i class="bi bi-pencil"></i></button>
      <button type="button" class="team-act team-act-danger" data-act="delete-member" title="ลบ"><i class="bi bi-trash"></i></button>` : ''}
    </span>`;
  return li;
}

function highlight(text, q) {
  const t = String(text || '');
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escHtml(t);
  return escHtml(t.slice(0, i)) + '<mark>' + escHtml(t.slice(i, i + q.length)) + '</mark>' + escHtml(t.slice(i + q.length));
}

/** Touch-primary device? Used only to phrase hints; never to gate behaviour. */
function coarsePointer() {
  try { return window.matchMedia?.('(pointer: coarse)')?.matches === true; }
  catch { return false; }
}

function computeFilter(qRaw) {
  const q = qRaw.trim().toLowerCase();
  const memberIds = new Set();
  const visible = new Set();
  const markUp = (nodeId) => {
    let cur = nodesById.get(nodeId);
    while (cur) { visible.add(cur.id); cur = cur.parent_id ? nodesById.get(cur.parent_id) : null; }
  };
  for (const n of nodesById.values()) if (n.name.toLowerCase().includes(q)) markUp(n.id);
  // Search PEOPLE in both modes. This used to be gated on `mode === 'team'`,
  // which dated from when จัดการสิทธิ์ listed ตำแหน่ง only. It now renders a
  // per-person row (สิทธิ์รายบุคคล), and renderMember drops any member missing
  // from `memberIds` — so with the gate in place, typing a name in จัดการสิทธิ์
  // matched nobody and hid every person, i.e. search looked broken in the one
  // mode where you most need to find a specific individual.
  for (const arr of membersByNode.values()) {
    for (const m of arr) {
      const hay = `${m.full_name} ${m.nickname || ''} ${m.student_id || ''} ${m.major || ''} ${m.kkumail || ''}`.toLowerCase();
      if (hay.includes(q)) { memberIds.add(m.id); markUp(m.node_id); }
    }
  }
  return { visible, memberIds, q: qRaw.trim() };
}

// ============================================================
// DRAG / DROP (fine reordering; cross-level use the move picker)
// ============================================================

/** A list inside a collapsed (d-none) node body can't be a visible drop target,
 *  so skip it — attaching SortableJS to all ~2×N lists every render (most of
 *  them hidden) is the main source of jank on big trees / iPad. Structural
 *  check (not offsetParent) so it's correct even if the pane re-renders while
 *  the team section itself is hidden. */
function inCollapsedBody(ul, tree) {
  let el = ul.parentElement;
  while (el && el !== tree) {
    if (el.classList.contains('team-node-body') && el.classList.contains('d-none')) return true;
    el = el.parentElement;
  }
  return false;
}

// Touch drags open on a LONG PRESS, mouse drags stay instant.
//
// Before this, a finger that happened to land on a drag handle while scrolling
// started a reorder — the handle also carried `touch-action: none`, so the page
// could not scroll out from under it. `delayOnTouchOnly` keeps the desktop feel
// (no delay with a mouse) while requiring a deliberate hold on touch, and
// `touchStartThreshold` cancels the pending drag the moment the finger travels,
// so a scroll gesture that begins on a handle scrolls instead of dragging.
const TOUCH_DRAG = {
  delay: 220,
  delayOnTouchOnly: true,
  touchStartThreshold: 8,
  chosenClass: 'team-chosen',
};

function attachSortables(tree) {
  if (!window.Sortable) return;
  tree.querySelectorAll('ul.team-children').forEach((ul) => {
    if (inCollapsedBody(ul, tree)) return;
    sortables.push(window.Sortable.create(ul, {
      group: 'team-nodes', handle: '.team-handle:not(.team-handle-sm)',
      draggable: '.team-node', animation: 150, fallbackOnBody: true, ghostClass: 'team-ghost',
      ...TOUCH_DRAG,
      onStart: () => { dragging = true; },
      onMove: (evt) => {
        const draggedId = evt.dragged?.dataset?.nodeId;
        const targetParent = evt.to?.dataset?.parentId || null;
        if (draggedId && targetParent && isAncestor(draggedId, targetParent)) return false;
        return true;
      },
      onEnd: onNodeDrop,
    }));
  });
  if (mode === 'team') {
    tree.querySelectorAll('ul.team-members').forEach((ul) => {
      if (inCollapsedBody(ul, tree)) return;
      sortables.push(window.Sortable.create(ul, {
        group: 'team-members', handle: '.team-handle-sm',
        draggable: '.team-member', animation: 150, fallbackOnBody: true, ghostClass: 'team-ghost',
        ...TOUCH_DRAG,
        onStart: () => { dragging = true; },
        onEnd: onMemberDrop,
      }));
    });
  }
}

async function onNodeDrop(evt) {
  dragging = false; pendingRender = false;
  const id = evt.item.dataset.nodeId;
  const newParentId = evt.to.dataset.parentId || null;
  if (!id) return;
  if (newParentId && isAncestor(id, newParentId)) { render(); return; }
  const siblingIds = [...evt.to.children].filter((c) => c.dataset.nodeId).map((c) => c.dataset.nodeId);
  const node = nodesById.get(id);
  const updates = [];
  if (node.parent_id !== newParentId) {
    node.parent_id = newParentId;
    updates.push({ id, parent_id: newParentId, position: siblingIds.indexOf(id) });
  }
  siblingIds.forEach((sid, i) => {
    const n = nodesById.get(sid);
    if (!n) return;
    if (n.position !== i) { n.position = i; if (!updates.find((u) => u.id === sid)) updates.push({ id: sid, position: i }); }
  });
  rebuildChildrenIndexFromNodes();
  render();
  if (updates.length) {
    try { await patchNodePositions(updates); }
    catch (e) { console.warn('[team] node reorder failed:', e?.message || e); reload(); }
  }
}

async function onMemberDrop(evt) {
  dragging = false; pendingRender = false;
  const id = evt.item.dataset.memberId;
  const newNodeId = evt.to.dataset.nodeId;
  if (!id || !newNodeId) return;
  const memberIds = [...evt.to.children].filter((c) => c.dataset.memberId).map((c) => c.dataset.memberId);
  const m = findMember(id);
  const updates = [];
  if (m && m.node_id !== newNodeId) { m.node_id = newNodeId; updates.push({ id, node_id: newNodeId, position: memberIds.indexOf(id) }); }
  memberIds.forEach((mid, i) => {
    const mm = findMember(mid);
    if (mm && mm.position !== i) { mm.position = i; if (!updates.find((u) => u.id === mid)) updates.push({ id: mid, position: i }); }
  });
  rebuildMembersIndex();
  render();
  if (updates.length) {
    try { await patchMemberPositions(updates); }
    catch (e) { console.warn('[team] member reorder failed:', e?.message || e); reload(); }
  }
}

function rebuildChildrenIndexFromNodes() {
  childrenByParent = new Map();
  for (const n of nodesById.values()) {
    const key = n.parent_id || '';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(n);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name, 'th'));
  }
}

function rebuildMembersIndex() {
  const all = [];
  for (const arr of membersByNode.values()) all.push(...arr);
  membersByNode.clear();
  all.forEach((m) => {
    if (!membersByNode.has(m.node_id)) membersByNode.set(m.node_id, []);
    membersByNode.get(m.node_id).push(m);
  });
  for (const arr of membersByNode.values()) {
    arr.sort((a, b) => (a.position - b.position) || a.full_name.localeCompare(b.full_name, 'th'));
  }
}

function findMember(id) {
  for (const arr of membersByNode.values()) { const m = arr.find((x) => x.id === id); if (m) return m; }
  return null;
}

/** Find an existing member in a node that an import row would duplicate:
 *  same kkumail (case-insensitive), else same name + student_id. */
function findExistingMember(nodeId, r) {
  const mail = (r.kkumail || '').toLowerCase();
  return membersOf(nodeId).find((m) => mail
    ? (m.kkumail || '').toLowerCase() === mail
    : (m.full_name === r.full_name && (m.student_id || '') === (r.student_id || ''))) || null;
}

// ============================================================
// TREE EVENT DELEGATION
// ============================================================

function wireTreeDelegation() {
  const tree = $('teamTree');
  if (!tree) return;
  tree.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const nodeId = btn.closest('.team-node')?.dataset.nodeId;
    const memberId = btn.closest('.team-member')?.dataset.memberId;

    if (act === 'select') {
      // Local toggle — avoid a full re-render so the checkbox/scroll stay put.
      const checked = btn.checked;
      if (memberId) {
        checked ? selectedMembers.add(memberId) : selectedMembers.delete(memberId);
        btn.closest('.team-member')?.classList.toggle('is-selected', checked);
      } else if (nodeId) {
        checked ? selectedNodes.add(nodeId) : selectedNodes.delete(nodeId);
        btn.closest('.team-node')?.classList.toggle('is-selected', checked);
      }
      updateSelectionBar();
      return;
    }
    if (act === 'toggle') {
      if (!nodeId) return;
      if (expanded.has(nodeId)) expanded.delete(nodeId); else expanded.add(nodeId);
      render(); return;
    }
    if (act === 'primary') {
      if (!nodeId) return;
      // ONE editor, opened on the tab that matches the mode you are in (0110).
      // Before this, จัดการทีม could only reach แก้ไขตำแหน่ง and จัดการสิทธิ์ only
      // reached สิทธิ์, so managing a record you had just clicked meant going
      // back and finding it again in the other mode.
      openNodeModal({ node: nodesById.get(nodeId), tab: modeTab() });
      return;
    }
    if (!nodeId && !memberId) return;
    switch (act) {
      case 'edit':        openNodeModal({ node: nodesById.get(nodeId), tab: modeTab() }); break;
      case 'add-child':   openNodeModal({ parentId: nodeId }); break;
      case 'add-member':  openMemberModal({ nodeId }); break;
      case 'move':        openMoveNode(nodeId); break;
      case 'delete':      onDeleteNode(nodeId); break;
      case 'edit-perms':  openPermModal(nodeId); break;
      case 'edit-member': openMemberModal({ member: findMember(memberId), tab: modeTab() }); break;
      case 'edit-member-perms': openMemberPermModal(memberId); break;
      case 'move-member': openMoveMember(memberId); break;
      case 'delete-member': onDeleteMember(memberId); break;
      // The flag is the shortcut, not just an indicator: seeing the problem and
      // being able to fix it should not be two separate navigations. And it
      // carries WHO — landing at the top of 24 findings and having to remember
      // the person you just clicked is the same work, moved.
      case 'check-member': openHealthFor({ memberId, nodeId }); break;
    }
  });
}

/** Which tab the entity editor should lead with, given the mode the click came
 *  from. Both tabs are always PRESENT — this only decides which one is on top. */
function modeTab() { return mode === 'perms' ? 'perm' : 'info'; }

/**
 * May this account WRITE the tree? (migration 0110)
 *
 * Since 0110 everyone with a posting holds `team` and can open this section to
 * look; only `team_edit` (or role vp_admin/dev) may change anything. Everything
 * below asks THIS function rather than re-deriving the answer, so the UI and
 * the RLS write policy cannot drift.
 *
 * Read-only is enforced by NOT RENDERING the affordance, not by disabling it
 * after a click: a live-looking ลบ button that 42501s is worse than no button,
 * and this repo has shipped that shape before (the scoped shop admin whose
 * product rows rendered Edit buttons that always failed).
 */
function canEdit() { return userCanAccess('team_edit'); }

/**
 * The shared footer button of a two-tab entity modal submits whichever pane is
 * showing.
 *
 * A modal cannot have two footers, and the two panes hold two independent
 * <form>s with two independent submit handlers — which is deliberate: merging
 * them into one form would have meant rewriting onNodeSubmit / the perm save
 * path, the two most authorization-sensitive writes in this module, for a
 * layout change. So the button is `type="button"` and forwards instead.
 *
 * `requestSubmit()`, never `submit()`: the latter bypasses the submit event
 * entirely, so every handler in this file would silently stop running.
 */
function wireModalSave() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-team-modal-save]');
    if (!btn) return;
    const modal = document.getElementById(btn.getAttribute('data-team-modal-save'));
    const form = modal?.querySelector('.tab-pane.active form');
    if (form) form.requestSubmit();
  });
}

// ============================================================
// TOOLBAR + MODE
// ============================================================

/** The single path into a mode. Used by the mode buttons AND by the ต้องตรวจสอบ
 *  flag on a member row, so the two can never drift about what switching
 *  entails (clearing a half-made selection, painting the pane, cold entry). */
function switchMode(m) {
  if (!m || m === mode) return;
  mode = m;
  if (selectionMode) { selectionMode = false; clearSelection(); }  // perms mode has no member rows
  render();
  if (mode === 'years') enterTerms();
  if (mode === 'health') enterHealth();
  if (mode === 'me') enterMySeatPane();
}

/**
 * Paint the shared ตำแหน่งของฉัน card into the admin pane.
 *
 * Deliberately thin: everything about the card — its markup, the findings, the
 * self-edit round trip, the photo upload — lives in ../my-seat.js and is the
 * same code the public home page runs. A second implementation here is exactly
 * what this repo means by "two implementations of one rule drift"; the only
 * thing this function decides is where it goes.
 */
async function enterMySeatPane() {
  const host = $('teamMySeat');
  const empty = $('teamMeEmpty');
  if (!host) return;
  const uid = getUser()?.id || null;
  const seat = uid ? await loadMySeat(uid) : null;
  empty?.classList.toggle('d-none', !!seat);
  renderMySeat(host, seat, { compact: true });
}

/** Every member id at or below a ตำแหน่ง. Used so the rolled-up count on a
 *  branch focuses that whole branch, not just one person. */
function memberIdsUnder(nodeId, out = []) {
  for (const m of membersOf(nodeId)) out.push(m.id);
  for (const child of childrenOf(nodeId)) memberIdsUnder(child.id, out);
  return out;
}

/** Open ตรวจสอบข้อมูล already filtered to what the admin clicked. A member row
 *  focuses that person; a ตำแหน่ง's rolled-up count focuses its whole branch. */
function openHealthFor({ memberId, nodeId }) {
  let focus = null;
  if (memberId) {
    const m = findMember(memberId);
    if (m) focus = { ids: [memberId], label: m.full_name || '(ไม่มีชื่อ)' };
  } else if (nodeId) {
    const ids = memberIdsUnder(nodeId);
    if (ids.length) focus = { ids, label: nodesById.get(nodeId)?.name || 'ตำแหน่งนี้' };
  }
  if (mode === 'health') { enterHealth(focus); return; }
  mode = 'health';
  if (selectionMode) { selectionMode = false; clearSelection(); }
  render();
  enterHealth(focus);
}

function wireToolbar() {
  $('teamAddRoot')?.addEventListener('click', () => openNodeModal({ parentId: null, kind: 'division' }));
  $('teamExpandAll')?.addEventListener('click', () => { for (const id of nodesById.keys()) expanded.add(id); render(); });
  $('teamCollapseAll')?.addEventListener('click', () => { expanded.clear(); render(); });

  document.querySelectorAll('.team-mode-btn').forEach((b) => {
    b.addEventListener('click', () => switchMode(b.dataset.teamMode));
  });

  // Multi-select: toggle checkboxes + the bulk action bar.
  $('teamSelectMode')?.addEventListener('click', () => {
    selectionMode = !selectionMode;
    if (!selectionMode) clearSelection();
    render();
  });
  $('teamSelMove')?.addEventListener('click', openBulkMove);
  $('teamSelDelete')?.addEventListener('click', bulkDelete);
  $('teamSelCancel')?.addEventListener('click', () => { selectionMode = false; clearSelection(); render(); });

  const search = $('teamSearch');
  const clear = $('teamSearchClear');
  let t = null;
  search?.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      searchQ = search.value.trim();
      clear?.classList.toggle('d-none', !searchQ);
      render();
    }, 180);
  });
  clear?.addEventListener('click', () => { search.value = ''; searchQ = ''; clear.classList.add('d-none'); render(); search.focus(); });
}

function modalInstance(id) {
  const el = $(id);
  return el && window.bootstrap ? window.bootstrap.Modal.getOrCreateInstance(el) : null;
}

// ============================================================
// DESTINATION PICKER — searchable list (used by node-move + member-role assign)
// A type-to-filter list beats a 200-option <select> and is touch-friendly:
// select a row, confirm. Far easier than precise nested drag.
// ============================================================

let pickerCandidates = [];   // [{ id, name, path, depth, current }]
let pickerSelected = null;   // chosen id ('' = root) or null = nothing yet
let pickerOnPick = null;     // (id|null) => void
let pickerAllowRoot = false;

function wirePicker() {
  $('teamPickerSearch')?.addEventListener('input', () => renderPickerList($('teamPickerSearch').value.trim()));
  $('teamPickerList')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-pick-id]');
    if (!row) return;
    pickerSelected = row.dataset.pickId;  // '' for root
    $('teamPickerList').querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected'));
    row.classList.add('is-selected');
    $('teamPickerConfirm').disabled = false;
  });
  $('teamPickerConfirm')?.addEventListener('click', () => {
    if (pickerSelected === null) return;
    const cb = pickerOnPick;
    const sel = pickerSelected;
    modalInstance('teamPickerModal')?.hide();
    if (cb) cb(sel || null);
  });
  // The picker can open ON TOP of the member modal. When the (inner) picker
  // closes, Bootstrap can strip `modal-open` from <body> even though the outer
  // modal is still up, unlocking page scroll. Re-assert it if so.
  $('teamPickerModal')?.addEventListener('hidden.bs.modal', () => {
    if (document.querySelector('.modal.show')) document.body.classList.add('modal-open');
  });
}

function openPicker({ title, what, currentId = null, exclude = null, allowRoot = false, onPick }) {
  pickerOnPick = onPick;
  pickerAllowRoot = allowRoot;
  pickerSelected = null;
  $('teamPickerTitle').textContent = title || 'เลือกตำแหน่ง';
  $('teamPickerWhat').textContent = what || '';
  $('teamPickerConfirm').disabled = true;
  pickerCandidates = [];
  const walk = (parentId, depth, trail) => {
    for (const n of childrenOf(parentId)) {
      if (exclude && exclude(n.id)) continue;
      const path = trail.concat(n.name);
      pickerCandidates.push({ id: n.id, name: n.name, path: path.join(' / '), depth, current: n.id === currentId });
      walk(n.id, depth + 1, path);
    }
  };
  walk(null, 0, []);
  const search = $('teamPickerSearch');
  if (search) search.value = '';
  renderPickerList('');
  modalInstance('teamPickerModal')?.show();
  setTimeout(() => search?.focus(), 250);
}

function renderPickerList(q) {
  const list = $('teamPickerList');
  if (!list) return;
  const ql = q.toLowerCase();
  const matches = ql ? pickerCandidates.filter((c) => c.path.toLowerCase().includes(ql)) : pickerCandidates;
  let html = '';
  if (pickerAllowRoot && !ql) {
    html += `<button type="button" class="team-picker-item team-picker-root" data-pick-id="">
      <i class="bi bi-diagram-2"></i> — ระดับบนสุด (ฝ่ายหลัก) —</button>`;
  }
  html += matches.slice(0, 300).map((c) => {
    const parent = c.path.split(' / ').slice(0, -1).join(' / ');
    return `<button type="button" class="team-picker-item ${c.current ? 'is-current' : ''}" data-pick-id="${c.id}">
      <span class="team-picker-leaf">${highlightPlain(c.name, q)}</span>
      ${parent ? `<span class="team-picker-path">${highlightPlain(parent, q)}</span>` : ''}
      ${c.current ? '<span class="team-picker-badge">ปัจจุบัน</span>' : ''}
    </button>`;
  }).join('');
  if (!html) html = '<div class="team-picker-empty">ไม่พบตำแหน่ง</div>';
  list.innerHTML = html;
}

function highlightPlain(text, q) {
  if (!q) return escHtml(text);
  const t = String(text || ''); const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escHtml(t);
  return escHtml(t.slice(0, i)) + '<mark>' + escHtml(t.slice(i, i + q.length)) + '</mark>' + escHtml(t.slice(i + q.length));
}

// ============================================================
// NODE MODAL (name + kind only)
// ============================================================

function wireNodeModal() {
  $('teamNodeForm')?.addEventListener('submit', onNodeSubmit);
  $('teamNodeDelete')?.addEventListener('click', () => {
    const id = $('teamNodeId').value;
    if (id) { modalInstance('teamNodeModal')?.hide(); onDeleteNode(id); }
  });
}

function openNodeModal({ node = null, parentId = null, kind = null, tab = 'info' } = {}) {
  $('teamNodeId').value = node?.id || '';
  $('teamNodeParentId').value = node ? (node.parent_id || '') : (parentId || '');
  $('teamNodeName').value = node?.name || '';
  $('teamNodeKind').value = node?.kind || kind || 'role';
  // New nodes default to visible; only an explicit false hides the subtree.
  if ($('teamNodeIsPublic')) $('teamNodeIsPublic').checked = node ? node.is_public !== false : true;
  // Board membership is opt-in, so a NEW ตำแหน่ง is never silently promoted into
  // the public headline grid.
  if ($('teamNodeIsBoard')) $('teamNodeIsBoard').checked = !!node?.is_board;
  $('teamNodeModalTitle').textContent = node ? 'แก้ไขตำแหน่ง' : (parentId ? 'เพิ่มตำแหน่งย่อย' : 'เพิ่มฝ่าย');
  $('teamNodeDelete').classList.toggle('d-none', !node);
  // Both editors live in one modal now (0110). An UNSAVED node has no row for a
  // grant to attach to, so its สิทธิ์ tab is disabled rather than shown empty.
  if (node) fillNodePermPane(node.id);
  showTeamModal('teamNodeModal', node ? tab : 'info', !!node);
  if (tab !== 'perm') setTimeout(() => $('teamNodeName')?.focus(), 250);
}

/**
 * Show a two-tab entity modal with one tab active.
 *
 * Bootstrap's Tab API is used rather than hand-toggling `.active`, so the
 * `aria-selected` / `tabindex` bookkeeping stays correct — and it is called
 * BEFORE `.show()` because switching panes on a visible modal is a visible
 * flicker. `getOrCreateInstance` throughout: constructing a fresh
 * `bootstrap.Modal` on an already-open modal stacks a second backdrop that the
 * first instance's hide() never clears (logged in the mistakes log), and these
 * modals genuinely can be re-opened while open — clicking another person in
 * the tree behind a stacked picker does exactly that.
 */
function showTeamModal(modalId, tab = 'info', permEnabled = true) {
  const permTab = document.getElementById(`${modalId}Pane2Tab`);
  const infoTab = document.getElementById(`${modalId}Pane1Tab`);
  if (permTab) {
    permTab.classList.toggle('disabled', !permEnabled);
    permTab.setAttribute('aria-disabled', String(!permEnabled));
    permTab.tabIndex = permEnabled ? 0 : -1;
  }
  const target = tab === 'perm' && permEnabled ? permTab : infoTab;
  if (target && window.bootstrap?.Tab) {
    window.bootstrap.Tab.getOrCreateInstance(target).show();
  }

  // A view-only member may OPEN the editor — that is how they read a record —
  // but every control in it is inert. Disabled rather than hidden: the point is
  // to show them the stored values, and an empty modal would read as a bug.
  const modal = document.getElementById(modalId);
  const writable = canEdit();
  // Only ever touch controls THIS pass disabled. A blanket `el.disabled =
  // !writable` also re-enabled everything the panes had deliberately locked —
  // the fill runs before this, so a master grant's implied checkboxes came back
  // editable and the modal contradicted what it would actually save.
  modal?.querySelectorAll('[data-readonly-locked]').forEach((el) => {
    el.disabled = false;
    delete el.dataset.readonlyLocked;
  });
  if (!writable) {
    modal?.querySelectorAll('input, select, textarea, button:not([data-bs-dismiss])')
      .forEach((el) => {
        if (el.closest('.modal-header')) return;      // close + the tab buttons stay live
        if (el.disabled) return;                      // already locked for another reason
        el.disabled = true;
        el.dataset.readonlyLocked = '1';
      });
  }
  if (!writable) {
    modal?.querySelector('#teamNodeDelete')?.classList.add('d-none');
    modal?.querySelector('#teamMemberDelete')?.classList.add('d-none');
  }

  modalInstance(modalId)?.show();
}

async function onNodeSubmit(e) {
  e.preventDefault();
  const id = $('teamNodeId').value;
  const name = $('teamNodeName').value.trim();
  if (!name) { $('teamNodeName').focus(); return; }
  const parentId = $('teamNodeParentId').value || null;
  const payload = {
    name,
    kind: $('teamNodeKind').value,
    is_public: $('teamNodeIsPublic') ? $('teamNodeIsPublic').checked : true,
    is_board: $('teamNodeIsBoard') ? $('teamNodeIsBoard').checked : false,
  };
  modalInstance('teamNodeModal')?.hide();
  try {
    if (id) {
      Object.assign(nodesById.get(id), payload);
      render();
      await updateNode(id, payload);
    } else {
      payload.parent_id = parentId;
      payload.position = childrenOf(parentId).length;
      const row = await createNode(payload);
      nodesById.set(row.id, row);
      rebuildChildrenIndexFromNodes();
      if (parentId) expanded.add(parentId);
      render();
    }
  } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); reload(); }
}

async function onDeleteNode(id) {
  const node = nodesById.get(id);
  // Same silent-dead-button shape as onDeleteMember below.
  if (!node) {
    alert('ไม่พบตำแหน่งนี้ในหน้าจอปัจจุบัน — กำลังโหลดผังใหม่ แล้วลองอีกครั้ง');
    reload();
    return;
  }
  const count = subtreeMemberCount(id);
  const kids = childrenOf(id).length;
  const warn = (kids || count) ? `\n\nจะลบตำแหน่งย่อย ${kids} รายการ และสมาชิก ${count} คนในสายนี้ด้วย` : '';
  if (!confirm(`ลบ “${node.name}” ?${warn}`)) return;
  const toDrop = [];
  const collect = (nid) => { toDrop.push(nid); childrenOf(nid).forEach((c) => collect(c.id)); };
  collect(id);
  toDrop.forEach((nid) => { nodesById.delete(nid); membersByNode.delete(nid); expanded.delete(nid); });
  rebuildChildrenIndexFromNodes();
  render();
  try { await deleteNode(id); } catch (e) { alert(e?.message || 'ลบไม่สำเร็จ'); reload(); }
}

// ============================================================
// MOVE (node → new parent, member → new role) via the picker
// ============================================================

function openMoveNode(id) {
  const node = nodesById.get(id);
  if (!node) return;
  openPicker({
    title: 'ย้ายตำแหน่ง', what: `กำลังย้าย: ${node.name}`,
    currentId: node.parent_id, allowRoot: true,
    exclude: (cid) => cid === id || isAncestor(id, cid),
    onPick: (target) => moveNodeTo(id, target),
  });
}

function moveNodeTo(id, newParentId) {
  const node = nodesById.get(id);
  if (!node) return;
  if (newParentId && isAncestor(id, newParentId)) { alert('ย้ายไปไว้ใต้ตำแหน่งลูกของตัวเองไม่ได้'); return; }
  if (newParentId === (node.parent_id || null)) return;
  node.parent_id = newParentId;
  node.position = childrenOf(newParentId).length;  // append at end of new parent
  rebuildChildrenIndexFromNodes();
  if (newParentId) expanded.add(newParentId);
  render();
  updateNode(id, { parent_id: newParentId, position: node.position })
    .catch((err) => { alert(err?.message || 'ย้ายไม่สำเร็จ'); reload(); });
}

function openMoveMember(id) {
  const m = findMember(id);
  if (!m) return;
  openPicker({
    title: 'ย้ายสมาชิกไปตำแหน่ง',
    what: m.full_name || '',
    currentId: m.node_id,
    onPick: (target) => { if (target) moveMemberTo(id, target); },
  });
}

function moveMemberTo(id, newNodeId) {
  const m = findMember(id);
  if (!m || !newNodeId || m.node_id === newNodeId) return;
  m.node_id = newNodeId;
  m.position = membersOf(newNodeId).length;
  rebuildMembersIndex();
  expanded.add(newNodeId);
  render();
  updateMember(id, { node_id: newNodeId, position: m.position })
    .catch((err) => { alert(err?.message || 'ย้ายไม่สำเร็จ'); reload(); });
}

// ============================================================
// MULTI-SELECT (bulk move / delete)
// ============================================================

function clearSelection() { selectedNodes.clear(); selectedMembers.clear(); updateSelectionBar(); }

function updateSelectionBar() {
  const bar = $('teamSelectionBar');
  if (!bar) return;
  const n = selectedNodes.size, m = selectedMembers.size;
  bar.classList.toggle('d-none', !selectionMode);
  const countEl = $('teamSelectionCount');
  if (countEl) countEl.textContent = `เลือก ${n} ตำแหน่ง, ${m} สมาชิก`;
  const none = !n && !m;
  $('teamSelMove')?.toggleAttribute('disabled', none);
  $('teamSelDelete')?.toggleAttribute('disabled', none);
}

function openBulkMove() {
  if (!selectedNodes.size && !selectedMembers.size) return;
  // Can't drop a moved node into any selected node's own subtree.
  const exclude = (id) => {
    for (const sid of selectedNodes) if (id === sid || isAncestor(sid, id)) return true;
    return false;
  };
  openPicker({
    title: 'ย้ายรายการที่เลือก',
    what: `${selectedNodes.size} ตำแหน่ง, ${selectedMembers.size} สมาชิก`,
    exclude,
    allowRoot: selectedNodes.size > 0 && selectedMembers.size === 0,  // root only valid for nodes
    onPick: (target) => bulkMoveTo(target),
  });
}

async function bulkMoveTo(target) {
  const patches = { nodes: [], members: [] };
  for (const id of selectedNodes) {
    const node = nodesById.get(id);
    if (!node) continue;
    if (target && isAncestor(id, target)) continue;  // safety
    node.parent_id = target || null;
    node.position = childrenOf(target || null).length;
    rebuildChildrenIndexFromNodes();
    patches.nodes.push({ id, parent_id: target || null, position: node.position });
  }
  if (target) {
    for (const id of selectedMembers) {
      const m = findMember(id);
      if (!m || m.node_id === target) continue;
      m.node_id = target;
      m.position = membersOf(target).length;
      rebuildMembersIndex();
      patches.members.push({ id, node_id: target, position: m.position });
    }
  }
  if (target) expanded.add(target);
  clearSelection();
  render();
  try {
    await Promise.all([patchNodePositions(patches.nodes), patchMemberPositions(patches.members)]);
  } catch (e) { console.warn('[team] bulk move failed:', e?.message || e); reload(); }
}

async function bulkDelete() {
  const topNodes = [...selectedNodes];
  const memberIds = [...selectedMembers];
  if (!topNodes.length && !memberIds.length) return;
  if (!confirm(`ลบ ${topNodes.length} ตำแหน่ง และ ${memberIds.length} สมาชิกที่เลือก?\n(ตำแหน่งจะลบรายการย่อยและสมาชิกในสายด้วย)`)) return;

  // Collect the full subtree of selected nodes (members under them cascade).
  const delNodeIds = new Set();
  const collect = (nid) => { delNodeIds.add(nid); childrenOf(nid).forEach((c) => collect(c.id)); };
  topNodes.forEach(collect);
  // Only delete selected members that AREN'T already covered by a deleted node.
  const memToDelete = memberIds.filter((id) => { const m = findMember(id); return m && !delNodeIds.has(m.node_id); });

  // optimistic model removal
  delNodeIds.forEach((nid) => { nodesById.delete(nid); membersByNode.delete(nid); expanded.delete(nid); });
  memToDelete.forEach((id) => {
    const m = findMember(id);
    if (m) { const arr = membersByNode.get(m.node_id); if (arr) membersByNode.set(m.node_id, arr.filter((x) => x.id !== id)); }
  });
  rebuildChildrenIndexFromNodes();
  clearSelection();
  render();
  try {
    await Promise.all([...topNodes.map((id) => deleteNode(id)), ...memToDelete.map((id) => deleteMember(id))]);
  } catch (e) {
    // Now that a blocked delete THROWS rather than resolving, this catch is
    // reachable for a real reason (no สิทธิ์, or someone else got there first).
    // console.warn alone would leave the user watching rows reappear after the
    // reload with no explanation — the same silence this whole change removes.
    console.warn('[team] bulk delete failed:', e?.message || e);
    alert(`ลบบางรายการไม่สำเร็จ: ${e?.message || 'ไม่ทราบสาเหตุ'}\n\nกำลังโหลดผังใหม่เพื่อแสดงสถานะจริง`);
    reload();
  }
}

// ============================================================
// PERMISSION MODAL (perms mode)
// ============================================================

/** Paint the perm checkbox grid into a container.
 *
 *  An `implicit` key (today only `team` — ทีม SAMO ดู) renders ticked, disabled
 *  and with a padlock: the server grants it to everyone in the tree, so a live
 *  checkbox there would be a control that silently does nothing. The reason is
 *  in the hint AND on the row, because a disabled tick with no explanation reads
 *  as a bug. `readPermInputs` drops these keys on the way out. */
function fillPermGrid(grid) {
  if (!grid) return;
  grid.innerHTML = PERM_CATALOG.map((p) => {
    const cls = ['team-perm-opt'];
    if (p.danger) cls.push('is-danger');
    if (p.implicit) cls.push('is-auto');
    return `
    <label class="${cls.join(' ')}"${p.hint ? ` title="${escHtml(p.hint)}"` : ''}>
      <input type="checkbox" value="${p.key}"${p.implicit ? ' checked disabled' : ''} />
      <span>${escHtml(p.label)}</span>
      ${p.implicit ? '<i class="bi bi-lock-fill team-perm-lock" aria-hidden="true"></i>'
    + '<span class="team-perm-auto-note">อัตโนมัติ</span>' : ''}
    </label>`;
  }).join('');
}

/**
 * `master` implies every other permission (migration 0111), so the rest of the
 * grid is shown ticked-and-locked while it is on — otherwise the form would
 * invite an admin to untick `pr` from someone who still, in fact, has pr.
 *
 * The CONFIRM is on the way IN only. The lesson this repo keeps relearning is
 * that the direction which WIDENS privilege needs the friction (the vs_categories
 * confidential toggle, the "ทุกแผนก" default at index 0); making it hard to
 * REMOVE power is the wrong way round.
 */
function syncMasterVisibility(grid) {
  if (!grid) return;
  const master = grid.querySelector('input[value="master"]');
  const on = !!master?.checked;
  const was = grid.classList.contains('is-master');

  // Turning master ON force-ticks the rest (it implies them). Turning it OFF
  // must therefore put them BACK — otherwise unticking the strongest grant
  // leaves all eight ticked and the next save hands out every permission
  // individually. The admin's action said "take this away"; the result would
  // have been "keep everything, just spelled out". Snapshot before the force,
  // restore after it.
  if (on && !was) {
    grid.dataset.preMaster = JSON.stringify(
      [...grid.querySelectorAll('input[type=checkbox]')]
        .filter((cb) => cb.value !== 'master' && cb.checked).map((cb) => cb.value),
    );
  }
  let restore = null;
  if (!on && was) {
    try { restore = new Set(JSON.parse(grid.dataset.preMaster || '[]')); } catch { restore = new Set(); }
    delete grid.dataset.preMaster;
  }

  grid.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    if (cb.value === 'master') return;
    // An IMPLICIT key is ticked-and-locked by fillPermGrid and must STAY that
    // way in both directions: `cb.disabled = on` below would clear the lock the
    // markup set whenever master is off — which is the normal case — turning
    // ทีม SAMO (ดู) back into a live checkbox that readPermInputs then ignores.
    // Unticking it made the pane claim the person has no view access.
    if (IMPLICIT_PERMS.includes(cb.value)) return;
    cb.disabled = on;
    if (on) cb.checked = true;
    else if (restore) cb.checked = restore.has(cb.value);
    cb.closest('.team-perm-opt')?.classList.toggle('is-implied', on);
  });
  grid.classList.toggle('is-master', on);
}

/**
 * Forget everything the grid remembers about master, before painting a new row.
 *
 * `is-master` and `preMaster` live on the GRID ELEMENT, which outlives the row
 * being edited — the modal is filled and re-filled from the same DOM. Without
 * this, opening a master ตำแหน่ง and then an ordinary person made
 * syncMasterVisibility see "master was on, now it is off" and RESTORE THE
 * PREVIOUS ROW'S snapshot onto the new row. The grid is what gets saved, so
 * that is not a display glitch: it would write permissions the second person
 * never had. Reproduced in a headless browser before fixing.
 */
function resetMasterState(grid) {
  if (!grid) return;
  grid.classList.remove('is-master');
  delete grid.dataset.preMaster;
}

/** Ask before handing over everything. Returns false if the admin backs out,
 *  in which case the checkbox is put back. */
function confirmMaster(cb) {
  if (!cb.checked) return true;
  const ok = window.confirm(
    'ให้สิทธิ์ “ทุกระบบ (Master)” ใช่หรือไม่?\n\n'
    + 'ผู้ที่ได้รับจะเข้าถึงได้ทุกระบบ รวมถึงแก้ไขโครงสร้างทีม SAMO '
    + 'และกำหนดสิทธิ์ของทุกคน (รวมถึงให้สิทธิ์ Master กับคนอื่น)',
  );
  if (!ok) cb.checked = false;
  return ok;
}

// Sentinel for the "all departments" VS grant. It is NOT the empty string:
// the empty value is "nothing chosen yet", so a fresh grant can never fall
// into the widest scope just by leaving the select alone (the escalating
// option must be picked on purpose — cf. the destructive-direction-toggle
// entry in .claude/rules/mistakes.md).
const VS_SCOPE_ALL = '__all__';

/** Paint the VS scope select. "" = not chosen (blocked on save);
 *  VS_SCOPE_ALL = the full `vs` grant; a dept value = that dept ONLY
 *  (and the `vs` perm is dropped on save). */
function fillVsScopeSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '<option value="">— เลือกขอบเขต —</option>'
    + `<option value="${VS_SCOPE_ALL}">ทุกแผนก (ดูแลทั้งระบบ เหมือน SE)</option>`
    + VS_DEPTS.map((d) => `<option value="${escHtml(d.value)}">เฉพาะ ${escHtml(d.label)}</option>`).join('');
}

/** Paint the หนังสือโครงการ seat select. "" = not chosen — blocked on save,
 *  because a projects grant without a seat has no working workflow. */
function fillSeatSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '<option value="">— เลือกบทบาท —</option>'
    + PROJECT_SEATS.map((x) => `<option value="${escHtml(x.value)}">${escHtml(x.label)}</option>`).join('');
}

// SAMO Passport departments + sub-departments, loaded once from
// list_passport_departments() (they live in the passport schema, whose tables
// have RLS on with no policy — a direct client read returns nothing).
let passportDepts = [];
let passportSubs = [];
const PASS_SCOPE_ALL = '__all__';

async function loadPassportDepts() {
  if (passportDepts.length) return;
  try {
    const { data, error } = await dbRest('/rpc/list_passport_departments', { method: 'POST', body: {} });
    if (error || !data) return;
    passportDepts = Array.isArray(data.departments) ? data.departments : [];
    passportSubs = Array.isArray(data.sub_departments) ? data.sub_departments : [];
  } catch { /* picker falls back to "ทุกฝ่าย" only */ }
}

/** Department select. "" = not chosen (blocked on save); PASS_SCOPE_ALL = the
 *  full `passport` grant; an id = that department (optionally narrowed by the
 *  sub-department select below it). */
function fillPassDeptSelect(sel) {
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— เลือกขอบเขต —</option>'
    + `<option value="${PASS_SCOPE_ALL}">ทุกฝ่าย (ดูแลทั้งระบบ)</option>`
    + passportDepts.map((d) => `<option value="${escHtml(String(d.id))}">${escHtml(d.name)}</option>`).join('');
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

/** Sub-department select — only rendered for departments that HAVE children
 *  (2 of 10 today), so the common case stays a single dropdown. */
function fillPassSubSelect(sel, deptId) {
  if (!sel) return;
  const kids = passportSubs.filter((x) => String(x.department_id) === String(deptId));
  if (!kids.length) { sel.innerHTML = ''; sel.classList.add('d-none'); return; }
  const prev = sel.value;
  sel.innerHTML = '<option value="">ทั้งฝ่าย (ทุกแผนกย่อย)</option>'
    + kids.map((x) => `<option value="${escHtml(String(x.id))}">เฉพาะ ${escHtml(x.name)}</option>`).join('');
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  sel.classList.remove('d-none');
}

/** Show the passport scope block only while "SAMO Passport" is ticked. */
function syncPassVisibility(grid, wrap) {
  if (!grid || !wrap) return;
  const on = !!grid.querySelector('input[value="passport"]')?.checked;
  wrap.classList.toggle('d-none', !on);
}

/** Show the VS scope block only while "VitalSound" is ticked in `grid`. */
function syncVsScopeVisibility(grid, wrap) {
  if (!grid || !wrap) return;
  const on = !!grid.querySelector('input[value="vs"]')?.checked;
  wrap.classList.toggle('d-none', !on);
}

/** Same, for the หนังสือโครงการ seat block. */
function syncSeatVisibility(grid, wrap) {
  if (!grid || !wrap) return;
  const on = !!grid.querySelector('input[value="projects"]')?.checked;
  wrap.classList.toggle('d-none', !on);
}

/** Split the modal inputs into the { permissions, vs_dept } the row stores.
 *  vs unticked          → no `vs`, no dept
 *  vs + ทุกแผนก          → `vs` (full), no dept
 *  vs + a dept          → NO `vs`, that dept (scoped — 0083)
 *  vs + nothing chosen  → null (caller must abort; see readPermInputsOrWarn) */
function readPermInputs(grid, vsSel, seatSel, passSel, passSubSel) {
  const perms = [...(grid?.querySelectorAll('input:checked') || [])]
    .map((cb) => cb.value)
    // Never store an implicit key. `input:checked` matches a DISABLED box too,
    // so the locked ทีม SAMO (ดู) tick would otherwise be written onto every row
    // the modal saves — making an implicit grant look like an explicit one that
    // someone could later untick, which is the 0083 "scope stored beside the
    // blanket key" trap. The resolver adds it; the row must not claim it.
    .filter((k) => !IMPLICIT_PERMS.includes(k));
  // `master` subsumes everything, so store it ALONE. Writing the implied keys
  // alongside it would make them look like independent grants that could be
  // unticked — the same trap as storing `vs` next to a vs_dept (0083) — and
  // would silently rot the day a new permission key is added.
  if (perms.includes('master')) {
    return {
      permissions: ['master'], vs_dept: null, project_seat: null,
      passport_dept_id: null, passport_sub_dept_id: null,
    };
  }
  const vsOn = perms.includes('vs');
  const scope = vsOn ? (vsSel?.value || '') : '';
  if (vsOn && !scope) return null;
  // A หนังสือโครงการ grant must name its seat — see PROJECT_SEATS.
  const projOn = perms.includes('projects');
  const seat = projOn ? (seatSel?.value || '') : '';
  if (projOn && !seat) return { missing: 'seat' };
  // SAMO Passport: same scoped-is-not-full rule as VitalSound — a specific
  // department/sub-department drops the blanket `passport` permission.
  const passOn = perms.includes('passport');
  const passScope = passOn ? (passSel?.value || '') : '';
  if (passOn && !passScope) return { missing: 'passport' };
  const scoped = passScope && passScope !== PASS_SCOPE_ALL;
  const passDept = scoped ? Number(passScope) : null;
  const passSub = scoped && passSubSel && !passSubSel.classList.contains('d-none')
    ? (Number(passSubSel.value) || null) : null;
  const dept = scope === VS_SCOPE_ALL ? '' : scope;
  let out = dept ? perms.filter((p) => p !== 'vs') : perms;
  if (scoped) out = out.filter((p) => p !== 'passport');
  return {
    permissions: out,
    vs_dept: dept || null,
    project_seat: seat || null,
    passport_dept_id: passDept,
    passport_sub_dept_id: passSub,
  };
}

/** readPermInputs + the two user-facing guards: a VS grant must state its
 *  scope, and "ทุกแผนก" (which hands over every department's confidential
 *  tickets) is confirmed because it is the privilege-ESCALATING direction.
 *  Returns null when the save should be aborted. */
function readPermInputsOrWarn(grid, vsSel, seatSel, passSel, passSubSel, subject) {
  const out = readPermInputs(grid, vsSel, seatSel, passSel, passSubSel);
  if (!out) {
    alert('กรุณาเลือกขอบเขต VitalSound — "ทุกแผนก" หรือเฉพาะแผนกที่รับผิดชอบ');
    vsSel?.focus();
    return null;
  }
  if (out.missing === 'passport') {
    alert('กรุณาเลือกขอบเขต SAMO Passport — "ทุกฝ่าย" หรือฝ่าย/แผนกย่อยที่ดูแล');
    passSel?.focus();
    return null;
  }
  if (out.missing === 'seat') {
    alert('กรุณาเลือกบทบาทหนังสือโครงการ — ผู้ส่ง, เจ้าหน้าที่คณะ หรือ อาจารย์ (ลงนาม)\n\n'
      + 'ถ้าไม่เลือก ผู้ใช้จะเปิดแท็บได้แต่ไม่มีปุ่มใช้งานใด ๆ');
    seatSel?.focus();
    return null;
  }
  if (out.permissions.includes('passport')
      && !confirm(`ให้สิทธิ์ SAMO Passport แบบ "ทุกฝ่าย" กับ${subject}\n\n`
        + 'จะเห็นและจัดการกิจกรรมของ "ทุกฝ่าย"\n'
        + 'ถ้าต้องการจำกัดเฉพาะฝ่ายที่ดูแล ให้กดยกเลิกแล้วเลือกฝ่ายนั้น')) {
    return null;
  }
  if (out.permissions.includes('vs')
      && !confirm(`ให้สิทธิ์ VitalSound แบบ "ทุกแผนก" กับ${subject}\n\n`
        + 'จะเห็นและจัดการเรื่องร้องเรียนของ "ทุกแผนก" (เทียบเท่า SE)\n'
        + 'ถ้าต้องการจำกัดเฉพาะแผนกที่รับผิดชอบ ให้กดยกเลิกแล้วเลือกแผนกนั้น')) {
    return null;
  }
  return out;
}

function wirePermModal() {
  const grid = $('teamPermGrid');
  fillPermGrid(grid);
  fillVsScopeSelect($('teamPermVsDept'));
  fillSeatSelect($('teamPermSeat'));
  grid?.addEventListener('change', (e) => {
    if (e.target?.value === 'master') confirmMaster(e.target);
    syncMasterVisibility(grid);
    syncVsScopeVisibility(grid, $('teamPermVsWrap'));
    syncSeatVisibility(grid, $('teamPermSeatWrap'));
    syncPassVisibility(grid, $('teamPermPassWrap'));
  });
  $('teamPermPassDept')?.addEventListener('change', () =>
    fillPassSubSelect($('teamPermPassSub'), $('teamPermPassDept').value));
  $('teamPermForm')?.addEventListener('submit', onPermSubmit);
  $('teamPermInherit')?.addEventListener('change', refreshPermInherited);
}

/** Should a permission checkbox be ticked for this row?
 *  A SCOPED grant deliberately stores no blanket permission key (0083/0087) —
 *  the binding IS the grant — so the box must be ticked from either signal.
 *  Miss this and re-opening the modal reads as "no grant", and the next save
 *  silently wipes the binding. */
export function permTicked(key, own, row) {
  // An implicit key is always on — the server grants it regardless of what the
  // row stores, and the box is disabled. Without this, re-filling the modal from
  // a row that (correctly) does not store `team` would UNTICK the locked box and
  // the pane would claim the person has no view access.
  if (IMPLICIT_PERMS.includes(key)) return true;
  if (key === 'vs') return own.has('vs') || !!row?.vs_dept;
  if (key === 'passport') {
    return own.has('passport')
      || row?.passport_dept_id != null || row?.passport_sub_dept_id != null;
  }
  return own.has(key);
}

/** Fill the สิทธิ์ pane of the ตำแหน่ง modal. Does NOT show anything — the modal
 *  is opened by openNodeModal, which decides which tab leads. */
function fillNodePermPane(id) {
  const node = nodesById.get(id);
  if (!node) return;
  $('teamPermNodeId').value = id;
  $('teamPermNodeName').textContent = nodePath(id);
  const own = new Set(node.permissions || []);
  resetMasterState($('teamPermGrid'));
  $('teamPermGrid').querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.checked = permTicked(cb.value, own, node);
  });
  $('teamPermInherit').checked = node.inherit_permissions !== false;
  if ($('teamPermVsDept')) {
    $('teamPermVsDept').value = node.vs_dept || (own.has('vs') ? VS_SCOPE_ALL : '');
  }
  if ($('teamPermSeat')) $('teamPermSeat').value = node.project_seat || '';
  loadPassportDepts().then(() => {
    fillPassDeptSelect($('teamPermPassDept'));
    const cur = node.passport_dept_id != null ? String(node.passport_dept_id)
      : (own.has('passport') ? PASS_SCOPE_ALL : '');
    if ($('teamPermPassDept')) $('teamPermPassDept').value = cur;
    fillPassSubSelect($('teamPermPassSub'), cur);
    if ($('teamPermPassSub') && node.passport_sub_dept_id != null) {
      $('teamPermPassSub').value = String(node.passport_sub_dept_id);
    }
  });
  syncMasterVisibility($('teamPermGrid'));
  syncVsScopeVisibility($('teamPermGrid'), $('teamPermVsWrap'));
  syncSeatVisibility($('teamPermGrid'), $('teamPermSeatWrap'));
  syncPassVisibility($('teamPermGrid'), $('teamPermPassWrap'));
  refreshPermInherited();
}

/** Open the ตำแหน่ง editor straight on its สิทธิ์ tab. */
function openPermModal(id) {
  const node = nodesById.get(id);
  if (node) openNodeModal({ node, tab: 'perm' });
}

function refreshPermInherited() {
  const id = $('teamPermNodeId').value;
  const inheritOn = $('teamPermInherit').checked;
  const wrap = $('teamPermInheritedWrap');
  const list = $('teamPermInheritedList');
  if (wrap && list && id) {
    const set = inheritedPermsFor(id, inheritOn);
    if (set.size) {
      list.innerHTML = [...set].map((p) => `<span class="team-perm-chip is-inherited">${escHtml(PERM_LABEL[p] || p)}</span>`).join(' ');
      wrap.classList.remove('d-none');
    } else wrap.classList.add('d-none');
  }
  // Inherited project-seat preview
  const sw = $('teamPermSeatInheritedWrap');
  const sl = $('teamPermSeatInheritedList');
  if (sw && sl && id) {
    const set = inheritedSeatsFor(id, inheritOn);
    if (set.size) {
      sl.innerHTML = [...set].map((x) => `<span class="team-perm-chip is-seat is-inherited">${escHtml(PROJECT_SEAT_LABEL[x] || x)}</span>`).join(' ');
      sw.classList.remove('d-none');
    } else sw.classList.add('d-none');
  }
  // Inherited VS depts preview
  const vw = $('teamPermVsInheritedWrap');
  const vl = $('teamPermVsInheritedList');
  if (vw && vl && id) {
    const set = inheritedVsDeptsFor(id, inheritOn);
    if (set.size) {
      vl.innerHTML = [...set].map((d) => `<span class="team-perm-chip is-vs is-inherited">${escHtml(VS_DEPT_LABEL[d] || d)}</span>`).join(' ');
      vw.classList.remove('d-none');
    } else vw.classList.add('d-none');
  }
}

async function onPermSubmit(e) {
  e.preventDefault();
  const id = $('teamPermNodeId').value;
  const node = nodesById.get(id);
  if (!node) return;
  const grants = readPermInputsOrWarn($('teamPermGrid'), $('teamPermVsDept'), $('teamPermSeat'),
    $('teamPermPassDept'), $('teamPermPassSub'), `ตำแหน่ง "${node.name}"`);
  if (!grants) return;
  const payload = { ...grants, inherit_permissions: $('teamPermInherit').checked };
  // The สิทธิ์ pane lives inside the ตำแหน่ง modal since 0110.
  modalInstance('teamNodeModal')?.hide();
  Object.assign(node, payload);
  render();
  try { await updateNode(id, payload); } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); reload(); }
}

// ============================================================
// สาขา VOCABULARY (migration 0113)
//
// Free-text สาขา produced `MD`, `md` and `M.D.` for one answer, which the
// ตรวจสอบข้อมูล pane then reported as a `drift` finding about nothing. The
// choosers below are filled from `team_majors`, and this is the CRUD the user
// asked for ("add, edit, remove สาขา names").
//
// THE ONE THING TO KNOW BEFORE EDITING: the list is a VOCABULARY, not a foreign
// key — `team_members.major` is still plain text. So REMOVE only shrinks the
// picker (every person keeps the value they had, and the pane will report it as
// off-list), while RENAME is a real data edit and backfills the people who carry
// the old code. Both say how many rows they touch before doing it.
// ============================================================

async function loadMajors(force = false) {
  if (majors.length && !force) return majors;
  try {
    majors = await fetchMajors();
  } catch (e) {
    console.warn('[team] majors load failed:', e?.message || e);
  }
  return majors;
}

/** Fill a สาขา select. `current` is kept as an extra option when it is not in
 *  the vocabulary — the alternative is a select that silently REWRITES an
 *  off-list value the moment someone saves an unrelated field on that row. */
function fillMajorSelect(sel, current) {
  if (!sel) return;
  const cur = String(current ?? '').trim();
  const known = majors.some((m) => majorKey(m.code) === majorKey(cur));
  sel.innerHTML = '<option value="">— ไม่ระบุ —</option>'
    + majors.map((m) => `<option value="${escHtml(m.code)}">${escHtml(m.code)}${
      m.label ? ` — ${escHtml(m.label)}` : ''}</option>`).join('')
    + (cur && !known
      ? `<option value="${escHtml(cur)}">${escHtml(cur)} (ไม่อยู่ในรายการ)</option>` : '');
  sel.value = cur;
}

/** Fill a ชั้นปี select the same way, from fields.js YEARS. */
function fillYearSelect(sel, current) {
  if (!sel) return;
  const cur = String(current ?? '').trim();
  const known = YEARS.includes(cur);
  sel.innerHTML = '<option value="">— ไม่ระบุ —</option>'
    + YEARS.map((y) => `<option value="${y}">ปี ${y}</option>`).join('')
    + (cur && !known
      ? `<option value="${escHtml(cur)}">${escHtml(cur)} (ไม่อยู่ในรายการ)</option>` : '');
  sel.value = cur;
}

function wireMajors() {
  $('teamMemberMajorsManage')?.addEventListener('click', openMajorsModal);
  $('teamMajorsAdd')?.addEventListener('submit', onMajorAdd);
  $('teamMajorsList')?.addEventListener('click', onMajorsListClick);
}

async function openMajorsModal() {
  await loadMajors(true);
  await renderMajorsList();
  // Stacks ON TOP of the member editor (same as the picker and the crop dialog),
  // so getOrCreateInstance — a fresh bootstrap.Modal on an already-open modal
  // leaves a backdrop nothing clears (mistakes log).
  modalInstance('teamMajorsModal')?.show();
}

/** The list, with a live count of how many people carry each code — that count
 *  is the whole reason this pane is safe to use: it turns "remove RT" from a
 *  guess into "remove RT, which 19 people still have". */
async function renderMajorsList() {
  const host = $('teamMajorsList');
  if (!host) return;
  host.innerHTML = '<div class="text-muted small">กำลังนับจำนวนสมาชิก…</div>';
  const counts = new Map();
  await Promise.all(majors.map(async (m) => {
    try { counts.set(m.id, await countMembersWithMajor(m.code)); } catch { counts.set(m.id, null); }
  }));
  if (!majors.length) {
    host.innerHTML = '<div class="text-muted small">ยังไม่มีสาขาในรายการ</div>';
    return;
  }
  host.innerHTML = majors.map((m) => {
    const n = counts.get(m.id);
    return `
    <div class="team-major-row" data-major-id="${escHtml(m.id)}">
      <div class="team-major-main">
        <span class="team-major-code">${escHtml(m.code)}</span>
        ${m.label ? `<span class="team-major-label">${escHtml(m.label)}</span>` : ''}
      </div>
      <span class="team-major-count">${n == null ? '—' : `${n} คน`}</span>
      <button type="button" class="team-act" data-major-act="rename" title="เปลี่ยนชื่อ">
        <i class="bi bi-pencil"></i></button>
      <button type="button" class="team-act team-act-danger" data-major-act="delete" title="ลบออกจากรายการ">
        <i class="bi bi-trash"></i></button>
    </div>`;
  }).join('');
}

async function onMajorAdd(e) {
  e.preventDefault();
  const codeEl = $('teamMajorsNewCode');
  const labelEl = $('teamMajorsNewLabel');
  const code = codeEl.value.trim();
  if (!code) { codeEl.focus(); return; }
  if (majors.some((m) => majorKey(m.code) === majorKey(code))) {
    alert(`“${code}” อยู่ในรายการแล้ว`);
    return;
  }
  try {
    await createMajor({
      code, label: labelEl.value.trim() || null,
      position: (majors[majors.length - 1]?.position ?? 0) + 1,
    });
    codeEl.value = '';
    labelEl.value = '';
    await loadMajors(true);
    await renderMajorsList();
    refreshMajorPickers();
  } catch (err) { alert(err?.message || 'เพิ่มสาขาไม่สำเร็จ'); }
}

async function onMajorsListClick(e) {
  const btn = e.target.closest('[data-major-act]');
  if (!btn) return;
  const id = btn.closest('[data-major-id]')?.dataset.majorId;
  const m = majors.find((x) => x.id === id);
  if (!m) return;
  if (btn.dataset.majorAct === 'rename') await renameMajor(m);
  else await removeMajor(m);
}

async function renameMajor(m) {
  const next = prompt(`เปลี่ยนชื่อสาขา “${m.code}” เป็น`, m.code);
  if (next == null) return;
  const code = next.trim();
  if (!code || code === m.code) return;
  if (majors.some((x) => x.id !== m.id && majorKey(x.code) === majorKey(code))) {
    alert(`“${code}” อยู่ในรายการแล้ว`);
    return;
  }
  let n = 0;
  try { n = await countMembersWithMajor(m.code); } catch { /* shown as unknown below */ }
  if (!confirm(`เปลี่ยน “${m.code}” เป็น “${code}”\n\n`
    + `จะแก้ข้อมูลสาขาของสมาชิก ${n} คนด้วย`)) return;
  try {
    // The PEOPLE first. If the vocabulary row were renamed first and this failed,
    // the list would say `code` while 348 rows still said `m.code` — i.e. every
    // one of them would read as "off-list" until someone noticed.
    await renameMajorOnMembers(m.code, code);
    await updateMajor(m.id, { code });
    await loadMajors(true);
    await renderMajorsList();
    refreshMajorPickers();
    reload();
  } catch (err) { alert(err?.message || 'เปลี่ยนชื่อไม่สำเร็จ'); }
}

async function removeMajor(m) {
  let n = 0;
  try { n = await countMembersWithMajor(m.code); } catch { /* shown as unknown below */ }
  const warn = n
    ? `\n\nสมาชิก ${n} คนยังมีสาขา “${m.code}” อยู่ — ข้อมูลของพวกเขาจะไม่เปลี่ยน `
      + 'แต่จะขึ้นว่า “ไม่อยู่ในรายการ” จนกว่าจะแก้ให้เป็นสาขาอื่น'
    : '';
  if (!confirm(`ลบ “${m.code}” ออกจากรายการสาขา?${warn}`)) return;
  try {
    await deleteMajor(m.id);
    await loadMajors(true);
    await renderMajorsList();
    refreshMajorPickers();
  } catch (err) { alert(err?.message || 'ลบไม่สำเร็จ'); }
}

/** Repaint any สาขา chooser that is currently on screen, keeping its value. */
function refreshMajorPickers() {
  const sel = $('teamMemberMajor');
  if (sel) fillMajorSelect(sel, sel.value);
}

// ============================================================
// MEMBER MODAL
// ============================================================

/**
 * Fill the member form from ระบบบ้าน, by kkumail.
 *
 * ASKED FOR: "when adding people in teamsamo … they should can use the data
 * from house system". The two tables hold the same fields for the same humans
 * and both key on kkumail (0108), so retyping is not just tedious — it is where
 * the two copies start disagreeing, and ตรวจสอบข้อมูล then reports a `drift`
 * finding about a difference a human introduced by hand.
 *
 * ONLY FILLS WHAT IS EMPTY. Overwriting a box someone has already typed in
 * would make this button destructive, and an admin correcting a name that
 * ระบบบ้าน has wrong is a legitimate thing to be doing. What it does say is
 * which fields it left alone, so "it didn't work" and "it deliberately kept
 * yours" are distinguishable.
 *
 * ชั้นปี is NOT filled. ระบบบ้าน has no ชั้นปี — it has รุ่น, which needs no clock
 * (see house/fields.js cohortLabel) — and deriving one here would put this
 * app's third implementation of that rule in a click handler.
 */
async function onFillFromHouse() {
  const hint = $('teamMemberHouseFillHint');
  const btn = $('teamMemberFillFromHouse');
  const say = (msg, cls = '') => { if (hint) { hint.textContent = msg; hint.className = `form-text ${cls}`; } };
  const mail = $('teamMemberEmail').value.trim();
  if (!mail) { say('พิมพ์ kkumail ก่อน แล้วกดปุ่มนี้อีกครั้ง', 'text-warning'); $('teamMemberEmail').focus(); return; }
  if (btn) btn.disabled = true;
  say('กำลังค้นจากระบบบ้าน…');
  try {
    const rec = await lookupStudentByKkumail(mail);
    if (!rec) { say(`ไม่พบ ${mail} ในระบบบ้าน — กรอกเองได้ตามปกติ`, 'text-warning'); return; }
    const filled = [];
    const kept = [];
    const put = (id, value, label) => {
      const el = $(id);
      if (!el || !value) return;
      if (String(el.value || '').trim()) { kept.push(label); return; }
      el.value = value;
      filled.push(label);
    };
    put('teamMemberName', rec.full_name, 'ชื่อ-สกุล');
    put('teamMemberNickname', rec.nickname, 'ชื่อเล่น');
    put('teamMemberStudentId', rec.student_id, 'รหัสนักศึกษา');
    // สาขา is a chooser, so it is set through the same filler the modal uses —
    // an off-list value is kept as its own option rather than silently dropped.
    const majorSel = $('teamMemberMajor');
    if (majorSel && rec.major && !String(majorSel.value || '').trim()) {
      await loadMajors();
      fillMajorSelect(majorSel, rec.major);
      filled.push('สาขา');
    } else if (rec.major && majorSel?.value) kept.push('สาขา');

    say([
      filled.length ? `เติมให้แล้ว: ${filled.join(' · ')}` : 'ไม่มีช่องว่างให้เติม',
      kept.length ? `คงของเดิมไว้: ${kept.join(' · ')}` : '',
    ].filter(Boolean).join(' — '), filled.length ? 'text-success' : '');
  } catch (err) {
    say(err?.message || 'ค้นจากระบบบ้านไม่สำเร็จ', 'text-danger');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function wireMemberModal() {
  $('teamMemberForm')?.addEventListener('submit', onMemberSubmit);
  $('teamMemberFillFromHouse')?.addEventListener('click', onFillFromHouse);
  $('teamMemberPhotoFile')?.addEventListener('change', onMemberPhotoPick);
  $('teamMemberPhotoClear')?.addEventListener('click', () => {
    // Dropping a PENDING pick must also drop the pick, not just the stored URL —
    // otherwise นำรูปออก appears to work and the save uploads the picked file.
    clearPendingPhoto();
    setMemberPhoto('');
    const hint = $('teamMemberPhotoHint');
    if (hint) hint.textContent = PHOTO_HINT_DEFAULT;
  });
  $('teamMemberDelete')?.addEventListener('click', () => {
    const id = $('teamMemberId').value;
    if (id) { modalInstance('teamMemberModal')?.hide(); onDeleteMember(id); }
  });
  // The node selector opens the searchable picker (the member modal stays open
  // underneath; we just stamp the choice into the hidden input + label).
  $('teamMemberNodeBtn')?.addEventListener('click', () => {
    openPicker({
      title: 'เลือกตำแหน่ง', currentId: $('teamMemberNodeId').value || null,
      onPick: (target) => { if (target) setMemberNode(target); },
    });
  });
}

function setMemberNode(nid) {
  $('teamMemberNodeId').value = nid || '';
  const label = $('teamMemberNodeLabel');
  if (label) {
    label.textContent = nid ? nodePath(nid) : 'เลือกตำแหน่ง…';
    label.classList.toggle('text-muted', !nid);
  }
}

// ============================================================
// MEMBER PERMISSION MODAL (perms mode — สิทธิ์รายบุคคล)
// ============================================================

function wireMemberPermModal() {
  const grid = $('teamMPermGrid');
  fillPermGrid(grid);
  fillVsScopeSelect($('teamMPermVsDept'));
  fillSeatSelect($('teamMPermSeat'));
  grid?.addEventListener('change', (e) => {
    if (e.target?.value === 'master') confirmMaster(e.target);
    syncMasterVisibility(grid);
    refreshMemberPermEff();
  });
  $('teamMPermPassDept')?.addEventListener('change', () => {
    fillPassSubSelect($('teamMPermPassSub'), $('teamMPermPassDept').value);
    refreshMemberPermEff();
  });
  $('teamMPermVsDept')?.addEventListener('change', refreshMemberPermEff);
  $('teamMPermSeat')?.addEventListener('change', refreshMemberPermEff);
  $('teamMPermInherit')?.addEventListener('change', refreshMemberPermEff);
  $('teamMPermForm')?.addEventListener('submit', onMemberPermSubmit);
}

/** Fill the สิทธิ์ pane of the สมาชิก modal. Does NOT show anything. */
function fillMemberPermPane(memberId) {
  const m = findMember(memberId);
  if (!m) return;
  $('teamMPermMemberId').value = m.id;
  $('teamMPermName').textContent = m.full_name || '';
  $('teamMPermNode').textContent = nodePath(m.node_id);
  const own = new Set(m.permissions || []);
  resetMasterState($('teamMPermGrid'));
  $('teamMPermGrid')?.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.checked = permTicked(cb.value, own, m);
  });
  if ($('teamMPermVsDept')) {
    $('teamMPermVsDept').value = m.vs_dept || (own.has('vs') ? VS_SCOPE_ALL : '');
  }
  if ($('teamMPermSeat')) $('teamMPermSeat').value = m.project_seat || '';
  loadPassportDepts().then(() => {
    fillPassDeptSelect($('teamMPermPassDept'));
    const cur = m.passport_dept_id != null ? String(m.passport_dept_id)
      : (own.has('passport') ? PASS_SCOPE_ALL : '');
    if ($('teamMPermPassDept')) $('teamMPermPassDept').value = cur;
    fillPassSubSelect($('teamMPermPassSub'), cur);
    if ($('teamMPermPassSub') && m.passport_sub_dept_id != null) {
      $('teamMPermPassSub').value = String(m.passport_sub_dept_id);
    }
    refreshMemberPermEff();
  });
  $('teamMPermInherit').checked = m.inherit_permissions !== false;
  refreshMemberPermEff();
}

/** Open the สมาชิก editor straight on its สิทธิ์ tab. */
function openMemberPermModal(memberId) {
  const m = findMember(memberId);
  if (m) openMemberModal({ member: m, tab: 'perm' });
}

/** Effective perms + VS scope the member-perm modal is about to grant, from
 *  live inputs: own picks ∪ (inherit ? the member's node effective grants). */
function refreshMemberPermEff() {
  syncMasterVisibility($('teamMPermGrid'));
  syncVsScopeVisibility($('teamMPermGrid'), $('teamMPermVsWrap'));
  syncSeatVisibility($('teamMPermGrid'), $('teamMPermSeatWrap'));
  syncPassVisibility($('teamMPermGrid'), $('teamMPermPassWrap'));
  const wrap = $('teamMPermEffWrap');
  const list = $('teamMPermEffList');
  if (!wrap || !list) return;
  const m = findMember($('teamMPermMemberId').value);
  // Preview only — a not-yet-chosen scope shows the perms without a VS chip.
  const { permissions, vs_dept: vsDept, project_seat: seat } =
    readPermInputs($('teamMPermGrid'), $('teamMPermVsDept'), $('teamMPermSeat'),
      $('teamMPermPassDept'), $('teamMPermPassSub'))
    || { permissions: [], vs_dept: null, project_seat: null };
  const set = new Set(permissions);
  const vsSet = new Set(vsDept ? [vsDept] : []);
  // A seat the person picked REPLACES the one their ตำแหน่ง would give them
  // (0092) — so the preview must not add the inherited seat on top, or the
  // admin is shown "เจ้าหน้าที่คณะ ผู้ส่งหนังสือ" for a grant that resolves to
  // เจ้าหน้าที่คณะ alone.
  const seatSet = new Set(seat ? [seat] : []);
  if (m && $('teamMPermInherit')?.checked) {
    nodeEffectivePerms(m.node_id).forEach((p) => set.add(p));
    nodeEffectiveVsDepts(m.node_id).forEach((d) => vsSet.add(d));
    if (!seat) nodeEffectiveSeats(m.node_id).forEach((x) => seatSet.add(x));
  }
  let html = [...set].map((p) => `<span class="team-perm-chip">${escHtml(PERM_LABEL[p] || p)}</span>`).join(' ');
  // A dept chip only means anything when it isn't already swallowed by full VS.
  if (!set.has('vs')) {
    html += ' ' + [...vsSet].map((d) => `<span class="team-perm-chip is-vs"><i class="bi bi-soundwave"></i> ${escHtml(VS_DEPT_LABEL[d] || d)}</span>`).join(' ');
  }
  html += ' ' + [...seatSet].map((x) => `<span class="team-perm-chip is-seat"><i class="bi bi-file-earmark-text"></i> ${escHtml(PROJECT_SEAT_LABEL[x] || x)}</span>`).join(' ');
  if (set.size || (!set.has('vs') && vsSet.size) || seatSet.size) {
    list.innerHTML = html;
    wrap.classList.remove('d-none');
  } else wrap.classList.add('d-none');
}

async function onMemberPermSubmit(e) {
  e.preventDefault();
  const id = $('teamMPermMemberId').value;
  const m = findMember(id);
  if (!m) return;
  const grants = readPermInputsOrWarn($('teamMPermGrid'), $('teamMPermVsDept'), $('teamMPermSeat'),
    $('teamMPermPassDept'), $('teamMPermPassSub'), `"${m.full_name}"`);
  if (!grants) return;
  const payload = { ...grants, inherit_permissions: $('teamMPermInherit').checked };
  // The สิทธิ์ pane lives inside the สมาชิก modal since 0110.
  modalInstance('teamMemberModal')?.hide();
  Object.assign(m, payload);
  render();
  try { await updateMember(id, payload); } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); reload(); }
}

function openMemberModal({ member = null, nodeId = null, tab = 'info' } = {}) {
  const nid = member?.node_id || nodeId || '';
  $('teamMemberId').value = member?.id || '';
  setMemberNode(nid);
  $('teamMemberName').value = member?.full_name || '';
  $('teamMemberNickname').value = member?.nickname || '';
  $('teamMemberStudentId').value = member?.student_id || '';
  const sidHint = $('teamMemberStudentIdHint');
  if (sidHint) sidHint.textContent = SID_HINT;
  fillYearSelect($('teamMemberYear'), member?.year || '');
  // The vocabulary may not be loaded yet on the very first open; paint what we
  // have, then repaint when it arrives. Painting nothing would show an empty
  // chooser next to a person who HAS a สาขา, which reads as data loss.
  fillMajorSelect($('teamMemberMajor'), member?.major || '');
  loadMajors().then(() => fillMajorSelect($('teamMemberMajor'), member?.major || ''));
  $('teamMemberEmail').value = member?.kkumail || '';
  const fillHint = $('teamMemberHouseFillHint');
  if (fillHint) { fillHint.textContent = ''; fillHint.className = 'form-text'; }
  $('teamMemberConfirmed').checked = !!member?.confirmed;
  // A pick left pending by a previous open must not follow the next person into
  // the editor — the modal is one DOM element reused for every row, which is
  // exactly how the permission grid leaked state across rows in 0110.
  clearPendingPhoto();
  const photoHint = $('teamMemberPhotoHint');
  if (photoHint) photoHint.textContent = PHOTO_HINT_DEFAULT;
  // Carried, not edited. A photo uploaded through the crop dialog is already 3:4
  // so its focus is 'center'; an older row keeps whatever it had until someone
  // re-uploads, and editing an unrelated field must not silently re-frame it.
  // Set BEFORE setMemberPhoto — the preview reads it.
  memberPhotoFocus = member?.photo_focus || 'center';
  setMemberPhoto(member?.photo_url || '');
  $('teamMemberModalTitle').textContent = member ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก';
  $('teamMemberDelete').classList.toggle('d-none', !member);
  // One modal, two tabs (0110). A member who has not been saved yet has no row
  // for a grant to hang on, so the สิทธิ์ tab is disabled until they exist.
  if (member) fillMemberPermPane(member.id);
  showTeamModal('teamMemberModal', member ? tab : 'info', !!member);
  if (tab !== 'perm') setTimeout(() => $('teamMemberName')?.focus(), 250);
}

/**
 * The framed-but-not-yet-uploaded portrait, or null.
 *
 * THE BUG THIS FIXES (reported: "when there's already a picture of me uploaded
 * on teamsamo and i press upload files, and upload it without pressing the
 * นำรูปออก, the drive now store both files"). The old flow uploaded on PICK.
 * Every intermediate choice therefore became a real Drive file, and only the
 * last one ended up in the row — so picking twice, or picking once and then
 * closing the editor, left files nothing would ever reference. The delete side
 * could not clean them up either: it trashes the photo the DB was POINTING AT,
 * which is exactly the file that is NOT the orphan.
 *
 * Now nothing leaves the browser until บันทึก. Cancel costs nothing, re-picking
 * costs nothing, and there is exactly one upload per saved change — so the only
 * file in Drive that no row references is one whose save failed mid-flight.
 */
let memberPhotoPending = null;   // { file, previewUrl }

/** Drop a pending pick and release its blob URL. Called when the editor opens,
 *  when the pick is replaced, and after a successful save — a revoked-late blob
 *  is a leak the browser keeps for the life of the document. */
function clearPendingPhoto() {
  if (memberPhotoPending?.previewUrl) URL.revokeObjectURL(memberPhotoPending.previewUrl);
  memberPhotoPending = null;
}

/** Paint the preview from a URL (or the empty state) and sync the hidden input. */
function setMemberPhoto(url) {
  const hidden = $('teamMemberPhotoUrl');
  const prev = $('teamMemberPhotoPreview');
  const clear = $('teamMemberPhotoClear');
  if (hidden) hidden.value = url || '';
  if (clear) clear.classList.toggle('d-none', !url && !memberPhotoPending);
  if (!prev) return;
  // A pending pick wins the preview: it is what บันทึก is about to publish, and
  // showing the OLD portrait next to "รูปใหม่ (ยังไม่บันทึก)" is the kind of
  // half-truth that makes someone press upload a second time.
  if (memberPhotoPending) {
    prev.innerHTML = `<img src="${escHtml(memberPhotoPending.previewUrl)}" alt="" />`;
    return;
  }
  if (url) {
    // portraitSrc, NOT convertDriveUrl(url, 320): convertDriveUrl returns an
    // ALREADY-lh3 URL untouched, so its `size` argument is silently ignored for
    // exactly the rows this app writes — the preview was asking for 320px and
    // being handed the stored =w1200. portraitSrc rebuilds the option string
    // from the file id, so the thumbnail is a thumbnail. It also rewrites the
    // legacy drive.google.com/thumbnail form, which intermittently fails to load
    // on iOS Safari (mistakes.md).
    // A legacy row may still carry top/bottom; the preview must show the same
    // framing the card will, or it is quietly lying about what will publish.
    const pos = focusToObjectPosition(memberPhotoFocus);
    prev.innerHTML = `<img src="${escHtml(portraitSrc(url, 168, memberPhotoFocus))}"`
      + ` alt="" loading="lazy"`
      + `${memberPhotoFocus === 'center' ? '' : ` style="object-position:${pos}"`} />`;
  } else {
    prev.innerHTML = '<span class="team-photo-empty"><i class="bi bi-person"></i></span>';
  }
}

/** Walk to the root ฝ่าย so the Drive folder groups a person under the division
 *  a human would look for them in, not their immediate sub-ตำแหน่ง. */
function rootDeptName(nodeId) {
  let cur = nodesById.get(nodeId);
  while (cur && cur.parent_id && nodesById.get(cur.parent_id)) cur = nodesById.get(cur.parent_id);
  return cur?.name || 'ทั่วไป';
}

const PHOTO_HINT_DEFAULT =
  'แสดงบนหน้าโครงสร้างองค์กรที่เปิดให้บุคคลทั่วไปดูได้ — ใช้รูปที่เจ้าตัวยินยอมให้เผยแพร่';

/** Pick + frame a portrait. Nothing is uploaded here — see memberPhotoPending. */
async function onMemberPhotoPick(e) {
  const picked = e.target.files?.[0];
  if (!picked) return;
  const hint = $('teamMemberPhotoHint');
  const input = e.target;
  let file;
  try {
    file = await cropImage(picked, {
      title: 'ปรับกรอบรูปประจำตัว',
      hint: 'กรอบนี้คือสิ่งที่แสดงบนหน้าโครงสร้างองค์กร — ลากให้ใบหน้าอยู่กลางกรอบ',
    });
  } catch (err) {
    alert('เปิดรูปไม่สำเร็จ: ' + (err?.message || err));
  }
  // Clear the file input either way, or re-picking the SAME file fires no change
  // event and the crop dialog silently does not re-open.
  input.value = '';
  if (!file) return;
  clearPendingPhoto();
  memberPhotoPending = { file, previewUrl: URL.createObjectURL(file) };
  // The uploaded frame IS 3:4, so lh3's server-side centre crop is exact: no
  // head is cut and the card fetches ~38 KB instead of ~78 KB.
  memberPhotoFocus = 'center';
  setMemberPhoto($('teamMemberPhotoUrl').value);
  if (hint) hint.textContent = 'รูปใหม่ยังไม่ถูกบันทึก — กดบันทึกเพื่ออัปโหลด หรือปิดหน้าต่างเพื่อยกเลิก';
}

/** Upload the pending pick, if there is one, and return the URL to store.
 *  Runs from the submit handler — BEFORE the modal closes — so a failure can
 *  still be reported into the form the person is looking at. */
async function uploadPendingPhoto(nodeId) {
  if (!memberPhotoPending) return { url: $('teamMemberPhotoUrl').value.trim() || null };
  const hint = $('teamMemberPhotoHint');
  // The downscale happens before the network call and is the slow part on a
  // phone, so say "processing" rather than "uploading" up front.
  if (hint) hint.textContent = 'กำลังย่อและอัปโหลดรูป…';
  // `order` is only the numeric prefix on the Drive filename, so a person can
  // be found by browsing the folder. For an EXISTING member that is their own
  // position — `membersOf().length` would file the first of five people as
  // "05-", which is exactly backwards. A new member really is going on the end.
  const editingId = $('teamMemberId').value;
  const editing = editingId ? findMember(editingId) : null;
  const res = await uploadTeamPhoto(memberPhotoPending.file, {
    year: currentTermYear || 'unsorted',
    dept: rootDeptName(nodeId),
    order: editing ? (editing.position ?? 0) : membersOf(nodeId).length,
    name: $('teamMemberName').value.trim() || 'member',
  });
  // Surface the un-organised fallback instead of hiding it — the file DID
  // upload, but into PR/ with no folder structure, which is the exact thing
  // uploadTeamPhoto exists to fix. Silence here would mean nobody notices the
  // GAS project still needs redeploying.
  if (!res.organised) {
    alert('อัปโหลดรูปแล้ว แต่ยังไม่ได้จัดโฟลเดอร์ (ต้อง redeploy Apps Script)');
  }
  return res;
}

async function onMemberSubmit(e) {
  e.preventDefault();
  const id = $('teamMemberId').value;
  const nodeId = $('teamMemberNodeId').value;
  const name = $('teamMemberName').value.trim();
  if (!name) { $('teamMemberName').focus(); return; }
  if (!nodeId) { alert('กรุณาเลือกตำแหน่ง'); return; }

  // Canonicalise รหัสนักศึกษา / ชั้นปี / สาขา through the one rule module. A
  // รหัส that cannot be read is REFUSED — but only when this save changed it,
  // because two live rows carry an unfixable legacy id and holding an unrelated
  // nickname edit hostage to somebody else's typo just teaches people to avoid
  // the form.
  const stored = id ? findMember(id) : null;
  const typedSid = $('teamMemberStudentId').value;
  const fields = normalizeIdentityFields({
    student_id: typedSid,
    year: $('teamMemberYear').value,
    major: $('teamMemberMajor').value,
  }, majorCodes());
  const sidProblem = fields.problemFor('student_id');
  if (sidProblem && String(stored?.student_id ?? '') !== String(typedSid ?? '').trim()) {
    alert(sidProblem.message);
    $('teamMemberStudentId').focus();
    return;
  }

  const payload = {
    full_name: name,
    nickname: $('teamMemberNickname').value.trim() || null,
    student_id: fields.student_id,
    year: fields.year,
    major: fields.major,
    kkumail: $('teamMemberEmail').value.trim() || null,
    confirmed: $('teamMemberConfirmed').checked,
    photo_url: $('teamMemberPhotoUrl').value.trim() || null,
    photo_focus: memberPhotoFocus || 'center',
  };

  // THE PHOTO UPLOAD HAPPENS HERE, not on pick (see memberPhotoPending). The
  // modal therefore stays open — and the submit button stays busy — until the
  // bytes are in Drive, because closing first would leave a failure with nowhere
  // to be reported and an orphan file with nothing pointing at it.
  const submitBtn = $('teamMemberModalSave');
  if (memberPhotoPending) {
    const label = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'กำลังอัปโหลดรูป…'; }
    try {
      const res = await uploadPendingPhoto(nodeId);
      payload.photo_url = res.url || null;
      clearPendingPhoto();
    } catch (err) {
      alert('อัปโหลดรูปไม่สำเร็จ: ' + (err?.message || err));
      const hint = $('teamMemberPhotoHint');
      if (hint) hint.textContent = 'อัปโหลดไม่สำเร็จ — ลองกดบันทึกอีกครั้ง หรือเลือกรูปใหม่';
      return;   // nothing saved, nothing uploaded, the pick is still pending
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = label; }
    }
  }

  modalInstance('teamMemberModal')?.hide();
  // Snapshot the photo BEFORE Object.assign overwrites it. Cleared or replaced
  // portraits are trashed AFTER the write lands, never on the นำรูปออก click —
  // deleting there would destroy a photo the DB still points at if the admin
  // then cancels.
  const prevPhoto = id ? (findMember(id)?.photo_url || '') : '';
  try {
    if (id) {
      const m = findMember(id);
      const movedNode = m && m.node_id !== nodeId;
      if (m) Object.assign(m, payload);
      if (movedNode) { payload.node_id = nodeId; m.node_id = nodeId; rebuildMembersIndex(); }
      render();
      await updateMember(id, movedNode ? { ...payload, node_id: nodeId } : payload);
    } else {
      payload.node_id = nodeId;
      payload.position = membersOf(nodeId).length;
      const row = await createMember(payload);
      if (!membersByNode.has(nodeId)) membersByNode.set(nodeId, []);
      membersByNode.get(nodeId).push(row);
      expanded.add(nodeId);
      render();
    }
    if (prevPhoto && prevPhoto !== (payload.photo_url || '')) {
      deleteTeamPhotoIfUnused(prevPhoto);
    }
  } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); reload(); }
}

async function onDeleteMember(id) {
  const m = findMember(id);
  // A miss here means the DOM row outlived the model it was rendered from — the
  // click is real, so returning in silence looks exactly like a dead button (it
  // is one of the two ways this handler can do nothing at all; the other is a
  // `confirm()` the browser has suppressed). Say so and resync.
  if (!m) {
    alert('ไม่พบข้อมูลสมาชิกนี้ในหน้าจอปัจจุบัน — กำลังโหลดผังใหม่ แล้วลองอีกครั้ง');
    reload();
    return;
  }
  if (!confirm(`ลบสมาชิก “${m.full_name}” ?`)) return;
  const photo = m.photo_url || '';
  const arr = membersByNode.get(m.node_id);
  if (arr) membersByNode.set(m.node_id, arr.filter((x) => x.id !== id));
  render();
  try {
    await deleteMember(id);
    // Only now is the row actually gone, so the ref-count can tell the truth.
    if (photo) deleteTeamPhotoIfUnused(photo);
  } catch (e) { alert(e?.message || 'ลบไม่สำเร็จ'); reload(); }
}

// ============================================================
// IMPORT / EXPORT
// ============================================================

function allNodesFlat() { return [...nodesById.values()]; }
function allMembersFlat() { const out = []; for (const arr of membersByNode.values()) out.push(...arr); return out; }

function downloadBlob(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wireIO() {
  $('teamExportJson')?.addEventListener('click', () => {
    const data = buildExportJson(allNodesFlat(), allMembersFlat());
    downloadBlob(`samo-team-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
  });
  $('teamExportCsv')?.addEventListener('click', () => {
    const rows = allMembersFlat().map((m) => ({
      path: nodePath(m.node_id).split(' / ').join(PATH_SEP),
      full_name: m.full_name, nickname: m.nickname,
      student_id: m.student_id, year: m.year, major: m.major,
      kkumail: m.kkumail, confirmed: m.confirmed,
    }));
    // ﻿ BOM so Excel opens Thai UTF-8 correctly.
    downloadBlob(`samo-team-members-${stamp()}.csv`, '﻿' + buildMembersCsv(rows), 'text/csv;charset=utf-8');
  });

  $('teamImportOpen')?.addEventListener('click', () => {
    $('teamImportText').value = '';
    $('teamImportFile').value = '';
    setImportStatus('');
    resetImportView();
    // Prime the สาขา vocabulary before anyone pastes a CSV — planMembersCsv()
    // canonicalises through it, and an empty list would silently degrade every
    // สาขา in the file to "keep as typed".
    loadMajors();
    modalInstance('teamImportModal')?.show();
  });
  $('teamImportFile')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (f) $('teamImportText').value = await f.text();
  });
  $('teamImportRun')?.addEventListener('click', runImport);

  // Conflict resolver: per-card keep/replace toggle + bulk buttons.
  $('teamImportConflictList')?.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-choice]');
    if (!opt) return;
    const card = opt.closest('[data-conflict-idx]');
    card?.querySelectorAll('[data-choice]').forEach((b) => b.classList.remove('active'));
    opt.classList.add('active');
  });
  $('teamImportConflicts')?.addEventListener('click', (e) => {
    const all = e.target.closest('[data-conflict-all]');
    if (!all) return;
    const choice = all.dataset.conflictAll;
    $('teamImportConflictList').querySelectorAll('[data-conflict-idx]').forEach((card) => {
      card.querySelectorAll('[data-choice]').forEach((b) => b.classList.toggle('active', b.dataset.choice === choice));
    });
  });
}

function resetImportView() {
  pendingPlan = null;
  $('teamImportFormArea')?.classList.remove('d-none');
  $('teamImportConflicts')?.classList.add('d-none');
  const list = $('teamImportConflictList'); if (list) list.innerHTML = '';
  const btn = $('teamImportRun');
  if (btn) btn.innerHTML = '<i class="bi bi-box-arrow-in-down me-1"></i>นำเข้า';
}

function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }
function setImportStatus(msg, isErr = false) {
  const el = $('teamImportStatus');
  if (el) { el.textContent = msg || ''; el.classList.toggle('is-error', isErr); }
}

function detailBlock(cls, title, items) {
  if (!items.length) return '';
  const shown = items.slice(0, 12).map((s) => `<li>${escHtml(s)}</li>`).join('');
  const more = items.length > 12 ? `<li>… อีก ${items.length - 12} รายการ</li>` : '';
  return `<div class="${cls}"><b>${escHtml(title)} (${items.length})</b><ul>${shown}${more}</ul></div>`;
}

function setImportReport(r) {
  const el = $('teamImportStatus');
  if (!el) return;
  el.classList.remove('is-error');
  const upd = r.updated ? `, อัปเดต ${r.updated}` : '';
  el.innerHTML =
    `<div class="team-import-ok"><i class="bi bi-check-circle-fill"></i> นำเข้าแล้ว: เพิ่ม ${r.nodes} ตำแหน่ง, ${r.members} สมาชิก${upd}</div>` +
    detailBlock('team-import-skip', 'ข้าม', r.skipped) +
    detailBlock('team-import-warn', 'เตือน', r.warnings);
}

async function runImport() {
  const btn = $('teamImportRun');

  // Phase 2 — apply a plan whose conflicts the user just resolved in the UI.
  if (pendingPlan) {
    btn.disabled = true;
    try {
      readConflictChoices(pendingPlan);
      const report = await applyPlan(pendingPlan, $('teamImportCreateRoles').checked);
      pendingPlan = null;
      $('teamImportFormArea')?.classList.remove('d-none');
      $('teamImportConflicts')?.classList.add('d-none');
      btn.innerHTML = '<i class="bi bi-box-arrow-in-down me-1"></i>นำเข้า';
      await reload();
      setImportReport(report);
    } catch (e) {
      console.warn('[team] import apply failed:', e);
      setImportStatus(`นำเข้าไม่สำเร็จ: ${e?.message || e}`, true);
    } finally { btn.disabled = false; }
    return;
  }

  const raw = $('teamImportText').value.trim();
  if (!raw) { setImportStatus('ไม่มีข้อมูล', true); return; }
  btn.disabled = true;
  setImportStatus('กำลังตรวจสอบ…');
  try {
    if (raw[0] === '{' || raw[0] === '[') {
      let data;
      try { data = JSON.parse(raw); }
      catch { throw new Error('JSON ไม่ถูกต้อง (อ่านไม่สำเร็จ)'); }
      const report = await importJson(data);
      await reload();
      setImportReport(report);
      return;
    }
    const mode = $('teamImportDupMode')?.value || 'choose';
    const plan = planMembersCsv(raw);
    if (mode === 'choose' && plan.conflicts.length) {
      // Pause and let the user resolve each conflict (git-merge style).
      renderConflictView(plan);
      pendingPlan = plan;
      btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>ยืนยันนำเข้า';
      setImportStatus('');
      return;
    }
    // No interactive conflicts: pin each conflict's choice from the mode.
    plan.conflicts.forEach((k) => { k.choice = (mode === 'update') ? 'replace' : 'keep'; });
    const report = await applyPlan(plan, $('teamImportCreateRoles').checked);
    await reload();
    setImportReport(report);
  } catch (e) {
    console.warn('[team] import failed:', e);
    setImportStatus(`นำเข้าไม่สำเร็จ: ${e?.message || e}`, true);
  } finally {
    btn.disabled = false;
  }
}

/** Append an exported structure (new ids), parents before children. Validates
 *  shape; skips bad members with reasons; de-dupes within the file. */
async function importJson(data) {
  const v = validateExportJson(data);
  if (!v.ok) throw new Error(v.error);
  const nodes = data.nodes;
  const members = Array.isArray(data.members) ? data.members : [];
  const report = { nodes: 0, members: 0, skipped: [], warnings: [] };

  const byParent = new Map();
  nodes.forEach((n) => { const k = n.parent_id || ''; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(n); });
  for (const arr of byParent.values()) arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const idMap = new Map();
  const mkNode = async (n, newParent, position) => {
    const row = await createNode({
      parent_id: newParent, name: n.name.trim(), kind: n.kind || 'role',
      position, permissions: Array.isArray(n.permissions) ? n.permissions : [],
      inherit_permissions: n.inherit_permissions !== false,
      vs_dept: n.vs_dept || null,
      project_seat: n.project_seat || null,
      is_public: n.is_public !== false,
      is_board: !!n.is_board,
      passport_dept_id: n.passport_dept_id ?? null,
      passport_sub_dept_id: n.passport_sub_dept_id ?? null,
    });
    idMap.set(n.id, row.id); report.nodes++;
    nodesById.set(row.id, row);
    setImportStatus(`กำลังสร้างตำแหน่ง… ${report.nodes}/${nodes.length}`);
    return row.id;
  };
  const createSubtree = async (oldParent, newParent) => {
    const kids = byParent.get(oldParent || '') || [];
    for (let i = 0; i < kids.length; i++) {
      const newId = await mkNode(kids[i], newParent, i);
      await createSubtree(kids[i].id, newId);
    }
  };
  await createSubtree(null, null);
  // Orphans (parent_id points at a node absent from the file) → put at root.
  for (const n of nodes) {
    if (idMap.has(n.id)) continue;
    await mkNode(n, null, childrenOf(null).length);
    report.warnings.push(`ตำแหน่ง “${n.name}” ไม่มีฝ่ายแม่ในไฟล์ จึงวางไว้ระดับบนสุด`);
  }
  rebuildChildrenIndexFromNodes();

  const seen = new Set();
  for (const m of members) {
    const who = String(m?.full_name ?? '').trim();
    if (!who) { report.skipped.push('สมาชิกที่ไม่มีชื่อ'); continue; }
    const newNode = idMap.get(m.node_id);
    if (!newNode) { report.skipped.push(`${who}: ไม่พบตำแหน่งในไฟล์`); continue; }
    const key = newNode + '::' + ((m.kkumail || '').toLowerCase() || `${who}|${m.student_id || ''}`);
    if (seen.has(key)) { report.skipped.push(`${who}: ซ้ำในไฟล์`); continue; }
    seen.add(key);
    if (m.kkumail && !isLikelyEmail(m.kkumail)) report.warnings.push(`${who}: อีเมลอาจไม่ถูกต้อง (${m.kkumail})`);
    await createMember({
      node_id: newNode, position: m.position ?? 0,
      full_name: who, nickname: m.nickname || null, student_id: m.student_id || null,
      year: normalizeYear(m.year), major: m.major || null, kkumail: m.kkumail || null,
      confirmed: !!m.confirmed,
      // Restore the portrait too. Omitting these is not a no-op — it is data
      // loss on every export→import round trip (see buildExportJson's header).
      photo_url: m.photo_url || null,
      photo_focus: m.photo_focus || null,
      permissions: Array.isArray(m.permissions) ? m.permissions : [],
      inherit_permissions: m.inherit_permissions !== false,
      vs_dept: m.vs_dept || null,
      project_seat: m.project_seat || null,
      passport_dept_id: m.passport_dept_id ?? null,
      passport_sub_dept_id: m.passport_sub_dept_id ?? null,
    });
    report.members++;
    setImportStatus(`กำลังเพิ่มสมาชิก… ${report.members}`);
  }
  return report;
}

const DIFF_FIELDS = [
  ['full_name', 'ชื่อ-สกุล'], ['nickname', 'ชื่อเล่น'],
  ['student_id', 'รหัส'], ['year', 'ชั้นปี'], ['major', 'สาขา'],
  ['kkumail', 'KKU Mail'], ['confirmed', 'ยืนยัน'],
];

function rowFields(r) {
  return {
    full_name: r.full_name, nickname: r.nickname || null,
    student_id: r.student_id || null, year: r.year || null, major: r.major || null,
    kkumail: r.kkumail || null, confirmed: !!r.confirmed,
  };
}

/** Resolve a name path to an existing node WITHOUT creating anything. */
function resolvePathReadOnly(segs) {
  let parentId = null;
  for (const name of segs) {
    const ex = childrenOf(parentId).find((c) => c.name === name);
    if (!ex) return null;
    parentId = ex.id;
  }
  return parentId;
}

function memberDiff(existing, fields) {
  const out = [];
  for (const [k, label] of DIFF_FIELDS) {
    const a = k === 'confirmed' ? !!existing[k] : (existing[k] || '');
    const b = k === 'confirmed' ? !!fields[k] : (fields[k] || '');
    if (String(a) !== String(b)) out.push({ field: k, label, old: a, new: b });
  }
  return out;
}

function fmtVal(field, v) {
  if (field === 'confirmed') return v ? 'ยืนยัน' : 'รอยืนยัน';
  return v === '' || v == null ? '—' : String(v);
}

/** Read-only pass: classify each CSV row as create / conflict / skip without
 *  mutating the model. Path creation (for new roles) is deferred to applyPlan. */
function planMembersCsv(raw) {
  // The vocabulary is passed in so an import canonicalises สาขา the same way the
  // two forms do (`md` → `MD`). Without it every value reads as off-list and is
  // kept verbatim — not data loss, but it is how `md` gets back in beside `MD`.
  // `majors` is primed by openImport(); an empty list degrades to "keep as typed".
  const rows = parseMembersCsv(raw, majorCodes());
  if (!rows.length) throw new Error('ไม่พบสมาชิกใน CSV (ต้องมีคอลัมน์ ชื่อ-สกุล / full_name)');
  const plan = { creates: [], conflicts: [], identical: 0, skipped: [], warnings: [] };
  const seen = new Set();
  for (const r of rows) {
    const who = r.full_name;
    if (!r.confirmedRecognized) plan.warnings.push(`${who} (แถว ${r._row}): ค่า "ยืนยัน" ไม่ชัดเจน — ถือว่ายังไม่ยืนยัน`);
    if (r.kkumail && !isLikelyEmail(r.kkumail)) plan.warnings.push(`${who} (แถว ${r._row}): อีเมลอาจไม่ถูกต้อง`);

    const segs = splitPath(r.path);
    if (!segs.length) { plan.skipped.push(`${who} (แถว ${r._row}): ไม่ได้ระบุตำแหน่ง (path)`); continue; }
    const nodeId = resolvePathReadOnly(segs);
    const fields = rowFields(r);
    const dupKey = (nodeId || segs.join(' / ')) + '::' + ((r.kkumail || '').toLowerCase() || `${who}|${r.student_id || ''}`);
    if (seen.has(dupKey)) { plan.skipped.push(`${who} (แถว ${r._row}): ซ้ำในไฟล์`); continue; }
    seen.add(dupKey);

    if (nodeId) {
      const existing = findExistingMember(nodeId, r);
      if (existing) {
        const diffs = memberDiff(existing, fields);
        if (!diffs.length) { plan.identical++; continue; }   // already up to date
        plan.conflicts.push({ who, row: r._row, existingId: existing.id, path: nodePath(nodeId), fields, diffs, choice: 'replace' });
        continue;
      }
      plan.creates.push({ nodeId, segs: null, fields });
    } else {
      plan.creates.push({ nodeId: null, segs, fields });     // role created at apply time
    }
  }
  return plan;
}

async function applyPlan(plan, createMissing) {
  const report = { nodes: 0, members: 0, updated: 0, skipped: [...plan.skipped], warnings: [...plan.warnings] };
  if (plan.identical) report.skipped.push(`เหมือนเดิม ${plan.identical} รายการ (ไม่ต้องเปลี่ยน)`);

  for (const c of plan.creates) {
    let nodeId = c.nodeId;
    if (!nodeId) {
      const before = nodesById.size;
      nodeId = await ensurePath(c.segs, createMissing);
      if (!nodeId) { report.skipped.push(`${c.fields.full_name}: ไม่พบ/สร้างตำแหน่งไม่ได้`); continue; }
      report.nodes += nodesById.size - before;
    }
    const row = await createMember({ node_id: nodeId, position: membersOf(nodeId).length, ...c.fields });
    if (!membersByNode.has(nodeId)) membersByNode.set(nodeId, []);
    membersByNode.get(nodeId).push(row);
    report.members++;
    setImportStatus(`กำลังเพิ่มสมาชิก… ${report.members}`);
  }
  for (const k of plan.conflicts) {
    if (k.choice === 'replace') {
      const m = findMember(k.existingId);
      if (m) Object.assign(m, k.fields);
      await updateMember(k.existingId, k.fields);
      report.updated++;
      setImportStatus(`กำลังอัปเดต… ${report.updated}`);
    } else {
      report.skipped.push(`${k.who} (แถว ${k.row}): เก็บของเดิม`);
    }
  }
  return report;
}

/** Render the per-conflict resolver (git-merge style) into the import modal. */
function renderConflictView(plan) {
  $('teamImportFormArea')?.classList.add('d-none');
  $('teamImportConflicts')?.classList.remove('d-none');
  const countEl = $('teamConflictCount');
  if (countEl) countEl.textContent = `พบข้อมูลซ้ำ ${plan.conflicts.length} รายการ — เลือกว่าจะเก็บอันไหน`;
  const list = $('teamImportConflictList');
  if (!list) return;
  list.innerHTML = plan.conflicts.map((k, i) => `
    <div class="team-conflict" data-conflict-idx="${i}">
      <div class="team-conflict-head"><b>${escHtml(k.who)}</b> <span class="team-conflict-path">${escHtml(k.path)}</span></div>
      <table class="team-conflict-diff"><thead><tr><th></th><th>เดิม</th><th>ใหม่</th></tr></thead><tbody>
        ${k.diffs.map((d) => `<tr><td>${escHtml(d.label)}</td><td class="old">${escHtml(fmtVal(d.field, d.old))}</td><td class="new">${escHtml(fmtVal(d.field, d.new))}</td></tr>`).join('')}
      </tbody></table>
      <div class="team-conflict-choice btn-group btn-group-sm" role="group">
        <button type="button" class="btn btn-outline-secondary" data-choice="keep">เก็บเดิม</button>
        <button type="button" class="btn btn-outline-primary active" data-choice="replace">ใช้ใหม่</button>
      </div>
    </div>`).join('');
}

function readConflictChoices(plan) {
  const list = $('teamImportConflictList');
  if (!list) return;
  list.querySelectorAll('[data-conflict-idx]').forEach((card) => {
    const idx = Number(card.dataset.conflictIdx);
    const active = card.querySelector('[data-choice].active');
    if (plan.conflicts[idx]) plan.conflicts[idx].choice = active?.dataset.choice || 'replace';
  });
}

/** Resolve a name path to a node id under the live model, creating missing
 *  levels when allowed. Returns null if unresolved and creation is off. */
async function ensurePath(segs, createMissing) {
  if (!segs.length) return null;
  let parentId = null;
  for (let i = 0; i < segs.length; i++) {
    const name = segs[i];
    const existing = childrenOf(parentId).find((c) => c.name === name);
    if (existing) { parentId = existing.id; continue; }
    if (!createMissing) return null;
    const kind = i === 0 ? 'division' : (i === segs.length - 1 ? 'role' : 'department');
    const row = await createNode({
      parent_id: parentId, name, kind, position: childrenOf(parentId).length,
      permissions: [], inherit_permissions: true,
    });
    nodesById.set(row.id, row);
    rebuildChildrenIndexFromNodes();
    parentId = row.id;
  }
  return parentId;
}
