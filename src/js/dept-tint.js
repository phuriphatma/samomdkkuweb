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
 * The CSS colour a node is drawn in, or null to INHERIT its parent's.
 *
 * TWO SOURCES, and they have different scopes:
 *
 *   CHOSEN  (`team_nodes.color`, 0152) — honoured at ANY depth. Somebody typed
 *           it about this exact node, so it is never a guess.
 *   DERIVED (the name matched `DEPT_TINT`) — honoured at the ROOT ONLY.
 *
 * REPORTED: "ฝ่ายวิชาการ that is inside ฝ่ายรังสีเทคนิค shows different color,
 * there shouldnt be a bug like that." Exactly right. The name match is a GUESS
 * standing in for an identity nobody recorded, and a guess is only defensible
 * where there is nothing to inherit. Applied at every level it overrides the
 * branch a node actually belongs to: measured on the live tree, 29 non-root
 * nodes match the palette by name, and `ฝ่ายวิชาการ` turns up under
 * ฝ่ายรังสีเทคนิค AND under ฝ่ายเวชนิทัศน์.
 *
 * The other 27 mostly matched the SAME colour as their own root by coincidence
 * (`อุปนายกฝ่ายบริหารองค์กร` contains `บริหารองค์กร`), painted the right answer
 * for the wrong reason, and are why this survived review — the visible failures
 * were the two where the coincidence broke.
 *
 * The stored value is constrained to a hex literal in the database (0152), and
 * this is the only place either source turns into a CSS value, so a caller
 * cannot accidentally interpolate something else into a style attribute.
 *
 * @param isRoot true only for a node with no ฝ่าย above it to inherit from
 */
export function tintColor(node, isRoot = false) {
  if (!node) return null;
  if (isHexColor(node.color)) return node.color;
  if (!isRoot) return null;
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
