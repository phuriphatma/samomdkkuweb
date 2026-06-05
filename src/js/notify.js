// ==============================================
// NOTIFY — Fire-and-forget Discord webhook trigger for PR + Vital Sign
//
// As of the notify unification, PR and VS share the SAME rate-limit-aware
// core as หนังสือโครงการ: every Discord-bound POST is serialised through
// the one global queue in `discord-queue.js` with minimum spacing, so two
// rapid submits (or a PR submit landing while a projects action is in
// flight) can never fire parallel POSTs that trip Cloudflare's per-IP
// 1015 limit. callGAS inside that core also logs every failure mode.
//
// Why GAS (not navigator.sendBeacon): sendBeacon does not follow HTTP
// redirects, and GAS `/exec` URLs always 302 to script.googleusercontent
// .com — sendBeacon would fire the POST, get the 302, and Discord would
// never be invoked. The shared callGAS uses fetch + keepalive instead.
//
// Usage (fire-and-forget — never await):
//   sendNotify('pr', { ticketId, ... });
//   sendNotify('vs', { mode: 'submit', ticketId, ... });
//   sendNotify('vs', { mode: 'consult', ticketId, ... });
// ==============================================

import { GAS_API_URL, GAS_VITAL_SOUND_URL } from './config.js';
import { sendDiscord } from './discord-queue.js';

const SYSTEM_ENDPOINT = {
  pr: GAS_API_URL,
  vs: GAS_VITAL_SOUND_URL,
};

export function actionFor(system, mode) {
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

  // Fire-and-forget through the shared, serialised, logged queue. We do
  // NOT await — the submit handler continues immediately and the request
  // runs out of band. The queue enforces inter-call spacing for the
  // rate-limit guarantee; callGAS logs every failure, so the bare
  // `.catch` here only silences the unhandled rejection.
  sendDiscord(url, action, payload, { label: `${system}/${action}` }).catch(() => {});
}
