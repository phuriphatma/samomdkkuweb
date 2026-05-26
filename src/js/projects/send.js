// ==============================================
// PROJECTS SEND — create-project / send-document flows (VP-Admin)
//
// One Bootstrap modal (`#projectSendModal`) does double duty:
//   - "create + (optional) first document": user fills project name +
//     optionally checks "ส่งหนังสือฉบับแรกตอนนี้เลย" to expose the doc
//     fields. On submit we create the project, then (if doc fields
//     present) create the document + upload files + notify p'nick.
//   - "add document to existing project": project is preselected and
//     locked; only doc fields are shown.
//
// Files are uploaded sequentially with simple progress text. Each upload
// goes to GAS uploadProjectFile under
// `Projects/<projectId>_<slug>/<docId>_<typeId>/`.
// ==============================================

import { escHtml } from '../utils.js';
import { getUser } from '../auth.js';
import {
  createProject,
  createDocument,
  createFile,
  listDocTypes,
  updateDocument,
} from './api.js';
import { uploadProjectFile } from './uploads.js';
import { buildDocFolderPath } from './data.js';
import { notifyUniStaff } from './notify.js';
import { getCachedDocTypes } from './index.js';

let onCreated = () => {};
let modal = null;
let mode = 'create';   // 'create' | 'add-doc'
let lockedProject = null;
let pendingFiles = [];

export function mountSendFlow({ onCreated: cb } = {}) {
  if (typeof cb === 'function') onCreated = cb;
  const modalEl = document.getElementById('projectSendModal');
  if (!modalEl) return;
  modal = window.bootstrap?.Modal.getOrCreateInstance(modalEl);

  // Toggle "send first doc now"
  document.getElementById('projectSendIncludeDoc')?.addEventListener('change', (e) => {
    document.getElementById('projectSendDocSection')?.classList.toggle('d-none', !e.target.checked);
  });

  // File input
  const fileInput = document.getElementById('projectSendFiles');
  fileInput?.addEventListener('change', () => {
    pendingFiles = Array.from(fileInput.files || []);
    renderFileList();
  });

  // Drag-drop
  const drop = document.getElementById('projectSendDropZone');
  if (drop) {
    drop.addEventListener('dragover',  (e) => { e.preventDefault(); drop.classList.add('is-drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-drag');
      pendingFiles = Array.from(e.dataTransfer.files || []);
      renderFileList();
    });
  }

  // Remove staged file
  document.getElementById('projectSendFileList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-projects-remove-file]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.projectsRemoveFile, 10);
    pendingFiles.splice(idx, 1);
    renderFileList();
  });

  // Submit
  document.getElementById('projectSendForm')?.addEventListener('submit', onSubmit);

  // Reset state when the modal closes
  modalEl.addEventListener('hidden.bs.modal', () => {
    pendingFiles = [];
    lockedProject = null;
    mode = 'create';
    document.getElementById('projectSendForm')?.reset();
    document.getElementById('projectSendFileList').innerHTML = '';
    document.getElementById('projectSendStatus').textContent = '';
  });
}

export async function openCreateProject() {
  mode = 'create';
  lockedProject = null;
  pendingFiles = [];
  await populateDocTypes();
  const projWrap = document.getElementById('projectSendProjectFields');
  const lockWrap = document.getElementById('projectSendLockedProject');
  const includeCk = document.getElementById('projectSendIncludeDoc');
  const docSection = document.getElementById('projectSendDocSection');
  if (projWrap) projWrap.classList.remove('d-none');
  if (lockWrap) lockWrap.classList.add('d-none');
  if (includeCk) { includeCk.checked = false; }
  if (docSection) docSection.classList.add('d-none');
  document.getElementById('projectSendIncludeDocWrap')?.classList.remove('d-none');
  document.getElementById('projectSendTitle').textContent = 'สร้างโครงการใหม่';
  modal?.show();
}

export async function openSendDocument({ project }) {
  if (!project) return openCreateProject();
  mode = 'add-doc';
  lockedProject = project;
  pendingFiles = [];
  await populateDocTypes();
  const projWrap = document.getElementById('projectSendProjectFields');
  const lockWrap = document.getElementById('projectSendLockedProject');
  if (projWrap) projWrap.classList.add('d-none');
  if (lockWrap) {
    lockWrap.classList.remove('d-none');
    lockWrap.innerHTML = `
      <div class="alert alert-light border d-flex align-items-center gap-2 small mb-0" role="alert">
        <i class="bi bi-folder2-open fs-5 text-success"></i>
        <div>
          <div class="text-muted" style="font-size: 0.78rem;">เพิ่มหนังสือในโครงการ</div>
          <div class="fw-bold">${escHtml(project.name)} <span class="text-muted ms-1">${escHtml(project.id)}</span></div>
        </div>
      </div>
    `;
  }
  // In add-doc mode, the "include doc" toggle is meaningless — always show.
  document.getElementById('projectSendIncludeDocWrap')?.classList.add('d-none');
  document.getElementById('projectSendDocSection')?.classList.remove('d-none');
  document.getElementById('projectSendTitle').textContent = 'ส่งหนังสือใหม่';
  modal?.show();
}

