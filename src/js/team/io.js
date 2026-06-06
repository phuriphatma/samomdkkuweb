// ==============================================
// TEAM IMPORT / EXPORT — pure (de)serialization helpers
//
// Kept side-effect-free so they're unit-testable; index.js orchestrates the
// actual create calls against the live model + API. Supports:
//   • JSON  — full structure + members (round-trips an export).
//   • CSV   — flat member rows with a "path" column ("Division / Dept / Role").
// ==============================================

export const CSV_COLUMNS = [
  'path', 'prefix', 'full_name', 'nickname', 'student_id', 'year', 'major', 'kkumail', 'confirmed',
];

export const PATH_SEP = ' / ';

// ---- JSON ----

export function buildExportJson(nodes, members) {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    nodes: nodes.map((n) => ({
      id: n.id, parent_id: n.parent_id || null, name: n.name, kind: n.kind,
      position: n.position ?? 0, permissions: n.permissions || [],
      inherit_permissions: n.inherit_permissions !== false,
    })),
    members: members.map((m) => ({
      id: m.id, node_id: m.node_id, position: m.position ?? 0,
      prefix: m.prefix || null, full_name: m.full_name, nickname: m.nickname || null,
      student_id: m.student_id || null, year: m.year || null, major: m.major || null,
      kkumail: m.kkumail || null, confirmed: !!m.confirmed,
    })),
  };
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
    else if (ch === '\r') { /* swallow; \n handles row break */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
}

/** Parse a members CSV into objects keyed by header. Tolerates header aliases
 *  (Thai labels from a Google Sheet export) and column reordering. */
export function parseMembersCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => normHeader(h));
  return rows.slice(1).map((cells) => {
    const o = {};
    header.forEach((key, i) => { if (key) o[key] = (cells[i] ?? '').trim(); });
    o.confirmed = /^(true|1|yes|ใช่|ยืนยัน|เข้าแล้ว)$/i.test(o.confirmed || '');
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
  const t = String(h || '').trim().toLowerCase();
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => a.toLowerCase() === t)) return key;
  }
  return '';  // unknown column → ignored
}

export function splitPath(path) {
  return String(path || '').split('/').map((s) => s.trim()).filter(Boolean);
}
