// ==============================================
// PROJECTS INBOX — list (left) + detail panel (right)
//
// The "inbox" is a unified view for both roles:
//   - VP-Admin sees projects they sent + status of each document
//   - uni_staff sees the same — every project + every doc — but the
//     action buttons in the detail panel differ (sender vs receiver)
// On mobile, the detail panel takes over the screen on click (back btn).
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { getUser } from '../auth.js';
import {
  getProject,
  getDocument,
  updateProject,
  deleteProject,
  updateDocument,
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
let selectedProjectId = null;     // null = empty state
let selectedDocumentId = null;    // null = show project overview
let filterStatus = 'all';
let searchQ = '';

// ---------- mounting ----------

export function mountInbox({ onChanged: changed, onAddDocument }) {
  if (typeof changed === 'function') onChanged = changed;
  if (typeof onAddDocument === 'function') onAddDocumentCb = onAddDocument;

  document.getElementById('projectsFilterRow')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-projects-filter]');
    if (!chip) return;
    filterStatus = chip.dataset.projectsFilter;
    refreshList();
  });
  document.getElementById('projectsSearchInput')?.addEventListener('input', (e) => {
    searchQ = (e.target.value || '').toLowerCase().trim();
    refreshList();
  });
  document.getElementById('projectsList')?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-project-id]');
    if (!card) return;
    selectedProjectId = card.dataset.projectId;
    selectedDocumentId = null;
    document.querySelector('.projects-layout')?.classList.add('is-detail-open');
    refreshDetail();
    refreshList();      // re-highlight active card
    history.replaceState(null, '', `#projects/${selectedProjectId}`);
  });
  document.getElementById('projectsDetailBack')?.addEventListener('click', () => {
    document.querySelector('.projects-layout')?.classList.remove('is-detail-open');
  });
}

// ---------- public renderers ----------

export function renderInbox(next) {
  cache = { ...cache, ...next };
  renderFilterChips();
  refreshList();
  refreshDetail();
}

export function openProjectDetail(projectId) {
  selectedProjectId = projectId;
  selectedDocumentId = null;
  document.querySelector('.projects-layout')?.classList.add('is-detail-open');
  refreshList();
  refreshDetail();
}

export async function openDocumentDetail(documentId) {
  // Locate the parent project via cached data; if not there, fetch.
  let projectId = null;
  for (const p of cache.projects) {
    if (Array.isArray(p.documents) && p.documents.some((d) => d.id === documentId)) {
      projectId = p.id; break;
    }
  }
  if (!projectId) {
    const doc = await getDocument(documentId).catch(() => null);
    projectId = doc?.project_id || null;
  }
  if (!projectId) return;
  selectedProjectId = projectId;
  selectedDocumentId = documentId;
  document.querySelector('.projects-layout')?.classList.add('is-detail-open');
  refreshList();
  refreshDetail();
}

// ---------- filter chips ----------

function renderFilterChips() {
  const row = document.getElementById('projectsFilterRow');
  if (!row) return;
  const chips = [
    { id: 'all',         label: 'ทั้งหมด' },
    { id: 'open',        label: 'เปิดรับ' },
    { id: 'in_progress', label: 'กำลังดำเนินการ' },
    { id: 'completed',   label: 'เสร็จสิ้น' },
    { id: 'cancelled',   label: 'ยกเลิก' },
  ];
  row.innerHTML = chips.map((c) =>
    `<button type="button" class="projects-chip ${c.id === filterStatus ? 'is-active' : ''}" data-projects-filter="${c.id}">${escHtml(c.label)}</button>`
  ).join('');
}

// ---------- list (left pane) ----------

