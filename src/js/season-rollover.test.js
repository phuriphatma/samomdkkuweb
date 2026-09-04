// ============================================================
// season-rollover.test.js — create the new วาระ/season BEFORE ending the old one.
//
// passport.stamp_scan stamps every scan with "the open row having the latest
// started_at", and passport.scans.samo_year_id / season_id are both NULLABLE
// while points_awarded is not. So if a rollover ends the current row before
// creating its replacement, a scan landing in that window:
//
//   - succeeds, showing the student nothing wrong,
//   - still adds km to their total_km (the trigger never reads the season), and
//   - is filed under NO วาระ and NO season, missing from every per-period view
//     for ever, repairable only by guessing from a timestamp.
//
// Both rollover buttons did exactly that until 2026-09-04 — and their FAILURE
// paths were worse than the race: if creating the replacement errored, the old
// rows were already ended and nothing was open at all until a human noticed.
//
// Creating first makes the worst case a one-second OVERLAP, which every reader
// resolves correctly because they all take the newest open row. The fix shipped
// into a repo with no test runner; this is the standing guard it owed, added
// when passport moved in here.
//
// Rule and reasoning: docs/INVARIANTS.md, "Never leave a GAP between two วาระ
// or two seasons".
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'passport/js/admin-page.js'), 'utf8');

/** The body of one `window.<name> = async () => { … }` handler. */
function bodyOf(name) {
  const start = SRC.indexOf(`window.${name} = async () =>`);
  expect(start, `${name} not found in admin-page.js — was it renamed?`).toBeGreaterThan(-1);
  const end = SRC.indexOf('\n};', start);
  expect(end, `${name}: could not find the end of the handler`).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

const ROLLOVERS = ['startNewYear', 'startNewSeason'];

describe('season / วาระ rollover leaves no gap', () => {
  it('found both rollover handlers (a sweep that finds nothing must prove it looked)', () => {
    expect(ROLLOVERS.length).toBe(2);
    for (const n of ROLLOVERS) expect(bodyOf(n).length).toBeGreaterThan(200);
  });

  for (const name of ROLLOVERS) {
    describe(name, () => {
      const body = bodyOf(name);

      it('CREATES the replacement before ending anything', () => {
        const insertAt = body.indexOf('.insert(');
        const endAt = body.indexOf('ended_at: now');
        expect(insertAt, `${name}: no .insert( — it no longer creates a replacement`)
          .toBeGreaterThan(-1);
        expect(endAt, `${name}: no ended_at update — it no longer closes the old row`)
          .toBeGreaterThan(-1);
        expect(insertAt, [
          `${name} ends the current row BEFORE creating its replacement.`,
          'That reopens the window where no วาระ/season is open, and a scan in it is',
          'filed under NULL with no error shown to anyone. It also means a failed',
          'insert leaves NOTHING open at all.',
          'This ordering reads tidier and is the bug — see docs/INVARIANTS.md.',
        ].join('\n')).toBeLessThan(endAt);
      });

      it('excludes the row it just created when closing the old ones', () => {
        expect(body, [
          `${name}'s closing update has no .neq('id', …).`,
          'Without it the update matches every row with ended_at IS NULL — which now',
          'includes the season it just created. The button would end its own new',
          'season, leaving nothing open: worse than the bug it was meant to fix.',
        ].join('\n')).toContain(".neq('id'");
      });

      it('does not end anything on the failure path', () => {
        // Everything before the first `ended_at: now` must be able to bail out
        // without having closed a row. If an `ended_at` write appears before the
        // first early return, the failure path is destructive again.
        const endAt = body.indexOf('ended_at: now');
        const beforeEnd = body.slice(0, endAt);
        expect(beforeEnd, `${name}: no early return guarding the insert — an error would `
          + 'fall through to the closing update').toMatch(/if\s*\([^)]*error[\s\S]{0,300}?return;/);
      });
    });
  }

  it('startNewYear rolls back its new วาระ if the season cannot be created', () => {
    // stamp_scan resolves the season GLOBALLY, with no year filter. An open year
    // owning no season would therefore pair the NEW year with the OLD year's
    // season and mis-stamp every scan — so a half-finished rollover must undo
    // itself rather than be left for someone to notice.
    const body = bodyOf('startNewYear');
    expect(body, [
      'startNewYear no longer deletes the วาระ it created when the season insert fails.',
      'An open วาระ with no season of its own pairs with the PREVIOUS season, because',
      'stamp_scan looks the season up globally. Every scan is then mis-stamped.',
    ].join('\n')).toMatch(/\.delete\(\)[\s\S]{0,80}newYear\.id/);
  });
});
