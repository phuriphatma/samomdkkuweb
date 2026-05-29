// ==============================================
// TICKET ID GENERATORS — shared pure helpers
//
// Extracted from pr-form.js / vs-form.js so the format contract can
// be unit-tested. Both forms use the SAME variable as both the insert
// payload's `id` AND the value displayed on the success card, so the
// id the user copies is guaranteed equal to the id the DB stores.
//
// Formats (don't change without coordinating with all read-sites —
// the success-card UI, tracking lookup, Discord messages, GAS legacy):
//
//   PR-XXXXXX                    6 random uppercase-alphanumeric chars
//   VS-YYMMDD-HHMM-XXX           date+time stem + 3 random chars
//
// Random suffix on VS prevents PK collisions when two submissions
// land in the same minute — without it, the idempotent-insert retry
// path treats the second submitter's 409 as "first attempt succeeded"
// and silently drops their data (per mistakes.md).
// ==============================================

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomSuffix(n) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

const pad2 = (n) => String(n).padStart(2, '0');

/** PR-XXXXXX — 6 random uppercase-alphanumeric characters. */
export function generatePRTicketId() {
  return `PR-${randomSuffix(6)}`;
}

/** VS-YYMMDD-HHMM-XXX — date + minute stem with a 3-char random tail. */
export function generateVSTicketId(now = new Date()) {
  const yy = String(now.getFullYear() % 100).padStart(2, '0');
  return `VS-${yy}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-`
    + `${pad2(now.getHours())}${pad2(now.getMinutes())}-${randomSuffix(3)}`;
}

/** Regex contract for PR ids — used by tests + by anything that needs
 *  to validate / extract a PR id from arbitrary input. */
export const PR_TICKET_ID_REGEX = /^PR-[A-Z0-9]{6}$/;

/** Regex contract for VS ids. */
export const VS_TICKET_ID_REGEX = /^VS-\d{6}-\d{4}-[A-Z0-9]{3}$/;
