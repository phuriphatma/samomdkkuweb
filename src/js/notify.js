// ==============================================
// NOTIFY — Fire-and-forget Discord webhook trigger
//
// Implementation: plain fetch with keepalive + drained body.
//
// Why NOT navigator.sendBeacon:
//   sendBeacon does not follow HTTP redirects. Google Apps Script
//   `/exec` URLs always 302-redirect to `script.googleusercontent.com`
//   for the actual response, so sendBeacon would fire the POST, get
//   the 302, stop, and Discord would never be invoked.
//
// Why this doesn't cause the "second submit hangs" bug:
//   The original hang was caused by supabase-js's autoRefreshToken
//   running an inline refresh that stalled. That's now disabled in
//   db.js (see proactive setInterval refresh there). Without that
//   inline refresh, regular fetches don't block subsequent foreground
//   requests, and the connection draining below ensures the connection
//   pool stays healthy.
//
// Usage (never returns a Promise; never await):
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
  if (!url) { console.warn(`[notify] unknown system "${system}"`); return; }
  let action;
  try { action = actionFor(system, payload.mode); }
  catch (e) { console.warn('[notify]', e.message); return; }

  const body = JSON.stringify({ action, ...payload });
  const label = `${system}/${action}`;

  // Fire-and-forget. We do NOT await this; the caller continues
  // immediately and the request runs in parallel with the rest of the
  // submit handler. The .then(r => r.text()) drains the response body
  // so the underlying HTTP connection closes cleanly — without this,
  // the half-read connection pool entry can pile up and degrade
  // performance over time.
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
    // keepalive lets the request survive page unload (rare in our flow
    // but harmless) and uses a slightly different priority lane.
    keepalive: true,
  })
    .then((r) => r.text().catch(() => ''))
    .catch((e) => console.warn(`[notify] ${label} failed:`, e));
}
