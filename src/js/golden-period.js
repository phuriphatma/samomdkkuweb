// ==============================================
// GOLDEN PERIOD — the IT DRAFT of /tools/golden-period.
//
// ⚠️ docs/DEPT-TOOLS.md D8: the real page belongs to the ฝ่าย, who build it
// with Claude. This is a placeholder so the URL exists today. When their page
// arrives it replaces the body of the same route and every shared link survives.
//
// All this module does is build the calendar iframe's `src`, LAZILY:
//   • lazily, because a hidden iframe would otherwise cost every visitor a
//     request to Google on every page load, on a tab most of them never open;
//   • by width, because Google Calendar's MONTH view is unreadable at 390px —
//     AGENDA is the only one that works on a phone.
// ==============================================

const CAL_ID = 'samomdkku.sod@gmail.com';
const AGENDA_MAX_WIDTH = 767.98;

/** The embed URL for a given viewport width. Exported for the test. */
export function calendarSrc(width) {
  const mode = width <= AGENDA_MAX_WIDTH ? 'AGENDA' : 'MONTH';
  const p = new URLSearchParams({
    src: CAL_ID,
    ctz: 'Asia/Bangkok',
    mode,
    showTitle: '0',
    showPrint: '0',
    showTabs: '0',
    showCalendars: '0',
  });
  return `https://calendar.google.com/calendar/embed?${p.toString()}`;
}

let lastMode = null;

/**
 * Point the iframe at the right view. Safe to call repeatedly: it only touches
 * `src` when the MODE actually changes, so re-opening the tab does not reload
 * the calendar and lose the month the reader had scrolled to.
 */
export function mountGoldenPeriodCalendar() {
  const frame = document.getElementById('gpCalendar');
  if (!frame) return;
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const mode = width <= AGENDA_MAX_WIDTH ? 'AGENDA' : 'MONTH';
  if (mode === lastMode && frame.src) return;
  lastMode = mode;
  frame.src = calendarSrc(width);
}
