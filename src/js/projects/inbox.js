// ==============================================
// PROJECTS INBOX — two-level drill-down
//
// Level 1 (grid):    one card per โครงการ, scannable like Google Drive.
//                    Filter chips + search + per-card "X ของฉัน" badge.
// Level 2 (detail):  click a project → breadcrumb back, project header
//                    with actions, list of its หนังสือ as compact cards.
//                    Click a doc card → expand inline with the 4-step
//                    stepper + files + actions + timeline.
//
// Both roles see the same shape; only the action buttons inside the
// expanded doc differ.
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
  fmtDate,
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

let level    = 'grid';     // 'grid' | 'detail'
let selectedProjectId = null;
let expandedDocs = new Set();   // doc ids expanded inside the detail view
let filterKind = 'all';    // 'mine' | 'waiting' | 'done' | 'all'
let searchQ    = '';

// Deferred actions, applied at the end of render()
let scrollDocId = null;

// ---------- helpers: next-actor / "is mine" ----------

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
  if (role === 'uni_staff') return settings?.uni_label || 'เจ้าหน้าที่';
  if (role === 'vp_admin')  return settings?.vp_label  || 'SAMO';
  return '—';
}

function isMine(doc, role) {
  const o = nextOwner(doc);
  if (!o) return false;
  if (role === 'dev') return true;
  return o === role;
}

/** Project-level rollup used by the grid: which bucket does this project fall in? */
function projectBucket(p, role) {
  const docs = p.documents || [];
  if (docs.length === 0) return 'empty';
  const active = docs.filter((d) => !['completed', 'cancelled'].includes(d.status));
  if (active.length === 0) return 'done';
  const hasMine = active.some((d) => isMine(d, role));
  if (hasMine) return 'mine';
  return 'waiting';
}

/** Counts for the level-1 filter chips, computed once per render(). */
function projectBucketCounts(role) {
  const c = { mine: 0, waiting: 0, done: 0, all: 0 };
  for (const p of cache.projects) {
    c.all += 1;
    const b = projectBucket(p, role);
    if (b === 'mine') c.mine += 1;
    else if (b === 'waiting') c.waiting += 1;
    else if (b === 'done') c.done += 1;
  }
  return c;
}

function lastActivityTime(p) {
  let t = new Date(p.updated_at || p.created_at).getTime() || 0;
  for (const d of (p.documents || [])) {
    const dt = new Date(d.updated_at || d.sent_at || d.created_at).getTime() || 0;
    if (dt > t) t = dt;
  }
  return t;
}

// ---------- mounting ----------

export function mountInbox({ onChanged: changed, onAddDocument }) {
  if (typeof changed === 'function') onChanged = changed;
  if (typeof onAddDocument === 'function') onAddDocumentCb = onAddDocument;

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

  document.getElementById('projectsBackToGrid')?.addEventListener('click', () => {
    level = 'grid';
    selectedProjectId = null;
    expandedDocs.clear();
    history.replaceState(null, '', '#projects');
    render();
  });

  // Delegated handlers — one for clicks, one for change (file inputs)
  const inbox = document.querySelector('[data-projects-pane="inbox"]');
  inbox?.addEventListener('click', onInboxClick);
  inbox?.addEventListener('change', onInboxChange);
}

// ---------- public renderers (entry points) ----------

export function renderInbox(next) {
  cache = { ...cache, ...next };
  render();
}

export function openProjectDetail(projectId) {
  selectedProjectId = projectId;
  level = 'detail';
  render();
}

export async function openDocumentDetail(documentId) {
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
  selectedProjectId = found.project.id;
  level = 'detail';
  expandedDocs.add(documentId);
  scrollDocId = documentId;
  render();
}

// ---------- main render ----------

