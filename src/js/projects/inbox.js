// ==============================================
// PROJECTS INBOX — spreadsheet table view
//
// Single full-width table. One row per document (flattened across all
// projects). Click row → expands inline (Airtable / Linear pattern) with
// the stepper + files + actions + timeline.
//
// Filter chips at the top are role-aware (mine / waiting / done / all);
// group-by select (project / status / owner / none) supports the
// "folder feel" via the project-grouping mode without giving up the
// cross-cutting power of the flat view.
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { getUser } from '../auth.js';
import {
  getProject,
  getDocument,
  updateProject,
  deleteProject,
  appendDocTimeline,
  deleteDocument,
  listFiles,
  createFile,
  supersedeFile,
} from './api.js';
import {
  PROJECT_STATUS_META,
  DOC_STATUS_META,
  DOC_PATH_ORDER,
  fmtDateTime,
  fmtRelative,
  fmtBytes,
  buildDocFolderPath,
} from './data.js';
import { uploadProjectFile } from './uploads.js';
import { notifyUniStaff, notifyVpAdmin } from './notify.js';

// ---------- module state ----------

let onChanged = () => {};
let onAddDocumentCb = null;

let cache = { projects: [], docTypes: [], settings: null, role: null };
let filterKind = 'all';        // 'mine' | 'waiting' | 'done' | 'all'
let groupBy    = 'project';    // 'project' | 'status' | 'owner' | 'none'
let searchQ    = '';
let expanded   = new Set();    // doc ids currently expanded

// Deferred scroll target — set by openProjectDetail / openDocumentDetail;
// honoured at the end of render().
let scrollDocId = null;
let scrollProjectId = null;

const TABLE_COLS = 6;

// ---------- helpers ----------

/** Which role owes the next move on this doc. null = nobody (done/cancel/draft). */
function nextOwner(doc) {
  switch (doc.status) {
    case 'sent':        return 'uni_staff';
    case 'received':    return 'uni_staff';
    case 'in_progress': return 'uni_staff';
    case 'returned':    return 'vp_admin';
    default:            return null;
  }
}

function ownerLabel(role, settings) {
  if (role === 'uni_staff') return settings?.uni_label || 'พี่นิค';
  if (role === 'vp_admin')  return settings?.vp_label  || 'SAMO';
  return '—';
}

/** Is the current user the next actor on this doc? */
function isMine(doc, role) {
  const owner = nextOwner(doc);
  if (!owner) return false;
  if (role === 'dev') return true;   // dev sees all action items as "mine"
  return owner === role;
}

/** Flatten all docs across all projects into rows the table renders. */
function flattenDocs(projects) {
  const rows = [];
  for (const p of projects || []) {
    for (const d of (p.documents || [])) {
      rows.push({ doc: d, project: p });
    }
  }
  return rows;
}

function applyFilter(rows, kind, role) {
  if (kind === 'all') return rows;
  if (kind === 'done')    return rows.filter(({ doc }) => doc.status === 'completed' || doc.status === 'cancelled');
  if (kind === 'mine')    return rows.filter(({ doc }) => isMine(doc, role));
  if (kind === 'waiting') return rows.filter(({ doc }) => {
    const o = nextOwner(doc);
    if (!o) return false;
    return role !== 'dev' && o !== role;   // dev: nothing is "waiting" — every active item is theirs
  });
  return rows;
}

function applySearch(rows, q) {
  if (!q) return rows;
  return rows.filter(({ doc, project }) =>
    (doc.title    || '').toLowerCase().includes(q)
    || (doc.id    || '').toLowerCase().includes(q)
    || (doc.note  || '').toLowerCase().includes(q)
    || (project.name || '').toLowerCase().includes(q)
    || (project.id   || '').toLowerCase().includes(q)
    || (project.description || '').toLowerCase().includes(q)
  );
}

function rowTime(r) {
  return new Date(r.doc.updated_at || r.doc.sent_at || r.doc.created_at).getTime() || 0;
}

