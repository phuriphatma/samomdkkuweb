// ==============================================
// HOUSE FIELD RULES — pure, shared, no DOM and no network.
//
// Mirrors src/js/team/fields.js in spirit: the canonical form of every field is
// decided ONCE, here, and every writer (the CSV importer, the admin form, the
// student's own edit) normalises through it.
//
// WHAT CANONICAL MEANS
//   • สายรหัส — exactly THREE digits, zero-padded: '001', '017', '100'.
//     The house is its LAST DIGIT. Nothing here ever derives a สายรหัส from a
//     รหัสนักศึกษา: it is the university's own อาจารย์ที่ปรึกษา assignment, handed
//     out at random, and inventing one would put a real student in a wrong house.
//   • รหัสนักศึกษา — '653070317-0', same rule as ทีม SAMO. Re-exported from
//     team/fields.js rather than reimplemented, because two implementations of
//     one rule is the bug class this repo pays for most.
//   • สาขา — 'MD' / 'MDI' / 'RT', matched case- and punctuation-insensitively.
//
// THE FAILURE THIS MODULE EXISTS TO CATCH
// Excel and Sheets silently strip leading zeros from a numeric-looking column,
// so '001' arrives as '1' and '017' as '17'. Read one row at a time that is
// invisible — '1' is a perfectly valid-looking สาย. It is only visible ACROSS
// the file: a healthy file has every สาย the same width. `auditSaiWidths()`
// below is therefore a FILE-level check, and the importer refuses on it rather
// than warning, because the damage (≈180 students in the wrong house, silently)
// is not something a human reviewer would spot afterwards.
// ==============================================

import { normalizeStudentId, majorKey } from '../team/fields.js';

export { normalizeStudentId, majorKey };

/** Canonical สายรหัส shape and the example shown to a human. */
export const SAI_RE = /^\d{3}$/;
export const SAI_PLACEHOLDER = '017';
export const SAI_HINT = 'สายรหัส 3 หลัก เช่น 001 017 100 (เติมศูนย์ข้างหน้าให้ครบ 3 หลัก)';

/** How many houses there are. Fixed by the rule (one per digit), not a setting. */
export const HOUSE_COUNT = 10;

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** Thai numerals → Arabic. Someone will paste ๐๑๗. */
function arabicDigits(s) {
  return String(s ?? '').replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

/**
 * Canonicalise a สายรหัส to three digits.
 *
 * @returns {{ value: string|null, ok: boolean, padded: boolean, raw: string }}
 *   `padded` is true when we ADDED leading zeros — the caller uses it to tell
 *   the difference between a file that was written correctly and one Excel got
 *   to. A single padded row is fine; a file where SOME rows needed padding and
 *   others did not is the disaster, and that is `auditSaiWidths`'s job.
 *
 * 1–3 digits are accepted and padded. 4+ digits are NOT — we would have to
 * guess which end to cut, and guessing puts someone in the wrong house.
 */
export function normalizeSai(raw) {
  const rawStr = String(raw ?? '').trim();
  if (!rawStr) return { value: null, ok: true, padded: false, raw: '' };
  const digits = arabicDigits(rawStr).replace(/\D/g, '');
  if (!digits || digits.length > 3) {
    return { value: rawStr, ok: false, padded: false, raw: rawStr };
  }
  return {
    value: digits.padStart(3, '0'),
    ok: true,
    padded: digits.length < 3,
    raw: rawStr,
  };
}

/**
 * The house a สายรหัส belongs to: its last digit.
 *
 * ⚠️ THE DATABASE IS THE AUTHORITY. `sais.house_id` is a GENERATED STORED column
 * computed by exactly this rule, and every READ path takes the house from that
 * column. This function exists only so the import PREVIEW can show which house a
 * row will land in before anything is written. `house-fields.test.js` pins it
 * against the same 001..100 partition the migration asserts, so the two cannot
 * drift — but if they ever disagree, the column wins.
 *
 * @returns {number|null} 0–9, or null when the code is not canonical.
 */
export function houseOf(saiCode) {
  const s = String(saiCode ?? '').trim();
  if (!SAI_RE.test(s)) return null;
  return Number(s[s.length - 1]);
}

/** Display name for a house that may not have been named yet. */
export function houseLabel(id, name) {
  const n = String(name ?? '').trim();
  if (n) return n;
  return Number.isInteger(id) ? `บ้าน ${id}` : 'ยังไม่มีบ้าน';
}

/**
 * FILE-LEVEL leading-zero audit.
 *
 * Returns the distinct widths of the RAW (un-padded) สาย values. A healthy file
 * has exactly one width. More than one means Excel ate the zeros off some rows
 * and not others, and the file must be rejected — after padding, '1' and '001'
 * are indistinguishable, so this is the last moment the damage is detectable.
 *
 * @param {string[]} rawValues the สาย column exactly as it came out of the file
 */
export function auditSaiWidths(rawValues) {
  const widths = new Map();          // width -> count
  let blank = 0;
  for (const v of rawValues) {
    const digits = arabicDigits(String(v ?? '').trim()).replace(/\D/g, '');
    if (!digits) { blank += 1; continue; }
    widths.set(digits.length, (widths.get(digits.length) || 0) + 1);
  }
  const list = [...widths.entries()].sort((a, b) => a[0] - b[0])
    .map(([width, count]) => ({ width, count }));
  return {
    widths: list,
    blank,
    consistent: list.length <= 1,
    // The specific, recognisable shape of the Excel failure: a mix that includes
    // values SHORTER than three digits.
    looksLikeStrippedZeros: list.length > 1 && list.some((w) => w.width < 3),
  };
}

/** Snap a สาขา onto the managed vocabulary. Unknown values are KEPT, not
 *  dropped — silently blanking a field on import is worse than flagging it. */
export function normalizeMajor(raw, known = []) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { value: null, ok: true };
  const key = majorKey(trimmed);
  const hit = known.find((k) => majorKey(k) === key);
  if (hit) return { value: hit, ok: true };
  return { value: trimmed, ok: false };
}

/** Collapse runs of whitespace, strip the invisible ones that arrive with every
 *  copy-paste out of Word (NBSP U+00A0, zero-width U+200B/FEFF). */
export function cleanSpace(s) {
  return String(s ?? '')
    .replace(/[ ​﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Values that mean "blank" but arrive as text. The spec asks for empty cells;
 *  this catches the files that ignore it, because storing '-' as a nickname
 *  puts a dash on a real person's card. */
const BLANKISH = new Set(['-', '–', '—', 'n/a', 'na', 'null', 'none', 'ไม่มี', 'ยังไม่ทราบ', '']);
export function blankish(s) {
  return BLANKISH.has(cleanSpace(s).toLowerCase());
}

/** Normalise a cell that should be empty when it has no content. */
export function cleanCell(s) {
  const v = cleanSpace(s);
  return blankish(v) ? null : v;
}

/** kkumail: lowercase, trimmed, and it must look like an address. */
export function normalizeKkumail(raw) {
  const v = cleanSpace(raw).toLowerCase();
  if (!v) return { value: null, ok: false, reason: 'ไม่มีอีเมล' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
    return { value: v, ok: false, reason: 'รูปแบบอีเมลไม่ถูกต้อง' };
  }
  return { value: v, ok: true };
}

/** Full name from the two columns the spec asks for. */
export function joinName(first, last) {
  return cleanSpace(`${cleanSpace(first)} ${cleanSpace(last)}`);
}
