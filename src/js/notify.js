// ==============================================
// NOTIFY — Fire-and-forget Discord webhook trigger
//
// Uses navigator.sendBeacon — the right tool for fire-and-forget POST:
//   - Browser-managed background request
//   - Separate connection pool from foreground fetches
//   - No Promise to leak / no body to drain
//   - Returns synchronously (boolean: queued)
//
// Fallback: keepalive fetch with body drained.
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

  // Primary: sendBeacon — separate connection pool, no Promise.
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
