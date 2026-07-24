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
 * which doesn't embed in <img>. Rewrite to a directly-embeddable URL.
 *
 * We emit the `lh3.googleusercontent.com/d/<id>=w<size>` CDN form, NOT
 * `drive.google.com/thumbnail?id=<id>` — the latter 302-redirects to
 * googleusercontent and that redirect FAILS TO LOAD on iOS Safari (iPad),
 * so ประกาศ / SAMO Shop images never appeared there. The lh3 URL is the
 * direct CDN endpoint (no redirect, correct Content-Type) and renders on
 * iOS Safari as well as desktop. `=w<size>` also caps the decoded pixels
 * (1200px is plenty for any card/banner) which keeps a grid of images
 * under iOS Safari's per-page image-memory budget. Both forms still
 * require the file to be shared "anyone with the link".
 *
 * This function is also applied at RENDER time (not just on upload), so it
 * must convert the legacy `drive.google.com/thumbnail?id=<id>&sz=...` URLs
 * already stored in the DB — hence the `?id=`/`&id=` match handles them too.
 */
export function convertDriveUrl(url, size = 1200) {
  if (!url) return url;
  // Supabase Storage URLs (from legacy rows when we briefly tried that) and
  // already-lh3 URLs pass through unchanged.
  if (url.includes('supabase.co/storage')) return url;
  if (url.includes('googleusercontent.com/d/')) return url;
  // The trailing slash on /file/d/<id>/ is optional in Drive's share URLs —
  // make it optional in the regex too. The second pattern catches
  // ?id=... / &id=... / open?id=... / uc?id=... / thumbnail?id=... forms.
  const m = url.match(/\/file\/d\/([^/?#]+)/) || url.match(/[?&]id=([^&]+)/);
  if (m && m[1]) return `https://lh3.googleusercontent.com/d/${m[1]}=w${size}`;
  return url;
}
