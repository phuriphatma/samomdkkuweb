// vs-route.js — sub-state routing INSIDE the VitalSound tab.
//
// The public site routes by PATH (`/vssound` → the VS tab; see PATH_ROUTES in
// main.js). Everything below that — which of the three modes is showing, and
// which ticket/problem is open — lived only in DOM state, so a reload threw it
// all away: you came back to กระดานปัญหา, had to switch to ติดตามสถานะ, press
// โหลดประวัติของฉัน, and find your ticket again. Reloading is the natural way
// to check for progress on a ticket, so that was the worst possible thing to
// lose.
//
// The hash carries the sub-state. It is free — nothing else in the public
// bundle reads or writes location.hash, and the path router never touches it
// (its pushState only fires when the PATHNAME differs, so arriving already on
// /vssound preserves the hash).
//
//   /vssound                  กระดานปัญหา (default, unchanged)
//   /vssound#report           แจ้งปัญหาใหม่
//   /vssound#track            ติดตามสถานะ — entry screen
//   /vssound#track/VS-XXXX    ติดตามสถานะ — that ticket open
//   /vssound#problem/VS-XXXX  กระดานปัญหา — that problem open
//
// replaceState, not pushState: the mode radios are a segmented control, and
// giving each tap a history entry makes the back button feel broken. The
// in-view back links (กลับหน้าประวัติ / กลับกระดานปัญหา) are the intended way
// to go up a level.

import { authReady, getUser as authGetUser } from './auth.js';
import {
  loginToViewHistory, openTicketDetail, trackWithTicketId, currentTrackedTicketId,
} from './vs-tracking.js';
import { currentBoardProblemId } from './vs-board.js';

// Guard against the feedback loop: every hash we write fires `hashchange`,
// which would re-apply the route we are already in the middle of applying.
let lastWritten = null;
let applying = false;

const MODE_RADIO = {
  board:  'vsModeBoard',
  report: 'vsModeReport',
  track:  'vsModeTrack',
};

/** True when the VitalSound tab is the visible one. The hash is only ours
 *  while that pane is active — another tab's deep link must not be hijacked. */
function vsTabActive() {
  return !!document.getElementById('pills-vitalsound')?.classList.contains('active');
}

/** Switch the mode radio + panes without going through the inline onchange
 *  (setting .checked programmatically does not fire `change`). */
function setMode(mode) {
  const id = MODE_RADIO[mode] || MODE_RADIO.board;
  const radio = document.getElementById(id);
  if (!radio) return;
  radio.checked = true;
  if (typeof window.toggleVitalSoundMode === 'function') window.toggleVitalSoundMode();
}

/** Write the VS sub-state into the URL. Called by the mode toggle and by the
 *  board / tracking views whenever what they are showing changes. */
export function vsSetRoute(sub) {
  if (!vsTabActive()) return;
  const want = sub ? `#${sub}` : '';
  if (location.hash === want) return;
  lastWritten = want;
  history.replaceState(null, '', location.pathname + location.search + want);
}

/** Apply the current hash. Safe to call repeatedly; no-ops when the VS tab
 *  isn't showing or when we are the ones who just wrote the hash. */
export async function applyVsRoute() {
  if (!vsTabActive() || applying) return;
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return;                       // no sub-state → leave the default
  const [head, ...rest] = raw.split('/');
  const id = rest.join('/');              // ids contain '-', never '/'

  applying = true;
  try {
    if (head === 'report') { setMode('report'); return; }

    if (head === 'problem') {
      setMode('board');
      if (id && typeof window.vsOpenBoardProblem === 'function') {
        await window.vsOpenBoardProblem(id);
      }
      return;
    }

    if (head === 'track') {
      // Mode first, SYNCHRONOUSLY, so the board doesn't flash while we wait
      // on the session below.
      setMode('track');
      if (!id) return;
      // Never decide "are they signed in" before the first getSession()
      // settles — on a cold reload authGetUser() is null for a valid session
      // (see the auth-gate flash entry in mistakes.md).
      await authReady;
      if (authGetUser()) {
        await loginToViewHistory();
        if (openTicketDetail(id)) return;   // found in their own history
      }
      // Not signed in, or not their ticket → the by-id guest lookup. The id is
      // already in their URL, which is exactly the capability that lookup asks
      // for, so this grants nothing new.
      await trackWithTicketId(id);
    }
  } finally {
    applying = false;
  }
}

/** Rebuild the hash from what is ACTUALLY on screen.
 *
 *  Needed because the path router's `shown.bs.tab` handler pushes a bare
 *  pathname on every tab activation, which drops the hash. Leaving the VS tab
 *  and coming back therefore left the URL saying "board" while the DOM was
 *  still showing ติดตามสถานะ — and a reload then obeyed the URL and threw the
 *  view away, which is the exact bug this module exists to fix. Sync the URL
 *  to the view rather than resetting the view to the URL: the user's place is
 *  the thing worth keeping. */
function syncRouteFromView() {
  if (!vsTabActive() || location.hash) return;
  if (document.getElementById(MODE_RADIO.report)?.checked) { vsSetRoute('report'); return; }
  if (document.getElementById(MODE_RADIO.track)?.checked) {
    const id = currentTrackedTicketId();
    vsSetRoute(id ? `track/${id}` : 'track');
    return;
  }
  const pid = currentBoardProblemId();
  if (pid) vsSetRoute(`problem/${pid}`);
}

export function initVsRoute() {
  if (!document.getElementById('pills-vitalsound')) return;
  // Deep link on first paint. The path router activates the tab; give it a
  // tick to mark the pane active before we read it.
  setTimeout(() => { applyVsRoute(); }, 0);
  // Manual hash edits + back/forward. Ignore the echo of our own writes.
  window.addEventListener('hashchange', () => {
    if (location.hash === lastWritten) { lastWritten = null; return; }
    applyVsRoute();
  });
  document.addEventListener('shown.bs.tab', (e) => {
    if (e.target?.getAttribute('data-bs-target') !== '#pills-vitalsound') return;
    // setTimeout so this runs AFTER the path router's own shown.bs.tab
    // listener — that one is registered later in main.js but fires in the same
    // synchronous chain, and it is what clears the hash.
    setTimeout(() => {
      if (location.hash) applyVsRoute(); else syncRouteFromView();
    }, 0);
  });
}
