// ==============================================
// NOTIFY — Unified Discord webhook abstraction
//
// Single API for both PR and VS Discord notifications. Currently
// routes to the GAS endpoints (`notifyPROnly` / `notifyVSOnly` /
// `notifyVSConsult`). When Supabase Edge Functions are fixed, this
// file is the only thing that needs to change — call sites stay the
// same.
//
// Usage (always fire-and-forget; callers must not await on UX path):
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

/**
 * Send a Discord notification. Fire-and-forget.
 *
 * Implementation notes (this matters — earlier versions caused the form
 * to hang on a second submit):
 *
 *  - We DON'T use `await fetch(...)` here. The caller would then hold
 *    a pending promise referencing an unread Response body, which
 *    keeps the browser's HTTP connection in a half-closed state.
 *    Subsequent requests (especially supabase-js's background token
 *    refresh) can deadlock on connection-pool backpressure.
 *  - We chain `.then(r => r.text())` to actually drain the response
 *    body, freeing the connection.
 *  - `keepalive: true` puts the request on a separate connection pool
 *    that doesn't compete with foreground fetches.
 */
export function sendNotify(system, payload = {}) {
  const url = SYSTEM_ENDPOINT[system];
  if (!url) return Promise.reject(new Error(`notify: unknown system "${system}"`));

  let action;
  try { action = actionFor(system, payload.mode); }
  catch (e) { return Promise.reject(e); }

  const body = { action, ...payload };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    keepalive: true,
  })
    .then((r) => r.text().catch(() => ''))
    .catch((e) => {
      console.warn(`[notify] ${system}/${action} failed:`, e);
    });
}