function render() {
  const gridRoot   = document.getElementById('projectsLevelGrid');
  const detailRoot = document.getElementById('projectsLevelDetail');
  if (!gridRoot || !detailRoot) return;

  if (level === 'grid') {
    gridRoot.classList.remove('d-none');
    detailRoot.classList.add('d-none');
    renderFilterChips();
    renderGrid();
  } else {
    gridRoot.classList.add('d-none');
    detailRoot.classList.remove('d-none');
    renderDetail();
    // Lazy-load files for any expanded doc
    expandedDocs.forEach((docId) => {
      if (document.getElementById(`projectsFilesList-${docId}`)) loadFilesForDoc(docId);
    });
    if (scrollDocId) {
      requestAnimationFrame(() => {
        const t = document.querySelector(`[data-projects-doc-id="${cssEsc(scrollDocId)}"]`);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        scrollDocId = null;
      });
    }
  }
}

// ---------- Level 1: filter chips + project grid ----------

function renderFilterChips() {
  const row = document.getElementById('projectsFilterRow');
  if (!row) return;
  const c = projectBucketCounts(cache.role);
  const chips = [
    { id: 'mine',    label: 'ของฉัน',    count: c.mine,    cls: 'is-mine' },
    { id: 'waiting', label: 'รออีกฝ่าย', count: c.waiting, cls: 'is-wait' },
    { id: 'done',    label: 'เสร็จสิ้น',  count: c.done,    cls: 'is-done' },
    { id: 'all',     label: 'ทั้งหมด',   count: c.all,     cls: 'is-all' },
  ];
  row.innerHTML = chips.map((k) => `
    <button type="button" class="projects-chip ${k.cls} ${k.id === filterKind ? 'is-active' : ''}"
      data-projects-filter="${k.id}">
      <span>${escHtml(k.label)}</span>
      <span class="projects-chip-count">${k.count}</span>
    </button>
  `).join('');
}

function renderGrid() {
  const grid  = document.getElementById('projectsGrid');
  const empty = document.getElementById('projectsGridEmpty');
  if (!grid) return;

  let rows = cache.projects.slice();
  // Filter by bucket
  const role = cache.role;
  if (filterKind === 'mine')    rows = rows.filter((p) => projectBucket(p, role) === 'mine');
  else if (filterKind === 'waiting') rows = rows.filter((p) => projectBucket(p, role) === 'waiting');
  else if (filterKind === 'done')    rows = rows.filter((p) => projectBucket(p, role) === 'done');
  // Search
  if (searchQ) {
    rows = rows.filter((p) =>
      (p.name || '').toLowerCase().includes(searchQ)
      || (p.id   || '').toLowerCase().includes(searchQ)
      || (p.description || '').toLowerCase().includes(searchQ)
    );
  }
  // Sort by recency
  rows.sort((a, b) => lastActivityTime(b) - lastActivityTime(a));

  if (rows.length === 0) {
    grid.innerHTML = '';
    empty?.classList.remove('d-none');
    return;
  }
  empty?.classList.add('d-none');
  grid.innerHTML = rows.map(renderProjectCard).join('');
}

function renderProjectCard(p) {
  const role = cache.role;
  const docs = p.documents || [];
  const total    = docs.length;
  const sent     = docs.filter((d) => d.status === 'sent').length;
  const returned = docs.filter((d) => d.status === 'returned').length;
  const bucket = projectBucket(p, role);
  const lastTouch = lastActivityTime(p);

  // One attention badge per role. Card stays minimal otherwise — drill in
  // to see per-status detail. Notifications fan out via notifyUniStaff /
  // notifyVpAdmin so the badge count auto-updates on the next refresh
  // when more docs are sent.
  let badge = '';
  if (role === 'uni_staff' && sent > 0) {
    badge = `<span class="projects-card-attn-badge is-new" title="หนังสือใหม่ ยังไม่ได้รับเรื่อง">
      <i class="bi bi-bell-fill"></i> ${sent} ใหม่
    </span>`;
  } else if (role === 'vp_admin' && returned > 0) {
    badge = `<span class="projects-card-attn-badge is-return" title="หนังสือถูกตีกลับ ต้องแก้ไข">
      <i class="bi bi-arrow-counterclockwise"></i> ${returned} ตีกลับ
    </span>`;
  } else if (role === 'dev') {
    const parts = [];
    if (sent > 0)     parts.push(`<span class="projects-card-attn-badge is-new"><i class="bi bi-bell-fill"></i> ${sent} ใหม่</span>`);
    if (returned > 0) parts.push(`<span class="projects-card-attn-badge is-return"><i class="bi bi-arrow-counterclockwise"></i> ${returned} ตีกลับ</span>`);
    badge = parts.join(' ');
  }

  return `
    <button type="button" class="projects-card-grid is-bucket-${bucket}" data-projects-open-project="${escHtml(p.id)}">
      <div class="projects-card-head">
        <span class="projects-card-icon"><i class="bi bi-folder2-open"></i></span>
        <div class="projects-card-title-wrap">
          <div class="projects-card-name">${escHtml(p.name)}</div>
          <div class="projects-card-id">${escHtml(p.id)}</div>
        </div>
        ${badge}
      </div>
      ${p.description ? `<div class="projects-card-desc">${escHtml(p.description)}</div>` : ''}
      <div class="projects-card-foot">
        <span class="projects-card-foot-stat"><i class="bi bi-files me-1"></i>${total} หนังสือ</span>
        <span class="projects-card-last"><i class="bi bi-clock-history me-1"></i>${escHtml(fmtRelative(lastTouch))}</span>
      </div>
    </button>
  `;
}

