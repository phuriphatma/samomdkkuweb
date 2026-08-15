// dept-tint.js — which colour identity a ฝ่าย carries.
//
// The ฝ่าย already have colour identities in base.css (`--dept-*`, "SAMO 69"),
// used by the ฝ่าย tab and the public org chart. This is the ONE table that
// decides which name gets which, because there are now two consumers a long way
// apart — the public chart (org-chart.js) and the ทีม SAMO admin tree
// (team/index.js) — and a ฝ่าย that is yellow on one screen and green on the
// other is worse than one that is grey on both.
//
// Matched on the NAME, and that is a deliberate limitation rather than an
// oversight: the public chart projection carries no dept id (it is an explicit
// allow-list of jsonb keys, and adding one to serve a colour would widen a
// security boundary for decoration). A ฝ่าย the table does not recognise gets
// null, and every caller falls back to the brand green — the palette is 10
// colours and the tree has 15 roots, so that path is normal, not an error.
//
// A tint name here MUST have a matching `--dept-<name>` in base.css.
// `dept-tint.test.js` fails if one does not: a missing custom property resolves
// to nothing and the bar simply disappears, which is CSS's usual silent
// failure and looks exactly like a design choice.

const DEPT_TINT = [
  [/สำนักนายก/, 'admin'],
  [/บริหารองค์กร/, 'admin'],
  [/ดิจิทัล|สื่อสารองค์กร/, 'digital'],
  [/กิจการภายใน/, 'internal'],
  [/กิจการภายนอก/, 'external'],
  [/กิจการมหาวิทยาลัย/, 'university'],
  [/วิชาการ/, 'academic'],
  [/ยุทธศาสตร์|พัฒนาองค์กร/, 'strategy'],
  [/คุณภาพชีวิต|สิ่งแวดล้อม/, 'quality'],
  [/เวชนิทัศน์/, 'media'],
  [/รังสีเทคนิค/, 'projects'],
];

/** The tint name for a ฝ่าย, or null if the palette has none for it. */
export function tintFor(name) {
  const hit = DEPT_TINT.find(([re]) => re.test(name || ''));
  return hit ? hit[1] : null;
}

/** Every tint this table can return — the subject `dept-tint.test.js` checks
 *  base.css against, derived from the table rather than listed again. */
export const TINT_NAMES = [...new Set(DEPT_TINT.map(([, t]) => t))];
