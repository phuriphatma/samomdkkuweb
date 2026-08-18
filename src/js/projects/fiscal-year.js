// ==============================================
// PROJECTS FISCAL YEAR — the ONE implementation of ปีงบประมาณ.
//
// The Thai budget year runs 1 ต.ค. – 30 ก.ย. and is NAMED for the year it
// ENDS in: ปีงบ 2569 = 1 ต.ค. 2568 → 30 ก.ย. 2569. So a date in Oct–Dec
// falls into the NEXT พ.ศ. year.
//
// Two answers live here, and they must never be two implementations:
//
//   deriveFiscalYearBE(date)   what the CLOCK says
//   projectFiscalYear(project) what the SYSTEM says — the override if a
//                              human set one, otherwise the clock
//
// Every reader (the filter, the dropdown, the counts, the detail header)
// goes through projectFiscalYear(). A second copy of "…+ 543 + (month >= 9)"
// anywhere else is the drift this repo keeps paying for (mistakes class 6),
// so the guard in fiscal-year.test.js greps the module tree for one.
//
// WHY AN OVERRIDE AND NOT A STORED VALUE. `projects.fiscal_year_be` is NULL
// for every row nobody has moved, and NULL means "ask the clock" — so
// correcting a โครงการ's created_at still re-derives its ปีงบ. A column
// filled once from an expression stops tracking that expression forever
// (0128, cohort_year), which is the bug this shape exists to avoid.
// ==============================================

/** Month index (0-based) the Thai fiscal year rolls over on — 9 = October. */
export const FISCAL_ROLLOVER_MONTH = 9;

/** Thai fiscal year (ปีงบประมาณ, พ.ศ. — 4 digits) for a timestamp.
 *  Uses the viewer's local calendar (the audience is in ICT, where local
 *  time is the authoritative boundary). Returns null on a bad/absent date. */
export function deriveFiscalYearBE(dateStr) {
  if (!dateStr) return null;
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return d.getFullYear() + 543 + (d.getMonth() >= FISCAL_ROLLOVER_MONTH ? 1 : 0);
}

/** The ปีงบประมาณ this โครงการ belongs to: the human's override when one
 *  was set, otherwise the derivation from created_at. Returns a NUMBER,
 *  or null when there is no date to derive from and no override. */
export function projectFiscalYear(project) {
  const override = Number(project?.fiscal_year_be);
  if (Number.isFinite(override) && override > 0) return override;
  return deriveFiscalYearBE(project?.created_at);
}

/** Has a human moved this โครงการ off the year its date implies? Used to
 *  label the detail header, so a moved year never looks like a bug. */
export function isFiscalYearMoved(project) {
  const override = Number(project?.fiscal_year_be);
  if (!Number.isFinite(override) || override <= 0) return false;
  return override !== deriveFiscalYearBE(project?.created_at);
}

/** The ปีงบประมาณ we are in right now. `now` is injectable so the tests can
 *  stand on 30 ก.ย. and 1 ต.ค. without waiting a year. */
export function currentFiscalYearBE(now = new Date()) {
  return deriveFiscalYearBE(now);
}

// ---------- the per-person default filter ----------

/** The three shapes `project_user_prefs.default_fiscal_year` may hold.
 *  Mirrors the CHECK constraint in migration 0165 — kept in step by
 *  fiscal-year.test.js, which asserts the constraint's own regex. */
export const DEFAULT_FY_ALL = 'all';
export const DEFAULT_FY_CURRENT = 'current';

/** Is `v` a value the column would accept? Anything else is treated as
 *  'all' — an unreadable preference must fail to the behaviour the app had
 *  before preferences existed, never to an empty screen. */
export function isValidDefaultFY(v) {
  return v === DEFAULT_FY_ALL || v === DEFAULT_FY_CURRENT || /^[0-9]{4}$/.test(String(v || ''));
}

/** Turn a stored preference into the filter value the dropdown uses.
 *  'current' is resolved HERE, at open time — that is the whole point of
 *  the option: on 1 ต.ค. 2570 it starts answering 2570 with nobody
 *  touching anything. */
export function resolveDefaultFY(pref, now = new Date()) {
  if (!isValidDefaultFY(pref)) return DEFAULT_FY_ALL;
  if (pref === DEFAULT_FY_CURRENT) return String(currentFiscalYearBE(now));
  return String(pref);
}

/** Every year the ปีงบ dropdown should offer, newest first, as STRINGS.
 *
 *  Three sources, deliberately:
 *    - the years the projects actually occupy (so the list grows by itself)
 *    - the CURRENT year (so on 1 ต.ค. 2570 the year is pickable before the
 *      first 2570 โครงการ exists — otherwise "ปีงบปัจจุบัน" would resolve
 *      to a year the select has no option for and silently snap to ทุกปีงบ)
 *    - the year the viewer's own default resolves to, for the same reason
 */
export function fiscalYearOptions(projects, { defaultFY = null, now = new Date() } = {}) {
  const years = new Set();
  for (const p of projects || []) {
    const y = projectFiscalYear(p);
    if (y != null) years.add(Number(y));
  }
  years.add(Number(currentFiscalYearBE(now)));
  if (defaultFY && defaultFY !== DEFAULT_FY_ALL) {
    const resolved = Number(resolveDefaultFY(defaultFY, now));
    if (Number.isFinite(resolved)) years.add(resolved);
  }
  return [...years].filter((y) => Number.isFinite(y)).sort((a, b) => b - a).map(String);
}

/** Candidate years offered when MOVING a โครงการ, newest first.
 *  Centred on the year its date implies, so the common correction
 *  ("ก.ย. 2569 but the faculty books it as 2570") is one click away, and
 *  widened by whatever years the rest of the data already uses. */
export function moveTargetYears(project, projects, { now = new Date() } = {}) {
  const base = deriveFiscalYearBE(project?.created_at) ?? currentFiscalYearBE(now);
  const years = new Set([base - 1, base, base + 1, base + 2]);
  years.add(Number(currentFiscalYearBE(now)));
  const cur = projectFiscalYear(project);
  if (cur != null) years.add(Number(cur));
  for (const p of projects || []) {
    const y = projectFiscalYear(p);
    if (y != null) years.add(Number(y));
  }
  return [...years].filter((y) => Number.isFinite(y) && y >= 2500 && y <= 2700)
    .sort((a, b) => b - a).map(String);
}
