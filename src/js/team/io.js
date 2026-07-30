// ==============================================
// TEAM IMPORT / EXPORT — pure (de)serialization + normalization helpers
//
// Kept side-effect-free so they're unit-testable; index.js orchestrates the
// actual create calls + dedupe against the live model. Tolerant on input:
// trims/collapses whitespace, normalizes ชั้นปี to a bare number, and accepts
// loose `confirmed` spellings (true/TRU/yes/ใช่/เข้าแล้ว…) — flagging only
// genuinely unrecognized values so the caller can warn.
// ==============================================

export const CSV_COLUMNS = [
  'path', 'prefix', 'full_name', 'nickname', 'student_id', 'year', 'major', 'kkumail', 'confirmed',
];

export const PATH_SEP = ' / ';

// ---- normalization ----

/** ชั้นปี → bare number string. "ปี 5" → "5", "5" → "5", "ปีที่ 3" → "3". */
export function normalizeYear(v) {
  const m = String(v ?? '').match(/\d+/);
  return m ? m[0] : null;
}

/** Loose truthiness for the confirm column. Returns { value, recognized } so
 *  callers can warn on genuinely ambiguous input (e.g. "maybe"). */
export function parseConfirmed(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return { value: false, recognized: true };
  if (/^(t|true|y|yes|1|✓|✔|ใช่|ยืนยัน|เข้า)/.test(s)) return { value: true, recognized: true };
  if (/^(f|false|n|no|0|✗|✘|ไม่|ยังไม่|รอ|-)/.test(s)) return { value: false, recognized: true };
  return { value: false, recognized: false };
}

export function isLikelyEmail(s) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s ?? '').trim());
}

/** Collapse runs of whitespace and trim. "  A   B " → "A B". */
export function cleanSpace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Split a path on the " / " separator (slash WITH surrounding whitespace) so
 *  that a slash INSIDE a name is preserved — e.g. "ComArt / Art/Graphic" →
 *  ["ComArt", "Art/Graphic"]. A bare "A/B" (no spaces) is one segment by
 *  design; the documented format puts spaces around each level separator. */
export function splitPath(path) {
  return String(path ?? '').split(/\s+\/\s+/).map((s) => cleanSpace(s)).filter(Boolean);
}

// ---- JSON ----

/**
 * Full-fidelity dump for backup / restructure-and-reimport.
 *
 * ⚠ THIS IS AN ALLOW-LIST AND IT IS A BACKUP, so the safe default is the
 * OPPOSITE of the public projection's. get_public_team_chart() names columns so
 * a new one is NOT published by accident; here, a column left out is silently
 * DESTROYED on the next export→import round trip. `is_board`, `photo_url` and
 * `photo_focus` were all missing at first and would have wiped every portrait
 * and the whole คณะกรรมการ grid on any restore.
 *
 * Adding a column to team_nodes / team_members? Add it here, add it to the two
 * create calls in index.js `importJson`, and extend the key list in
 * io.test.js — that test exists to make this a conscious decision.
 *
 * (`shop_source` is deliberately absent: 0094 reverted shop scoping and the
 * column is inert and unread. If it is ever wired up again, add it.)
 */
export function buildExportJson(nodes, members) {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    nodes: nodes.map((n) => ({
      id: n.id, parent_id: n.parent_id || null, name: n.name, kind: n.kind,
      position: n.position ?? 0, permissions: n.permissions || [],
      inherit_permissions: n.inherit_permissions !== false,
      vs_dept: n.vs_dept || null,
      project_seat: n.project_seat || null,
      is_public: n.is_public !== false,
      is_board: !!n.is_board,
      passport_dept_id: n.passport_dept_id ?? null,
      passport_sub_dept_id: n.passport_sub_dept_id ?? null,
    })),
    members: members.map((m) => ({
      id: m.id, node_id: m.node_id, position: m.position ?? 0,
      prefix: m.prefix || null, full_name: m.full_name, nickname: m.nickname || null,
      student_id: m.student_id || null, year: m.year || null, major: m.major || null,
      kkumail: m.kkumail || null, confirmed: !!m.confirmed,
      photo_url: m.photo_url || null,
      photo_focus: m.photo_focus || null,
      permissions: m.permissions || [],
      inherit_permissions: m.inherit_permissions !== false,
      vs_dept: m.vs_dept || null,
      project_seat: m.project_seat || null,
      passport_dept_id: m.passport_dept_id ?? null,
      passport_sub_dept_id: m.passport_sub_dept_id ?? null,
    })),
  };
}

