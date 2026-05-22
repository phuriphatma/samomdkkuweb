// ==============================================
// NOTIFY — Deferred fire-and-forget Discord webhook trigger
//
// Strategy:
//   1. Defer to requestIdleCallback / setTimeout so the call doesn't
//      land in the same task as the form's success-path code.
//   2. Use navigator.sendBeacon when possible (separate connection
//      pool, no Promise machinery to leak).
//   3. Fall back to keepalive fetch.
//
// Why the defer matters:
//   Even with sendBeacon, when the Discord webhook is slow (especially
//   with @here mentions that hit Discord rate-limits), keeping the
//   request in-flight in the same tick as form-reset/state-update
//   somehow correlates with the next user submit hanging. Deferring
//   via requestIdleCallback ensures the notify only fires once the
//   browser has settled foreground work — eliminating the interference.
//
// Usage (fire-and-forget; never returns a Promise):
//   sendNotify('pr', { ticketId, ... });
//   sendNotify('vs', { mode: 'submit', ticketId, ... });
//   sendNotify('vs', { mode: 'consult', ticketId, ... });
// ==============================================

import { GAS_API_URL, GAS_VITAL_SOUND_URL } from './config.js';

const SYSTEM_ENDPOINT = {
  pr: GAS_API_URL,
  vs: GAS_VITAL_SOUND_URL,
};

function actionFor(system, mode) {
  if (system === 'pr') return 'notifyPROnly';
  if (system === 'vs' && mode === 'consult') return 'notifyVSConsult';
  if (system === 'vs') return 'notifyVSOnly';
  throw new Error(`notify: unknown system "${system}" mode "${mode}"`);
}

function defer(fn) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout: 5000 });
  } else {
    setTimeout(fn, 1500);
  }
}

function fireRequest(url, body, label) {
  // Primary: sendBeacon — separate connection pool, browser-managed.
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
      const queued = navigator.sendBeacon(url, blob);
      if (queued) return;
      console.warn(`[notify] sendBeacon refused for ${label}; falling back to fetch`);
    } catch (e) {
      console.warn(`[notify] sendBeacon threw for ${label}:`, e);
    }
  }
  // Fallback: keepalive fetch with response drained.
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
    keepalive: true,
  })
    .then((r) => r.text().catch(() => ''))
    .catch((e) => console.warn(`[notify] ${label} failed:`, e));
}

export function sendNotify(system, payload = {}) {
  const url = SYSTEM_ENDPOINT[system];
  if (!url) { console.warn(`[notify] unknown system "${system}"`); return; }
  let action;
  try { action = actionFor(system, payload.mode); }
  catch (e) { console.warn('[notify]', e.message); return; }
  const body = JSON.stringify({ action, ...payload });
  const label = `${system}/${action}`;

  // Defer to when the browser is idle. This isolates the notify request
  // from any work happening in the same tick as the form's
  // success-path (state cleanup, UI updates, supabase-js post-insert
  // bookkeeping, etc.).
  defer(() => fireRequest(url, body, label));
}