/** Returns [{ key, label, meta, rows }] in display order. */
function groupRows(rows, mode, settings) {
  if (mode === 'none') {
    const sorted = rows.slice().sort((a, b) => rowTime(b) - rowTime(a));
    return [{ key: 'all', label: '', rows: sorted, headerless: true }];
  }
  const map = new Map();
  for (const r of rows) {
    let key;
    if (mode === 'project') key = r.project.id;
    else if (mode === 'status') key = r.doc.status;
    else if (mode === 'owner')  key = nextOwner(r.doc) || 'none';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  const out = [];
  for (const [key, list] of map) {
    list.sort((a, b) => rowTime(b) - rowTime(a));
    let label = key;
    let meta = null;
    if (mode === 'project') {
      const p = list[0].project;
      label = p.name;
      meta = { project: p, count: list.length };
    } else if (mode === 'status') {
      const m = DOC_STATUS_META[key];
      label = m?.label || key;
      meta = { icon: m?.icon, cls: m?.cls, count: list.length };
    } else if (mode === 'owner') {
      if (key === 'uni_staff') label = `${ownerLabel('uni_staff', settings)} (เจ้าหน้าที่)`;
      else if (key === 'vp_admin') label = `${ownerLabel('vp_admin', settings)} (SAMO VP)`;
      else label = 'เสร็จสิ้น / ยกเลิก (ไม่มีฝ่ายรับผิดชอบ)';
      meta = { count: list.length };
    }
    out.push({ key, label, meta, rows: list, mode });
  }
  // Order the groups themselves
  if (mode === 'project') {
    out.sort((a, b) => Math.max(...b.rows.map(rowTime)) - Math.max(...a.rows.map(rowTime)));
  } else if (mode === 'status') {
    const order = ['sent', 'returned', 'received', 'in_progress', 'completed', 'cancelled', 'draft'];
    out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  } else if (mode === 'owner') {
    const role = cache.role;
    const rank = (k) => {
      if (role === 'dev') return ({ uni_staff: 0, vp_admin: 1, none: 2 })[k] ?? 3;
      if (k === role) return 0;
      if (k === 'none') return 2;
      return 1;
    };
    out.sort((a, b) => rank(a.key) - rank(b.key));
  }
  return out;
}

// ---------- mounting ----------

export function mountInbox({ onChanged: changed, onAddDocument }) {
  if (typeof changed === 'function') onChanged = changed;
  if (typeof onAddDocument === 'function') onAddDocumentCb = onAddDocument;

  // Toolbar
  document.getElementById('projectsFilterRow')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-projects-filter]');
    if (!chip) return;
    filterKind = chip.dataset.projectsFilter;
    render();
  });
  document.getElementById('projectsSearchInput')?.addEventListener('input', (e) => {
    searchQ = (e.target.value || '').toLowerCase().trim();
    render();
  });
  document.getElementById('projectsGroupBy')?.addEventListener('change', (e) => {
    groupBy = e.target.value;
    render();
  });

  // Table body — one delegated click handler for all row interactions.
  document.getElementById('projectsTableBody')?.addEventListener('click', onTableClick);
  document.getElementById('projectsTableBody')?.addEventListener('change', onTableChange);
}

// ---------- public renderers ----------

export function renderInbox(next) {
  cache = { ...cache, ...next };
  render();
}

export function openProjectDetail(projectId) {
  scrollProjectId = projectId;
  // When jumping to a project, force project-grouping so the user lands on
  // a recognisable section.
  if (groupBy !== 'project') {
    groupBy = 'project';
    const sel = document.getElementById('projectsGroupBy');
    if (sel) sel.value = 'project';
  }
  render();
}

export async function openDocumentDetail(documentId) {
  // Locate the doc; if missing from cache, fetch to keep deep-links robust.
  let found = null;
  for (const p of cache.projects) {
    const d = (p.documents || []).find((x) => x.id === documentId);
    if (d) { found = { doc: d, project: p }; break; }
  }
  if (!found) {
    const doc = await getDocument(documentId).catch(() => null);
    if (!doc) return;
    const project = await getProject(doc.project_id).catch(() => null);
    if (project) found = { doc, project };
  }
  if (!found) return;
  expanded.add(documentId);
  scrollDocId = documentId;
  scrollProjectId = found.project.id;
  if (groupBy !== 'project') {
    groupBy = 'project';
    const sel = document.getElementById('projectsGroupBy');
    if (sel) sel.value = 'project';
  }
  render();
}

// ---------- main render ----------

function render() {
  renderFilterChips();
  renderTable();
  // Defer scroll until DOM has settled
  if (scrollDocId || scrollProjectId) {
    requestAnimationFrame(() => {
      const target =
        (scrollDocId && document.querySelector(`[data-projects-row-doc="${cssEsc(scrollDocId)}"]`))
        || (scrollProjectId && document.querySelector(`[data-projects-group-project="${cssEsc(scrollProjectId)}"]`));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      scrollDocId = null;
      scrollProjectId = null;
    });
  }
}

function renderFilterChips() {
  const row = document.getElementById('projectsFilterRow');
  if (!row) return;
  const all = flattenDocs(cache.projects);
  const role = cache.role;
  const cMine    = applyFilter(all, 'mine', role).length;
  const cWait    = applyFilter(all, 'waiting', role).length;
  const cDone    = applyFilter(all, 'done', role).length;
  const cAll     = all.length;
  const chips = [
    { id: 'mine',    label: 'ของฉัน',    count: cMine, cls: 'is-mine' },
    { id: 'waiting', label: 'รออีกฝ่าย', count: cWait, cls: 'is-wait' },
    { id: 'done',    label: 'เสร็จสิ้น',  count: cDone, cls: 'is-done' },
    { id: 'all',     label: 'ทั้งหมด',   count: cAll,  cls: 'is-all' },
  ];
  row.innerHTML = chips.map((c) => `
    <button type="button" class="projects-chip ${c.cls} ${c.id === filterKind ? 'is-active' : ''}"
      data-projects-filter="${c.id}">
      <span>${escHtml(c.label)}</span>
      <span class="projects-chip-count">${c.count}</span>
    </button>
  `).join('');
}

