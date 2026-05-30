// ==============================================
// PROJECTS UPLOADS — Drive uploads via GAS uploadProjectFile
//
// Mirrors src/js/shop/uploads.js. Each call posts the file as base64
// to GAS with a logical folder path under `Projects/...`. GAS walks
// the path lazily, creating any missing folders.
// ==============================================

import { GAS_API_URL } from '../config.js';

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = (e) => resolve(e.target.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/**
 * Upload `file` to Drive into `folderPath` (must start with `Projects/`).
 * Returns { url, fileId, mimeType, sizeBytes }. `url` is Drive's viewer
 * URL (`/file/d/<id>/view`) — opens PDFs/images inline and prompts
 * "Open with Google Docs" for Office docs. Don't rewrite to the thumbnail
 * form here; that's only useful for images embedded via <img>.
 *
 * @param {File} file
 * @param {string} folderPath e.g. 'Projects/PRJ-K3X7_kickoff/DOC-AB2KX_project'
 * @param {{ fileName?: string }} [opts]
 */
export async function uploadProjectFile(file, folderPath, opts = {}) {
  if (!file) throw new Error('No file');
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('folderPath is required');
  }
  if (!folderPath.startsWith('Projects')) {
    throw new Error('folderPath must start with Projects');
  }
  const base64 = await readAsDataURL(file);
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'uploadProjectFile',
      folderPath,
      fileName: opts.fileName || file.name,
      mimeType: file.type,
      fileData: base64,
    }),
  });
  const result = await res.json();
  if (!result.success || !result.fileUrl) {
    throw new Error(result.message || 'อัปโหลดไฟล์ไม่สำเร็จ');
  }
  return {
    url: result.fileUrl,
    fileId: result.fileId || null,
    mimeType: result.mimeType || file.type || null,
    sizeBytes: result.sizeBytes || file.size || null,
  };
}

/**
 * Trash a folder (and everything inside) under `Projects/...` via GAS.
 * Used by the project-tracking delete flows so the Drive side doesn't
 * orphan when a โครงการ or หนังสือ is deleted in the DB.
 *
 * Fire-and-forget from the caller's perspective: a Drive failure must
 * not block the DB delete or surface a scary error to the user — the
 * row is the source of truth, and Drive Trash auto-purges after 30
 * days anyway. Caller catches and logs; this helper still throws on
 * failure so the caller can choose to log.
 */
export async function deleteProjectFolder(folderPath) {
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('folderPath is required');
  }
  if (!folderPath.startsWith('Projects')) {
    throw new Error('folderPath must start with Projects');
  }
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'deleteProjectFolder', folderPath }),
  });
  const result = await res.json().catch(() => ({ success: false, message: 'invalid JSON' }));
  if (!result.success) throw new Error(result.message || 'ลบโฟลเดอร์ใน Drive ไม่สำเร็จ');
  return result;
}
