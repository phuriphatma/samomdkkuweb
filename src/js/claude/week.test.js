// The calendar must cover the quota week EXACTLY — no minute drawn that belongs
// to another week, no minute of this week left undrawn.
//
// REPORTED: "when i try book in the next week like 19 ส.ค. for 02.00-05.00 …
// it doesn't render on that next calendar because it's the token of previous
// week, but it counts the token."
//
// Exactly right, and there were two faults with one cause — a hardcoded seven
// columns for a week that spans eight calendar dates:
//
//   1. 19 Aug 00:00–16:00 was DRAWN AND BOOKABLE on the 19-Aug week, but the
//      reset is 16:00, so that block belongs to the previous quota week. It
//      saved, then disappeared: get_claude_board() filters by week, correctly.
//      Meanwhile the modal's live preview had counted it against the week on
//      screen — the wrong pool.
//   2. 26 Aug 00:00–16:00 — sixteen hours that ARE in the week — had no column
//      at all. Nothing there could be seen, and nothing could be booked.
//
// Neither is visible in a diff and neither throws. So the invariant is asserted
// here over MANY reset times rather than the one the bug happened to be found
// on: a guard whose subject is a single hardcoded case only ever catches that
// case.
import { describe, it, expect } from 'vitest';
import {
  dayColumnsFor, bookableRangeFor, coversWeek, startOfDay,
  carve, mergeBands, bookingLayout,
} from './week.js';

const DAY_MS = 86400000;
const MIN_MS = 60000;
const wk = (start) => [new Date(start), new Date(start.getTime() + 7 * DAY_MS)];

/** Every reset hour, on every weekday — 168 weeks' worth of geometry. */
const ALL_RESETS = [];
for (let dow = 0; dow < 7; dow++) {
  for (let hour = 0; hour < 24; hour++) {
    const d = new Date(2026, 7, 16 + dow, hour, 0, 0, 0);
    ALL_RESETS.push([`${d.toDateString()} ${String(hour).padStart(2, '0')}:00`, d]);
  }
}

describe('the grid covers the quota week exactly', () => {
  it.each(ALL_RESETS)('covers the week starting %s', (_label, start) => {
    const [ws, we] = wk(start);
    expect(coversWeek(ws, we)).toBe(true);
  });

  it('spans EIGHT columns for a mid-day reset (the real Wed 16:00 case)', () => {
    const [ws, we] = wk(new Date(2026, 7, 19, 16, 0, 0, 0));
    const cols = dayColumnsFor(ws, we);
    expect(cols).toHaveLength(8);
    expect(cols[0].getDate()).toBe(19);
    expect(cols[7].getDate()).toBe(26);   // the column the bug omitted
  });

  it('spans SEVEN columns for a midnight reset — the count is derived, not fixed', () => {
    const [ws, we] = wk(new Date(2026, 7, 17, 0, 0, 0, 0));
    expect(dayColumnsFor(ws, we)).toHaveLength(7);
  });
});

describe('the out-of-week slivers are not bookable', () => {
  const [ws, we] = wk(new Date(2026, 7, 19, 16, 0, 0, 0));
  const cols = dayColumnsFor(ws, we);

  it('the reported case: 19 Aug 02:00 is BEFORE the reset, so it is refused', () => {
    const r = bookableRangeFor(cols[0].getTime(), ws, we);
    expect(r.min).toBe(16 * 60);            // 00:00–16:00 belongs to last week
    expect(2 * 60).toBeLessThan(r.min);     // the block the owner booked
  });

  it('the last column stops at the reset, not at midnight', () => {
    const r = bookableRangeFor(cols[7].getTime(), ws, we);
    expect(r.min).toBe(0);
    expect(r.max).toBe(16 * 60);
  });

  it('every middle column is bookable all day', () => {
    cols.slice(1, 7).forEach((c) => {
      const r = bookableRangeFor(c.getTime(), ws, we);
      expect({ min: r.min, max: r.max }).toEqual({ min: 0, max: 1440 });
    });
  });

  it('the bookable minutes sum to exactly one week', () => {
    // The strongest form of the invariant: no double-count, no gap.
    const total = cols.reduce((n, c) => {
      const r = bookableRangeFor(c.getTime(), ws, we);
      return n + Math.max(0, r.max - r.min);
    }, 0);
    expect(total).toBe((7 * DAY_MS) / MIN_MS);
  });
});

describe('startOfDay', () => {
  it('returns local midnight and does not mutate its argument', () => {
    const d = new Date(2026, 7, 19, 16, 30, 5, 250);
    const s = startOfDay(d);
    expect([s.getHours(), s.getMinutes(), s.getSeconds(), s.getMilliseconds()])
      .toEqual([0, 0, 0, 0]);
    expect(d.getHours()).toBe(16);
  });
});