function renderTable() {
  const tbody = document.getElementById('projectsTableBody');
  const table = document.getElementById('projectsTable');
  const empty = document.getElementById('projectsTableEmpty');
  if (!tbody) return;

  let rows = flattenDocs(cache.projects);
  rows = applyFilter(rows, filterKind, cache.role);
  rows = applySearch(rows, searchQ);

  if (rows.length === 0) {
    tbody.innerHTML = '';
    empty?.classList.remove('d-none');
    table?.classList.add('d-none');
    return;
  }
  empty?.classList.add('d-none');
  table?.classList.remove('d-none');

  // Toggle redundant-column hiding based on group mode
  table?.classList.toggle('is-grouped-project', groupBy === 'project');
  table?.classList.toggle('is-grouped-status',  groupBy === 'status');

  const groups = groupRows(rows, groupBy, cache.settings);
  tbody.innerHTML = groups.map(renderGroup).join('');

  // Load files for every expanded row that's now in the DOM
  expanded.forEach((docId) => {
    if (document.getElementById(`projectsFilesList-${docId}`)) loadFilesForDoc(docId);
  });
}

function renderGroup(group) {
  const header = group.headerless ? '' : renderGroupHeader(group);
  const body = group.rows.map(renderRow).join('');
  return header + body;
}

function renderGroupHeader(group) {
  const role = cache.role;
  const canManage = role === 'vp_admin' || role === 'dev';
  if (group.mode === 'project') {
    const p = group.meta.project;
    const pmeta = PROJECT_STATUS_META[p.status] || PROJECT_STATUS_META.open;
    return `
      <tr class="projects-group-row" data-projects-group-project="${escHtml(p.id)}">
        <td colspan="${TABLE_COLS}">
          <div class="projects-group-head">
            <span class="projects-group-icon"><i class="bi bi-folder2-open"></i></span>
            <div class="projects-group-title">
              <span class="projects-group-name">${escHtml(p.name)}</span>
              <span class="projects-group-id">${escHtml(p.id)}</span>
              ${p.description ? `<span class="projects-group-desc">${escHtml(p.description)}</span>` : ''}
            </div>
            <span class="projects-status-pill ${pmeta.cls}"><i class="bi ${pmeta.icon} me-1"></i>${escHtml(pmeta.label)}</span>
            <span class="projects-group-count">${group.meta.count} หนังสือ</span>
            <div class="projects-group-actions">
              ${canManage ? `<button type="button" class="btn btn-sm btn-primary-soft" data-projects-add-doc="${escHtml(p.id)}">
                <i class="bi bi-plus-lg me-1"></i>เพิ่มหนังสือ
              </button>` : ''}
              <button type="button" class="btn btn-sm btn-ghost" data-projects-copy-project="${escHtml(p.id)}" title="คัดลอกลิงก์โครงการ">
                <i class="bi bi-link-45deg"></i>
              </button>
              ${canManage ? `
                <div class="dropdown d-inline-block">
                  <button type="button" class="btn btn-sm btn-ghost dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
                    <i class="bi bi-three-dots"></i>
                  </button>
                  <ul class="dropdown-menu dropdown-menu-end">
                    <li><h6 class="dropdown-header">เปลี่ยนสถานะโครงการ</h6></li>
                    ${['open','in_progress','completed','cancelled'].map((s) =>
                      `<li><button class="dropdown-item ${s===p.status?'active':''}" type="button"
                          data-projects-set-project-status="${s}" data-project-id="${escHtml(p.id)}">
                          <i class="bi ${PROJECT_STATUS_META[s].icon} me-2"></i>${escHtml(PROJECT_STATUS_META[s].label)}
                        </button></li>`).join('')}
                    <li><hr class="dropdown-divider"></li>
                    <li><button class="dropdown-item text-danger" type="button"
                      data-projects-delete-project="${escHtml(p.id)}">
                      <i class="bi bi-trash me-2"></i>ลบโครงการ (ลบหนังสือทั้งหมดด้วย)
                    </button></li>
                  </ul>
                </div>
              ` : ''}
            </div>
          </div>
        </td>
      </tr>
    `;
  }
  if (group.mode === 'status') {
    return `
      <tr class="projects-group-row is-narrow">
        <td colspan="${TABLE_COLS}">
          <div class="projects-group-head">
            <span class="projects-status-pill ${group.meta.cls || ''}"><i class="bi ${group.meta.icon || ''} me-1"></i>${escHtml(group.label)}</span>
            <span class="projects-group-count">${group.meta.count} หนังสือ</span>
          </div>
        </td>
      </tr>
    `;
  }
  // owner
  return `
    <tr class="projects-group-row is-narrow">
      <td colspan="${TABLE_COLS}">
        <div class="projects-group-head">
          <span class="projects-group-name">${escHtml(group.label)}</span>
          <span class="projects-group-count">${group.meta.count} หนังสือ</span>
        </div>
      </td>
    </tr>
  `;
}