// ---------- Level 2: project detail (breadcrumb + header + doc list) ----------

function renderDetail() {
  const root = document.getElementById('projectsDetailRoot');
  if (!root) return;
  const project = cache.projects.find((p) => p.id === selectedProjectId);
  if (!project) {
    root.innerHTML = `<div class="projects-empty"><i class="bi bi-folder-x"></i><h4>ไม่พบโครงการ</h4></div>`;
    return;
  }
  const meta = PROJECT_STATUS_META[project.status] || PROJECT_STATUS_META.open;
  const docs = (project.documents || []).slice()
    .sort((a, b) => new Date(b.sent_at || b.updated_at || b.created_at) - new Date(a.sent_at || a.updated_at || a.created_at));
  const role = cache.role;
  const canManage = role === 'vp_admin' || role === 'dev';

  root.innerHTML = `
    <header class="projects-detail-head">
      <div class="projects-detail-id">${escHtml(project.id)} · ${escHtml(fmtDate(project.created_at))}</div>
      <h2 class="projects-detail-title">${escHtml(project.name)}</h2>
      ${project.description ? `<p class="projects-detail-desc">${escHtml(project.description)}</p>` : ''}
      <div class="projects-detail-meta">
        <span class="projects-status-pill ${meta.cls}"><i class="bi ${meta.icon} me-1"></i>${escHtml(meta.label)}</span>
        <span class="text-muted small">${docs.length} หนังสือในโครงการนี้</span>
      </div>
      <div class="projects-detail-actions">
        ${canManage ? `<button type="button" class="btn btn-sm btn-primary-soft" data-projects-add-doc="${escHtml(project.id)}">
          <i class="bi bi-plus-lg me-1"></i> เพิ่มหนังสือ
        </button>` : ''}
        ${canManage ? `
          <div class="dropdown d-inline-block">
            <button type="button" class="btn btn-sm btn-ghost dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
              <i class="bi bi-three-dots"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><h6 class="dropdown-header">เปลี่ยนสถานะโครงการ</h6></li>
              ${['open','in_progress','completed','cancelled'].map((s) =>
                `<li><button class="dropdown-item ${s===project.status?'active':''}" type="button"
                    data-projects-set-project-status="${s}" data-project-id="${escHtml(project.id)}">
                    <i class="bi ${PROJECT_STATUS_META[s].icon} me-2"></i>${escHtml(PROJECT_STATUS_META[s].label)}
                  </button></li>`).join('')}
              <li><hr class="dropdown-divider"></li>
              <li><button class="dropdown-item text-danger" type="button"
                data-projects-delete-project="${escHtml(project.id)}">
                <i class="bi bi-trash me-2"></i>ลบโครงการ (ลบหนังสือทั้งหมดด้วย)
              </button></li>
            </ul>
          </div>
        ` : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-projects-copy-project="${escHtml(project.id)}" title="คัดลอกลิงก์โครงการ">
          <i class="bi bi-link-45deg me-1"></i> คัดลอกลิงก์
        </button>
      </div>
    </header>

    <div class="projects-doc-list">
      ${docs.length === 0
        ? `<div class="projects-empty small"><i class="bi bi-inbox"></i><h4>ยังไม่มีหนังสือในโครงการนี้</h4>${canManage ? `<p>กด "เพิ่มหนังสือ" ด้านบนเพื่อส่งหนังสือฉบับแรก</p>` : ''}</div>`
        : docs.map((d) => renderDocCard(d, project)).join('')}
    </div>
  `;
}

