// The four things the owner found on an iPad, each held down by an assertion.
//
// Three of the four are INVISIBLE to a build, to a type checker and to every
// other test in this repo, because each one is a listener that is not there or
// an option that silently does nothing:
//
//   1. A tap on the grid opened the booking modal. Scrolling a calendar starts
//      with a press on a day column, so press-to-select made "read Thursday"
//      and "book Thursday" the same gesture.
//   2. Worse and stranger: tapping the WEEK ARROW opened the modal too. A
//      scroll fires `pointercancel`, nothing listened for it, so the drag
//      stayed armed and the next `pointerup` anywhere ran the drag-end handler.
//      That is the "it shows my profile" report — the profile was the booking
//      modal's identity card.
//   3. That identity card named the raw account and "ยังไม่มีตำแหน่งในผังทีม"
//      whenever you browsed to a week you had not booked in, because it
//      resolved who you are by hunting for a booking of yours ON SCREEN.
//   4. A block could be drawn across a session edge, and only the database
//      said no — after ยืนยัน.
//
// §A is the pure gesture logic. §B is the wiring, which is where all three
// silent failures actually live: a listener you forgot, a `{ passive: false }`
// you left off (preventDefault then does NOTHING, with no error), and a
// `touch-action: none` that would make the grid unscrollable — this repo has
// paid for that one already, on a drag handle in ระบบบ้าน.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../strip-comments.js';
import {
  pressIntent, movedTooFar, shouldBlockScroll, HOLD_MS, SLOP_PX, HOLD_MIN,
} from './gesture.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const INDEX = stripComments(read('./index.js'));

/**
 * The body of one top-level function, by brace matching.
 *
 * Because `/function foo\(\)[\s\S]*?thing/` does NOT say "foo calls thing" — it
 * says "thing appears somewhere after foo starts", and the lazy match will walk
 * happily into the next function to find it. That is not a hypothetical: the
 * first version of the clamp test below passed with the clamp deleted, because
 * save() calls limitsFor() twenty lines further down. A guard's instrument
 * needs a guard, so this one throws rather than returning '' when the function
 * is renamed — silence is how a test stops testing.
 */
function bodyOf(name) {
  const at = INDEX.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`bodyOf: no function ${name}() in claude/index.js`);
  const open = INDEX.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}' && --depth === 0) return INDEX.slice(open, i + 1);
  }
  throw new Error(`bodyOf: unbalanced braces reading ${name}()`);
}
const CSS = stripComments(read('../../css/claude.css'));
const MIG = read('../../../supabase/migrations/0155_claude_measured_usage_log.sql');

// ── §A. What a press means ─────────────────────────────────────────────────
describe('a finger and a mouse do not mean the same thing', () => {
  it('a mouse press selects immediately — no hold tax on a device with no ambiguity', () => {
    expect(pressIntent({ pointerType: 'mouse' })).toBe('drag');
  });

  it('a finger must hold first', () => {
    expect(pressIntent({ pointerType: 'touch' })).toBe('hold');
  });

  it('a stylus counts as a finger — an Apple Pencil scrolls the page too', () => {
    expect(pressIntent({ pointerType: 'pen' })).toBe('hold');
  });

  it('a right-click or a second finger selects nothing', () => {
    expect(pressIntent({ pointerType: 'mouse', button: 2 })).toBe('ignore');
    expect(pressIntent({ pointerType: 'touch', isPrimary: false })).toBe('ignore');
  });

  it('the hold is abandoned by real movement, not by a resting finger', () => {
    // A finger on glass wanders a few pixels without its owner moving it. A
    // threshold tight enough to be "still" is one nobody can hit, so this pair
    // is the actual specification of the gesture — both sides of it.
    expect(movedTooFar(3, 4)).toBe(false);
    expect(movedTooFar(0, SLOP_PX + 1)).toBe(true);
  });

  it('the hold is long enough to be deliberate and short enough to discover', () => {
    expect(HOLD_MS).toBeGreaterThanOrEqual(300);
    expect(HOLD_MS).toBeLessThanOrEqual(600);
  });

  it('a hold with no drag produces a bookable block, not a sliver', () => {
    // The old tap made 15 minutes, which is what made an accidental modal look
    // like a real booking someone had started.
    expect(HOLD_MIN).toBeGreaterThanOrEqual(30);
  });

  it('scrolling is only ever suppressed for a live TOUCH selection', () => {
    expect(shouldBlockScroll(null)).toBe(false);
    expect(shouldBlockScroll({ viaTouch: false })).toBe(false);
    expect(shouldBlockScroll({ viaTouch: true })).toBe(true);
  });
});