// ── carve: what is LEFT of an interval ─────────────────────────────────────
//
// Two callers with different units — the rail carves minutes-of-day, the
// session gaps carve epoch milliseconds — which is exactly why it is one
// function. The property that matters to both is that the pieces are disjoint,
// inside [a,b), and touch nothing in `cuts`.
describe('carve', () => {
  it('a cut in the middle leaves the two ends', () => {
    expect(carve(0, 100, [[40, 60]])).toEqual([[0, 40], [60, 100]]);
  });

  it('a cut covering the whole interval leaves nothing', () => {
    expect(carve(0, 100, [[0, 100]])).toEqual([]);
  });

  it('a cut that only overlaps trims rather than removes', () => {
    expect(carve(20, 80, [[0, 40]])).toEqual([[40, 80]]);
    expect(carve(20, 80, [[60, 200]])).toEqual([[20, 60]]);
  });

  it('a cut that misses leaves the interval whole', () => {
    expect(carve(20, 80, [[80, 90]])).toEqual([[20, 80]]);
    expect(carve(20, 80, [])).toEqual([[20, 80]]);
    expect(carve(20, 80, undefined)).toEqual([[20, 80]]);
  });

  // THE OWNER'S CASE, in the unit the session gaps use. A 5-hour window opened
  // at 16:00 with a booking 16:00–19:00 leaves 19:00–21:00 — the stretch the
  // dashed box is drawn over.
  it('a booking at the head of its window leaves the tail', () => {
    const h = 3600000;
    const win = [16 * h, 21 * h];
    expect(carve(win[0], win[1], [[16 * h, 19 * h]]))
      .toEqual([[19 * h, 21 * h]]);
  });

  // …and a booking filling its window leaves NOTHING, which is what makes the
  // box disappear rather than being drawn with a zero in it.
  it('a booking filling its window leaves no gap at all', () => {
    const h = 3600000;
    expect(carve(16 * h, 21 * h, [[16 * h, 21 * h]])).toEqual([]);
  });
});

// ── mergeBands: the rail's boundary set is a deliberate superset ───────────
describe('mergeBands', () => {
  const band = (a, b, pct, bound = 'session') => ({
    starts_at: a, ends_at: b, free_pct: pct, bound_by: bound, until: b,
  });

  it('joins touching bands that carry the same number', () => {
    const out = mergeBands([band('A', 'B', 25), band('B', 'C', 25)]);
    expect(out).toHaveLength(1);
    expect(out[0].starts_at).toBe('A');
    expect(out[0].ends_at).toBe('C');
  });

  it('does NOT join across a change of number', () => {
    expect(mergeBands([band('A', 'B', 25), band('B', 'C', 100)])).toHaveLength(2);
  });

  // The number can be equal while the REASON differs — "25% because the session
  // is shared" and "25% because the week is nearly gone" are different facts and
  // the rail's tooltip says which. Merging them would print one of the two over
  // a stretch where the other was true.
  it('does NOT join across a change of bound_by', () => {
    expect(mergeBands([band('A', 'B', 25), band('B', 'C', 25, 'week')]))
      .toHaveLength(2);
  });

  it('does NOT join bands that do not touch', () => {
    expect(mergeBands([band('A', 'B', 25), band('X', 'C', 25)])).toHaveLength(2);
  });

  it('survives an empty or missing list', () => {
    expect(mergeBands([])).toEqual([]);
    expect(mergeBands(undefined)).toEqual([]);
  });

  // The control: a merger that returned its input unchanged would pass every
  // "does NOT join" case above.
  it('control — a run of three equal bands collapses to one', () => {
    const out = mergeBands([band('A', 'B', 25), band('B', 'C', 25), band('C', 'D', 25)]);
    expect(out).toHaveLength(1);
    expect(out[0].ends_at).toBe('D');
  });
});

// ── bookingLayout: the RANGE survives every tier ──────────────────────────
//
// The owner's report was "it shows only 16.00 not 16.00-21:00". The tiers exist
// so the range never has to be dropped again — what gets dropped as the block
// shrinks is the NAME, then nothing else.
describe('bookingLayout', () => {
  it('a two-hour block on a desktop gets both lines', () => {
    expect(bookingLayout(86)).toBe('full');     // 2h at --claude-hour-h: 44px
  });

  it('a 45-minute block on a phone still gets both lines, smaller', () => {
    expect(bookingLayout(28.5)).toBe('tight');  // 45m at 38px/hour
  });

  it('a 15-minute block drops the name and stacks range over percentage', () => {
    expect(bookingLayout(18)).toBe('micro');
  });

  it('the tiers are ordered and cover every height', () => {
    const seen = new Set();
    for (let h = 0; h <= 400; h += 0.5) seen.add(bookingLayout(h));
    expect([...seen].sort()).toEqual(['full', 'micro', 'tight']);
  });

  // The tiers must be MONOTONE in height — a taller block may never get a
  // poorer layout. Written as a property because the alternative is three
  // examples that all pass while the thresholds are out of order.
  it('a taller block never gets a smaller layout', () => {
    const rank = { micro: 0, tight: 1, full: 2 };
    let prev = -1;
    for (let h = 0; h <= 400; h += 0.5) {
      const r = rank[bookingLayout(h)];
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });
});
