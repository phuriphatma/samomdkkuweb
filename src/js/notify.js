// ==============================================
// NOTIFY — Fire-and-forget Discord webhook trigger
//
// Strategy: navigator.sendBeacon (primary) → fetch (fallback)
//
// sendBeacon is the right tool here:
//   - Designed for fire-and-forget POSTs (analytics / notifications)
//   - Runs on a separate browser-managed connection — does NOT compete
//     with foreground fetches in the regular HTTP connection pool
//   - Survives page unload (matters if user navigates away mid-submit)
//   - Returns synchronously (boolean: queued or not)
//
// Why we explicitly need this:
//   The legacy `await fetch(...)` pattern leaves connections in a
//   half-closed state when the caller doesn't read the response body.
//   Combined with supabase-js's background token refresh, this caused
//   the second form submit to hang for 30s as a deadlock on
//   connection-pool backpressure. sendBeacon side-steps that pool
//   entirely.
//
// Usage (always fire-and-forget; never await):
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

export function sendNotify(system, payload = {}) {
  const url = SYSTEM_ENDPOINT[system];
  if (!url) {
    console.warn(`[notify] unknown system "${system}"`);
    return;
  }
  let action;
  try { action = actionFor(system, payload.mode); }
  catch (e) { console.warn('[notify]', e.message); return; }

  const body = JSON.stringify({ action, ...payload });

  // Primary path: navigator.sendBeacon. Separate connection pool,
  // truly fire-and-forget, no main-thread blocking.
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
      const queued = navigator.sendBeacon(url, blob);
      if (queued) return;
      // If queued is false (body too large / browser refused), fall through
      // to the fetch fallback below.
      console.warn(`[notify] sendBeacon refused for ${system}/${action}; falling back to fetch`);
    } catch (e) {
      console.warn(`[notify] sendBeacon threw for ${system}/${action}:`, e);
    }
  }

  // Fallback: keepalive fetch. Still on a separate connection pool, but
  // less ideal than sendBeacon. Body is drained to free the connection.
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
    keepalive: true,
  })
    .then((r) => r.text().catch(() => ''))
    .catch((e) => {
      console.warn(`[notify] ${system}/${action} failed:`, e);
    });
}
