// ============================================================
// rest-error.js — turn a PostgREST error body into something a human can read,
// without throwing away what the machine reads.
//
// WHY THIS IS ITS OWN MODULE. Three places fetch PostgREST directly and each
// invented its own error string: db.js (every staff write), vs-form.js and
// pr-form.js (the two GUEST-facing forms, which deliberately do not go through
// the supabase client). All three put the RAW JSON BODY where a person would
// read it, so a refused write showed a student
//
//   บันทึกไม่สำเร็จ: PostgREST 400: {"code":"P0001","details":null,"hint":null,
//                    "message":"…: professor may only add comments"}
//
// That is the shape the 0176 report arrived in. Three copies of one rule is
// the drift this repo pays for most (mistakes class 6), so the rule gets one
// home rather than three corrections.
//
// THE SEAM, and it is the whole reason this returns an object and not a
// string: `PGRST303` lives in the `code` field, and db.js's JWT
// refresh-and-retry matches on it. Returning only `message` would silently
// kill that retry — a fix to the human half breaking the machine half of the
// same string.
// ============================================================

/**
 * @param {number} status   HTTP status
 * @param {string} text     the raw response body
 * @param {string} [statusText]
 * @returns {{status:number, message:string, code:string|null,
 *            details:string|null, hint:string|null, raw:string}}
 */
export function parseRestError(status, text, statusText = '') {
  const raw = text || statusText || '';
  let body = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const message = (body && typeof body.message === 'string' && body.message.trim())
    ? body.message
    : (raw || statusText);
  return {
    status,
    message,
    code:    body?.code    ?? null,
    details: body?.details ?? null,
    hint:    body?.hint    ?? null,
    raw,
  };
}

/**
 * The one-line sentence to show a person for a failed PostgREST call.
 *
 * A database error is not a user-facing message even after unwrapping — a
 * trigger name means nothing to a student filling in a form. So: keep the
 * server's sentence when it is short enough to be a sentence, and fall back to
 * the caller's own Thai when it is a wall of SQL. Either way the JSON braces
 * never reach the page.
 */
export function restErrorMessage(status, text, statusText = '') {
  const { message } = parseRestError(status, text, statusText);
  const clean = (message || '').trim();
  if (!clean || clean.length > 200 || clean.startsWith('{')) {
    return `เกิดข้อผิดพลาดจากระบบ (${status})`;
  }
  return clean;
}
