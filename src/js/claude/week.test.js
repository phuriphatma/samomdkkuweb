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
import { dayColumnsFor, bookableRangeFor, coversWeek, startOfDay } from './week.js';

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
