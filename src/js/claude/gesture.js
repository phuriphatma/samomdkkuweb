// gesture.js — what a press on the calendar MEANS, per input device. Pure: no
// DOM, no timers, no module state, so the decisions can be tested directly.
//
// WHY THIS EXISTS
// The calendar was drag-to-select on `pointerdown`, which is right for a mouse
// and wrong for a finger. On an iPad every scroll of the week starts with a
// pointerdown on a day column, so the two gestures were the same gesture and
// the board could not tell "I am reading Thursday" from "I am booking Thursday
// 09:00". Two separate things went wrong, and they LOOK unrelated:
//
//   • a tap opened the booking modal. paintSel() floors a selection at one slot,
//     so even a zero-distance press produced a bookable 15 minutes;
//   • the browser took the gesture over to scroll, fired `pointercancel`, and
//     nothing was listening — so the drag stayed armed. The next `pointerup`
//     ANYWHERE, including on the week arrows at the top of the pane, ran the
//     drag-end handler and opened the modal. That is the "I tapped the arrow
//     and it showed my profile" report: the profile was the booking modal's
//     identity card.
//
// THE FIX, in one sentence: a finger must HOLD before it is booking. Holding
// still is the one thing a scroll gesture never does, so the hold is what
// separates them — and the hold cannot be mistaken for anything else, which is
// why no movement threshold on its own would have worked.
//
// The mouse path is untouched. A pointing device that can press without
// scrolling has no ambiguity to resolve, and making everyone wait 400ms for a
// gesture only touch needs is a tax paid by the wrong people.

/** How long a finger must stay put before the press becomes a selection. */
export const HOLD_MS = 400;

/** How far it may drift while waiting, in CSS pixels. Generous on purpose:
 *  a finger resting on glass wanders a few pixels without its owner moving it,
 *  and a threshold tight enough to be "still" is one nobody can hit. */
export const SLOP_PX = 12;

/** The block a hold creates before any dragging, in minutes. A hold with no
 *  drag is a complete gesture — press, let go, fill in the form — so it has to
 *  produce something worth booking rather than the 15-minute sliver a stray tap
 *  used to make. */
export const HOLD_MIN = 60;

/**
 * What does this pointerdown mean?
 *
 *   'drag'   — begin selecting immediately (mouse, or anything with a button)
 *   'hold'   — a finger: arm the timer, decide later
 *   'ignore' — a secondary button, or a gesture with more than one finger.
 *              Two fingers on a scroll container is a pan, never a selection.
 */
export function pressIntent({ pointerType, button = 0, isPrimary = true } = {}) {
  if (button !== 0 || !isPrimary) return 'ignore';
  // `pen` sits with touch: an Apple Pencil scrolls the page exactly as a finger
  // does, so it has the same ambiguity and needs the same hold.
  if (pointerType === 'touch' || pointerType === 'pen') return 'hold';
  return 'drag';
}

/** Has the finger drifted far enough that this was a scroll after all? */
export function movedTooFar(dx, dy, slop = SLOP_PX) {
  return Math.hypot(dx, dy) > slop;
}

/**
 * Should the pane suppress the browser's own scrolling for this move?
 *
 * Only while a TOUCH-initiated selection is actually live. Calling
 * preventDefault() any earlier would make the calendar unscrollable with a
 * finger, which is the `touch-action: none` mistake wearing a different hat:
 * the grid is 24 hours tall and eight days wide, so scrolling it is most of
 * what anyone does here.
 *
 * The ordering is what makes this work at all. The hold only fires while the
 * finger is STILL, so at the moment it fires the browser has not begun a
 * scroll — and a scroll that has not begun can still be refused. Once one is
 * under way, preventDefault is ignored and nothing can call it back.
 */
export function shouldBlockScroll(drag) {
  return !!drag && drag.viaTouch === true;
}
