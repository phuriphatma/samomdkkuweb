// ==============================================
// PROJECTS SIGN — "ส่งให้อาจารย์ลงนาม" picker (uni_staff → saprof)
//
// A modal (`#projectSignModal`) that lists a หนังสือ's active files with
// checkboxes so sastaff can pick a SUBSET to send to the professor for
// signing (e.g. the final PDFs, not the private docx drafts). Submit
// creates a project_sign_requests row addressed to the sa_prof user and
// pings the professor (in-app + email).
// ==============================================

import { escHtml } from '../utils.js';
import { getUser } from '../auth.js';
import { listFiles, createSignRequest, listUsersByRole } from './api.js';
import { fmtBytes } from './data.js';
import { notifyProf } from './notify.js';

let onSent = () => {};
let modal = null;
let ctxDoc = null;
let ctxProject = null;
let files = [];

function isPdf(f) {
  const e = (f.file_name || '').split('.').pop()?.toLowerCase();
  return e === 'pdf' || /pdf/i.test(f.mime_type || '');
}

export function mountSignFlow({ onSent: cb } = {}) {
  if (typeof cb === 'function') onSent = cb;
  const el = document.getElementById('projectSignModal');
  if (!el) return;
  modal = window.bootstrap?.Modal.getOrCreateInstance(el);
  document.getElementById('projectSignForm')?.addEventListener('submit', onSubmit);
  // Bulk-select helpers — default is NO files checked, so these give a fast
  // way to grab the usual targets (all PDFs) or everything.
  const setAll = (pred) => document
    .querySelectorAll('#projectSignFileList input[type=checkbox]')
    .forEach((cb) => { cb.checked = pred(cb); });
  document.getElementById('projectSignSelectPdf')?.addEventListener('click',
    () => setAll((cb) => cb.dataset.isPdf === '1'));
  document.getElementById('projectSignSelectAll')?.addEventListener('click',
    () => setAll(() => true));
  document.getElementById('projectSignClear')?.addEventListener('click',
    () => setAll(() => false));
  el.addEventListener('hidden.bs.modal', () => {
    ctxDoc = null; ctxProject = null; files = [];
    const list = document.getElementById('projectSignFileList');
    if (list) list.innerHTML = '';
    const note = document.getElementById('projectSignNote');
    if (note) note.value = '';
    const status = document.getElementById('projectSignStatus');
    if (status) status.textContent = '';
  });
}

export async function openSignRequest({ doc, project }) {
  if (!doc || !project) return;
  ctxDoc = doc;
  ctxProject = project;
  const label = document.getElementById('projectSignDocLabel');
  if (label) label.textContent = `${project.name} — ${doc.title} (#${doc.sequence_no || ''})`;
  const list = document.getElementById('projectSignFileList');
  if (list) list.innerHTML = '<div class="text-muted small py-2"><span class="spinner-border spinner-border-sm me-2"></span>กำลังโหลดไฟล์…</div>';
  modal?.show();
  try {
    files = (await listFiles(doc.id, { includeSuperseded: false })).filter((f) => !f.is_signed);
  } catch { files = []; }
  renderPickList();
}

function renderPickList() {
  const list = document.getElementById('projectSignFileList');
  if (!list) return;
  if (files.length === 0) {
    list.innerHTML = '<div class="text-muted small py-2">หนังสือนี้ยังไม่มีไฟล์แนบให้ส่ง</div>';
    return;
  }
  // Default = NOTHING checked (the user picks explicitly). The toolbar's
  // "เลือก PDF ทั้งหมด" / "เลือกทั้งหมด" buttons use data-is-pdf to bulk-select.
  list.innerHTML = files.map((f) => `
    <label class="projects-sign-pick">
      <input type="checkbox" class="form-check-input me-2" value="${escHtml(f.id)}" data-is-pdf="${isPdf(f) ? '1' : '0'}" />
      <span class="flex-grow-1 text-truncate">${escHtml(f.file_name)}</span>
      <span class="text-muted small ms-2">${escHtml(fmtBytes(f.size_bytes))}</span>
    </label>`).join('');
}

async function onSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('projectSignSubmit');
  const status = document.getElementById('projectSignStatus');
  const ids = Array.from(document.querySelectorAll('#projectSignFileList input:checked'))
    .map((i) => Number(i.value)).filter(Boolean);
  if (ids.length === 0) { if (status) status.textContent = 'เลือกไฟล์อย่างน้อย 1 ไฟล์'; return; }
  const note = (document.getElementById('projectSignNote')?.value || '').trim();
  const user = getUser();
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังส่ง…';
  if (status) status.textContent = '';
  try {
    const profs = await listUsersByRole('sa_prof');
    const profId = profs?.[0]?.id || null;
    if (!profId) throw new Error('ยังไม่มีบัญชีอาจารย์ในระบบ (seed saprof ก่อน)');
    await createSignRequest({
      documentId: ctxDoc.id,
      profId,
      fileIds: ids,
      note,
      requestedBy: user?.id || null,
    });
    notifyProf({
      kind: 'sign_requested',
      project: ctxProject,
      document: ctxDoc,
      body: `มีหนังสือใหม่ให้ลงนาม: "${ctxDoc.title}" (${ids.length} ไฟล์)${note ? `\n\nโน้ต: ${note}` : ''}`,
      subject: `[MDKKU SAMO] ลงนามหนังสือ — ${ctxProject.name}`,
    }).catch(() => {});
    const focus = { projectId: ctxProject.id, documentId: ctxDoc.id };
    modal?.hide();
    onSent(focus);
  } catch (err) {
    if (status) status.textContent = err.message || 'ส่งไม่สำเร็จ';
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}
