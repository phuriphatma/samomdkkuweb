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

/**
 * The seven columns the handover spec asks for, in the DATABASE's vocabulary.
 *
 * ONE VOCABULARY, MANY SPELLINGS. The canonical name of every field is its
 * column name in `students` — which is what the CSV EXPORT writes, so an export
 * can be handed straight back to this importer. The friendly spellings a
 * spreadsheet actually arrives with (`sai`, `nickname_th`, `ชื่อ`, `อีเมล`) are
 * ALIASES resolved at the door. Two vocabularies for one field is the drift
 * class this repo pays for most; aliases are how you accept the world's
 * spelling without keeping a second one of your own.
 */
export const CSV_COLUMNS = [
  'student_id', 'first_name_th', 'last_name_th', 'nickname_imported', 'kkumail', 'major', 'sai_code',
];

/** What to CALL each column when talking to a human — the spec's spelling. */
export const CSV_COLUMN_LABEL = {
  student_id: 'student_id (รหัสนักศึกษา)',
  first_name_th: 'first_name_th (ชื่อ)',
  last_name_th: 'last_name_th (นามสกุล)',
  nickname_imported: 'nickname_th (ชื่อเล่น)',
  kkumail: 'kkumail (อีเมล)',
  major: 'major (สาขา)',
  sai_code: 'sai (สายรหัส)',
};

/**
 * Does this name LOOK like it has a คำนำหน้า glued to the front?
 *
 * REPORTS, NEVER STRIPS — and that reversal is the whole point. An earlier
 * version cut the prefix off, which turns "นายก" into "ก" and "นางาม" into "าม":
 * `นาย` and `นาง` are the openings of real Thai names, not just titles, and
 * nothing downstream could ever tell that the row had been renamed. It is the
 * same mistake as splitting a combined "ชื่อ-สกุล" on the first space, which this
 * importer already refuses to do — a guess about a person's name is not
 * recoverable, so the only safe answer is to keep what was sent and say so.
 *
 * A file where every row starts with นาย is a file to send back, and one line
 * per row is exactly how a human notices that.
 */
const TITLE_PREFIXES = ['นางสาว', 'น.ส.', 'นาง', 'นาย', 'ด.ช.', 'ด.ญ.', 'เด็กชาย', 'เด็กหญิง'];

export function looksTitled(raw) {
  const v = cleanSpace(raw);
  // A SPACE after the prefix is the only halfway-reliable signal ("นาย สมชาย"),
  // but plenty of files write "นายสมชาย" with none — so both are reported, and
  // neither is acted on.
  return TITLE_PREFIXES.find((t) => v.startsWith(t) && cleanSpace(v.slice(t.length))) || null;
}

/** Header aliases, so a file that spells a column slightly differently still
 *  lands rather than silently importing blanks. */
