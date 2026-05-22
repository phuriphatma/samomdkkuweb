// ==============================================
// NOTIFY — Unified Discord webhook abstraction
//
// Single API for both PR and VS Discord notifications. Currently
// routes to the GAS endpoints (`notifyPROnly` / `notifyVSOnly` /
// `notifyVSConsult`). When Supabase Edge Functions are debugged, this
// file is the only thing that needs to change — call sites stay the same.
//
// Usage:
//   import { sendNotify } from './notify.js';
//
//   sendNotify('pr', { ... }).catch(() => {});  // PR new ticket
//
//   sendNotify('vs', { mode: 'submit', ... });  // VS new ticket
//   sendNotify('vs', { mode: 'consult', ... }); // VS staff consult
//
// The helper is fire-and-forget by default — callers may .catch() to
// log a warning but should never await it on the user's critical path.
// ==============================================

import { GAS_API_URL, GAS_VITAL_SOUND_URL } from './config.js';

const SYSTEM_ENDPOINT = {
  pr: GAS_API_URL,
  vs: GAS_VITAL_SOUND_URL,
};

// Maps the (system, mode) tuple to the GAS action name. The GAS files
// (appscript/prform.gs + appscript/vssound.gs) define matching actions.
function actionFor(system, mode) {
  if (system === 'pr') return 'notifyPROnly';
  if (system === 'vs' && mode === 'consult') return 'notifyVSConsult';
  if (system === 'vs') return 'notifyVSOnly';
  throw new Error(`notify: unknown system "${system}" mode "${mode}"`);
}

/**
 * Send a Discord notification.
 *
 * @param {'pr'|'vs'} system  Which subsystem the notification is for.
 * @param {object}     payload Fields the backend webhook formatter expects.
 *                              For VS, include `mode: 'submit'|'consult'`.
 * @returns {Promise<Response>} Resolves with the fetch Response. Reject on network failure.
 */
export async function sendNotify(system, payload = {}) {
  const url = SYSTEM_ENDPOINT[system];
  if (!url) throw new Error(`notify: unknown system "${system}"`);

  const action = actionFor(system, payload.mode);
  const body = { action, ...payload };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
    return res;
  } catch (e) {
    console.warn(`[notify] ${system}/${action} failed:`, e);
    throw e;
  }
}
