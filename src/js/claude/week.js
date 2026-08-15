// week.js — the calendar geometry of a Claude quota week. Pure: no DOM, no
// network, no module state, so it can be tested directly.
//
// It exists because the first version got this wrong at BOTH ends and the
// failure was silent. The quota week runs Wed 16:00 → Wed 16:00, so it spans
// EIGHT calendar dates, and a hardcoded seven columns:
//
//   • drew 19 Aug 00:00–16:00, which belongs to the PREVIOUS quota week — a
//     booking made there saved fine and then vanished, because the board RPC
//     filters by week;
//   • omitted 26 Aug 00:00–16:00 entirely — sixteen hours that ARE in the week
//     and had no column to be drawn in, so nothing there could be seen or made.
//
// Both come from assuming a number instead of deriving it. Everything here
// derives from the two boundary instants.

const DAY_MS = 86400000;
const MIN_MS = 60000;

/** Local midnight of `d`, as a new Date. */
export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * The day columns whose union covers the whole quota week.
 *
 * Count is derived: a midnight reset gives 7 columns, a mid-day reset gives 8.
 * Returns local-midnight Dates, one per column.
 */
export function dayColumnsFor(weekStart, weekEnd) {
  const first = startOfDay(weekStart);
  const n = Math.ceil((weekEnd.getTime() - first.getTime()) / DAY_MS);
  return Array.from({ length: n }, (_, i) => new Date(first.getTime() + i * DAY_MS));
}

/**
 * The bookable slice of one day column, in minutes-of-day.
 *
 * Outside `[min, max)` the instant belongs to a neighbouring quota week: it is
 * drawn hatched so the boundary is visible, and refused by the drag handler.
 * For every column except the first and last this is the whole day.
 */
export function bookableRangeFor(dayStartMs, weekStart, weekEnd) {
  return {
    min: Math.max(0, (weekStart.getTime() - dayStartMs) / MIN_MS),
    max: Math.min(1440, (weekEnd.getTime() - dayStartMs) / MIN_MS),
  };
}

/**
 * Does the column set cover the quota week exactly — nothing missing, and every
 * in-week minute reachable? The invariant the bug violated, as a function, so a
 * test can assert it over many reset times rather than the one we happened to
 * have.
 */
export function coversWeek(weekStart, weekEnd) {
  const cols = dayColumnsFor(weekStart, weekEnd);
  if (!cols.length) return false;
  const firstBookable = cols[0].getTime()
    + bookableRangeFor(cols[0].getTime(), weekStart, weekEnd).min * MIN_MS;
  const last = cols[cols.length - 1];
  const lastBookable = last.getTime()
    + bookableRangeFor(last.getTime(), weekStart, weekEnd).max * MIN_MS;
  return firstBookable === weekStart.getTime() && lastBookable === weekEnd.getTime();
}