async function populateDocTypes() {
  const sel = document.getElementById('projectSendDocType');
  if (!sel) return;
  let types = getCachedDocTypes();
  if (!types || types.length === 0) {
    try { types = await listDocTypes({ activeOnly: true }); } catch { types = []; }
  }
  sel.innerHTML = '<option value="">— เลือกประเภทหนังสือ —</option>'
    + (types || []).filter((t) => t.is_active).map((t) =>
      `<option value="${escHtml(t.id)}">${escHtml(t.label_th)}</option>`
    ).join('');
}

function renderFileList() {
  const wrap = document.getElementById('projectSendFileList');
  if (!wrap) return;
  if (pendingFiles.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = pendingFiles.map((f, i) => `
    <div class="projects-staged-file">
      <i class="bi bi-paperclip me-2 text-muted"></i>
      <span class="flex-grow-1 text-truncate">${escHtml(f.name)}</span>
      <span class="text-muted small mx-2">${escHtml(humanSize(f.size))}</span>
      <button type="button" class="btn btn-sm btn-ghost text-danger" data-projects-remove-file="${i}" aria-label="ลบ">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>
  `).join('');
}

function humanSize(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

async function onSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('projectSendSubmit');
  const status = document.getElementById('projectSendStatus');
  const original = btn.innerHTML;
  btn.disabled = true;
  status.textContent = '';

  const includeDoc = mode === 'add-doc'
    || document.getElementById('projectSendIncludeDoc')?.checked;
  const user = getUser();

  try {
    // 1) Project (create or use locked)
    let project = lockedProject;
    if (mode === 'create') {
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังสร้างโครงการ…';
      const name = document.getElementById('projectSendProjectName').value.trim();
      const desc = document.getElementById('projectSendProjectDesc').value.trim();
      if (!name) throw new Error('กรุณากรอกชื่อโครงการ');
      project = await createProject({ name, description: desc, createdBy: user?.id || null });
    }

    // 2) Document (optional)
    let doc = null;
    if (includeDoc) {
      const typeId = document.getElementById('projectSendDocType').value;
      const title = document.getElementById('projectSendDocTitle').value.trim();
      const note  = document.getElementById('projectSendDocNote').value.trim();
      if (!typeId) throw new Error('กรุณาเลือกประเภทหนังสือ');
      if (!title)  throw new Error('กรุณากรอกชื่อหนังสือ');

      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึกหนังสือ…';
      doc = await createDocument({
        projectId: project.id,
        typeId,
        title,
        note,
        driveFolder: buildDocFolderPath(project.id, project.name, '', typeId),
        createdBy: user?.id || null,
        status: pendingFiles.length === 0 ? 'sent' : 'sent',  // sent even with 0 files
      });

      // 3) Files (upload + insert rows)
      if (pendingFiles.length > 0) {
        const folder = buildDocFolderPath(project.id, project.name, doc.id, typeId);
        // Patch the document's drive_folder now that we have the real doc id.
        // (createDocument received an empty placeholder doc id segment.)
        try { await updateDocument(doc.id, { drive_folder: folder }); } catch {}

        for (let i = 0; i < pendingFiles.length; i++) {
          const f = pendingFiles[i];
          btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>กำลังอัปโหลด ${i + 1}/${pendingFiles.length}…`;
          status.textContent = `${f.name}`;
          const up = await uploadProjectFile(f, folder);
          await createFile({
            document_id: doc.id,
            file_name: f.name,
            drive_file_id: up.fileId,
            drive_view_url: up.url,
            mime_type: up.mimeType,
            size_bytes: up.sizeBytes,
            uploaded_by: user?.id || null,
          });
        }
      }

      // 4) Notify p'nick
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังแจ้งเตือน…';
      await notifyUniStaff({
        kind: 'sent',
        project,
        document: doc,
        body: `ส่งหนังสือใหม่ "${doc.title}" (หนังสือ ${doc.sequence_no}) — ${pendingFiles.length} ไฟล์แนบ${note ? `\n\nโน้ตจากผู้ส่ง: ${note}` : ''}`,
        subject: `[MDKKU SAMO] หนังสือใหม่: ${project.name} — ${doc.title}`,
      });
    }

    status.textContent = 'สำเร็จ';
    modal?.hide();
    onCreated();
  } catch (err) {
    status.textContent = '';
    alert(err.message || 'ไม่สามารถบันทึกได้');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}
