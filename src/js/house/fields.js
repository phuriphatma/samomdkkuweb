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
//   • รหัสนักศึกษา — '659999999-9', same rule as ทีม SAMO. Re-exported from
//     team/fields.js rather than reimplemented, because two implementations of
//     one rule is the bug class this repo pays for most.
//   • สาขา — 'MD' / 'MDI' / 'RT', matched case- and punctuation-insensitively.
//
// THE FAILURE THIS MODULE EXISTS TO CATCH
// Excel and Sheets silently strip leading zeros from a numeric-looking column,
// so '001' arrives as '1' and '017' as '17'. Read one row at a time that is
// invisible — '1' is a perfectly valid-looking สาย. It is only visible ACROSS
// the file: a healthy file has every สาย the same width. `auditSaiWidths()`
// below is therefore a FILE-level check. It WARNS rather than refuses: stripping
// only ever removes LEADING zeros, so left-padding restores the value exactly and
// the house — the last digit — is invariant under it. What is NOT recoverable is
// a zero that was ADDED: a blank numeric cell comes back as `0`, and `000` is
// refused outright by normalizeSai for that reason.
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
  const value = digits.padStart(3, '0');
  // `000` is not a สายรหัส — the range is 001–999 — and it is exactly what a
  // spreadsheet puts in an EMPTY numeric cell. Accepting it would file a student
  // into บ้าน 0 under a สาย the university does not have, silently, from a blank.
  // This is the same Excel-mangles-the-สาย-column failure `auditSaiWidths` exists
  // for, arriving from the other direction: not a zero stripped off, a zero
  // added. บ้าน 0 loses nothing — it is fed by 010, 020, … 100.
  if (value === '000') return { value: rawStr, ok: false, padded: false, raw: rawStr };
  return {
    value,
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

/**
 * Why a สายรหัส was refused, in words a person can act on.
 *
 * `normalizeSai` returns a boolean; every caller that shows a message was
 * spelling its own, and they had drifted — an all-zero value produced
 * "ต้องเป็นตัวเลขไม่เกิน 3 หลัก", which is both wrong (it IS three digits) and
 * unhelpful (the real cause is an empty cell a spreadsheet filled in).
 */
export function saiProblem(raw) {
  const n = normalizeSai(raw);
  if (n.ok) return null;
  const digits = arabicDigits(String(raw ?? '').trim()).replace(/\D/g, '');
  if (digits && /^0+$/.test(digits)) {
    return 'สายรหัส 000 ไม่มีอยู่จริง — สายเริ่มที่ 001 '
      + '(ค่านี้มักเกิดจากช่องว่างที่โปรแกรมตารางเติมเลข 0 ให้)';
  }
  if (digits.length > 3) return 'สายรหัสยาวเกิน 3 หลัก';
  return 'สายรหัสต้องเป็นตัวเลข 1–3 หลัก เช่น 7 หรือ 007';
}

/** A colour safe to interpolate into a `style` attribute. escHtml stops the
 *  attribute being broken out of, but not `#fff;background:url(…)` — and
 *  `houses.color` is written through the API, not only by the `<input
 *  type="color">` that normally sets it. Anything that is not a plain hex colour
 *  falls back to the caller's default. */
export function safeColor(c, fallback = null) {
  const v = String(c ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
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
 * and not others — which left-padding undoes exactly, so this reports rather than
 * refuses. It is still worth saying out loud: a file that went through a
 * spreadsheet may have been damaged in columns where the damage is NOT
 * reversible.
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

/**
 * รุ่น (MD50) from ปีที่เข้า — the ONE implementation, and the ONLY cohort
 * vocabulary ระบบบ้าน has.
 *
 * WHY NOT ชั้นปี. ชั้นปี is a moving target: it needs a "current academic year"
 * to subtract from, it is wrong for anyone who ลาพัก / เรียนซ้ำ / จบช้า, and it
 * silently rots — a record entered today reads "ปี 5", and the same record read
 * next August reads "ปี 5" too unless somebody remembers to move a setting.
 * รุ่น is a FACT about the person, fixed at admission and readable straight off
 * the รหัสนักศึกษา, so it needs no clock, no override and no maintenance. That is
 * why the ชั้นปี override (`students.year_override`) is no longer offered
 * anywhere: there is nothing left for it to correct.
 *
 * THE NUMBER. It is the faculty's intake count, not a year: ปีที่เข้า 2565 is
 * MD50, 2564 is MD49 — i.e. `cohort - 2515`. One epoch constant, one prefix,
 * spelled once here. MDI and RT students entering the same year carry the same
 * intake label; if that ever needs to differ, it differs HERE and nowhere else.
 */
export const COHORT_EPOCH = 2515;
export const COHORT_PREFIX = 'MD';

export function cohortLabel({ cohort_year: cohort, student_id: sid } = {}) {
  const c = cohort || cohortFromStudentId(sid);
  if (!c) return null;
  const n = Number(c) - COHORT_EPOCH;
  return n >= 1 ? `${COHORT_PREFIX}${n}` : null;
}

/**
 * ชั้นปี — DERIVED, every time, from facts that do not rot.
 *
 * `ชั้นปี = ปีการศึกษา − ปีที่เข้า + 1 + year_offset`
 *
 * WHY IT IS NOT STORED. A stored ชั้นปี is correct for one academic year and
 * silently wrong forever after — and wrong for exactly the people whose
 * situation is unusual enough that nobody re-checks it. `students.year_override`
 * was that column; 0129 dropped it, and `team_members.year` is still that column
 * (399 rows, and nothing anywhere in this repo has ever bumped it — verified by
 * grep, so every August all 399 quietly become last year's answer).
 *
 * WHAT IS STORED INSTEAD is `year_offset`, a DIFFERENCE (0131). `-1` means
 * "permanently one year behind their รุ่น" — ลาพัก, เรียนซ้ำ — and it stays
 * correct in 2570 and 2575 with no maintenance. That is the entire argument for
 * the shape: the offset is a property of the person, the year is a property of
 * the person AND the calendar, and only the first is safe to write down.
 *
 * THIS IS THE ONLY IMPLEMENTATION. There is deliberately no SQL twin: nothing
 * server-side gates on ชั้นปี, so SQL stores the ingredients and this does the
 * arithmetic. Two implementations of one rule is the class this repo pays for
 * most, and the cheapest way to not have it is to not write the second one.
 */

/** ปีการศึกษา rolls over in สิงหาคม. A CONSTANT, not a settings row: a setting
 *  somebody must change every August is a setting that is forgotten every
 *  August, and an override that pins the value is the same fill-once failure
 *  0128 and 0129 both exist to undo. If the faculty's calendar ever disagrees,
 *  this line changes once — in review, not in a form. */
export const ACADEMIC_YEAR_ROLLOVER_MONTH = 8;

/** The current ปีการศึกษา in พ.ศ. `now` is injectable so the tests can stand at
 *  a date instead of asserting against whenever they happen to run. */
export function academicYear(now = new Date()) {
  const be = now.getFullYear() + 543;
  return now.getMonth() + 1 >= ACADEMIC_YEAR_ROLLOVER_MONTH ? be : be - 1;
}

/**
 * The raw ชั้นปี number. May be > 6 or < 1 — the caller decides how to read
 * that; see studyYearLabel.
 *
 * @returns {number|null} null when there is no ปีที่เข้า to count from, which is
 *   the honest answer for a shared department account or a row whose
 *   รหัสนักศึกษา has not been filled in yet.
 */
export function studyYear({ cohort_year: cohort, student_id: sid, year_offset: off } = {},
  now = new Date()) {
  const c = cohort || cohortFromStudentId(sid);
  if (!c) return null;
  return academicYear(now) - Number(c) + 1 + (Number(off) || 0);
}

/**
 * ชั้นปี as a person reads it.
 *
 * Out-of-range is rendered, not clamped: `year_offset` is deliberately
 * unbounded (0131), so the guard against an absurd value belongs here, at the
 * one place that turns a number into words. Above ปี 6 the honest word is
 * "จบแล้ว" — which also makes a graduation signal fall out of the arithmetic
 * with no `status` column to keep current (0120 dropped that one).
 */
export function studyYearLabel(rec, now = new Date()) {
  const n = studyYear(rec, now);
  if (n === null || n < 1) return null;
  return n > 6 ? 'จบแล้ว' : `ปี ${n}`;
}

/**
 * Turn a ชั้นปี a HUMAN PICKED into the offset to store.
 *
 * The chooser shows real years (1–6) because that is what people think in; what
 * it saves is the gap between the pick and the computation. Picking exactly the
 * computed year stores null — "no adjustment" — rather than 0, so `self_edited`
 * never claims an edit that no reader could see.
 *
 * @returns {number|null} the offset, or null for "exactly as computed".
 */
export function offsetForPickedYear(rec, picked, now = new Date()) {
  const base = studyYear({ ...rec, year_offset: 0 }, now);
  const want = Number(picked);
  if (base === null || !Number.isFinite(want)) return null;
  const diff = want - base;
  return diff === 0 ? null : diff;
}

/**
 * ปีที่เข้า (พ.ศ.) from the first two digits of รหัสนักศึกษา.
 * Mirrors `public.cohort_from_student_id`, INCLUDING its 2540–2580 window —
 * 0118 tightened that because 2500+99 was inside the original bound, so a
 * malformed id produced a confident "ปี 1". Out of range returns null, which
 * renders as no รุ่น rather than a plausible wrong one.
 */
export function cohortFromStudentId(sid) {
  const digits = arabicDigits(sid).replace(/\D/g, '');
  if (digits.length < 2) return null;
  const year = 2500 + Number(digits.slice(0, 2));
  return year >= 2540 && year <= 2580 ? year : null;
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
