// fmt.js — how จองโควตา Claude says a time, a duration, a percentage and a
// person. Pure, and shared by every renderer in this folder.
//
// It exists because the second renderer (usage.js) needed the same eight
// helpers the first one had, and copying them would have put "what colour is
// this person" in two places — the drift class this repo pays for more than any
// other. A ฝ่าย that changed colour in the calendar and not in the log would be
// a bug nobody would think to look for.

import { tintFor } from '../dept-tint.js';

const MIN_MS = 60000;

export const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const minsOfDay = (d) => d.getHours() * 60 + d.getMinutes();

/** Thai day letters. Intl carries the era and the month abbreviations; a
 *  hand-rolled month table is how a date renders as 'undefined' for one month
 *  of the year. */
export const THAI_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
/** The SPELLED-OUT day, for prose. THAI_DOW is the calendar column header and
 *  is an abbreviation, so using it in a sentence produces "ทุกวันพ". */
export const THAI_DOW_FULL = [
  'อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์',
];
export const dayLabel = (d) => `${THAI_DOW[d.getDay()]} ${d.getDate()}`;
export const fullDate = (d) => d.toLocaleDateString('th-TH', {
  day: 'numeric', month: 'short', year: '2-digit',
});
export const stampLabel = (d) => `${fullDate(d)} ${hhmm(d)}`;
export const dayStamp = (d) => `${THAI_DOW[d.getDay()]} ${d.getDate()} ${hhmm(d)}`;

export function durLabel(ms) {
  const mins = Math.max(0, Math.round(ms / MIN_MS));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} ชม. ${m} น.`;
  if (h) return `${h} ชม.`;
  return `${m} น.`;
}

/** One decimal only when there is one — "434%" reads as a quantity,
 *  "434.0%" reads as an instrument. */
export function pctText(v) {
  if (v == null) return '—';
  const n = Number(v);
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

export function personName(person) {
  const n = (person?.name || '').trim();
  if (n) return n;
  // A booking by an account with no ตำแหน่ง in the tree. Shared department
  // accounts have none, and they are exactly the operators most likely to be
  // using this — so name the situation rather than rendering a blank block.
  return 'บัญชีที่ยังไม่มีตำแหน่งในผังทีม';
}

export const shortName = (person) => personName(person).split(' ')[0];

export function personDept(person) {
  const path = Array.isArray(person?.path) ? person.path : [];
  // The last ancestor is the immediate container — the most specific ฝ่าย.
  return path.length ? path[path.length - 1] : '';
}

/** The ฝ่าย colour for a person, from their org path.
 *
 *  Scanned ROOT-FIRST and stopped at the first match, which is the inheritance
 *  rule dept-tint.js settled on in 0152: a name match is a GUESS standing in
 *  for an identity nobody recorded, so the OUTERMOST ฝ่าย wins and a
 *  ฝ่ายวิชาการ nested under ฝ่ายรังสีเทคนิค draws in รังสีเทคนิค's colour
 *  rather than hijacking its own. */
export function personColor(person) {
  const path = Array.isArray(person?.path) ? person.path : [];
  for (const name of path) {
    const tint = tintFor(name);
    if (tint) return `var(--dept-${tint})`;
  }
  return 'var(--brand-primary)';
}
