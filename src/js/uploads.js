// ==============================================
// UPLOADS — Image upload helper (Google Drive via GAS)
//
// Why Drive (not Supabase Storage):
//   Drive gives 2 TB on the personal account that owns the prform GAS;
//   Supabase Storage free tier caps at 1 GB. For image-heavy PR
//   submissions and announcement covers, Drive is the better fit.
//
// Wire-up: the upload still uses the GAS uploadPRFile action — that
// endpoint is the only thing the GAS deployment is still used for
// (everything else now talks to Supabase directly).
// ==============================================

import { GAS_API_URL } from './config.js';

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Upload an image File to Drive via GAS and return its public-thumbnail URL.
 *
 * The base64-via-JSON shape exists because Apps Script doesn't accept
 * multipart/form-data; we have to base64-encode the bytes into the JSON
 * body. Fine for files up to ~30 MB; bigger ones should use the manual
 * "lay your link" path on the form.
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
 * Drive's default share URL is the viewer page (`/file/d/<id>/view`),
 * which doesn't embed in <img>. Rewrite to the thumbnail endpoint that
 * does. sz=w2000 caps width at 2000px — plenty for any embed.
 */
export function convertDriveUrl(url) {
  if (!url) return url;
  // Already-converted URLs and Supabase Storage URLs (from legacy rows
  // when we briefly tried that) pass through unchanged.
  if (url.includes('drive.google.com/thumbnail')) return url;
  if (url.includes('supabase.co/storage')) return url;
  // The trailing slash on /file/d/<id>/ is optional in Drive's share URLs —
  // make it optional in the regex too. The second pattern catches
  // ?id=... / &id=... / open?id=... / uc?id=... forms.
  const m = url.match(/\/file\/d\/([^/?#]+)/) || url.match(/[?&]id=([^&]+)/);
  if (m && m[1]) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w2000`;
  return url;
}