function refreshList() {
  const list = document.getElementById('projectsList');
  const empty = document.getElementById('projectsListEmpty');
  if (!list) return;

  let rows = cache.projects.slice();
  if (filterStatus !== 'all') rows = rows.filter((p) => p.status === filterStatus);
  if (searchQ) {
    rows = rows.filter((p) =>
      (p.name || '').toLowerCase().includes(searchQ)
      || (p.id || '').toLowerCase().includes(searchQ)
      || (p.description || '').toLowerCase().includes(searchQ)
    );
  }

  if (rows.length === 0) {
    list.innerHTML = '';
    if (empty) empty.classList.remove('d-none');
    return;
  }
  if (empty) empty.classList.add('d-none');

  list.innerHTML = rows.map((p) => renderProjectCard(p)).join('');
}

function renderProjectCard(p) {
  const docs = Array.isArray(p.documents) ? p.documents : [];
  const total = docs.length;
  const inflight = docs.filter((d) => ['sent', 'received', 'in_progress', 'returned'].includes(d.status)).length;
  const done = docs.filter((d) => d.status === 'completed').length;
  const meta = PROJECT_STATUS_META[p.status] || PROJECT_STATUS_META.open;
  const active = p.id === selectedProjectId ? 'is-active' : '';
  const recent = docs.slice().sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))[0];
  return `
    <button type="button" class="projects-card ${active}" data-project-id="${escHtml(p.id)}">
      <div class="projects-card-head">
        <span class="projects-status-pill ${meta.cls}"><i class="bi ${meta.icon} me-1"></i>${escHtml(meta.label)}</span>
        <span class="projects-card-id">${escHtml(p.id)}</span>
      </div>
      <div class="projects-card-title">${escHtml(p.name)}</div>
      ${p.description ? `<div class="projects-card-sub">${escHtml(p.description).slice(0, 140)}</div>` : ''}
      <div class="projects-card-meta">
        <span><i class="bi bi-files me-1"></i>${total} หนังสือ</span>
        ${inflight ? `<span class="text-warning"><i class="bi bi-arrow-repeat me-1"></i>${inflight} ดำเนินการ</span>` : ''}
        ${done ? `<span class="text-success"><i class="bi bi-check-circle me-1"></i>${done} เสร็จ</span>` : ''}
      </div>
      <div class="projects-card-foot">
        <span>${escHtml(recent ? fmtRelative(recent.updated_at || recent.created_at) : fmtRelative(p.created_at))}</span>
      </div>
    </button>
  `;
}

// ---------- detail (right pane) ----------

function refreshDetail() {
  const root = document.getElementById('projectsDetail');
  if (!root) return;
  if (!selectedProjectId) {
    root.innerHTML = renderEmptyDetail();
    return;
  }
  const project = cache.projects.find((p) => p.id === selectedProjectId);
  if (!project) {
    root.innerHTML = renderEmptyDetail('ไม่พบโครงการ');
    return;
  }
  root.innerHTML = renderDetail(project);
  wireDetailActions(project);
}

function renderEmptyDetail(msg) {
  return `
    <div class="projects-detail-empty">
      <i class="bi bi-folder2-open"></i>
      <h4>${escHtml(msg || 'เลือกโครงการเพื่อดูรายละเอียด')}</h4>
      <p>แตะที่การ์ดทางซ้ายเพื่อเปิดหนังสือทั้งหมดในโครงการ</p>
    </div>
  `;
}