const HEADER_ALIAS = {
  student_id: 'student_id', studentid: 'student_id', sid: 'student_id',
  รหัสนักศึกษา: 'student_id', รหัส: 'student_id',
  first_name_th: 'first_name_th', firstname: 'first_name_th',
  first_name: 'first_name_th', ชื่อ: 'first_name_th', ชื่อจริง: 'first_name_th',
  last_name_th: 'last_name_th', lastname: 'last_name_th',
  last_name: 'last_name_th', นามสกุล: 'last_name_th', สกุล: 'last_name_th',
  nickname_th: 'nickname_imported', nickname: 'nickname_imported',
  nick: 'nickname_imported', ชื่อเล่น: 'nickname_imported',
  nickname_imported: 'nickname_imported',
  kkumail: 'kkumail', email: 'kkumail', mail: 'kkumail', อีเมล: 'kkumail',
  major: 'major', สาขา: 'major',
  sai: 'sai_code', sai_code: 'sai_code', สายรหัส: 'sai_code', สาย: 'sai_code',
  // Recognised ONLY so the file can be refused with the right sentence. A single
  // "ชื่อ-สกุล" column cannot be split: "สมชาย ณ อยุธยา" and "สมชาย ใจดี ดีมาก"
  // both have three tokens and different answers, and guessing renames a real
  // person. See '_combined_name' handling in parseStudentsCsv.
  full_name: '_combined_name', fullname: '_combined_name',
  name: '_combined_name', 'ชื่อ-สกุล': '_combined_name', 'ชื่อ-นามสกุล': '_combined_name',
  ชื่อสกุล: '_combined_name', ชื่อนามสกุล: '_combined_name',
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
 * Something is fatal only when proceeding would produce a WRONG result that no
 * later reader could detect:
 *   • the file is not UTF-8 (every Thai name is already destroyed),
 *   • no kkumail column (nothing can be matched to a login),
 *   • no ชื่อ column, or only a COMBINED "ชื่อ-สกุล" one (splitting a Thai name
 *     on whitespace renames people: "สมชาย ณ อยุธยา").
 * Everything else is a per-row problem the human can look at and still proceed.
 *
 * NOTE ON LEADING ZEROS — this used to be fatal and no longer is. Excel strips
 * LEADING zeros only ("017" → 17, "007" → 7); it never touches trailing ones,
 * so left-padding back to three digits is information-preserving, and the house
 * — the LAST digit — is invariant under it. A mixed-width file is therefore
 * recoverable, and refusing it cost a real import for no safety. It is now a
 * prominent warning that says exactly what was padded, because it still means
 * the file went through a spreadsheet and the other columns deserve a look.
 */
export function parseStudentsCsv(text, knownMajors = []) {
  const empty = {
    rows: [], problems: [], widthAudit: null,
    missingColumns: CSV_COLUMNS, presentColumns: [],
  };

  // U+FFFD is what a non-UTF-8 file looks like after FileReader has decoded it
  // as UTF-8. A TIS-620 / Windows-874 export of Thai names arrives ENTIRELY as
  // replacement characters, and every name is already unrecoverable at this
  // point — importing it would write 1,800 rows of "????" that look like data.
  const text0 = String(text || '');
  if (text0.includes('\uFFFD')) {
    // An .xlsx is a ZIP: it starts with the bytes "PK". Reading one as text
    // produces the same replacement characters as a TIS-620 CSV, and the two
    // need completely different advice — so say which one this is.
    return { ...empty,
      fatal: text0.startsWith('PK')
        ? 'ไฟล์นี้เป็น Excel (.xlsx) ไม่ใช่ CSV — เปิดใน Excel แล้วเลือก '
          + '“Save As → CSV UTF-8 (Comma delimited)” ก่อน แล้วค่อยนำเข้าไฟล์ .csv นั้น'
        : 'ไฟล์นี้ไม่ได้บันทึกเป็น UTF-8 ตัวอักษรไทยเสียหายไปแล้วตั้งแต่ในไฟล์ '
          + '— กรุณาขอไฟล์ใหม่ โดยบันทึกจาก Excel เป็น “CSV UTF-8 (Comma delimited)” '
          + 'หรือทำใน Google Sheets แล้วดาวน์โหลดเป็น CSV' };
  }

  const raw = parseCsv(text);
  if (!raw.length) return { ...empty, fatal: 'ไฟล์ว่าง' };

  const header = raw[0].map(normHeader);
  const missingColumns = CSV_COLUMNS.filter((c) => !header.includes(c));
  const problems = [];

  if (!header.includes('kkumail')) {
    return { ...empty, missingColumns,
      fatal: 'ไม่พบคอลัมน์ kkumail — คอลัมน์นี้คือกุญแจที่ใช้จับคู่ตอนนักศึกษาเข้าสู่ระบบ นำเข้าไม่ได้' };
  }

  // A single "ชื่อ-สกุล" column is refused, not split. Thai surnames contain
  // spaces ("ณ อยุธยา") and Thai first names sometimes do too, so whitespace
  // does not mark the boundary — a split would rename real people, silently and
  // irreversibly, and nothing downstream could ever tell.
  //
  // NO name column at all is a DIFFERENT thing and is allowed (0126): the
  // minimum useful file is `kkumail, student_id, sai`, and asking Data Analytics
  // for that instead means 1,800 people's names never leave their department.
  // The student fills their own name in — it is the one field they certainly
  // know. Refusing a combined column while accepting no column looks
  // inconsistent and is not: one would rename people, the other names nobody.
  if (header.includes('_combined_name') && !header.includes('first_name_th')) {
    return { ...empty, missingColumns,
      fatal: 'ไฟล์นี้รวมชื่อกับนามสกุลไว้คอลัมน์เดียว — ระบบแยกให้ไม่ได้ '
        + '(นามสกุลไทยมีเว้นวรรคได้ เช่น “ณ อยุธยา” ถ้าเดาจะได้ชื่อผิดตัว) '
        + 'กรุณาขอไฟล์ที่แยกเป็น first_name_th (ชื่อ) และ last_name_th (นามสกุล) '
        + 'หรือถ้าไม่อยากส่งชื่อเลย ตัดคอลัมน์ชื่อออกทั้งหมดก็ได้ '
        + 'ระบบรับไฟล์ที่มีแค่ kkumail กับสายรหัส' };
  }
  if (!header.includes('first_name_th')) {
    problems.push({ line: 1, level: 'info', field: 'first_name_th',
      message: 'ไฟล์นี้ไม่มีคอลัมน์ชื่อ — นำเข้าได้ ระบบจะเก็บเฉพาะช่องที่มีในไฟล์ '
        + 'และให้นักศึกษากรอกชื่อของตัวเองเมื่อเข้าสู่ระบบ', value: '' });
  }

  // Raw สาย values BEFORE normalisation — the audit is only meaningful on these.
  const saiIdx = header.indexOf('sai_code');
  const rawSais = saiIdx >= 0 ? raw.slice(1).map((cells) => cells[saiIdx] ?? '') : [];
  const widthAudit = auditSaiWidths(rawSais);

  // Columns we did not recognise. Silently ignoring them is how an export gets
  // re-imported and someone believes a self-edited ชื่อเล่น came back with it.
  const unknown = raw[0]
    .filter((h, i) => cleanSpace(h) && !header[i])
    .map((h) => cleanSpace(h));
  if (unknown.length) {
    problems.push({ line: 1, level: 'info', field: '_header',
      message: `คอลัมน์ที่ระบบไม่ได้ใช้ (ข้ามไป): ${unknown.join(', ')}`, value: '' });
  }

  if (saiIdx >= 0 && !widthAudit.consistent) {
    const shape = widthAudit.widths.map((w) => `${w.width} หลัก ${w.count} แถว`).join(' · ');
    problems.push({ line: 1, level: 'warn', field: 'sai_code',
      message: `สายรหัสในไฟล์ยาวไม่เท่ากัน (${shape}) — โปรแกรมตารางตัดเลข 0 ข้างหน้าออก `
        + '(เช่น 007 กลายเป็น 7) ระบบเติมศูนย์คืนให้แล้ว และบ้านไม่เปลี่ยน '
        + 'เพราะบ้านคิดจากหลักสุดท้าย แต่แปลว่าไฟล์นี้ผ่านโปรแกรมตารางมา '
        + 'ควรตรวจคอลัมน์อื่นด้วย', value: '' });
  }

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
    const titled = first ? looksTitled(first) : null;
    if (titled) {
      problems.push({ line: lineNo, level: 'warn', field: 'first_name_th',
        message: `บรรทัด ${lineNo}: ชื่อ “${first}” ดูเหมือนมีคำนำหน้า “${titled}” ติดมา `
          + '— เก็บไว้ตามเดิม ไม่ได้ตัดออกให้ (บางคนมีคำนี้อยู่ในชื่อจริง) '
          + 'ถ้าทั้งไฟล์เป็นแบบนี้ ควรขอไฟล์ใหม่ที่ไม่มีคำนำหน้า',
        value: first });
    }

    // A row with no address cannot be matched to a login and cannot be upserted
    // (kkumail is NOT NULL + the unique key). Skip it, loudly.
    if (!mail.ok) {
      problems.push({ line: lineNo, level: 'skip', field: 'kkumail',
        message: `บรรทัด ${lineNo}: ${mail.reason} — ข้ามแถวนี้`, value: cleanSpace(o.kkumail) });
      return;
    }
    // A blank name no longer skips the row. `first_name_th` is nullable (0126)
    // and kkumail is what the row is FOR — dropping somebody entirely because
    // one cell is empty loses their สายรหัส and their house too. Only worth
    // saying when the file HAS the column and this row is the exception.
    if (!first && header.includes('first_name_th')) {
      problems.push({ line: lineNo, level: 'warn', field: 'first_name_th',
        message: `บรรทัด ${lineNo}: ไม่มีชื่อจริง — นำเข้าให้ แต่ชื่อจะว่างไว้`, value: '' });
    }

    if (seenMail.has(mail.value)) {
      problems.push({ line: lineNo, level: 'skip', field: 'kkumail',
        message: `บรรทัด ${lineNo}: อีเมล ${mail.value} ซ้ำกับบรรทัด ${seenMail.get(mail.value)} — ข้ามแถวนี้`,
        value: mail.value });
      return;
    }
    // A valid address at the WRONG domain imports fine and then never matches a
    // login — students sign in with kkumail, and get_my_student_record() joins
    // on it. Warn rather than skip: the row is still worth having, and only a
    // human knows whether the address is a typo or a genuine exception.
    if (!mail.value.endsWith('@kkumail.com')) {
      problems.push({ line: lineNo, level: 'warn', field: 'kkumail',
        message: `บรรทัด ${lineNo}: ${mail.value} ไม่ใช่ @kkumail.com — `
          + 'นักศึกษาจะเข้าสู่ระบบแล้วไม่เจอข้อมูลตัวเอง', value: mail.value });
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

    const sai = normalizeSai(o.sai_code);
    if (!sai.ok) {
      problems.push({ line: lineNo, level: 'warn', field: 'sai_code',
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
      nickname_imported: cleanCell(o.nickname_imported),
      major: major.value,
      sai_code: sai.ok ? sai.value : null,
      _house: sai.ok ? houseOf(sai.value) : null,
    });
  });

  // Which import-owned columns this file actually carried. Everything
  // downstream (the diff, the upsert payload) is scoped to it.
  const presentColumns = IMPORT_OWNED_COLUMNS.filter((c) => header.includes(c));

  return { rows, problems, widthAudit, missingColumns, presentColumns, fatal: null };
}

/** The columns an upsert is allowed to write. Everything a STUDENT owns is
 *  deliberately absent — this list is the mechanism behind "a re-import can
 *  never destroy a self-edit". Pinned by house-io.test.js. */
export const IMPORT_OWNED_COLUMNS = [
  'kkumail', 'student_id', 'first_name_th', 'last_name_th',
  'nickname_imported', 'major', 'sai_code',
];

/**
 * Strip a parsed row down to the import-owned columns THIS FILE ACTUALLY HAD.
 *
 * `present` is why this takes a third argument. The upsert writes every key in
 * the payload, so including a column the file did not contain wrote NULL over
 * it for everyone in the file: a corrected name-list that happened to omit the
 * `sai` column would have silently cleared ~1,800 สายรหัส — and with them every
 * house placement — while the preview cheerfully said "แก้ไข 1,800". An import
 * must never destroy a field it was not given.
 *
 * Omitting the key is enough: PostgREST's `merge-duplicates` builds its
 * `ON CONFLICT DO UPDATE SET` from the keys present in the body, so an absent
 * column keeps whatever the row already has. All rows in one import share the
 * same key set (`present` is file-level), which PostgREST also requires.
 *
 * A column that IS in the file but empty on a row still writes NULL — that is a
 * real "this person has no ชื่อเล่น any more", not a gap in the file.
 */
export function toUpsertRow(row, batchId, present = IMPORT_OWNED_COLUMNS) {
  const out = {};
  for (const c of IMPORT_OWNED_COLUMNS) {
    // kkumail is the conflict target and must always be sent.
    if (c === 'kkumail' || present.includes(c)) out[c] = row[c] ?? null;
  }
  out.last_import_batch = batchId || null;
  out.missing_since = null;      // present in this file ⇒ not missing
  return out;
}

/**
 * Compare parsed rows against what is already stored.
 * Returns counts + the per-row verdict, so the preview can say
 * "จะเพิ่ม N · แก้ไข M · ไม่เปลี่ยน K" BEFORE anything is written.
 */
export function diffAgainstExisting(rows, existing, present = IMPORT_OWNED_COLUMNS) {
  const byMail = new Map(
    (existing || []).map((s) => [String(s.kkumail || '').toLowerCase(), s]));
  let insert = 0, update = 0, same = 0;
  // Only the columns the file carries — the same set toUpsertRow will write.
  // Diffing a column the import will not touch reports a change that will not
  // happen, which is how a preview stops being evidence.
  const compared = IMPORT_OWNED_COLUMNS.filter((c) => present.includes(c));
  const verdicts = rows.map((r) => {
    const cur = byMail.get(r.kkumail);
    if (!cur) { insert += 1; return { ...r, _verdict: 'insert' }; }
    const changed = compared.filter((c) => {
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
 * ⚠️ THIS IS A BACKUP, so its safe default is the OPPOSITE of a public
 * projection's: a column left OUT here is silently destroyed on the next
 * export→re-import round trip, whereas a column left out of a projection is
 * merely not published. Adding a column to `students`? Add it here too.
 * (`io.test.js` in team/ carries the same warning for the same reason.)
 *
 * HEADERS ARE THE TABLE'S COLUMN NAMES, which is also what `CSV_COLUMNS` above
 * canonicalises to — so a file exported here can be handed straight back to the
 * importer without renaming anything.
 *
 * `house` is DERIVED (the last digit of สาย) and is here anyway: the importer
 * has no alias for it, so it round-trips as an ignored column, and a human
 * reading the backup can see the house without doing arithmetic. A generated
 * column that COLLIDES with an import-owned one is the opposite case and must
 * NOT be exported — `nickname` is `coalesce(nickname_self, nickname_imported)`,
 * and the importer reads a `nickname` header as the IMPORTED one, so exporting
 * it made a round trip overwrite the import value with the student's own.
 */
export const EXPORT_COLUMNS = [
  'kkumail', 'student_id', 'first_name_th', 'last_name_th',
  'nickname_imported', 'nickname_self', 'major', 'sai_code', 'house',
  'cohort_year', 'year_override', 'is_listed', 'sai_locked',
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
