// ==============================================
// PROJECTS API — Supabase CRUD via dbRest()
//
// All writes use prefer: 'return=representation' + a length check so
// RLS denials surface as errors instead of silent success (mistakes.md).
// ==============================================

import { dbRest } from '../db.js';
import { genProjectId, genDocumentId } from './data.js';

// ---- Doc types ----

export async function listDocTypes({ activeOnly = true } = {}) {
  const filter = activeOnly ? '&is_active=eq.true' : '';
  const { data, error } = await dbRest(
    `/project_doc_types?select=*${filter}&order=sort_order.asc,label_th.asc`,
  );
  if (error) throw new Error(error.message || 'โหลดประเภทหนังสือไม่สำเร็จ');
  return data || [];
}

export async function upsertDocType(row) {
  if (!row?.id || !row?.label_th) throw new Error('id และ label_th จำเป็น');
  const { data, error } = await dbRest(
    `/project_doc_types?on_conflict=id`,
    {
      method: 'POST',
      body: row,
      prefer: 'return=representation,resolution=merge-duplicates',
    },
  );
  if (error) throw new Error(error.message || 'บันทึกประเภทหนังสือไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

// ---- Projects ----

const PROJECT_FIELDS = '*,documents:project_documents(*)';

export async function listProjects({ status } = {}) {
  const filter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
  const { data, error } = await dbRest(
    `/projects?select=${PROJECT_FIELDS}${filter}&order=created_at.desc`,
  );
  if (error) throw new Error(error.message || 'โหลดโครงการไม่สำเร็จ');
  return data || [];
}

export async function getProject(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/projects?select=${PROJECT_FIELDS}&id=eq.${idEsc}`,
  );
  if (error) throw new Error(error.message || 'โหลดโครงการไม่สำเร็จ');
  return (data && data[0]) || null;
}

export async function createProject({ name, description, createdBy }) {
  if (!name) throw new Error('ต้องระบุชื่อโครงการ');
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = genProjectId();
    const row = {
      id,
      name,
      description: description || null,
      status: 'open',
      created_by: createdBy || null,
    };
    const { data, error } = await dbRest(
      '/projects',
      { method: 'POST', body: row, prefer: 'return=representation' },
    );
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique')) { lastErr = error; continue; }
      throw new Error(error.message || 'สร้างโครงการไม่สำเร็จ');
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('สร้างโครงการไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
    }
    return data[0];
  }
  throw new Error(lastErr?.message || 'สร้างโครงการไม่สำเร็จ (เลขซ้ำ)');
}

export async function updateProject(id, patch) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/projects?id=eq.${idEsc}`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'อัปเดตโครงการไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('อัปเดตโครงการไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return data[0];
}

export async function deleteProject(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/projects?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบโครงการไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบโครงการไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return true;
}

// ---- Documents ----

const DOC_FIELDS = '*,files:project_files(*)';

export async function listDocuments({ projectId, status } = {}) {
  const parts = ['select=' + encodeURIComponent(DOC_FIELDS), 'order=sent_at.desc.nullslast,created_at.desc'];
  if (projectId) parts.push(`project_id=eq.${encodeURIComponent(projectId)}`);
  if (status)    parts.push(`status=eq.${encodeURIComponent(status)}`);
  const { data, error } = await dbRest(`/project_documents?${parts.join('&')}`);
  if (error) throw new Error(error.message || 'โหลดหนังสือไม่สำเร็จ');
  return data || [];
}

export async function getDocument(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/project_documents?select=${DOC_FIELDS}&id=eq.${idEsc}`,
  );
  if (error) throw new Error(error.message || 'โหลดหนังสือไม่สำเร็จ');
  return (data && data[0]) || null;
}

/** Allocate the next sequence_no for a project. */
export async function nextSequenceNo(projectId) {
  const projEsc = encodeURIComponent(projectId);
  const { data, error } = await dbRest(
    `/project_documents?select=sequence_no&project_id=eq.${projEsc}&order=sequence_no.desc&limit=1`,
  );
  if (error) throw new Error(error.message || 'คำนวณลำดับหนังสือไม่สำเร็จ');
  const top = (data && data[0]?.sequence_no) || 0;
  return top + 1;
}

export async function createDocument({ projectId, typeId, title, note, driveFolder, createdBy, status = 'sent' }) {
  if (!projectId) throw new Error('project_id required');
  if (!typeId)    throw new Error('type_id required');
  if (!title)     throw new Error('ต้องระบุชื่อหนังสือ');
  const seq = await nextSequenceNo(projectId);
  const now = new Date().toISOString();
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = genDocumentId();
    const row = {
      id,
      project_id: projectId,
      type_id: typeId,
      title,
      note: note || null,
      sequence_no: seq,
      status,
      sent_at: status === 'sent' ? now : null,
      timeline: [{
        at: now,
        by: createdBy || null,
        role: 'vp_admin',
        action: status === 'sent' ? 'sent' : 'draft',
        note: status === 'sent' ? 'ส่งหนังสือ' : 'สร้างฉบับร่าง',
      }],
      drive_folder: driveFolder || null,
      created_by: createdBy || null,
    };
    const { data, error } = await dbRest(
      '/project_documents',
      { method: 'POST', body: row, prefer: 'return=representation' },
    );
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique')) { lastErr = error; continue; }
      throw new Error(error.message || 'สร้างหนังสือไม่สำเร็จ');
    }
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('สร้างหนังสือไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
    }
    return data[0];
  }
  throw new Error(lastErr?.message || 'สร้างหนังสือไม่สำเร็จ (เลขซ้ำ)');
}

/** Update arbitrary fields on a document. */
export async function updateDocument(id, patch) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/project_documents?id=eq.${idEsc}`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'อัปเดตหนังสือไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('อัปเดตหนังสือไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return data[0];
}

/**
 * Append a timeline entry AND patch the status / timestamps in one PATCH.
 * Re-reads the current row to merge the timeline server-side-safely.
 */
export async function appendDocTimeline(id, entry, extra = {}) {
  const current = await getDocument(id);
  if (!current) throw new Error('ไม่พบหนังสือ');
  const timeline = Array.isArray(current.timeline) ? current.timeline.slice() : [];
  timeline.push({ at: new Date().toISOString(), ...entry });
  return updateDocument(id, { timeline, ...extra });
}

export async function deleteDocument(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/project_documents?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบหนังสือไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบหนังสือไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return true;
}

// ---- Files ----

export async function listFiles(documentId, { includeSuperseded = false } = {}) {
  const docEsc = encodeURIComponent(documentId);
  const sup = includeSuperseded ? '' : '&superseded_by=is.null';
  const { data, error } = await dbRest(
    `/project_files?select=*&document_id=eq.${docEsc}${sup}&order=uploaded_at.asc`,
  );
  if (error) throw new Error(error.message || 'โหลดไฟล์ไม่สำเร็จ');
  return data || [];
}

export async function createFile(row) {
  if (!row?.document_id || !row?.drive_view_url) throw new Error('document_id และ drive_view_url required');
  const { data, error } = await dbRest(
    '/project_files',
    { method: 'POST', body: row, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'บันทึกไฟล์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกไฟล์ไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

/** Mark an old file superseded by a new one (non-destructive replace). */
export async function supersedeFile(oldId, newId) {
  const oldIdEsc = encodeURIComponent(oldId);
  const { data, error } = await dbRest(
    `/project_files?id=eq.${oldIdEsc}`,
    { method: 'PATCH', body: { superseded_by: newId }, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'แทนที่ไฟล์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('แทนที่ไฟล์ไม่สำเร็จ (RLS หรือไม่พบ id)');
  }
  return data[0];
}

// ---- Notifications ----

export async function listMyNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  if (!userId) return [];
  const idEsc = encodeURIComponent(userId);
  const unread = unreadOnly ? '&is_read=eq.false' : '';
  const { data, error } = await dbRest(
    `/project_notifications?select=*&user_id=eq.${idEsc}${unread}&order=created_at.desc&limit=${limit}`,
  );
  if (error) throw new Error(error.message || 'โหลดการแจ้งเตือนไม่สำเร็จ');
  return data || [];
}

export async function countMyUnread(userId) {
  if (!userId) return 0;
  const idEsc = encodeURIComponent(userId);
  const { data, error } = await dbRest(
    `/project_notifications?select=id&user_id=eq.${idEsc}&is_read=eq.false`,
    { headers: { Prefer: 'count=exact' } },
  );
  if (error) return 0;
  return Array.isArray(data) ? data.length : 0;
}

export async function createNotification(row) {
  if (!row?.user_id || !row?.kind || !row?.body) throw new Error('user_id, kind, body required');
  // NOTE: do NOT ask for return=representation. The row's user_id is the
  // RECIPIENT (uni_staff), but the SELECT policy on project_notifications
  // is `user_id = auth.uid()`. Postgres requires INSERT...RETURNING rows
  // to pass the SELECT policy too, so the post-insert read would fail
  // for the SENDER (vp_admin) and the whole INSERT is rejected with
  // "new row violates row-level security policy" — same wording as a
  // WITH CHECK failure, which makes it look like an RLS-WITH-CHECK bug.
  // Fire-and-forget: callers ignore the return value.
  const { error } = await dbRest(
    '/project_notifications',
    { method: 'POST', body: row, prefer: 'return=minimal' },
  );
  if (error) { console.warn('[projects] notification insert failed:', error.message); return null; }
  return null;
}

export async function markNotificationRead(id) {
  const idEsc = encodeURIComponent(id);
  const { error } = await dbRest(
    `/project_notifications?id=eq.${idEsc}`,
    { method: 'PATCH', body: { is_read: true } },
  );
  return !error;
}

export async function markAllNotificationsRead(userId) {
  if (!userId) return false;
  const idEsc = encodeURIComponent(userId);
  const { error } = await dbRest(
    `/project_notifications?user_id=eq.${idEsc}&is_read=eq.false`,
    { method: 'PATCH', body: { is_read: true } },
  );
  return !error;
}

// ---- Settings ----

export async function getSettings() {
  const { data, error } = await dbRest('/project_settings?id=eq.1&select=*');
  if (error) throw new Error(error.message || 'โหลดการตั้งค่าไม่สำเร็จ');
  return (data && data[0]) || null;
}

export async function saveSettings(patch) {
  const { data, error } = await dbRest(
    '/project_settings?id=eq.1',
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'บันทึกการตั้งค่าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกการตั้งค่าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

// ---- Recipient lookup ----

/** Find the uni_staff or vp_admin user(s). Used to address notifications. */
export async function listUsersByRole(role) {
  const { data, error } = await dbRest(
    `/users?select=id,email,username,display_name,role&role=eq.${encodeURIComponent(role)}`,
  );
  if (error) return [];
  return data || [];
}