function renderRow({ doc, project }) {
  const m = DOC_STATUS_META[doc.status] || DOC_STATUS_META.sent;
  const type = (cache.docTypes || []).find((t) => t.id === doc.type_id);
  const owner = nextOwner(doc);
  const ownerTxt = owner ? ownerLabel(owner, cache.settings) : '—';
  const ownerCls = owner === cache.role || (cache.role === 'dev' && owner) ? 'is-mine' : (owner ? 'is-other' : 'is-none');
  const isOpen = expanded.has(doc.id);
  const mineFlag = isMine(doc, cache.role) ? '<span class="projects-row-mine-dot" title="ของฉัน"></span>' : '';
  const dataMine = isMine(doc, cache.role) ? 'data-projects-row-mine="1"' : '';

  const baseRow = `
    <tr class="projects-row ${isOpen ? 'is-open' : ''}" data-projects-row-doc="${escHtml(doc.id)}" ${dataMine}>
      <td class="col-status">
        ${mineFlag}
        <span class="projects-status-pill ${m.cls}"><i class="bi ${m.icon} me-1"></i>${escHtml(m.label)}</span>
      </td>
      <td class="col-doc">
        <div class="projects-cell-stack">
          <div class="projects-cell-title">
            <span class="projects-doc-seq-mini">#${doc.sequence_no || 1}</span>
            ${escHtml(doc.title)}
          </div>
          <div class="projects-cell-sub">
            <span class="projects-type-pill">${escHtml(type?.label_th || doc.type_id)}</span>
            <span class="projects-cell-mono d-none d-lg-inline">${escHtml(doc.id)}</span>
          </div>
        </div>
      </td>
      <td class="col-project">
        <div class="projects-cell-stack">
          <div class="projects-cell-title">${escHtml(project.name)}</div>
          <div class="projects-cell-sub projects-cell-mono">${escHtml(project.id)}</div>
        </div>
      </td>
      <td class="col-owner">
        <span class="projects-owner-pill ${ownerCls}">${escHtml(ownerTxt)}</span>
      </td>
      <td class="col-updated">
        <span class="projects-cell-sub" title="${escHtml(fmtDateTime(doc.updated_at || doc.created_at))}">${escHtml(fmtRelative(doc.updated_at || doc.created_at))}</span>
      </td>
      <td class="col-expand">
        <button type="button" class="projects-row-expand" aria-label="ขยาย/ย่อ" aria-expanded="${isOpen}">
          <i class="bi bi-chevron-${isOpen ? 'up' : 'down'}"></i>
        </button>
      </td>
    </tr>
  `;

  if (!isOpen) return baseRow;
  return baseRow + renderExpandedRow(doc, project);
}

function renderExpandedRow(doc, project) {
  return `
    <tr class="projects-row-expand-tr" data-projects-expand-of="${escHtml(doc.id)}">
      <td colspan="${TABLE_COLS}">
        ${renderExpandedContent(doc, project)}
      </td>
    </tr>
  `;
}

function renderExpandedContent(doc, project) {
  const stepIndex = DOC_PATH_ORDER.indexOf(doc.status);
  const isReturned  = doc.status === 'returned';
  const isCancelled = doc.status === 'cancelled';
  const isCompleted = doc.status === 'completed';
  const role = cache.role;
  const isVp  = role === 'vp_admin' || role === 'dev';
  const isUni = role === 'uni_staff' || role === 'dev';
  const tlSorted = (doc.timeline || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));
  const lastReturn = (doc.timeline || []).slice().reverse().find((e) => e.action === 'returned');

  return `
    <div class="projects-expand">
      ${renderProgressBar(stepIndex, isReturned, isCancelled, doc)}

      ${doc.note ? `<div class="projects-doc-note"><i class="bi bi-chat-square-quote me-1"></i>${escHtml(doc.note)}</div>` : ''}
      ${isReturned && (doc.return_reason || lastReturn?.note) ? `<div class="projects-doc-return"><b>ส่งกลับเพื่อแก้ไข:</b> ${escHtml(doc.return_reason || lastReturn?.note || '')}</div>` : ''}

      <div class="projects-doc-files" data-projects-files-for="${escHtml(doc.id)}">
        <div class="projects-files-head">
          <span><i class="bi bi-paperclip me-1"></i>ไฟล์แนบ</span>
          ${(isVp && !isCancelled) ? `<label class="btn btn-sm btn-ghost">
            <i class="bi bi-cloud-upload me-1"></i>เพิ่มไฟล์
            <input type="file" hidden multiple data-projects-add-files="${escHtml(doc.id)}" />
          </label>` : ''}
        </div>
        <div class="projects-files-list" id="projectsFilesList-${escHtml(doc.id)}">
          <div class="text-muted small py-2"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลดไฟล์…</div>
        </div>
      </div>

      <div class="projects-doc-actions">
        ${(isUni && !isCompleted && !isCancelled) ? `
          ${doc.status === 'sent' ? `<button type="button" class="btn btn-sm btn-primary-soft" data-projects-doc-status="received" data-doc-id="${escHtml(doc.id)}"><i class="bi bi-inbox me-1"></i>รับเรื่อง</button>` : ''}
          ${(['received','sent'].includes(doc.status)) ? `<button type="button" class="btn btn-sm btn-warning-soft" data-projects-doc-status="in_progress" data-doc-id="${escHtml(doc.id)}"><i class="bi bi-arrow-repeat me-1"></i>กำลังดำเนินการ</button>` : ''}
          ${(['sent','received','in_progress','returned'].includes(doc.status)) ? `<button type="button" class="btn btn-sm btn-success-soft" data-projects-doc-status="completed" data-doc-id="${escHtml(doc.id)}"><i class="bi bi-check-circle me-1"></i>เสร็จสิ้น</button>` : ''}
          ${(['sent','received','in_progress'].includes(doc.status)) ? `<button type="button" class="btn btn-sm btn-danger-soft" data-projects-doc-return data-doc-id="${escHtml(doc.id)}"><i class="bi bi-arrow-counterclockwise me-1"></i>ส่งกลับให้แก้</button>` : ''}
        ` : ''}
        ${(isVp && !isCancelled) ? `
          <button type="button" class="btn btn-sm btn-ghost" data-projects-doc-comment data-doc-id="${escHtml(doc.id)}"><i class="bi bi-chat-left-text me-1"></i>คอมเมนต์</button>
          ${(['draft','sent','returned'].includes(doc.status)) ? `<button type="button" class="btn btn-sm btn-ghost" data-projects-doc-status="cancelled" data-doc-id="${escHtml(doc.id)}"><i class="bi bi-slash-circle me-1"></i>ยกเลิก/ถอน</button>` : ''}
          <button type="button" class="btn btn-sm btn-ghost text-danger" data-projects-doc-delete data-doc-id="${escHtml(doc.id)}"><i class="bi bi-trash me-1"></i>ลบ</button>
        ` : ''}
        ${(isUni && !isVp) ? `
          <button type="button" class="btn btn-sm btn-ghost" data-projects-doc-comment data-doc-id="${escHtml(doc.id)}"><i class="bi bi-chat-left-text me-1"></i>คอมเมนต์</button>
        ` : ''}
        <button type="button" class="btn btn-sm btn-ghost ms-auto" data-projects-copy-doc="${escHtml(doc.id)}" data-project-id="${escHtml(project.id)}">
          <i class="bi bi-link-45deg me-1"></i>คัดลอกลิงก์
        </button>
      </div>

      ${tlSorted.length ? renderTimeline(tlSorted) : ''}
    </div>
  `;
}

