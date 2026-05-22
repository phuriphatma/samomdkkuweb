// ==============================================
// UPLOADS — Image upload helper (Supabase Storage)
//
// Uploads File objects to the public "samo-uploads" bucket and returns
// a public URL. Used by:
//   - Quill custom image handler (announcement + VS editors)
//   - Creator announcement thumbnail picker
//   - PR form file uploads (Phase 4 in progress; large multi-image
//     uploads in pr-form.js still on the legacy path until verified)
//
// Why this exists: Quill's default image handler embeds images as base64
// inside the editor's HTML. That bloats every announcement to MB and
// can trip Postgres/Supabase row size limits. Uploading first + inserting
// the URL keeps payloads tiny.
// ==============================================

import { db } from './db.js';

const BUCKET = 'samo-uploads';

function safeFilename(name) {
  // Keep an alphanumeric / dash / dot / underscore subset; replace the rest.
  // Storage paths can contain most chars, but spaces and Thai characters
  // make URLs fragile and break some image embedders.
  return (name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

/**
 * Upload an image File to Supabase Storage and return its public URL.
 */
export async function uploadImageToDrive(file) {
  if (!file) throw new Error('No file');
  // Path: <yyyy>/<MM>/<timestamp>-<safe-name>. Year/month folders keep
  // the bucket browser usable as content grows.
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const ts = now.getTime();
  const path = `${yyyy}/${mm}/${ts}-${safeFilename(file.name)}`;

  const { error: uploadErr } = await db.storage
    .from(BUCKET)
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });
  if (uploadErr) throw new Error(uploadErr.message || 'อัปโหลดไม่สำเร็จ');

  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('ไม่สามารถสร้างลิงก์รูปได้');
  return data.publicUrl;
}

/**
 * Legacy Drive URL normalizer. Kept so existing announcements / tickets
 * with Drive thumbnails (from before the Supabase Storage migration)
 * still render. Newly uploaded images use Supabase Storage URLs which
 * pass through unchanged.
 */
export function convertDriveUrl(url) {
  if (!url) return url;
  if (url.includes('supabase.co/storage')) return url;
  const m = url.match(/\/file\/d\/([^/]+)\//) || url.match(/[?&]id=([^&]+)/);
  if (m && m[1]) return `https://drive.google.com/thumbnail?id=${m[1]}&sz=w2000`;
  return url;
}
