// ==============================================
// HOUSE IMPORT / EXPORT — pure, testable, no DOM and no network.
//
// The importer's job is not to load a file. It is to REFUSE a file that would
// put students in the wrong house, at the only moment the damage is still
// visible. See auditSaiWidths() in ./fields.js for the failure this is built
// around: after padding, '1' and '001' are identical, so a mixed-width file has
// to be caught here or not at all.
// ==============================================
import { parseCsv } from '../team/io.js';
import {
  normalizeSai, normalizeStudentId, normalizeMajor, normalizeKkumail,
  auditSaiWidths, cleanCell, cleanSpace, houseOf,
} from './fields.js';

/** The seven columns the handover spec asks for. */
export const CSV_COLUMNS = [
  'student_id', 'first_name_th', 'last_name_th', 'nickname_th', 'kkumail', 'major', 'sai',
];

/** Header aliases, so a file that spells a column slightly differently still
 *  lands rather than silently importing blanks. */
const HEADER_ALIAS = {
  student_id: 'student_id', studentid: 'student_id', sid: 'student_id',
  รหัสนักศึกษา: 'student_id', รหัส: 'student_id',
  first_name_th: 'first_name_th', firstname: 'first_name_th',
  first_name: 'first_name_th', ชื่อ: 'first_name_th', ชื่อจริง: 'first_name_th',
  last_name_th: 'last_name_th', lastname: 'last_name_th',
  last_name: 'last_name_th', นามสกุล: 'last_name_th', สกุล: 'last_name_th',
  nickname_th: 'nickname_th', nickname: 'nickname_th',
  nick: 'nickname_th', ชื่อเล่น: 'nickname_th',
  kkumail: 'kkumail', email: 'kkumail', mail: 'kkumail', อีเมล: 'kkumail',
  major: 'major', สาขา: 'major',
  sai: 'sai', sai_code: 'sai', สายรหัส: 'sai', สาย: 'sai',
};

function normHeader(h) {
  const key = cleanSpace(h).toLowerCase().replace(/[\s_-]+/g, '');
  // Try the raw cleaned value first (Thai headers), then the squashed form.
  return HEADER_ALIAS[cleanSpace(h).toLowerCase()] || HEADER_ALIAS[key] || null;
}

/**
 * Parse a students CSV into normalized rows plus everything the preview needs.
 *
 * @returns {{
 *   rows: object[], problems: object[], widthAudit: object,
 *   missingColumns: string[], fatal: string|null
 * }}
 *
 * `fatal` non-null means DO NOT IMPORT — the UI refuses rather than warning.
 * Only two things are fatal, and both are silent-corruption shapes:
 *   • a missing kkumail column (nothing can be matched to a login), and
 *   • mixed สาย widths (Excel ate the leading zeros off some rows).
 * Everything else is a per-row problem the human can look at and still proceed.
 */
export function parseStudentsCsv(text, knownMajors = []) {
  const raw = parseCsv(text);
  if (!raw.length) {
    return { rows: [], problems: [], widthAudit: null, missingColumns: CSV_COLUMNS, fatal: 'ไฟล์ว่าง' };
  }

  const header = raw[0].map(normHeader);
  const missingColumns = CSV_COLUMNS.filter((c) => !header.includes(c));

  if (!header.includes('kkumail')) {
    return {
      rows: [], problems: [], widthAudit: null, missingColumns,
      fatal: 'ไม่พบคอลัมน์ kkumail — คอลัมน์นี้คือกุญแจที่ใช้จับคู่ตอนนักศึกษาเข้าสู่ระบบ นำเข้าไม่ได้',
    };
  }

  // Raw สาย values BEFORE normalisation — the audit is only meaningful on these.
  const saiIdx = header.indexOf('sai');
  const rawSais = saiIdx >= 0 ? raw.slice(1).map((cells) => cells[saiIdx] ?? '') : [];
  const widthAudit = auditSaiWidths(rawSais);

  if (saiIdx >= 0 && !widthAudit.consistent) {
    const shape = widthAudit.widths.map((w) => `${w.width} หลัก ${w.count} แถว`).join(' · ');
    return {
      rows: [], problems: [], widthAudit, missingColumns,
      fatal: `สายรหัสในไฟล์มีความยาวไม่เท่ากัน (${shape}) — `
        + 'แปลว่าโปรแกรมตารางตัดเลข 0 ข้างหน้าออกไปบางแถวแล้ว '
        + '(เช่น 001 กลายเป็น 1) ถ้านำเข้าตอนนี้จะมีนักศึกษาถูกจัดเข้าบ้านผิด '
        + 'กรุณาขอไฟล์ใหม่โดยตั้งรูปแบบคอลัมน์สายรหัสเป็น "ข้อความ" ก่อนกรอกข้อมูล',
    };
  }

  const problems = [];
  const seenMail = new Map();
  const seenSid = new Map();
  const rows = [];

  raw.slice(1).forEach((cells, idx) => {
    const lineNo = idx + 2;                     // 1-based, including the header
    const o = {};
    header.forEach((key, i) => { if (key) o[key] = cells[i] ?? ''; });

    const mail = normalizeKkumail(o.kkumail);
    const first = cleanCell(o.first_name_th);
    const last = cleanCell(o.last_name_th);

    // A row with no address cannot be matched to a login and cannot be upserted
    // (kkumail is NOT NULL + the unique key). Skip it, loudly.
    if (!mail.ok) {
      problems.push({ line: lineNo, level: 'skip', field: 'kkumail',
        message: `บรรทัด ${lineNo}: ${mail.reason} — ข้ามแถวนี้`, value: cleanSpace(o.kkumail) });
      return;
    }
    if (!first) {
      problems.push({ line: lineNo, level: 'skip', field: 'first_name_th',
        message: `บรรทัด ${lineNo}: ไม่มีชื่อจริง — ข้ามแถวนี้`, value: '' });
      return;
    }

    if (seenMail.has(mail.value)) {
      problems.push({ line: lineNo, level: 'skip', field: 'kkumail',
        message: `บรรทัด ${lineNo}: อีเมล ${mail.value} ซ้ำกับบรรทัด ${seenMail.get(mail.value)} — ข้ามแถวนี้`,
        value: mail.value });
      return;
    }
    seenMail.set(mail.value, lineNo);

    const sid = normalizeStudentId(o.student_id);
    if (!sid.ok && sid.value) {
      problems.push({ line: lineNo, level: 'warn', field: 'student_id',
        message: `บรรทัด ${lineNo}: รหัสนักศึกษา “${sid.value}” ไม่ตรงรูปแบบ (เก็บไว้ตามเดิม)`,
        value: sid.value });
    }
    if (sid.value && seenSid.has(sid.value)) {
      problems.push({ line: lineNo, level: 'warn', field: 'student_id',
        message: `บรรทัด ${lineNo}: รหัสนักศึกษา ${sid.value} ซ้ำกับบรรทัด ${seenSid.get(sid.value)}`,
        value: sid.value });
    } else if (sid.value) seenSid.set(sid.value, lineNo);

    const sai = normalizeSai(o.sai);
    if (!sai.ok) {
      problems.push({ line: lineNo, level: 'warn', field: 'sai',
        message: `บรรทัด ${lineNo}: สายรหัส “${sai.raw}” อ่านไม่ออก — จะเว้นว่างไว้`,
        value: sai.raw });
    }
    const major = normalizeMajor(o.major, knownMajors);
    if (!major.ok && major.value) {
      problems.push({ line: lineNo, level: 'warn', field: 'major',
        message: `บรรทัด ${lineNo}: สาขา “${major.value}” ไม่อยู่ในรายการ (เก็บไว้ตามเดิม)`,
        value: major.value });
    }

    rows.push({
      _line: lineNo,
      kkumail: mail.value,
      student_id: sid.value,
      first_name_th: first,
      last_name_th: last,
      // NOTE: nickname_IMPORTED, never nickname_self. The student owns the other
      // column and an import must not be able to overwrite what they typed.
      nickname_imported: cleanCell(o.nickname_th),
      major: major.value,
      sai_code: sai.ok ? sai.value : null,
      _house: sai.ok ? houseOf(sai.value) : null,
    });
  });

  return { rows, problems, widthAudit, missingColumns, fatal: null };
}

