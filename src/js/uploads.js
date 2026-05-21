// ==============================================
// UPLOADS — Shared image-upload helper
// Uploads a File to Google Drive via the existing
// uploadPRFile GAS endpoint and returns a public URL.
// Used by:
//   - PR form (multi-image submission)
//   - Quill custom image handler (announcement / VS editors)
//   - Announcement thumbnail picker
// ==============================================

import { GAS_API_URL } from './config.js';

/**
 * Read a File as base64 data URL.
 */
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Upload an image file to Drive. Returns its public URL.
 *
 * Why this exists: Quill's default image handler embeds images as base64
 * inside the editor's HTML. That bloats the announcement payload to MB and
 * makes the JSON.stringify POST exceed Apps Script's request limit (causing
 * "Failed to fetch"). Uploading first + inserting the URL keeps payloads tiny.
 */
export async function uploadImageToDrive(file) {
  if (!file) throw new Error('No file');
  const base64 = await readAsDataURL(file);
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action: 'uploadPRFile',
      fileName: file.name,
      mimeType: file.type,
      fileData: base64,
    }),
  });
  const result = await res.json();
  if (!result.success || !result.fileUrl) {
    throw new Error(result.message || 'อัปโหลดไม่สำเร็จ');
  }
  return convertDriveUrl(result.fileUrl);
}

/**
 * Google Drive's default share URLs (returned by file.getUrl() in Apps Script)
 * point at the viewer page (https://drive.google.com/file/d/<ID>/view) which
 * does NOT embed in <img>.
 *
 * Google has been restricting the older /uc?id= direct-link form for
 * hotlinking. The reliable current URL for embedding an "Anyone with the
 * link" shared image is the thumbnail endpoint:
 *
 *   https://drive.google.com/thumbnail?id=<ID>&sz=w2000
 *
 * The sz=w2000 caps width at 2000px which is plenty for any embed.
 */
export function convertDriveUrl(url) {
  if (!url) return url;
  const m = url.match(/\/file\/d\/([^/]+)\//) || url.match(/[?&]id=([^&]+)/);
  if (m && m[1]) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w2000`;
  return url;
}
