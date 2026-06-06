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

import { escHtml } from '../utils.js';
import {
  fetchTree, createNode, updateNode, deleteNode,
  createMember, updateMember, deleteMember,
  patchNodePositions, patchMemberPositions,
} from './api.js';
import { subscribeTeam } from './realtime.js';
import {
  buildExportJson, buildMembersCsv, parseMembersCsv, splitPath, PATH_SEP,
  normalizeYear, isLikelyEmail, validateExportJson,
} from './io.js';

// App permissions that can be attached to a node (keys match userCanAccess).
const PERM_CATALOG = [
  { key: 'pr',       label: 'PR' },
  { key: 'vs',       label: 'VitalSound' },
  { key: 'samoshop', label: 'SAMO Shop' },
  { key: 'projects', label: 'หนังสือโครงการ' },
  { key: 'creator',  label: 'เขียนประกาศ' },
  { key: 'team',     label: 'ทีม SAMO' },
];
const PERM_LABEL = Object.fromEntries(PERM_CATALOG.map((p) => [p.key, p.label]));

const KIND_ICON = { division: 'bi-diagram-2', department: 'bi-folder2', role: 'bi-person-badge' };

// ---- module state ----
let initialized = false;
let loaded = false;
let loading = null;            // in-flight load promise (single-flight)
let mode = 'team';             // 'team' | 'perms'
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

const $ = (id) => document.getElementById(id);

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
  wireMemberModal();
  wireTreeDelegation();
  wireIO();
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
      membersByNode.get(nid).push(payload.new);
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
  const tree = $('teamTree');
  if (!tree) return;
  destroySortables();

  // toolbar reflects mode
  $('teamAddRoot')?.classList.toggle('d-none', mode !== 'team');
  document.querySelectorAll('.team-mode-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.teamMode === mode);
  });
  const hint = $('teamModeHint');
  if (hint) {
    hint.textContent = mode === 'perms'
      ? 'แตะที่ตำแหน่งเพื่อกำหนดสิทธิ์การใช้งานระบบ — สีทึบคือสิทธิ์ของตำแหน่งนี้ สีเส้นประคือสิทธิ์ที่รับมาจากตำแหน่งแม่'
      : '';
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

  // Drag is for fine reordering; disabled while filtering or selecting. The
  // "ย้าย" picker / bulk-move bar handle cross-level + multi moves.
  if (!searchQ && !selectionMode) attachSortables(tree);

  tree.classList.toggle('is-selectmode', selectionMode);
  $('teamSelectMode')?.classList.toggle('is-active', selectionMode);
  updateSelectionBar();
}

function renderNode(node, filter) {
  if (filter && !filter.visible.has(node.id)) return null;
  const kids = childrenOf(node.id);
  const mem = membersOf(node.id);
  const showMembers = mode === 'team';
  // In team mode EVERY node is expandable — a role can always hold members, so
  // you must be able to open even an empty one to reveal its drop zone / add
  // button. In perms mode only nodes with child nodes expand.
  const expandable = showMembers ? true : kids.length > 0;
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
    if (!permChips) permChips = '<span class="team-perm-none">ไม่มีสิทธิ์</span>';
  }

  const nameHtml = filter ? highlight(node.name, filter.q) : escHtml(node.name);
  const actions = mode === 'team' ? `
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
      <span class="team-handle" title="ลากเพื่อจัดลำดับ"><i class="bi bi-grip-vertical"></i></span>
      <button type="button" class="team-caret ${expandable ? '' : 'is-leaf'}" data-act="toggle"
        aria-label="ขยาย/ย่อ">${expandable ? `<i class="bi bi-chevron-${isOpen ? 'down' : 'right'}"></i>` : ''}</button>
      <i class="bi ${KIND_ICON[node.kind] || KIND_ICON.role} team-node-icon"></i>
      <span class="team-node-name" data-act="primary">${nameHtml}</span>
      ${count ? `<span class="team-count" title="สมาชิกในสายนี้">${count}</span>` : ''}
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
    if (!mem.length && !kids.length && !filter) {
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
  const name = `${m.prefix ? m.prefix + ' ' : ''}${m.full_name}`;
  const nameHtml = filter ? highlight(name, filter.q) : escHtml(name);
  const nick = m.nickname ? (filter ? highlight(m.nickname, filter.q) : escHtml(m.nickname)) : '';
  const mailHtml = m.kkumail ? (filter ? highlight(m.kkumail, filter.q) : escHtml(m.kkumail)) : '';
  const checkbox = selectionMode
    ? `<input type="checkbox" class="team-check" data-act="select" ${selectedMembers.has(m.id) ? 'checked' : ''} aria-label="เลือกสมาชิก" />`
    : '';
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
      </span>
    </span>
    <span class="team-member-actions">
      <button type="button" class="team-act" data-act="move-member" title="ย้ายตำแหน่ง"><i class="bi bi-arrows-move"></i></button>
      <button type="button" class="team-act" data-act="edit-member" title="แก้ไข"><i class="bi bi-pencil"></i></button>
      <button type="button" class="team-act team-act-danger" data-act="delete-member" title="ลบ"><i class="bi bi-trash"></i></button>
    </span>`;
  return li;
}