function renderDocCard(doc, project) {
  const m = DOC_STATUS_META[doc.status] || DOC_STATUS_META.sent;
  const type = (cache.docTypes || []).find((t) => t.id === doc.type_id);
  const isOpen = expandedDocs.has(doc.id);
  const mineDot = isMine(doc, cache.role) ? '<span class="projects-row-mine-dot" title="ของฉัน"></span>' : '';
  const hasUpdate = shouldShowUpdateBanner(doc, cache.role);
  const updateBadge = hasUpdate
    ? `<span class="projects-doc-update-pill"><i class="bi bi-bell-fill me-1"></i>อัปเดต</span>`
    : '';

  return `
    <article class="projects-doc-card ${isOpen ? 'is-open' : ''} ${hasUpdate ? 'has-update' : ''}" data-projects-doc-id="${escHtml(doc.id)}">
      <header class="projects-doc-card-head" data-projects-doc-toggle="${escHtml(doc.id)}">
        ${mineDot}
        <span class="projects-doc-seq-mini">#${doc.sequence_no || 1}</span>
        <div class="projects-doc-card-title-wrap">
          <div class="projects-doc-card-title">${escHtml(doc.title)}</div>
          <div class="projects-doc-card-sub">
            <span class="projects-type-pill">${escHtml(type?.label_th || doc.type_id)}</span>
            <span class="projects-cell-mono d-none d-md-inline">${escHtml(doc.id)}</span>
          </div>
        </div>
        ${updateBadge}
        <span class="projects-status-pill ${m.cls}"><i class="bi ${m.icon} me-1"></i>${escHtml(m.label)}</span>
        <span class="projects-doc-card-time text-muted small">${escHtml(fmtRelative(doc.updated_at || doc.created_at))}</span>
        <button type="button" class="projects-row-expand" aria-label="ขยาย/ย่อ" aria-expanded="${isOpen}">
          <i class="bi bi-chevron-${isOpen ? 'up' : 'down'}"></i>
        </button>
      </header>
      ${isOpen ? `<div class="projects-doc-card-body">${renderDocExpand(doc, project)}</div>` : ''}
    </article>
  `;
}

function renderDocExpand(doc, project) {
  const stepIndex = DOC_PATH_ORDER.indexOf(doc.status);
  const isReturned  = doc.status === 'returned';
  const isCancelled = doc.status === 'cancelled';
  const isCompleted = doc.status === 'completed';
  const role = cache.role;
  const isVp  = role === 'vp_admin' || role === 'dev';
  const isUni = role === 'uni_staff' || role === 'dev';
  const tlSorted = (doc.timeline || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at));

  return `
    ${renderRecentUpdateBanner(doc, role)}

    ${renderProgressBar(stepIndex, isReturned, isCancelled)}

    ${doc.note ? `<div class="projects-doc-note"><i class="bi bi-chat-square-quote me-1"></i>${escHtml(doc.note)}</div>` : ''}

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
      ${(isVp && isReturned) ? `<button type="button" class="btn btn-sm btn-primary-soft" data-projects-doc-resend data-doc-id="${escHtml(doc.id)}">
        <i class="bi bi-send-arrow-up me-1"></i>ส่งใหม่อีกครั้ง
      </button>` : ''}
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
  `;
}

/** Does the current viewer have an open action that needs the "what changed" banner? */
function shouldShowUpdateBanner(doc, role) {
  if (role === 'uni_staff') return doc.status === 'sent';
  if (role === 'vp_admin')  return doc.status === 'returned';
  return false;
}

/**
 * Renders a compact callout above the stepper summarising the most recent
 * action from the other side — what specifically changed that you need to
 * react to. Returns '' when not applicable (your turn isn't open, or no
 * other-side action exists yet).
 */