function renderProgressBar(stepIndex, isReturned, isCancelled, doc) {
  const steps = ['ส่งแล้ว', 'รับเรื่อง', 'ดำเนินการ', 'เสร็จสิ้น'];
  const wrapCls = isCancelled ? 'is-cancel-overlay' : (isReturned ? 'is-returned-overlay' : '');
  // When returned: clamp the visual progress to step 0 (still on "ส่ง") and
  // overlay a "ตีกลับ" tag on the first node so the user knows it bounced.
  const visualIdx = isReturned ? 0 : stepIndex;
  return `
    <div class="projects-progress ${wrapCls}">
      ${steps.map((label, i) => `
        <div class="projects-step ${i <= visualIdx ? 'is-done' : ''} ${i === visualIdx ? 'is-current' : ''}">
          <div class="projects-step-dot">${i < visualIdx ? '<i class="bi bi-check"></i>' : (i + 1)}</div>
          <div class="projects-step-label">${escHtml(label)}</div>
          ${i === 0 && isReturned ? '<div class="projects-step-overlay"><i class="bi bi-arrow-counterclockwise"></i> ตีกลับ</div>' : ''}
        </div>
      `).join('<div class="projects-step-bar"></div>')}
      ${isCancelled ? '<div class="projects-progress-cancel"><i class="bi bi-x-circle me-1"></i>ถูกยกเลิก</div>' : ''}
    </div>
  `;
}

function renderTimeline(tl) {
  return `
    <details class="projects-doc-timeline" ${tl.length <= 2 ? 'open' : ''}>
      <summary>ประวัติการดำเนินการ (${tl.length})</summary>
      <ol>
        ${tl.map((entry) => `
          <li>
            <span class="text-muted small">${escHtml(fmtDateTime(entry.at))}</span>
            ${entry.role ? `<span class="projects-tl-role ${escHtml(entry.role)}">${escHtml(roleLabel(entry.role))}</span>` : ''}
            <span class="projects-tl-action">${escHtml(actionLabel(entry.action))}</span>
            ${entry.note ? `<div class="projects-tl-note">${escHtml(entry.note)}</div>` : ''}
          </li>
        `).join('')}
      </ol>
    </details>
  `;
}

function roleLabel(r) {
  if (r === 'vp_admin') return 'รองนายกฝ่ายบริหาร';
  if (r === 'uni_staff') return 'พี่นิค (เจ้าหน้าที่)';
  if (r === 'dev')       return 'Dev';
  return r || '';
}

function actionLabel(a) {
  switch (a) {
    case 'sent':      return 'ส่งหนังสือ';
    case 'received':  return 'รับเรื่อง';
    case 'in_progress': return 'เริ่มดำเนินการ';
    case 'returned':  return 'ส่งกลับเพื่อแก้';
    case 'completed': return 'ปิดเรื่อง';
    case 'cancelled': return 'ยกเลิก';
    case 'comment':   return 'คอมเมนต์';
    case 'file_added':    return 'เพิ่มไฟล์';
    case 'file_replaced': return 'แทนที่ไฟล์';
    case 'draft':     return 'บันทึกร่าง';
    default:          return a || '';
  }
}

