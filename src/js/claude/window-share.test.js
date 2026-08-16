// จองโควตา Claude, migration 0159 — the five things that would go wrong
// SILENTLY if a later edit undid them.
//
// The bug 0159 fixed was invisible for a day: with 08:00–13:00 booked at 100%,
// the board happily accepted a booking at 06:00, whose 5-hour window swallows
// the first one. It was invisible because the guard was ARITHMETICALLY BUSY —
// it computed sessions, it raised on straddles, it capped percentages — and
// every one of those answers was about the wrong set of rows. Nothing here
// re-tests the arithmetic; tools/claude0159-window-share.sql does that live,
// in both directions, and was falsified against the old guard. These are the
// STRUCTURAL properties that a live proof cannot see.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../strip-comments.js';
import { buildClaudeBookingPayload } from '../../../functions/_discord.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const INDEX_JS = read('./index.js');
const HTML     = read('../../html/tab-claude.html');
const CSS      = read('../../css/claude.css');
const M0159    = read('../../../supabase/migrations/'
  + '0159_claude_a_window_is_shared_by_whoever_it_covers.sql');

const CODE = stripComments(INDEX_JS);

// ── §A. The cap comes from the SERVER, always ──────────────────────────────
// The modal used to project board.sessions locally to guess how much a range
// could claim. 0159 made the rule a chain over windows with a MEASURED window
// in it; re-deriving that in the browser is the drift class this repo pays for
// most, and the failure mode is a form that offers a number the database will
// refuse.
describe('the booking form asks the database how much a range may claim', () => {
  it('calls claude_booking_limits', () => {
    expect(CODE).toContain('/rpc/claude_booking_limits');
  });

  it('the slider ceiling comes from that answer and nowhere else', () => {
    // `cap` is what slider.max is set from. It must be derived from `limits`,
    // never from board.sessions.
    expect(CODE).toMatch(/const cap =[\s\S]{0,120}limits\.max_pct/);
    expect(CODE).toMatch(/slider\.max = String\(Math\.max\(5, cap\)\)/);
  });

  it('the local session projection is gone, not merely unused', () => {
    // probeSession() was the second implementation. If it comes back under any
    // name, these are the shapes it will wear.
    expect(CODE).not.toContain('probeSession');
    expect(CODE).not.toMatch(/pool - pr\.used/);
    expect(CODE).not.toMatch(/board\.sessions\.find\([\s\S]{0,200}used_pct/);
  });

  it('a late reply cannot cap the slider for a range somebody has changed', () => {
    // The two mechanisms that make that impossible, both required: a sequence
    // number so a late reply is discarded, and a KEY so an answer is only used
    // for the range it describes. Either one alone leaves the hole open.
    expect(CODE).toContain('limitsSeq');
    expect(CODE).toMatch(/if \(seq !== limitsSeq\) return/);
    expect(CODE).toContain('limitsKey === key');
  });

  it('dragging the percentage slider does not re-ask the server', () => {
    // max_pct does not depend on the pct being asked for. A request per pixel
    // would be a hundred RPCs per booking.
    const fetchFn = CODE.slice(CODE.indexOf('async function fetchLimits'));
    expect(fetchFn.slice(0, fetchFn.indexOf('\n}\n'))).not.toContain('claudePct');
  });
});

// ── §B. The straddle rule really is gone, from BOTH sides ──────────────────
// Dropping it in SQL and leaving the client-side wall in place would keep the
// legal pair (50% at 06:00 + 50% at 08:00) undrawable in one of the two orders
// — the exact asymmetry 0159 exists to remove — while every live proof stayed
// green, because a proof writes rows and never touches the form.
describe('a block may cross a 5-hour boundary, in SQL and in the form alike', () => {
  it('the guard no longer raises the straddle error', () => {
    expect(M0159).toContain('claude_window_loads(new.id');
    expect(M0159).not.toContain('คร่อมขอบเซสชัน');
  });

  it('limitsFor() no longer treats a session edge as a wall', () => {
    const fn = CODE.slice(CODE.indexOf('function limitsFor'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).not.toContain('board.sessions');
    // The three walls that ARE still real must all still be there.
    expect(body).toContain('board.bookings');
    expect(body).toContain('weekEnd()');
    expect(body).toContain('sessionMs()');
  });
});

// ── §C. Every write announces itself ───────────────────────────────────────
// A cancel is the notification that matters most — it is the one that hands
// quota BACK — and it was the one that did not exist.
describe('booking, editing and cancelling all notify', () => {
  it('index.js fires all three modes', () => {
    expect(CODE).toMatch(/notifyBooking\(wasEdit \? 'edit' : 'new'/);
    expect(CODE).toMatch(/notifyBooking\('cancel'/);
  });

  it('the cancel notice is built from a row captured BEFORE the delete', () => {
    // Afterwards the row is off the board and the notice would have no name in
    // it — a notification that says "ไม่ทราบชื่อ" is worse than none.
    const fn = CODE.slice(CODE.indexOf('async function removeBooking'));
    const body = fn.slice(0, fn.indexOf("\n  notifyBooking('cancel'"));
    expect(body).toMatch(/const gone = \{ \.\.\.editing \}/);
    expect(body.indexOf('const gone')).toBeLessThan(body.indexOf('method: \'DELETE\''));
  });

  it('the payload builder gives each mode its own verb, title and colour', () => {
    const base = { who: 'ก', pct: 30, purpose: 'x', weekUsed: 100, weekPool: 700 };
    const made = buildClaudeBookingPayload({ ...base, mode: 'new' });
    const edited = buildClaudeBookingPayload({ ...base, mode: 'edit' });
    const gone = buildClaudeBookingPayload({ ...base, mode: 'cancel' });

    const titles = [made, edited, gone].map((p) => p.embeds[0].title);
    expect(new Set(titles).size).toBe(3);
    const colors = [made, edited, gone].map((p) => p.embeds[0].color);
    expect(new Set(colors).size).toBe(3);
    expect(gone.content).toContain('ยกเลิก');
    expect(gone.embeds[0].title).toContain('ว่างแล้ว');
  });

  it('an unknown or missing mode reads as a new booking', () => {
    // Every caller written before `mode` existed meant "new". A payload builder
    // that renders `undefined` for them would be a silent regression in the one
    // notification that already worked.
    const p = buildClaudeBookingPayload({ who: 'ก' });
    expect(p.content).toContain('จองโควตา Claude');
    expect(JSON.stringify(p)).not.toContain('undefined');
  });

  it('a cancelled block reports no "left in this session"', () => {
    // The session it belonged to may not exist any more, and a dash there reads
    // as a reading.
    const gone = buildClaudeBookingPayload({ who: 'ก', mode: 'cancel', pct: 30 });
    const names = gone.embeds[0].fields.map((f) => f.name);
    expect(names.join('|')).not.toContain('เหลือในรอบ');
    expect(names.join('|')).toContain('โควตาที่คืนกลับมา');
  });

  it('the start-on-time reminder rides along when somebody is waiting', () => {
    const p = buildClaudeBookingPayload({ who: 'ก', mode: 'new', nextUp: 'ข 21:00' });
    const txt = JSON.stringify(p);
    expect(txt).toContain('ข 21:00');
    expect(txt).toContain('ตรงเวลา');
    // …and stays away when nobody is. A warning that fires every time is a
    // warning people stop reading.
    expect(JSON.stringify(buildClaudeBookingPayload({ who: 'ก', mode: 'new' })))
      .not.toContain('มีคนใช้ต่อ');
  });
});

// ── §D. The page says the three things, in the asked-for order ─────────────
describe('the week card names ใช้ไปแล้ว / จองไว้ / ว่าง, above the free-now hero', () => {
  it('has all three figures', () => {
    ['claudeWeekUsed', 'claudeWeekBooked', 'claudeWeekFree']
      .forEach((id) => expect(HTML).toContain(`id="${id}"`));
    expect(CODE).toContain('จองไว้');
    expect(CODE).toContain('ว่าง');
  });

  it('the shared-pool card comes BEFORE "ใช้ได้เลยตอนนี้"', () => {
    // Asked for in those terms: leading with "you may use this much without
    // booking" advertises the behaviour the board exists to reduce. This is a
    // DOM-order property, so it is invisible in every other kind of test and
    // would be undone by any restructure of the pane.
    expect(HTML.indexOf('id="claudeWeekBar"'))
      .toBeLessThan(HTML.indexOf('id="claudeNow"'));
  });

  it('a week with no measurement shows no number rather than a zero', () => {
    // A zero draws an empty bar and reads as "nothing used yet", which is
    // indistinguishable from a real reading (0156).
    expect(CODE).toMatch(/haveMeasured \? Math\.round\(usedReal\) : '—'/);
  });
});

// ── §E. The two view layers stay out of each other's way ───────────────────
describe('the measured overlay has its own lane', () => {
  it('is off by default and remembered per device', () => {
    expect(CODE).toContain("lsGet(LS_HIST) === '1'");
    expect(HTML).toContain('id="claudeHistToggle"');
    expect(HTML).toContain('aria-pressed="false"');
  });

  it('narrows the blocks instead of drawing over them', () => {
    // The capacity rail cost this feature a report by being drawn over the
    // bookings ("the rails it got overlap with the booking making it look
    // weird"). The answer there was a reserved lane; this asserts the same
    // answer here, and that it costs nothing when the overlay is off.
    expect(CSS).toMatch(/\.claude-cal-shell\.is-hist \.claude-bk[\s\S]{0,120}right:/);
    expect(CSS).toMatch(/\.claude-hist \{[\s\S]{0,200}right: 0/);
  });

  it('a gap in the samples is left blank, not bridged', () => {
    // The reporter goes down. Joining across a two-hour hole would draw a
    // reading that was never taken.
    expect(CODE).toContain('MAX_GAP_MS');
    expect(CODE).toMatch(/if \(b - a > MAX_GAP_MS\) continue/);
  });
});

// ── §F. The ข้อตกลง is seen, and can be re-seen ────────────────────────────
describe('the rules open by themselves, and again when they change', () => {
  it('opens on first visit', () => {
    expect(CODE).toMatch(/if \(!termsSeen\(\)\) openTerms\(\)/);
  });

  it('acceptance is recorded under the SAME key it is checked against', () => {
    // Recording under one key and testing another is a modal that either never
    // appears or never goes away, and both look like the feature working to
    // whoever wrote it.
    expect(CODE).toMatch(/lsGet\(LS_TERMS\) === TERMS_VERSION/);
    expect(CODE).toMatch(/lsSet\(LS_TERMS, TERMS_VERSION\)/);
  });

  it('is reachable again from the toolbar and from the help line', () => {
    expect(HTML).toContain('id="claudeTermsOpen"');
    expect(CODE).toContain('claudeTermsInline');
  });

  it('reads the weekly reset from the data instead of repeating it', () => {
    // A rule sheet that says Wednesday while claude_settings says Sunday is
    // worse than no rule sheet.
    expect(CODE).toMatch(/claudeTermsReset[\s\S]{0,160}weekEnd\(\)/);
  });
});

// ── §G. The cancel is called a cancel ──────────────────────────────────────
describe('giving a slot back is ยกเลิก, not ลบ', () => {
  it('the button says ยกเลิกการจอง', () => {
    expect(HTML).toContain('ยกเลิกการจอง');
    expect(HTML).not.toContain('ลบการจอง');
  });

  it('the confirmation says it too, and says what it frees', () => {
    // askDelete() hardcodes ลบ in both its title and its button, so using it
    // here would put the old word back through the back door.
    expect(CODE).not.toContain('askDelete');
    expect(CODE).toMatch(/title: 'ยกเลิกการจองนี้\?'/);
    // …and the CONFIRMING button must not begin with the same word as the
    // dismissing one. askConfirm's "no" is a hardcoded, shared ยกเลิก, so
    // labelling the "yes" ยกเลิกการจอง put two buttons starting with ยกเลิก
    // beside each other — one meaning "back out", one meaning "do it". That was
    // only visible in the rendered dialog.
    const yes = CODE.match(/yes: '([^']+)'/)?.[1] || '';
    expect(yes).not.toMatch(/^ยกเลิก/);
    expect(yes).toContain('คืนช่วงเวลา');
  });
});
