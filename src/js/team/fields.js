// ==============================================
// TEAM FIELD RULES — pure, shared, no DOM and no network.
//
// รหัสนักศึกษา / ชั้นปี / สาขา are typed by hand in three places (the admin
// สมาชิก form, the CSV import, and — since the ตำแหน่งของฉัน card grew a
// self-edit — by the person themselves), and the same field arrives spelled
// four ways: `659999999-9`, `6599999999`, `ปี5`, `5 `, `md`, `M.D.`.
//
// Free text is why ตรวจสอบข้อมูล has findings nobody can act on: two rows for
// one human reading `MD` and `md` are a `drift` finding about nothing. So the
// canonical form is decided ONCE, here, and every writer normalises through it.
// Pure functions, unit-tested, imported by both entry points — the alternative
// is the same rule spelled slightly differently in three files, which is the
// class this repo has paid for most often.
//
// WHAT CANONICAL MEANS FOR EACH FIELD (decided from the live data, 405 rows):
//   • รหัสนักศึกษา — `659999999-9`. 380 of 383 non-empty rows already carry the
//     dashed form; it is what is printed on the KKU student card and what a
//     student writes on paper. The bare 10-digit form is accepted and converted,
//     never stored.
//   • ชั้นปี — a bare digit `1`–`6`. Live data is already clean (`1`–`5`), and
//     the field is now a chooser, so this only has to catch legacy text and
//     pasted values.
//   • สาขา — a code from the managed vocabulary (`team_majors`, seeded MD /
//     MDI / RT). Matched case-insensitively and ignoring dots, so `m.d.` lands
//     on `MD`. An unknown value is NOT silently dropped: it is kept verbatim so
//     an import can never blank a field, and ตรวจสอบข้อมูล can show it.
// ==============================================

/** The canonical รหัสนักศึกษา shape, and the example shown to a human. */
export const SID_RE = /^\d{9}-\d$/;
export const SID_PLACEHOLDER = '659999999-9';
export const SID_HINT = `รูปแบบ ${SID_PLACEHOLDER} (พิมพ์ติดกัน 10 หลักก็ได้ ระบบจะเติมขีดให้)`;

/** ชั้นปี options. Six because the MD programme is six years — the live tree
 *  only reaches 5 today, and a chooser that cannot express year 6 would send
 *  the next intake straight back to free text. */
export const YEARS = ['1', '2', '3', '4', '5', '6'];

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** Thai numerals → Arabic. Someone WILL paste `๕`, and a silent reject there
 *  looks like the field refusing a perfectly good answer. */
function arabicDigits(s) {
  return String(s).replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

/**
 * Canonicalise a รหัสนักศึกษา.
 *
 * @returns {{ value: string|null, ok: boolean }}
 *   `value` is the canonical `659999999-9` when it could be read, otherwise the
 *   input trimmed (never null-for-nonempty — losing what someone typed is worse
 *   than storing it unparsed), and null for genuinely empty.
 *   `ok` is false when the digits could not be made to fit, which is what the
 *   forms refuse on.
 *
 * Everything that is not a digit is discarded before counting — one live row
 * holds `ุ693070229-1`, a stray Thai vowel mark in front of an otherwise
 * perfect id, and there is no reason to make a human retype that.
 */
export function normalizeStudentId(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { value: null, ok: true };
  const digits = arabicDigits(trimmed).replace(/\D/g, '');
  if (digits.length === 10) {
    return { value: `${digits.slice(0, 9)}-${digits[9]}`, ok: true };
  }
  // 9 or 11+ digits: we do not know which digit the dash belongs before, and
  // guessing would invent a different student's id. Keep it, flag it.
  return { value: trimmed, ok: false };
}

/**
 * Canonicalise a ชั้นปี to a bare digit.
 *
 * Accepts `5`, ` 5 `, `ปี5`, `ปี 5`, `ชั้นปีที่ 5`, `๕`, `5/2569` — anything
 * whose FIRST number is 1–6.
 *
 * UNLIKE รหัสนักศึกษา and สาขา, an unreadable ชั้นปี is DROPPED rather than kept:
 * the field is a six-value enum behind a chooser, so there is no legitimate
 * value outside the list to preserve, and the CSV column is full of `-` meaning
 * "blank" — storing that verbatim would put `-` on 20 people's cards. `raw` is
 * carried separately so a caller can still quote what it refused.
 *
 * @returns {{ value: string|null, ok: boolean, raw: string }}
 */
export function normalizeYear(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { value: null, ok: true, raw: '' };
  const m = arabicDigits(trimmed).match(/\d+/);
  const n = m ? Number(m[0]) : NaN;
  if (Number.isInteger(n) && n >= 1 && n <= 6) {
    return { value: String(n), ok: true, raw: trimmed };
  }
  return { value: null, ok: false, raw: trimmed };
}

/** Comparison key for a สาขา code: case- and punctuation-insensitive, so
 *  `md`, `MD`, `M.D.` and `M D` are all the same answer. */
export function majorKey(v) {
  return String(v ?? '').toLowerCase().replace(/[^a-z0-9ก-๙]/g, '');
}

/**
 * Snap a typed สาขา onto the managed vocabulary.
 *
 * @param {string} raw       what the human typed / the CSV carried
 * @param {string[]} known   the vocabulary codes (from team_majors)
 * @returns {{ value: string|null, ok: boolean }}
 *   `ok: false` means "kept verbatim, but it is not one of ours" — the value is
 *   still returned. Dropping it would silently erase data on import, and the
 *   ตรวจสอบข้อมูล pane is the right place to surface it, not a blank field.
 */
export function normalizeMajor(raw, known = []) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return { value: null, ok: true };
  const key = majorKey(trimmed);
  const hit = known.find((k) => majorKey(k) === key);
  if (hit) return { value: hit, ok: true };
  return { value: trimmed, ok: false };
}

/**
 * The three fields at once, for a form's submit path.
 *
 * Returns the normalised values plus a `problems` array of `{ field, label,
 * value, message }`. Callers decide what to do with problems — the admin form
 * and the self-edit form both refuse to save a รหัสนักศึกษา the reader CHANGED
 * into something unreadable, but neither blocks a save because a row already
 * carried a bad legacy value (holding an unrelated nickname edit hostage to
 * somebody else's typo is how a form teaches people to avoid it).
 */
export function normalizeIdentityFields({ student_id: sid, year, major }, knownMajors = []) {
  const s = normalizeStudentId(sid);
  const y = normalizeYear(year);
  const m = normalizeMajor(major, knownMajors);
  const problems = [];
  if (!s.ok) {
    problems.push({
      field: 'student_id', label: 'รหัสนักศึกษา', value: s.value,
      message: `รหัสนักศึกษา “${s.value}” ไม่ตรงรูปแบบ — ${SID_HINT}`,
    });
  }
  if (!y.ok) {
    problems.push({
      field: 'year', label: 'ชั้นปี', value: y.raw,
      message: `ชั้นปี “${y.raw}” อ่านไม่ออก — เลือกจากรายการ 1–6`,
    });
  }
  if (!m.ok) {
    problems.push({
      field: 'major', label: 'สาขา', value: m.value,
      message: `สาขา “${m.value}” ไม่อยู่ในรายการ — เลือกจากรายการ หรือเพิ่มสาขานี้ก่อน`,
    });
  }
  return {
    student_id: s.value, year: y.value, major: m.value, problems,
    problemFor: (field) => problems.find((p) => p.field === field) || null,
  };
}