// ---------- table interactions (event delegation) ----------

function findRowDoc(el) {
  const tr = el.closest('[data-projects-row-doc]');
  if (!tr) return null;
  const docId = tr.dataset.projectsRowDoc;
  for (const p of cache.projects) {
    const d = (p.documents || []).find((x) => x.id === docId);
    if (d) return { doc: d, project: p };
  }
  return null;
}

function findProjectById(projectId) {
  return cache.projects.find((p) => p.id === projectId) || null;
}

function onTableClick(e) {
  // Project group actions
  const addBtn = e.target.closest('[data-projects-add-doc]');
  if (addBtn) {
    const project = findProjectById(addBtn.dataset.projectsAddDoc);
    if (project && onAddDocumentCb) onAddDocumentCb(project);
    return;
  }
  const copyProj = e.target.closest('[data-projects-copy-project]');
  if (copyProj) {
    copyToClipboard(`${window.location.origin}${window.location.pathname}#projects/${copyProj.dataset.projectsCopyProject}`, copyProj);
    return;
  }
  const copyDoc = e.target.closest('[data-projects-copy-doc]');
  if (copyDoc) {
    const pid = copyDoc.dataset.projectId;
    const did = copyDoc.dataset.projectsCopyDoc;
    copyToClipboard(`${window.location.origin}${window.location.pathname}#projects/${pid}/doc/${did}`, copyDoc);
    return;
  }
  const setProj = e.target.closest('[data-projects-set-project-status]');
  if (setProj) {
    onSetProjectStatus(setProj.dataset.projectId, setProj.dataset.projectsSetProjectStatus);
    return;
  }
  const delProj = e.target.closest('[data-projects-delete-project]');
  if (delProj) {
    onDeleteProject(delProj.dataset.projectsDeleteProject);
    return;
  }

  // Doc actions (inside expanded row)
  const statusBtn = e.target.closest('[data-projects-doc-status]');
  if (statusBtn) { onDocStatusClick(statusBtn); return; }
  const returnBtn = e.target.closest('[data-projects-doc-return]');
  if (returnBtn) { onDocReturnClick(returnBtn); return; }
  const cmtBtn = e.target.closest('[data-projects-doc-comment]');
  if (cmtBtn) { onDocCommentClick(cmtBtn); return; }
  const delBtn = e.target.closest('[data-projects-doc-delete]');
  if (delBtn) { onDocDeleteClick(delBtn); return; }

  // Expand toggle — anywhere on the row except action buttons / dropdowns
  if (e.target.closest('button, a, .dropdown-menu, label, input')) return;
  const found = findRowDoc(e.target);
  if (!found) return;
  toggleExpand(found.doc.id);
}

function onTableChange(e) {
  const addFiles = e.target.closest('[data-projects-add-files]');
  if (addFiles) { onDocAddFiles(e, addFiles.dataset.projectsAddFiles); return; }
  const replace = e.target.closest('[data-replace-for-file]');
  if (replace) { onReplaceFile(e, replace.dataset.replaceForFile, replace.closest('[data-projects-files-for]')?.dataset.projectsFilesFor); return; }
}

function toggleExpand(docId) {
  if (expanded.has(docId)) expanded.delete(docId);
  else expanded.add(docId);
  render();
}

async function onSetProjectStatus(projectId, next) {
  try {
    await updateProject(projectId, { status: next });
    onChanged();
  } catch (e) { alert(e.message || 'อัปเดตไม่สำเร็จ'); }
}

async function onDeleteProject(projectId) {
  const p = findProjectById(projectId);
  if (!p) return;
  if (!confirm(`ลบโครงการ "${p.name}" และหนังสือทั้งหมดในนี้? การกระทำนี้ย้อนกลับไม่ได้`)) return;
  try { await deleteProject(projectId); onChanged(); }
  catch (e) { alert(e.message || 'ลบไม่สำเร็จ'); }
}

// ---------- doc actions ----------

async function onDocStatusClick(btn) {
  const docId = btn.dataset.docId;
  const next  = btn.dataset.projectsDocStatus;
  const found = findRowDocById(docId);
  if (!found) return;
  const { project } = found;
  const user = getUser();
  const role = cache.role;
  const note = ({
    received:    'รับเรื่องแล้ว',
    in_progress: 'เริ่มดำเนินการ',
    completed:   'เสร็จสิ้น — ปิดเรื่อง',
    cancelled:   'ยกเลิก / ถอนหนังสือ',
  })[next] || `เปลี่ยนสถานะเป็น ${next}`;
  const patch = { status: next };
  if (next === 'received')  patch.received_at  = new Date().toISOString();
  if (next === 'completed') patch.completed_at = new Date().toISOString();
  if (next === 'cancelled') patch.completed_at = null;
  try {
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role,
      action: next,
      note,
    }, patch);
    const doc = await getDocument(docId).catch(() => null);
    if (role === 'uni_staff') {
      await notifyVpAdmin({
        kind: next === 'completed' ? 'completed' : 'status',
        project, document: doc,
        body: `${note} (หนังสือ ${doc?.sequence_no || ''} · ${doc?.title || ''})`,
      });
    } else if (role === 'vp_admin' && next === 'cancelled') {
      await notifyUniStaff({
        kind: 'status',
        project, document: doc,
        body: `VP ยกเลิกหนังสือ: ${doc?.title || ''}`,
        subject: `[MDKKU SAMO] ยกเลิกหนังสือ — ${project.name}`,
      });
    }
    onChanged();
  } catch (e) { alert(e.message || 'อัปเดตสถานะไม่สำเร็จ'); }
}

