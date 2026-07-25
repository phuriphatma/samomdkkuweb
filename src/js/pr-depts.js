// ==============================================
// PR DEPARTMENTS — the single source of truth for `pr_tickets.department`
//
// This list used to be hand-written TWICE in HTML (the submit form's
// ข้อมูลผู้ส่งงาน → ฝ่าย select and the admin staff dept filter). They drifted:
// both carried the same typo, both were missing ฝ่ายรังสีเทคนิค, and only the
// admin one had โครงการอื่นๆ. Both selects are now filled from here, so adding
// a ฝ่าย is a one-line change that cannot go half-applied.
//
// `pr_tickets.department` is free text (no DB constraint, no FK) — these
// strings ARE the stored values, so renaming one orphans historical rows.
// That is what DEPT_ALIASES exists for; see canonicalPrDept().
// ==============================================

/** Canonical options, in display order. นายกสโม leads (top of the org chart);
 *  โครงการอื่นๆ trails and is the one value the form treats specially
 *  (see updateFormVisibility → project mode). */
export const PR_DEPARTMENTS = [
  'นายกสโม',
  'ฝ่ายบริหารองค์กร',
  'ฝ่ายดิจิทัลและสื่อสารองค์กร',
  'ฝ่ายกิจการภายใน',
  'ฝ่ายกิจการภายนอก',
  'ฝ่ายกิจการมหาวิทยาลัย',
  'ฝ่ายวิชาการ',
  'ฝ่ายยุทธศาสตร์และพัฒนาองค์กร',
  'ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',
  'ฝ่ายเวชนิทัศน์',
  'ฝ่ายรังสีเทคนิค',
  'โครงการอื่นๆ',
];

/** Label overrides for the option text (value stays the canonical string). */
const PR_DEPT_LABEL = { 'โครงการอื่นๆ': 'โครงการอื่นๆ (Projects)' };

/** Superseded spellings → the canonical value they now map to.
 *  'ฝ่ายคุณภาพขีวิต…' (ขี, not ชี) was the shipped option value until
 *  2026-07-25; 8 live tickets still carry it. Nothing rewrites the stored
 *  column — reads normalize instead, so history stays intact and the dept
 *  filter keeps finding those tickets. */
const DEPT_ALIASES = {
  'ฝ่ายคุณภาพขีวิตและสิ่งแวดล้อม': 'ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',
};

/** Normalize a stored department to its canonical spelling. Apply at the
 *  DB-row → view-model boundary so display AND filtering agree; never write
 *  the result back (the alias is a read-side concern). */
export function canonicalPrDept(dept) {
  const d = typeof dept === 'string' ? dept.trim() : '';
  if (!d) return '';
  return DEPT_ALIASES[d] || d;
}

/** Fill a <select> with the department options.
 *  @param {HTMLSelectElement|null} sel
 *  @param {{placeholder?: string, allOption?: string}} opts
 *    placeholder — a disabled, preselected first option (the submit form)
 *    allOption   — a first option valued 'all' (the staff filter) */
export function fillPrDeptSelect(sel, { placeholder = '', allOption = '' } = {}) {
  if (!sel) return;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const head = placeholder
    ? `<option value="" disabled selected>${esc(placeholder)}</option>`
    : (allOption ? `<option value="all">${esc(allOption)}</option>` : '');
  const prev = sel.value;
  sel.innerHTML = head + PR_DEPARTMENTS
    .map((d) => `<option value="${esc(d)}">${esc(PR_DEPT_LABEL[d] || d)}</option>`)
    .join('');
  // Re-entering the staff dashboard refills this select; keep the user's
  // current filter instead of silently snapping back to "ทุกฝ่าย".
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}
