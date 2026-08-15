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

/** The tint NAME for a ฝ่าย, from its name alone, or null. The fallback half
 *  of `tintColor` — exported for the guard, which asserts every name this can
 *  return has a `--dept-*` behind it. */
export function tintFor(name) {
  const hit = DEPT_TINT.find(([re]) => re.test(name || ''));
  return hit ? hit[1] : null;
}

/**
 * The CSS colour a node is drawn in, or null to inherit the brand green.
 *
 * TWO SOURCES, in order: what the admin CHOSE (`team_nodes.color`, 0152), then
 * what the name IMPLIES. Chosen wins, because the derived answer exists only
 * because there was nothing better — the palette names ten ฝ่าย and the tree
 * has fifteen roots, and a rename used to lose a ฝ่าย's colour in silence.
 *
 * The stored value is constrained to a hex literal in the database (0152), and
 * this is the only place either half turns into a CSS value, so a caller cannot
 * accidentally interpolate something else into a style attribute.
 */
export function tintColor(node) {
  if (!node) return null;
  if (isHexColor(node.color)) return node.color;
  const named = tintFor(node.name);
  return named ? `var(--dept-${named})` : null;
}

/** The client-side half of 0152's CHECK. Belt and braces: the column is
 *  constrained, but this value is interpolated into a `style` attribute on an
 *  anonymous public page, and a projection is one `create or replace` away from
 *  carrying something else. Two checks of one rule, deliberately — see
 *  `dept-tint.test.js`, which asserts they agree on the same strings. */
export function isHexColor(v) {
  return typeof v === 'string' && /^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{2})?)?$/.test(v);
}

/** Every tint this table can return — the subject `dept-tint.test.js` checks
 *  base.css against, derived from the table rather than listed again. */
export const TINT_NAMES = [...new Set(DEPT_TINT.map(([, t]) => t))];