function renderDetail(project) {
  const meta = PROJECT_STATUS_META[project.status] || PROJECT_STATUS_META.open;
  const docs = (Array.isArray(project.documents) ? project.documents : []).slice()
    .sort((a, b) => (a.sequence_no || 0) - (b.sequence_no || 0));
  const role = cache.role;
  const canEditProject = role === 'vp_admin' || role === 'dev';

  return `
    <div class="projects-detail-head">
      <button type="button" class="projects-back-btn d-md-none" id="projectsDetailBackMobile" aria-label="กลับ"><i class="bi bi-chevron-left"></i></button>
      <div class="projects-detail-id">${escHtml(project.id)} · ${escHtml(fmtDate(project.created_at))}</div>
      <div class="projects-detail-title">${escHtml(project.name)}</div>
      ${project.description ? `<div class="projects-detail-desc">${escHtml(project.description)}</div>` : ''}
      <div class="projects-detail-meta">
        <span class="projects-status-pill ${meta.cls}"><i class="bi ${meta.icon} me-1"></i>${escHtml(meta.label)}</span>
        <span class="text-muted small">${docs.length} หนังสือในโครงการนี้</span>
      </div>
      <div class="projects-detail-actions">
        <button type="button" class="btn btn-sm btn-primary-soft" data-projects-role="vp_admin" id="projectsAddDocBtn">
          <i class="bi bi-plus-lg me-1"></i> เพิ่มหนังสือ
        </button>
        ${canEditProject ? `
          <div class="dropdown d-inline-block">
            <button type="button" class="btn btn-sm btn-ghost dropdown-toggle" data-bs-toggle="dropdown" aria-expanded="false">
              <i class="bi bi-three-dots"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><h6 class="dropdown-header">เปลี่ยนสถานะโครงการ</h6></li>
              ${['open','in_progress','completed','cancelled'].map((s) =>
                `<li><button class="dropdown-item ${s===project.status?'active':''}" type="button" data-projects-set-status="${s}"><i class="bi ${PROJECT_STATUS_META[s].icon} me-2"></i>${escHtml(PROJECT_STATUS_META[s].label)}</button></li>`
              ).join('')}
              <li><hr class="dropdown-divider"></li>
              <li><button class="dropdown-item text-danger" type="button" data-projects-delete-project>
                <i class="bi bi-trash me-2"></i>ลบโครงการ (ลบหนังสือทั้งหมดด้วย)
              </button></li>
            </ul>
          </div>
        ` : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-projects-copy-link>
          <i class="bi bi-link-45deg me-1"></i> คัดลอกลิงก์
        </button>
      </div>
    </div>

    <div class="projects-docs-wrap">
      ${docs.length === 0
        ? `<div class="projects-detail-empty small"><i class="bi bi-inbox"></i><h4>ยังไม่มีหนังสือในโครงการนี้</h4><p data-projects-role="vp_admin">กด "เพิ่มหนังสือ" ด้านบนเพื่อส่งหนังสือฉบับแรก</p></div>`
        : docs.map((d) => renderDocBlock(d, project)).join('')}
    </div>
  `;
}

function renderDocBlock(doc, project) {
  const meta = DOC_STATUS_META[doc.status] || DOC_STATUS_META.sent;
  const type = (cache.docTypes || []).find((t) => t.id === doc.type_id);
  const stepIndex = DOC_PATH_ORDER.indexOf(doc.status);
  const onPath = stepIndex >= 0;
  const isReturned  = doc.status === 'returned';
  const isCancelled = doc.status === 'cancelled';
  const isCompleted = doc.status === 'completed';
  const role = cache.role;
  const isVp = role === 'vp_admin' || role === 'dev';
  const isUni = role === 'uni_staff' || role === 'dev';

  return `
    <article class="projects-doc" data-projects-doc-id="${escHtml(doc.id)}">
      <header class="projects-doc-head">
        <div class="projects-doc-seq">หนังสือ ${doc.sequence_no || 1}</div>
        <div class="projects-doc-title">${escHtml(doc.title)}</div>
        <div class="projects-doc-meta">
          <span class="projects-type-pill">${escHtml(type?.label_th || doc.type_id)}</span>
          <span class="projects-status-pill ${meta.cls}"><i class="bi ${meta.icon} me-1"></i>${escHtml(meta.label)}</span>
          <span class="text-muted small">${escHtml(doc.id)}</span>
        </div>
      </header>

      ${renderProgressBar(stepIndex, isReturned, isCancelled)}

      ${doc.note ? `<div class="projects-doc-note"><i class="bi bi-chat-square-quote me-1"></i>${escHtml(doc.note)}</div>` : ''}
      ${isReturned && doc.return_reason ? `<div class="projects-doc-return"><b>ส่งกลับเพื่อแก้ไข:</b> ${escHtml(doc.return_reason)}</div>` : ''}

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
      </div>

      ${renderTimeline(doc)}
    </article>
  `;
}

