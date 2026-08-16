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
 * `[a,b)` minus every range in `cuts`, as the pieces that survive.
 *
 * Unit-agnostic on purpose — the rail carves in minutes-of-day and the session
 * gaps carve in epoch milliseconds, and one implementation of "what is left of
 * this interval" is the point. It was a closure inside paintGrid() serving only
 * the first of those.
 */
export function carve(a, b, cuts) {
  let pieces = [[a, b]];
  (cuts || []).forEach(([cs, ce]) => {
    const next = [];
    pieces.forEach(([ps, pe]) => {
      if (ce <= ps || cs >= pe) { next.push([ps, pe]); return; }
      if (cs > ps) next.push([ps, cs]);
      if (ce < pe) next.push([ce, pe]);
    });
    pieces = next;
  });
  return pieces;
}

/**
 * Join touching rail bands that carry the same number.
 *
 * claude_free_windows() emits a band per boundary INSTANT, and 0161 made that
 * set a deliberate superset: it names `booking_start + 5h` for every booking,
 * including the ones that joined an earlier window and open nothing. A superset
 * is the safe direction server-side — a boundary too few draws a wrong number
 * for hours — but drawn literally it splits one 25% stretch into three abutting
 * 25% boxes, each captioned "25%", which reads as three different facts.
 *
 * So the client merges. The band's own identity is its NUMBER, not the instant
 * that happened to split it.
 */
export function mergeBands(bands) {
  const out = [];
  (bands || []).forEach((fw) => {
    const prev = out[out.length - 1];
    if (prev
        && prev.ends_at === fw.starts_at
        && Math.round(Number(prev.free_pct)) === Math.round(Number(fw.free_pct))
        && prev.bound_by === fw.bound_by) {
      // The later band's end wins; everything else describes the same answer.
      out[out.length - 1] = { ...prev, ends_at: fw.ends_at, until: fw.until };
      return;
    }
    out.push({ ...fw });
  });
  return out;
}

/**
 * How much of a booking's card fits in the height the calendar gave it.
 *
 * A NUMBER decides this, not a media query, because the constraint is the
 * block's HEIGHT — which is its duration times --claude-hour-h, and that
 * variable moves with "พอดีจอ", the mobile breakpoint and a tablet rotation.
 * A stylesheet cannot ask how tall an element is; paintGrid() already computed
 * it.
 *
 * Three tiers, each the largest thing that fits:
 *   'full'   — two lines: the time RANGE, then the name and the percentage.
 *   'tight'  — the same two lines at a smaller size (~28–40px, a 45-minute
 *              block on a phone).
 *   'micro'  — the range, then the percentage under it, at the smallest size
 *              with no padding. The NAME is what goes; it is the one of the
 *              three a tooltip can carry without being missed.
 *
 * MICRO IS STACKED, NOT A SINGLE ROW, and that was measured rather than
 * preferred. The first version put the range and the percentage side by side:
 * on a phone the card is 81px wide (the grid has min-width: 940px and SCROLLS
 * rather than squeezing its columns, so 81px is the card at every viewport
 * below 940), and "11:00–11:30" plus "20%" wanted 86px of the 71px inside the
 * padding. Two short lines fit where one long one does not.
 *
 * The RANGE survives every tier — it is what the owner asked to be able to read
 * off the block ("it shows only 16.00 not 16.00-21:00").
 */
export function bookingLayout(heightPx) {
  if (heightPx >= 40) return 'full';
  if (heightPx >= 28) return 'tight';
  return 'micro';
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