function renderRecentUpdateBanner(doc, role) {
  if (!shouldShowUpdateBanner(doc, role)) return '';
  const tl = doc.timeline || [];
  // Most-recent-first scan for the relevant other-side actions
  const myRole = role;
  const relevantActions = role === 'uni_staff'
    ? ['sent', 'file_added', 'file_replaced']
    : ['returned', 'comment'];
  // Collect ALL relevant entries since the current user's most recent action
  // (so we summarise everything they need to see, not just the latest one).
  const cuts = [];
  for (let i = tl.length - 1; i >= 0; i--) {
    const e = tl[i];
    if (e.role === myRole) break;  // stop at the viewer's own most-recent entry
    if (!relevantActions.includes(e.action)) continue;
    if (e.role && e.role === myRole) continue;
    cuts.push(e);
  }
  if (cuts.length === 0) return '';
  cuts.reverse(); // oldest first within the chunk

  const headerLabel = role === 'uni_staff' ? 'เปลี่ยนแปลงจาก SAMO' : 'เจ้าหน้าที่ตีกลับ';
  const headerCls   = role === 'uni_staff' ? 'is-update' : 'is-return';
  const headerIcon  = role === 'uni_staff' ? 'bi-bell-fill' : 'bi-arrow-counterclockwise';
  const lines = cuts.map((e) => {
    const label = ({
      sent:          'ส่งใหม่อีกครั้ง',
      file_added:    'เพิ่มไฟล์',
      file_replaced: 'แทนที่ไฟล์',
      returned:      'ตีกลับเพื่อแก้ไข',
      comment:       'คอมเมนต์',
    })[e.action] || e.action;
    const icon  = ({
      sent:          'bi-send-arrow-up',
      file_added:    'bi-cloud-plus-fill',
      file_replaced: 'bi-arrow-repeat',
      returned:      'bi-arrow-counterclockwise',
      comment:       'bi-chat-left-text',
    })[e.action] || 'bi-dot';
    return `
      <li class="projects-update-line">
        <i class="bi ${icon}"></i>
        <span class="projects-update-line-label">${escHtml(label)}</span>
        ${e.note ? `<span class="projects-update-line-note">${escHtml(e.note)}</span>` : ''}
        <span class="projects-update-line-time">${escHtml(fmtRelative(e.at))}</span>
      </li>
    `;
  }).join('');

  return `
    <div class="projects-update-banner ${headerCls}">
      <div class="projects-update-banner-head">
        <i class="bi ${headerIcon}"></i>
        <span>${escHtml(headerLabel)}</span>
        <span class="projects-update-banner-count">${cuts.length}</span>
      </div>
      <ul class="projects-update-list">${lines}</ul>
    </div>
  `;
}

function renderProgressBar(stepIndex, isReturned, isCancelled) {
  const steps = ['ส่งแล้ว', 'รับเรื่อง', 'ดำเนินการ', 'เสร็จสิ้น'];
  const wrapCls = isCancelled ? 'is-cancel-overlay' : (isReturned ? 'is-returned-overlay' : '');
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
  if (r === 'vp_admin')  return 'SAMO VP';
  if (r === 'uni_staff') return 'เจ้าหน้าที่';
  if (r === 'dev')       return 'Dev';
  return r || '';
}

function actionLabel(a) {
  switch (a) {
    case 'sent':         return 'ส่งหนังสือ';
    case 'received':     return 'รับเรื่อง';
    case 'in_progress':  return 'เริ่มดำเนินการ';
    case 'returned':     return 'ส่งกลับเพื่อแก้';
    case 'completed':    return 'ปิดเรื่อง';
    case 'cancelled':    return 'ยกเลิก';
    case 'comment':      return 'คอมเมนต์';
    case 'file_added':   return 'เพิ่มไฟล์';
    case 'file_replaced':return 'แทนที่ไฟล์';
    case 'draft':        return 'บันทึกร่าง';
    default:             return a || '';
  }
}

// ---------- delegated event handlers ----------

