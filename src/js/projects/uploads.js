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
 * @param {string} folderPath e.g. 'Projects/PRJ-2605-0001_kickoff/DOC-260526-1430-ABCD_project'
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