function highlight(text, q) {
  const t = String(text || '');
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escHtml(t);
  return escHtml(t.slice(0, i)) + '<mark>' + escHtml(t.slice(i, i + q.length)) + '</mark>' + escHtml(t.slice(i + q.length));
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
  if (mode === 'team') {
    for (const arr of membersByNode.values()) {
      for (const m of arr) {
        const hay = `${m.prefix || ''} ${m.full_name} ${m.nickname || ''} ${m.student_id || ''} ${m.major || ''} ${m.kkumail || ''}`.toLowerCase();
        if (hay.includes(q)) { memberIds.add(m.id); markUp(m.node_id); }
      }
    }
  }
  return { visible, memberIds, q: qRaw.trim() };
}

// ============================================================
// DRAG / DROP (fine reordering; cross-level use the move picker)
// ============================================================

function attachSortables(tree) {
  if (!window.Sortable) return;
  tree.querySelectorAll('ul.team-children').forEach((ul) => {
    sortables.push(window.Sortable.create(ul, {
      group: 'team-nodes', handle: '.team-handle:not(.team-handle-sm)',
      draggable: '.team-node', animation: 150, fallbackOnBody: true, ghostClass: 'team-ghost',
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
      sortables.push(window.Sortable.create(ul, {
        group: 'team-members', handle: '.team-handle-sm',
        draggable: '.team-member', animation: 150, fallbackOnBody: true, ghostClass: 'team-ghost',
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
      if (mode === 'perms') openPermModal(nodeId); else openNodeModal({ node: nodesById.get(nodeId) });
      return;
    }
    if (!nodeId && !memberId) return;
    switch (act) {
      case 'edit':        openNodeModal({ node: nodesById.get(nodeId) }); break;
      case 'add-child':   openNodeModal({ parentId: nodeId }); break;
      case 'add-member':  openMemberModal({ nodeId }); break;
      case 'move':        openMoveNode(nodeId); break;
      case 'delete':      onDeleteNode(nodeId); break;
      case 'edit-perms':  openPermModal(nodeId); break;
      case 'edit-member': openMemberModal({ member: findMember(memberId) }); break;
      case 'move-member': openMoveMember(memberId); break;
      case 'delete-member': onDeleteMember(memberId); break;
    }
  });
}

// ============================================================
// TOOLBAR + MODE
// ============================================================

function wireToolbar() {
  $('teamAddRoot')?.addEventListener('click', () => openNodeModal({ parentId: null, kind: 'division' }));
  $('teamExpandAll')?.addEventListener('click', () => { for (const id of nodesById.keys()) expanded.add(id); render(); });
  $('teamCollapseAll')?.addEventListener('click', () => { expanded.clear(); render(); });

  document.querySelectorAll('.team-mode-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const m = b.dataset.teamMode;
      if (m === mode) return;
      mode = m;
      if (selectionMode) { selectionMode = false; clearSelection(); }  // perms mode has no member rows
      render();
    });
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

function openNodeModal({ node = null, parentId = null, kind = null } = {}) {
  $('teamNodeId').value = node?.id || '';
  $('teamNodeParentId').value = node ? (node.parent_id || '') : (parentId || '');
  $('teamNodeName').value = node?.name || '';
  $('teamNodeKind').value = node?.kind || kind || 'role';
  $('teamNodeModalTitle').textContent = node ? 'แก้ไขตำแหน่ง' : (parentId ? 'เพิ่มตำแหน่งย่อย' : 'เพิ่มฝ่าย');
  $('teamNodeDelete').classList.toggle('d-none', !node);
  modalInstance('teamNodeModal')?.show();
  setTimeout(() => $('teamNodeName')?.focus(), 250);
}

async function onNodeSubmit(e) {
  e.preventDefault();
  const id = $('teamNodeId').value;
  const name = $('teamNodeName').value.trim();
  if (!name) { $('teamNodeName').focus(); return; }
  const parentId = $('teamNodeParentId').value || null;
  const payload = { name, kind: $('teamNodeKind').value };
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
  if (!node) return;
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
    what: `${m.prefix ? m.prefix + ' ' : ''}${m.full_name}`,
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
  } catch (e) { console.warn('[team] bulk delete failed:', e?.message || e); reload(); }
}

// ============================================================
// PERMISSION MODAL (perms mode)
// ============================================================

function wirePermModal() {
  const grid = $('teamPermGrid');
  if (grid) {
    grid.innerHTML = PERM_CATALOG.map((p) => `
      <label class="team-perm-opt">
        <input type="checkbox" value="${p.key}" /> <span>${escHtml(p.label)}</span>
      </label>`).join('');
  }
  $('teamPermForm')?.addEventListener('submit', onPermSubmit);
  $('teamPermInherit')?.addEventListener('change', refreshPermInherited);
}

function openPermModal(id) {
  const node = nodesById.get(id);
  if (!node) return;
  $('teamPermNodeId').value = id;
  $('teamPermNodeName').textContent = nodePath(id);
  const own = new Set(node.permissions || []);
  $('teamPermGrid').querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = own.has(cb.value); });
  $('teamPermInherit').checked = node.inherit_permissions !== false;
  refreshPermInherited();
  modalInstance('teamPermModal')?.show();
}

function refreshPermInherited() {
  const wrap = $('teamPermInheritedWrap');
  const list = $('teamPermInheritedList');
  const id = $('teamPermNodeId').value;
  if (!wrap || !list || !id) return;
  const set = inheritedPermsFor(id, $('teamPermInherit').checked);
  if (set.size) {
    list.innerHTML = [...set].map((p) => `<span class="team-perm-chip is-inherited">${escHtml(PERM_LABEL[p] || p)}</span>`).join(' ');
    wrap.classList.remove('d-none');
  } else wrap.classList.add('d-none');
}

async function onPermSubmit(e) {
  e.preventDefault();
  const id = $('teamPermNodeId').value;
  const node = nodesById.get(id);
  if (!node) return;
  const perms = [...$('teamPermGrid').querySelectorAll('input:checked')].map((cb) => cb.value);
  const payload = { permissions: perms, inherit_permissions: $('teamPermInherit').checked };
  modalInstance('teamPermModal')?.hide();
  Object.assign(node, payload);
  render();
  try { await updateNode(id, payload); } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); reload(); }
}