function onInboxClick(e) {
  // Level 1: open project card
  const openCard = e.target.closest('[data-projects-open-project]');
  if (openCard) {
    selectedProjectId = openCard.dataset.projectsOpenProject;
    level = 'detail';
    history.replaceState(null, '', `#projects/${selectedProjectId}`);
    render();
    return;
  }

  // Level 2 / detail: doc toggle
  const docToggle = e.target.closest('[data-projects-doc-toggle]');
  if (docToggle && !e.target.closest('button, a, input, label, .dropdown-menu')) {
    const id = docToggle.dataset.projectsDocToggle;
    if (expandedDocs.has(id)) expandedDocs.delete(id);
    else expandedDocs.add(id);
    render();
    return;
  }
  // (The chevron button itself bubbles here too — the if-guard above excludes
  //  it. Special-case: the .projects-row-expand button intentionally toggles.)
  const expandBtn = e.target.closest('.projects-row-expand');
  if (expandBtn) {
    const card = expandBtn.closest('[data-projects-doc-id]');
    if (card) {
      const id = card.dataset.projectsDocId;
      if (expandedDocs.has(id)) expandedDocs.delete(id);
      else expandedDocs.add(id);
      render();
    }
    return;
  }

  // Project actions
  const addBtn = e.target.closest('[data-projects-add-doc]');
  if (addBtn) {
    const project = cache.projects.find((p) => p.id === addBtn.dataset.projectsAddDoc);
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

  // Doc actions
  const statusBtn = e.target.closest('[data-projects-doc-status]');
  if (statusBtn) { onDocStatusClick(statusBtn); return; }
  const returnBtn = e.target.closest('[data-projects-doc-return]');
  if (returnBtn) { onDocReturnClick(returnBtn); return; }
  const resendBtn = e.target.closest('[data-projects-doc-resend]');
  if (resendBtn) { onDocResendClick(resendBtn); return; }
  const cmtBtn = e.target.closest('[data-projects-doc-comment]');
  if (cmtBtn) { onDocCommentClick(cmtBtn); return; }
  const delBtn = e.target.closest('[data-projects-doc-delete]');
  if (delBtn) { onDocDeleteClick(delBtn); return; }
}

function onInboxChange(e) {
  const addFiles = e.target.closest('[data-projects-add-files]');
  if (addFiles) { onDocAddFiles(e, addFiles.dataset.projectsAddFiles); return; }
  const replace = e.target.closest('[data-replace-for-file]');
  if (replace) {
    const docId = replace.closest('[data-projects-files-for]')?.dataset.projectsFilesFor;
    onReplaceFile(e, replace.dataset.replaceForFile, docId);
  }
}

// ---------- project actions ----------

async function onSetProjectStatus(projectId, next) {
  try {
    await updateProject(projectId, { status: next });
    onChanged();
  } catch (e) { alert(e.message || 'อัปเดตไม่สำเร็จ'); }
}

async function onDeleteProject(projectId) {
  const p = cache.projects.find((x) => x.id === projectId);
  if (!p) return;
  if (!confirm(`ลบโครงการ "${p.name}" และหนังสือทั้งหมดในนี้? การกระทำนี้ย้อนกลับไม่ได้`)) return;
  try {
    await deleteProject(projectId);
    if (selectedProjectId === projectId) {
      selectedProjectId = null;
      level = 'grid';
      history.replaceState(null, '', '#projects');
    }
    onChanged();
  } catch (e) { alert(e.message || 'ลบไม่สำเร็จ'); }
}

// ---------- doc actions ----------

function findDocById(docId) {
  for (const p of cache.projects) {
    const d = (p.documents || []).find((x) => x.id === docId);
    if (d) return { doc: d, project: p };
  }
  return null;
}

async function onDocStatusClick(btn) {
  const docId = btn.dataset.docId;
  const next  = btn.dataset.projectsDocStatus;
  const found = findDocById(docId);
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
  const found = findDocById(docId);
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

async function onDocResendClick(btn) {
  const docId = btn.dataset.docId;
  const found = findDocById(docId);
  if (!found) return;
  const { project } = found;
  const summary = prompt('สรุปสิ่งที่แก้ไข / เปลี่ยนแปลง (เพื่อแจ้งให้เจ้าหน้าที่ทราบ):');
  if (summary === null) return;   // user cancelled
  const note = summary.trim() || 'ส่งใหม่หลังตีกลับ (ไม่ได้ระบุการเปลี่ยนแปลง)';
  const user = getUser();
  try {
    await appendDocTimeline(docId, {
      by: user?.id || null,
      role: cache.role,
      action: 'sent',
      note,
    }, { status: 'sent', return_reason: null });
    const doc = await getDocument(docId).catch(() => null);
    await notifyUniStaff({
      kind: 'resent',
      project, document: doc,
      body: `SAMO ส่งหนังสือใหม่อีกครั้ง: ${note}`,
      subject: `[MDKKU SAMO] ส่งใหม่ — ${project.name}`,
    });
    onChanged();
  } catch (e) { alert(e.message || 'ส่งใหม่ไม่สำเร็จ'); }
}

async function onDocCommentClick(btn) {
  const docId = btn.dataset.docId;
  const found = findDocById(docId);
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
    expandedDocs.delete(docId);
    onChanged();
  } catch (e) { alert(e.message || 'ลบไม่สำเร็จ'); }
}

async function onDocAddFiles(e, docId) {
  const input = e.target;
  const files = Array.from(input.files || []);
  if (files.length === 0) return;
  const found = findDocById(docId);
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
      kind: 'file_added',
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
  const input = e.target;
  const f = input.files?.[0];
  if (!f) return;
  const found = findDocById(docId);
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

// ---------- files (lazy load per expanded doc) ----------

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
    const doc = findDocById(docId)?.doc;
    const lastActed = doc ? myLastActionTime(doc, role) : 0;
    wrap.innerHTML = active.map((f) => {
      const preds = supersedeFrom.get(f.id) || [];
      const newness = fileNewnessForRole(f, preds, lastActed, role);
      return renderFileRow(f, preds, isVp, newness);
    }).join('') || '<div class="text-muted small py-2">ยังไม่มีไฟล์แนบ</div>';
  } catch (e) {
    wrap.innerHTML = `<div class="text-danger small py-2">โหลดไฟล์ไม่สำเร็จ: ${escHtml(e.message || e)}</div>`;
  }
}