// ── §B. The wiring, where the silent failures live ─────────────────────────
describe('the listeners that make the gesture work at all', () => {
  it('listens for pointercancel — the stale drag that opened the modal from the week arrow', () => {
    expect(INDEX).toContain("addEventListener('pointercancel'");
  });

  it('clears the drag when the browser takes the gesture over', () => {
    expect(INDEX).toMatch(/function onDragCancel\(\)[\s\S]*?drag = null/);
  });

  it('registers touchmove with passive:false', () => {
    // A passive listener's preventDefault() is a no-op with no error, so this
    // reads as working code that does nothing at all — the exact shape of an
    // instrument that cannot see its own failure.
    expect(INDEX).toMatch(/addEventListener\('touchmove',[^)]*\{\s*passive:\s*false\s*\}/);
  });

  it('never disables touch scrolling in the stylesheet', () => {
    // `touch-action: none` on a drag surface makes the page unscrollable THERE
    // — already an entry in docs/mistakes/frontend-ui.md. The grid is 24 hours
    // tall and eight days wide; scrolling it is most of what anyone does here.
    expect(CSS).not.toMatch(/touch-action:\s*none/);
  });

  it('a press that never became a hold books nothing', () => {
    expect(INDEX).toMatch(/function onDragEnd\(\)\s*\{\s*clearPending\(\)/);
  });

  it("refuses iOS's own long press — text selection and the callout menu", () => {
    // Safari fires selection handles and the copy/look-up callout on the SAME
    // gesture this feature claims, so a hold produced a booking and a system
    // selection at once. Reported as "it trigger the selection of the apple
    // system, the select text".
    //
    // Asserted on the calendar grid specifically: blanket user-select:none on
    // the pane would also kill selecting the text in the measured log, which is
    // the one place here someone might want to copy a number out of.
    // EVERY .claude-cal-grid rule, not the first one. There are two — the
    // original geometry block and this one — and `String.match` without /g
    // returns the earlier, which has none of these properties. The first
    // version of this test failed on correct code for that reason, which is
    // the same class as the clamp test above: the instrument was reading
    // something other than its subject.
    const grid = (CSS.match(/\.claude-cal-grid\s*\{[^}]*\}/g) || []).join('\n');
    expect(grid, 'the grid must exist as a rule').not.toBe('');
    expect(grid).toMatch(/-webkit-touch-callout:\s*none/);
    expect(grid).toMatch(/(^|[^-])user-select:\s*none/m);
  });

  it('the hold indicator marks the PRESS, not the whole day', () => {
    // The first version tinted the entire column, which reads as "this day is
    // selected". The owner reported it as exactly that.
    expect(CSS).not.toContain('.claude-daycol.is-holding');
    expect(INDEX).toContain('claude-hold');
  });

  it('the indicator lasts exactly as long as the timer it depicts', () => {
    // The duration is handed to CSS from HOLD_MS. A stylesheet that repeats the
    // number drifts from the timer, and then the bar finishes early or late —
    // which teaches the wrong hold length to everyone who watches it.
    expect(INDEX).toMatch(/--claude-hold-ms['"`],\s*`\$\{HOLD_MS\}ms`/);
    expect(CSS).toMatch(/animation:\s*claude-hold-fill\s+var\(--claude-hold-ms/);
  });
});

// ── §C. Identity is not a property of which week is open ───────────────────
describe('the booking modal names the same person in every week', () => {
  it('the id card reads board.me', () => {
    expect(INDEX).toMatch(/const me = board\.me\?\.name \? board\.me : null/);
  });

  it('it no longer infers the reader from a booking on screen', () => {
    // The precise expression that was wrong. If it comes back, so does a card
    // that is correct only in weeks you have already booked in.
    expect(INDEX).not.toMatch(/board\.bookings\.find\(\s*\(b\)\s*=>\s*b\.is_mine\s*\)/);
  });

  it('the server resolves it through the SAME projection as everyone else', () => {
    // One projection, so a booking's person and the reader's own name can never
    // be built by two different pieces of SQL that drift.
    expect(MIG).toContain("'person',    public.claude_person(b.user_id)");
    expect(MIG).toContain("'me',       public.claude_person(v_uid)");
  });
});

// ── §D. A block may not be DRAWN across a boundary the database refuses ────
describe('the session edge is a wall in the UI, not only in the trigger', () => {
  it('both entry points clamp through the same limitsFor()', () => {
    // A guard on one entry point is not a guard (class 4). The drag and the
    // time selects are two ways to the same booking, and before this only the
    // database had an opinion about either.
    //
    // Read from the function's OWN body, by brace matching. The obvious
    // `/function recalc\(\)[\s\S]*?limitsFor\(/` passes with the clamp deleted:
    // the lazy match simply runs on past the end of recalc until it finds the
    // call in save(). Falsified — it reported green with the bug reintroduced,
    // which is the whole reason this reads the body instead.
    expect(bodyOf('paintSel'), 'paintSel must clamp').toContain('limitsFor(');
    expect(bodyOf('recalc'), 'recalc must clamp').toContain('limitsFor(');
  });

  it('the clamped tail is offered as a second booking, never auto-created', () => {
    // Splitting one press into two rows would have to invent how the percentage
    // divides between two different pools, and could half-fail. The tail is an
    // offer with the times filled in.
    expect(INDEX).toContain('continuation');
    expect(INDEX).toMatch(/if \(next\)[\s\S]*?openModal\(\{ start: next\.start/);
  });

  it('the informational clamp note does not disable ยืนยัน', () => {
    // It would refuse the very booking the clamp just made legal.
    expect(INDEX).toMatch(/claudeSave'\)\.disabled = notes\.some\(/);
  });
});

// ── §E. The new SQL keeps 0154's privilege posture ─────────────────────────
describe('0155 publishes nothing that 0154 kept internal', () => {
  it.each([
    'public.claude_person(uuid)',
    'public.claude_free_now(timestamptz)',
    'public.claude_free_windows(timestamptz)',
    'public.claude_usage_deltas(timestamptz, timestamptz)',
    'public.claude_usage_attribution(timestamptz, timestamptz)',
  ])('%s is revoked from authenticated', (sig) => {
    // Each is SECURITY DEFINER over claude_bookings / claude_usage_samples /
    // team_members, so a grant would hand the whole board — and a staff
    // directory keyed by user id — to any signed-in account with no `claude`
    // grant anywhere in the path. Proved live by claude0155-free-now.sql §D;
    // pinned here so it cannot be dropped from the migration in silence.
    expect(MIG).toContain(`revoke all on function ${sig} from authenticated`);
  });

  it('the log RPC applies the same gate as the board', () => {
    expect(MIG).toMatch(
      /get_claude_usage_log[\s\S]*?current_user_has_permission\('claude'\)/,
    );
  });
});
