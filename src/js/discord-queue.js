// ==============================================
// DISCORD QUEUE — one rate-limit-aware notification core for the app
//
// Every Discord webhook fan-out in this app (PR form, Vital Sign,
// หนังสือโครงการ) goes through GAS, and GAS shares its egress IP across
// all our requests. The rate limit that actually bites is therefore
// Cloudflare's per-IP filter (HTTP 429, body "error code: 1015",
// cooldown measured in MINUTES) — NOT Discord's own per-webhook bucket
// (~5 tokens / 2s). See `.claude/rules/mistakes.md`.
//
// Because the binding limit is per-IP, the only effective client-side
// defence is to serialise EVERY Discord-bound POST — regardless of which
// webhook (PR / VS / projects) it targets — through ONE global chain with
// a minimum spacing between calls. Two rapid user actions (or actions in
// two different systems) can no longer fire parallel POSTs that trip 1015.
//
// This module is the single home for that queue + the logged GAS caller.
// Domain modules (projects/notify.js, notify.js) build their own payloads
// and hand them here; they must NOT keep private copies of the queue.
//
// Usage:
//   import { sendDiscord, callGAS, queueDiscord } from './discord-queue.js';
//   sendDiscord(GAS_API_URL, 'notifyProjectDiscord', { title, fields });
// ==============================================

// 6 seconds: wide enough to clear Cloudflare's 1015 cooldown window, not
// just Discord's ~2s bucket. Field-observed: 2.2s spacing cleared the
// Discord bucket but the FIRST action's retries still hit 1015; 6s makes
// the next call far less likely to even SEE the 1015 page.
let minSpacingMs = 6000;

let discordChain = Promise.resolve();
let lastDiscordEndedAt = 0;

/**
 * Serialise `fn` onto the global Discord chain, enforcing a minimum gap
 * between the end of the previous call and the start of this one. The
 * first call fires immediately; later calls wait their turn.
 *
 * Returns the promise for THIS call (so the caller can await / observe
 * its result), while the internal chain is re-anchored on a swallowed
 * variant so one failure can't poison every subsequent call.
 */
export function queueDiscord(fn) {
  const next = discordChain.then(async () => {
    const wait = Math.max(0, minSpacingMs - (Date.now() - lastDiscordEndedAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastDiscordEndedAt = Date.now();
    }
  });
  discordChain = next.catch(() => {});
  return next;
}

/**
 * POST a GAS action and return the parsed JSON (or null on failure).
 * Bounded by `timeoutMs` so a wedged webhook can't hang the chain.
 *
 * Logging policy: every failure mode (timeout, network, non-2xx,
 * action-level success:false) logs exactly one warning so silent drops
 * stay debuggable — GAS Cloud Logs are NOT recorded for our public
 * browser-fetch calls, so the response body echoed here is the only
 * runtime window into what Discord actually returned.
 */
export async function callGAS(url, action, payload = {}, { timeoutMs = 20000, label } = {}) {
  const tag = label || action;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      // keepalive lets a fire-and-forget call survive a navigation; the
      // awaited path doesn't need it but it's harmless and keeps one
      // helper for both callers.
      keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text().catch(() => '');
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!res.ok) {
      console.warn(`[discord] ${tag} HTTP ${res.status}:`, (text || '').slice(0, 300));
      return null;
    }
    if (parsed && parsed.success === false) {
      console.warn(`[discord] ${tag} returned success:false`, parsed);
      return parsed;
    }
    if (parsed && (parsed.retried || (parsed.attempts && parsed.attempts > 1))) {
      console.info(`[discord] ${tag} took ${parsed.attempts || '?'} attempt(s)`, parsed);
    }
    return parsed;
  } catch (e) {
    clearTimeout(timer);
    const aborted = e?.name === 'AbortError';
    console.warn(`[discord] ${tag} ${aborted ? 'timed out' : 'failed'}:`, e?.message || e);
    return null;
  }
}

/**
 * Convenience: queue a logged GAS call. Returns the promise for the call
 * (await it if you need the result; ignore it for fire-and-forget — it's
 * already logged internally, so a bare `.catch(() => {})` is enough to
 * silence the unhandled-rejection if you don't await).
 */
export function sendDiscord(url, action, payload = {}, opts = {}) {
  return queueDiscord(() => callGAS(url, action, payload, opts));
}

// ---- test seams (not used in production code) ----
/** Override the inter-call spacing. Tests set this small/zero for speed. */
export function setDiscordSpacing(ms) { minSpacingMs = ms; }
/** Current spacing — lets tests restore the production default. */
export function getDiscordSpacing() { return minSpacingMs; }
/** Reset the queue state between tests. */
export function __resetDiscordQueue() {
  discordChain = Promise.resolve();
  lastDiscordEndedAt = 0;
}