/** Timestamp of the current role's most recent timeline action on this doc.
 *  0 means "never acted" — for uni_staff on a fresh sent doc, this lights up
 *  every attached file as ใหม่ on first open. */
function myLastActionTime(doc, role) {
  const tl = doc.timeline || [];
  for (let i = tl.length - 1; i >= 0; i--) {
    if (tl[i].role === role) {
      const t = new Date(tl[i].at).getTime();
      if (!isNaN(t)) return t;
    }
  }
  return 0;
}

/** Returns 'new' | 'replaced' | null based on whether this file changed since
 *  the viewer's last action. VPA uploaded the files themselves — skip the
 *  highlight for them. */
function fileNewnessForRole(file, predecessors, lastActed, role) {
  if (role === 'vp_admin') return null;
  const uploaded = new Date(file.uploaded_at).getTime();
  if (isNaN(uploaded)) return null;
  if (lastActed > 0 && uploaded <= lastActed) return null;
  return predecessors.length > 0 ? 'replaced' : 'new';
}

function renderFileRow(f, superseded, isVp, newness) {
  const ext = (f.file_name || '').split('.').pop()?.toLowerCase();
  const icon = iconForExt(ext);
  const newnessCls   = newness ? `is-${newness}` : '';
  const newnessBadge = newness === 'new'
    ? `<span class="projects-file-newness-pill is-new"><i class="bi bi-stars me-1"></i>ใหม่</span>`
    : newness === 'replaced'
    ? `<span class="projects-file-newness-pill is-replaced"><i class="bi bi-arrow-repeat me-1"></i>แทนที่ใหม่</span>`
    : '';
  return `
    <div class="projects-file ${newnessCls}">
      <i class="bi ${icon} projects-file-icon"></i>
      <div class="projects-file-info">
        <div class="projects-file-name-row">
          <a href="${safeUrl(f.drive_view_url)}" target="_blank" rel="noopener" class="projects-file-name">${escHtml(f.file_name)}</a>
          ${newnessBadge}
        </div>
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