/** Validate a parsed export object. Returns { ok, error } — a hard structural
 *  problem is a fail (JSON is machine-generated; malformed ⇒ abort with a
 *  clear message rather than partial import). */
export function validateExportJson(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'ต้องเป็น JSON ที่ส่งออกจากระบบ (object ที่มี nodes/members) — ถ้าเป็นรายชื่อให้ใช้ CSV' };
  }
  if (!Array.isArray(data.nodes) || !data.nodes.length) {
    return { ok: false, error: 'JSON ไม่มี nodes' };
  }
  const badNode = data.nodes.find((n) => !n || typeof n.name !== 'string' || !n.name.trim());
  if (badNode) return { ok: false, error: 'มี node ที่ไม่มีชื่อ (name) — ไฟล์อาจเสียหาย' };
  if (data.members && !Array.isArray(data.members)) {
    return { ok: false, error: 'members ต้องเป็น array' };
  }
  return { ok: true };
}

// ---- CSV ----

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows: [{ path, prefix, full_name, ... }] */
export function buildMembersCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(
      c === 'confirmed' ? (r.confirmed ? 'true' : 'false') : r[c],
    )).join(','));
  }
  return lines.join('\r\n');
}

/** RFC-4180-ish CSV parser: handles quoted fields, escaped quotes, CRLF/LF. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  const s = String(text || '').replace(/^﻿/, '');  // strip BOM
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* swallow; \n ends the row */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
}

/** Parse a members CSV into normalized objects keyed by canonical header.
 *  Tolerates Thai header aliases, column reordering, stray whitespace. Each
 *  row carries `confirmedRecognized` so the caller can warn on ambiguous
 *  confirm values. Rows without a full_name are dropped. */
export function parseMembersCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => normHeader(h));
  return rows.slice(1).map((cells, idx) => {
    const o = { _row: idx + 2 };  // 1-based incl header, for messages
    header.forEach((key, i) => { if (key) o[key] = cleanSpace(cells[i] ?? ''); });
    const c = parseConfirmed(o.confirmed);
    o.confirmed = c.value;
    o.confirmedRecognized = c.recognized;
    o.year = normalizeYear(o.year);
    return o;
  }).filter((o) => o.full_name);
}

const HEADER_ALIASES = {
  path: ['path', 'ตำแหน่ง', 'สังกัด', 'ฝ่าย', 'role', 'สายงาน'],
  prefix: ['prefix', 'คำนำหน้า'],
  full_name: ['full_name', 'fullname', 'name', 'ชื่อ-สกุล', 'ชื่อสกุล', 'ชื่อ'],
  nickname: ['nickname', 'ชื่อเล่น'],
  student_id: ['student_id', 'studentid', 'รหัสนักศึกษา', 'รหัส'],
  year: ['year', 'ชั้นปี', 'ปี'],
  major: ['major', 'สาขา'],
  kkumail: ['kkumail', 'email', 'kku mail', 'อีเมล', 'e-mail'],
  confirmed: ['confirmed', 'ยืนยัน', 'สถานะ'],
};

function normHeader(h) {
  const t = cleanSpace(h).toLowerCase();
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => a.toLowerCase() === t)) return key;
  }
  return '';  // unknown column → ignored
}