// ============================================================
// MEMBER MODAL
// ============================================================

function wireMemberModal() {
  $('teamMemberForm')?.addEventListener('submit', onMemberSubmit);
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

function openMemberModal({ member = null, nodeId = null } = {}) {
  const nid = member?.node_id || nodeId || '';
  $('teamMemberId').value = member?.id || '';
  setMemberNode(nid);
  $('teamMemberPrefix').value = member?.prefix || '';
  $('teamMemberName').value = member?.full_name || '';
  $('teamMemberNickname').value = member?.nickname || '';
  $('teamMemberStudentId').value = member?.student_id || '';
  $('teamMemberYear').value = member?.year || '';
  $('teamMemberMajor').value = member?.major || '';
  $('teamMemberEmail').value = member?.kkumail || '';
  $('teamMemberConfirmed').checked = !!member?.confirmed;
  $('teamMemberModalTitle').textContent = member ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก';
  $('teamMemberDelete').classList.toggle('d-none', !member);
  modalInstance('teamMemberModal')?.show();
  setTimeout(() => $('teamMemberName')?.focus(), 250);
}

async function onMemberSubmit(e) {
  e.preventDefault();
  const id = $('teamMemberId').value;
  const nodeId = $('teamMemberNodeId').value;
  const name = $('teamMemberName').value.trim();
  if (!name) { $('teamMemberName').focus(); return; }
  if (!nodeId) { alert('กรุณาเลือกตำแหน่ง'); return; }
  const payload = {
    prefix: $('teamMemberPrefix').value.trim() || null,
    full_name: name,
    nickname: $('teamMemberNickname').value.trim() || null,
    student_id: $('teamMemberStudentId').value.trim() || null,
    year: normalizeYear($('teamMemberYear').value),
    major: $('teamMemberMajor').value.trim() || null,
    kkumail: $('teamMemberEmail').value.trim() || null,
    confirmed: $('teamMemberConfirmed').checked,
  };
  modalInstance('teamMemberModal')?.hide();
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
  } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); reload(); }
}

async function onDeleteMember(id) {
  const m = findMember(id);
  if (!m) return;
  if (!confirm(`ลบสมาชิก “${m.full_name}” ?`)) return;
  const arr = membersByNode.get(m.node_id);
  if (arr) membersByNode.set(m.node_id, arr.filter((x) => x.id !== id));
  render();
  try { await deleteMember(id); } catch (e) { alert(e?.message || 'ลบไม่สำเร็จ'); reload(); }
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
      prefix: m.prefix, full_name: m.full_name, nickname: m.nickname,
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
      node_id: newNode, position: m.position ?? 0, prefix: m.prefix || null,
      full_name: who, nickname: m.nickname || null, student_id: m.student_id || null,
      year: normalizeYear(m.year), major: m.major || null, kkumail: m.kkumail || null,
      confirmed: !!m.confirmed,
    });
    report.members++;
    setImportStatus(`กำลังเพิ่มสมาชิก… ${report.members}`);
  }
  return report;
}

const DIFF_FIELDS = [
  ['prefix', 'คำนำหน้า'], ['full_name', 'ชื่อ-สกุล'], ['nickname', 'ชื่อเล่น'],
  ['student_id', 'รหัส'], ['year', 'ชั้นปี'], ['major', 'สาขา'],
  ['kkumail', 'KKU Mail'], ['confirmed', 'ยืนยัน'],
];

function rowFields(r) {
  return {
    prefix: r.prefix || null, full_name: r.full_name, nickname: r.nickname || null,
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
  const rows = parseMembersCsv(raw);
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