function renderProgressBar(stepIndex, isReturned, isCancelled) {
  if (isCancelled) {
    return `<div class="projects-progress is-cancel"><i class="bi bi-x-circle me-1"></i>หนังสือฉบับนี้ถูกยกเลิก</div>`;
  }
  if (isReturned) {
    return `<div class="projects-progress is-returned"><i class="bi bi-arrow-counterclockwise me-1"></i>ส่งกลับเพื่อแก้ไข — รอ SAMO ส่งใหม่</div>`;
  }
  const steps = ['ส่งแล้ว', 'รับเรื่อง', 'ดำเนินการ', 'เสร็จสิ้น'];
  return `
    <div class="projects-progress">
      ${steps.map((label, i) => `
        <div class="projects-step ${i <= stepIndex ? 'is-done' : ''} ${i === stepIndex ? 'is-current' : ''}">
          <div class="projects-step-dot">${i < stepIndex ? '<i class="bi bi-check"></i>' : (i + 1)}</div>
          <div class="projects-step-label">${escHtml(label)}</div>
        </div>
      `).join('<div class="projects-step-bar"></div>')}
    </div>
  `;
}

function renderTimeline(doc) {
  const tl = Array.isArray(doc.timeline) ? doc.timeline.slice() : [];
  if (tl.length === 0) return '';
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

// ---------- detail panel wiring ----------

function wireDetailActions(project) {
  // Mobile back
  document.getElementById('projectsDetailBackMobile')?.addEventListener('click', () => {
    document.querySelector('.projects-layout')?.classList.remove('is-detail-open');
  });

  // Copy deep link
  const copy = document.querySelector('[data-projects-copy-link]');
  if (copy) copy.addEventListener('click', async () => {
    const url = `${window.location.origin}${window.location.pathname}#projects/${project.id}`;
    try { await navigator.clipboard.writeText(url); flash(copy, 'คัดลอกแล้ว'); }
    catch { window.prompt('คัดลอกลิงก์:', url); }
  });

  // Add document
  document.getElementById('projectsAddDocBtn')?.addEventListener('click', () => {
    if (onAddDocumentCb) onAddDocumentCb(project);
  });

  // Project status menu
  document.querySelectorAll('[data-projects-set-status]').forEach((el) => {
    el.addEventListener('click', async () => {
      const next = el.dataset.projectsSetStatus;
      try {
        await updateProject(project.id, { status: next });
        onChanged();
      } catch (e) { alert(e.message || 'อัปเดตไม่สำเร็จ'); }
    });
  });

  // Delete project
  document.querySelector('[data-projects-delete-project]')?.addEventListener('click', async () => {
    if (!confirm(`ลบโครงการ "${project.name}" และหนังสือทั้งหมดในนี้? การกระทำนี้ย้อนกลับไม่ได้`)) return;
    try { await deleteProject(project.id); selectedProjectId = null; onChanged(); }
    catch (e) { alert(e.message || 'ลบไม่สำเร็จ'); }
  });

  // Per-doc actions
  document.querySelectorAll('[data-projects-doc-status]').forEach((btn) => {
    btn.addEventListener('click', () => onDocStatusClick(btn, project));
  });
  document.querySelectorAll('[data-projects-doc-return]').forEach((btn) => {
    btn.addEventListener('click', () => onDocReturnClick(btn, project));
  });
  document.querySelectorAll('[data-projects-doc-comment]').forEach((btn) => {
    btn.addEventListener('click', () => onDocCommentClick(btn, project));
  });
  document.querySelectorAll('[data-projects-doc-delete]').forEach((btn) => {
    btn.addEventListener('click', () => onDocDeleteClick(btn, project));
  });
  document.querySelectorAll('[data-projects-add-files]').forEach((input) => {
    input.addEventListener('change', (e) => onDocAddFiles(e, input.dataset.projectsAddFiles, project));
  });

  // Load files for each doc block
  const docs = Array.isArray(project.documents) ? project.documents : [];
  for (const d of docs) loadFilesForDoc(d.id);
}

async function loadFilesForDoc(docId) {
  const wrap = document.getElementById(`projectsFilesList-${docId}`);
  if (!wrap) return;
  try {
    const files = await listFiles(docId, { includeSuperseded: true });
    if (files.length === 0) {
      wrap.innerHTML = '<div class="text-muted small py-2">ยังไม่มีไฟล์แนบ</div>';
      return;
    }
    // Group by supersede chain — only show "active" (not superseded), with
    // a "previous versions" disclosure below.
    const byId = new Map(files.map((f) => [f.id, f]));
    const supersedeFrom = new Map(); // newId -> [oldFile]
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
    wrap.innerHTML = active.map((f) => renderFileRow(f, supersedeFrom.get(f.id) || [], isVp, docId)).join('') || '<div class="text-muted small py-2">ยังไม่มีไฟล์แนบ</div>';

    // Wire replace buttons
    wrap.querySelectorAll('[data-projects-replace-file]').forEach((label) => {
      const input = label.querySelector('input[type=file]');
      if (!input) return;
      input.addEventListener('change', (e) => onReplaceFile(e, input.dataset.replaceForFile, docId));
    });
  } catch (e) {
    wrap.innerHTML = `<div class="text-danger small py-2">โหลดไฟล์ไม่สำเร็จ: ${escHtml(e.message || e)}</div>`;
  }
}

function renderFileRow(f, superseded, isVp, docId) {
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
      ${isVp ? `<label class="btn btn-sm btn-ghost" data-projects-replace-file>
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

// ---------- per-doc actions ----------

async function onDocStatusClick(btn, project) {
  const docId = btn.dataset.docId;
  const next  = btn.dataset.projectsDocStatus;
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

    // Notify the other side. uni_staff actions ping VP-Admin via Discord;
    // VP-Admin "cancel" pings uni_staff in-app.
    const doc = await getDocument(docId).catch(() => null);
    if (role === 'uni_staff') {
      await notifyVpAdmin({
        kind: next === 'completed' ? 'completed' : next === 'cancelled' ? 'status' : 'status',
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

async function onDocReturnClick(btn, project) {
  const docId = btn.dataset.docId;
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

async function onDocCommentClick(btn, project) {
  const docId = btn.dataset.docId;
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

async function onDocDeleteClick(btn, project) {
  const docId = btn.dataset.docId;
  if (!confirm('ลบหนังสือฉบับนี้และไฟล์แนบทั้งหมด? การกระทำนี้ย้อนกลับไม่ได้')) return;
  try {
    await deleteDocument(docId);
    if (selectedDocumentId === docId) selectedDocumentId = null;
    onChanged();
  } catch (e) { alert(e.message || 'ลบไม่สำเร็จ'); }
}

async function onDocAddFiles(e, docId, project) {
  const input = e.currentTarget;
  const files = Array.from(input.files || []);
  if (files.length === 0) return;
  const doc = (project.documents || []).find((d) => d.id === docId);
  if (!doc) return;
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
  const input = e.currentTarget;
  const f = input.files?.[0];
  if (!f) return;
  const project = cache.projects.find((p) => p.id === selectedProjectId);
  const doc = (project?.documents || []).find((d) => d.id === docId);
  if (!project || !doc) return;
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

function showFilesBusy(docId, msg) {
  const wrap = document.getElementById(`projectsFilesList-${docId}`);
  if (wrap) wrap.innerHTML = `<div class="text-muted small py-2"><span class="spinner-border spinner-border-sm me-2"></span>${escHtml(msg)}</div>`;
}

function flash(el, text) {
  const original = el.innerHTML;
  el.innerHTML = `<i class="bi bi-check2 me-1"></i>${escHtml(text)}`;
  setTimeout(() => { el.innerHTML = original; }, 1400);
}
