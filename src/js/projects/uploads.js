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
 * Trash a single Drive file (by viewer URL) that lives under `Projects/`.
 * Mirrors deleteShopFile in src/js/shop/uploads.js — same pattern, just
 * scoped to the Projects/ tree on the GAS side.
 *
 * Fire-and-forget by convention: the DB row is the source of truth, so
 * a Drive-side failure logs but doesn't surface. Returns true on success
 * and false on failure / missing helper.
 */
export async function deleteProjectFile(fileUrl) {
  if (!fileUrl) return true;
  try {
    const res = await fetch(GAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'deleteProjectFile', fileUrl }),
    });
    const result = await res.json();
    if (!result.success) {
      console.warn('[projects/uploads] deleteProjectFile failed:', result.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[projects/uploads] deleteProjectFile failed:', e);
    return false;
  }
}

/**
 * Resolve the Drive folder URL for a logical `Projects/...` path,
 * creating the folder if it doesn't exist yet and ensuring it's shared
 * as ANYONE_WITH_LINK view. Drives the per-project QR feature — the
 * URL is what the QR encodes. Returns { folderId, folderUrl, folderName }.
 *
 * Empty-folder case: brand-new projects with no files uploaded yet
 * still get a valid URL because GAS creates the folder on demand.
 * The QR is therefore usable immediately on project creation.
 */
export async function getProjectFolderInfo(folderPath) {
  if (!folderPath || typeof folderPath !== 'string') {
    throw new Error('folderPath is required');
  }
  if (!folderPath.startsWith('Projects/')) {
    throw new Error('folderPath must start with Projects/');
  }
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'getProjectFolderInfo', folderPath }),
  });
  const result = await res.json().catch(() => ({ success: false, message: 'invalid JSON' }));
  if (!result.success || !result.folderUrl) {
    throw new Error(result.message || 'หา URL โฟลเดอร์ไม่สำเร็จ');
  }
  return {
    folderId:   result.folderId   || null,
    folderUrl:  result.folderUrl,
    folderName: result.folderName || null,
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