async function onDocReturnClick(btn) {
  const docId = btn.dataset.docId;
  const found = findRowDocById(docId);
  if (!found) return;
  const { project } = found;
  const reason = prompt('เหตุผลที่ส่งกลับให้ SAMO แก้ไข:');
  if (!reason || !reason.trim()) return;
  const user = getUser();
  try {
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'returned',
      note: reason.trim(),
    }, { status: 'returned', return_reason: reason.trim() });
    const doc = await getDocument(docId).catch(() => null);
    await notifyVpAdmin({
      kind: 'returned',
      project, document: doc,
      body: `ส่งกลับเพื่อแก้ไข: ${reason.trim()}`,
      title: `ส่งกลับ — ${doc?.title || ''}`,
    });
    onChanged();
  } catch (e) { alert(e.message || 'ส่งกลับไม่สำเร็จ'); }
}

async function onDocCommentClick(btn) {
  const docId = btn.dataset.docId;
  const found = findRowDocById(docId);
  if (!found) return;
  const { project } = found;
  const text = prompt('คอมเมนต์ / โน้ตเพิ่มเติม:');
  if (!text || !text.trim()) return;
  const user = getUser();
  try {
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'comment',
      note: text.trim(),
    });
    const doc = await getDocument(docId).catch(() => null);
    if (cache.role === 'uni_staff') {
      await notifyVpAdmin({ kind: 'comment', project, document: doc, body: text.trim(), title: `คอมเมนต์ใหม่ — ${doc?.title || ''}` });
    } else {
      await notifyUniStaff({ kind: 'comment', project, document: doc, body: text.trim(), subject: `[MDKKU SAMO] คอมเมนต์ใหม่ — ${project.name}` });
    }
    onChanged();
  } catch (e) { alert(e.message || 'บันทึกคอมเมนต์ไม่สำเร็จ'); }
}

async function onDocDeleteClick(btn) {
  const docId = btn.dataset.docId;
  if (!confirm('ลบหนังสือฉบับนี้และไฟล์แนบทั้งหมด? การกระทำนี้ย้อนกลับไม่ได้')) return;
  try {
    await deleteDocument(docId);
    expanded.delete(docId);
    onChanged();
  } catch (e) { alert(e.message || 'ลบไม่สำเร็จ'); }
}

async function onDocAddFiles(e, docId) {
  const input = e.currentTarget || e.target;
  const files = Array.from(input.files || []);
  if (files.length === 0) return;
  const found = findRowDocById(docId);
  if (!found) return;
  const { doc, project } = found;
  const folder = doc.drive_folder || buildDocFolderPath(project.id, project.name, doc.id, doc.type_id);
  const user = getUser();
  try {
    showFilesBusy(docId, 'กำลังอัปโหลด…');
    for (const f of files) {
      const uploaded = await uploadProjectFile(f, folder);
      await createFile({
        document_id: docId,
        file_name: f.name,
        drive_file_id: uploaded.fileId,
        drive_view_url: uploaded.url,
        mime_type: uploaded.mimeType,
        size_bytes: uploaded.sizeBytes,
        uploaded_by: user?.id || null,
      });
    }
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'file_added',
      note: `เพิ่มไฟล์ ${files.length} ไฟล์`,
    });
    await notifyUniStaff({
      kind: 'file_replaced',
      project, document: doc,
      body: `เพิ่มไฟล์ใหม่ ${files.length} ไฟล์ในหนังสือ "${doc.title}"`,
      subject: `[MDKKU SAMO] ไฟล์ใหม่ใน ${project.name}`,
    });
    onChanged();
  } catch (err) {
    alert(err.message || 'อัปโหลดไม่สำเร็จ');
  } finally {
    input.value = '';
  }
}

async function onReplaceFile(e, oldFileId, docId) {
  const input = e.currentTarget || e.target;
  const f = input.files?.[0];
  if (!f) return;
  const found = findRowDocById(docId);
  if (!found) return;
  const { doc, project } = found;
  const folder = doc.drive_folder || buildDocFolderPath(project.id, project.name, doc.id, doc.type_id);
  const user = getUser();
  try {
    showFilesBusy(docId, 'กำลังแทนที่ไฟล์…');
    const uploaded = await uploadProjectFile(f, folder);
    const newRow = await createFile({
      document_id: docId,
      file_name: f.name,
      drive_file_id: uploaded.fileId,
      drive_view_url: uploaded.url,
      mime_type: uploaded.mimeType,
      size_bytes: uploaded.sizeBytes,
      uploaded_by: user?.id || null,
    });
    await supersedeFile(oldFileId, newRow.id);
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'file_replaced',
      note: `แทนที่ไฟล์เป็น "${f.name}"`,
    });
    await notifyUniStaff({
      kind: 'file_replaced',
      project, document: doc,
      body: `แทนที่ไฟล์ในหนังสือ "${doc.title}" — เวอร์ชันใหม่: ${f.name}`,
      subject: `[MDKKU SAMO] แทนที่ไฟล์ — ${project.name}`,
    });
    onChanged();
  } catch (err) {
    alert(err.message || 'แทนที่ไฟล์ไม่สำเร็จ');
  } finally {
    input.value = '';
  }
}