/** The columns an upsert is allowed to write. Everything a STUDENT owns is
 *  deliberately absent — this list is the mechanism behind "a re-import can
 *  never destroy a self-edit". Pinned by house-io.test.js. */
export const IMPORT_OWNED_COLUMNS = [
  'kkumail', 'student_id', 'first_name_th', 'last_name_th',
  'nickname_imported', 'major', 'sai_code',
];

/** Strip a parsed row down to exactly the import-owned columns. */
export function toUpsertRow(row, batchId) {
  const out = {};
  for (const c of IMPORT_OWNED_COLUMNS) out[c] = row[c] ?? null;
  out.last_import_batch = batchId || null;
  out.missing_since = null;      // present in this file ⇒ not missing
  return out;
}

/**
 * Compare parsed rows against what is already stored.
 * Returns counts + the per-row verdict, so the preview can say
 * "จะเพิ่ม N · แก้ไข M · ไม่เปลี่ยน K" BEFORE anything is written.
 */
export function diffAgainstExisting(rows, existing) {
  const byMail = new Map(
    (existing || []).map((s) => [String(s.kkumail || '').toLowerCase(), s]));
  let insert = 0, update = 0, same = 0;
  const verdicts = rows.map((r) => {
    const cur = byMail.get(r.kkumail);
    if (!cur) { insert += 1; return { ...r, _verdict: 'insert' }; }
    const changed = IMPORT_OWNED_COLUMNS.filter((c) => {
      const a = r[c] ?? null;
      const b = cur[c] ?? null;
      return String(a ?? '') !== String(b ?? '');
    });
    if (!changed.length) { same += 1; return { ...r, _verdict: 'same' }; }
    update += 1;
    return { ...r, _verdict: 'update', _changed: changed };
  });
  // Rows in the DB that this file does NOT mention. Reported, never deleted.
  const fileMails = new Set(rows.map((r) => r.kkumail));
  const missing = (existing || []).filter(
    (s) => !fileMails.has(String(s.kkumail || '').toLowerCase()));
  return { verdicts, insert, update, same, missing };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Admin export.
 *
 * ⚠️ THIS IS A BACKUP, so its safe default is the OPPOSITE of the roster
 * projection's: a column left OUT here is silently destroyed on the next
 * export→re-import round trip, whereas a column left out of the roster is
 * merely not published. Adding a column to `students`? Add it here too.
 * (`io.test.js` in team/ carries the same warning for the same reason.)
 */
export const EXPORT_COLUMNS = [
  'kkumail', 'student_id', 'first_name_th', 'last_name_th', 'nickname',
  'nickname_imported', 'nickname_self', 'major', 'sai_code', 'house',
  'cohort_year', 'year_override', 'status', 'is_listed', 'sai_locked',
  'verified_at',
];

export function buildStudentsCsv(rows) {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(EXPORT_COLUMNS.map((c) => csvCell(
      c === 'house' ? (houseOf(r.sai_code) ?? '') : r[c],
    )).join(','));
  }
  return lines.join('\r\n');
}