function findRowDocById(docId) {
  for (const p of cache.projects) {
    const d = (p.documents || []).find((x) => x.id === docId);
    if (d) return { doc: d, project: p };
  }
  return null;
}

// ---------- files (lazy load per expanded row) ----------

async function loadFilesForDoc(docId) {
  const wrap = document.getElementById(`projectsFilesList-${docId}`);
  if (!wrap) return;
  try {
    const files = await listFiles(docId, { includeSuperseded: true });
    if (files.length === 0) {
      wrap.innerHTML = '<div class="text-muted small py-2">ยังไม่มีไฟล์แนบ</div>';
      return;
    }
    const supersedeFrom = new Map();
    for (const f of files) {
      if (f.superseded_by != null) {
        const arr = supersedeFrom.get(f.superseded_by) || [];
        arr.push(f);
        supersedeFrom.set(f.superseded_by, arr);
      }
    }
    const role = cache.role;
    const isVp = role === 'vp_admin' || role === 'dev';
    const active = files.filter((f) => f.superseded_by == null);
    wrap.innerHTML = active.map((f) => renderFileRow(f, supersedeFrom.get(f.id) || [], isVp)).join('') || '<div class="text-muted small py-2">ยังไม่มีไฟล์แนบ</div>';
  } catch (e) {
    wrap.innerHTML = `<div class="text-danger small py-2">โหลดไฟล์ไม่สำเร็จ: ${escHtml(e.message || e)}</div>`;
  }
}

function renderFileRow(f, superseded, isVp) {
  const ext = (f.file_name || '').split('.').pop()?.toLowerCase();
  const icon = iconForExt(ext);
  return `
    <div class="projects-file">
      <i class="bi ${icon} projects-file-icon"></i>
      <div class="projects-file-info">
        <a href="${safeUrl(f.drive_view_url)}" target="_blank" rel="noopener" class="projects-file-name">${escHtml(f.file_name)}</a>
        <div class="projects-file-meta">
          <span>${escHtml(fmtBytes(f.size_bytes))}</span>
          <span>·</span>
          <span>${escHtml(fmtDateTime(f.uploaded_at))}</span>
          ${superseded.length ? `<span>·</span><span class="text-warning">v${superseded.length + 1}</span>` : ''}
        </div>
      </div>
      ${isVp ? `<label class="btn btn-sm btn-ghost">
        <i class="bi bi-arrow-repeat"></i><span class="d-none d-md-inline ms-1">แทนที่</span>
        <input type="file" hidden data-replace-for-file="${f.id}" />
      </label>` : ''}
      ${superseded.length ? `
        <details class="projects-file-history">
          <summary>เวอร์ชันก่อนหน้า (${superseded.length})</summary>
          ${superseded.map((old) => `
            <div class="projects-file-old">
              <i class="bi bi-clock-history me-1"></i>
              <a href="${safeUrl(old.drive_view_url)}" target="_blank" rel="noopener">${escHtml(old.file_name)}</a>
              <span class="text-muted small ms-2">${escHtml(fmtDateTime(old.uploaded_at))}</span>
            </div>
          `).join('')}
        </details>
      ` : ''}
    </div>
  `;
}

function iconForExt(ext) {
  if (['pdf'].includes(ext)) return 'bi-file-earmark-pdf';
  if (['doc','docx'].includes(ext)) return 'bi-file-earmark-word';
  if (['xls','xlsx','csv'].includes(ext)) return 'bi-file-earmark-spreadsheet';
  if (['ppt','pptx'].includes(ext)) return 'bi-file-earmark-slides';
  if (['png','jpg','jpeg','webp','gif'].includes(ext)) return 'bi-file-earmark-image';
  if (['zip','rar','7z'].includes(ext)) return 'bi-file-earmark-zip';
  return 'bi-file-earmark';
}

function showFilesBusy(docId, msg) {
  const wrap = document.getElementById(`projectsFilesList-${docId}`);
  if (wrap) wrap.innerHTML = `<div class="text-muted small py-2"><span class="spinner-border spinner-border-sm me-2"></span>${escHtml(msg)}</div>`;
}

// ---------- utils ----------

async function copyToClipboard(url, srcEl) {
  try { await navigator.clipboard.writeText(url); flash(srcEl, 'คัดลอกแล้ว'); }
  catch { window.prompt('คัดลอกลิงก์:', url); }
}

function flash(el, text) {
  const original = el.innerHTML;
  el.innerHTML = `<i class="bi bi-check2 me-1"></i>${escHtml(text)}`;
  setTimeout(() => { el.innerHTML = original; }, 1400);
}

function cssEsc(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/["\\]/g, '\\$&');
}
