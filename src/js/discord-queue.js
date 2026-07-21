// ==============================================
// DISCORD QUEUE — one rate-limit-aware notification core for the app
//
// Every Discord webhook fan-out in this app (PR form, Vital Sign,
// หนังสือโครงการ) now POSTs to the `/notify` Cloudflare Pages Function
// (functions/notify.js), NOT GAS. That move changed the threat model:
//
//   - The Cloudflare-1015 per-IP block (body "error code: 1015", cooldown
//     in MINUTES) was a GAS-shared-egress problem. Running on Cloudflare's
//     own egress, our volume effectively never sees it. It is no longer
//     the binding limit for this path.
//   - The limit that remains is Discord's own per-webhook bucket
//     (~5 tokens / 2s). The Function already handles that server-side:
//     it retries 429 up to 3× honouring Retry-After. So a burst that
//     briefly exceeds the bucket recovers WITHOUT client help.
//
// The client queue therefore no longer needs the old 1015-era 6s spacing.
// Its remaining job is small: serialise this tab's POSTs so two rapid
// actions don't fire perfectly parallel and waste the Function's retry
// budget. A short spacing (800ms) is enough. Two guards keep a call from
// dying in that park window (a parked call hasn't been fetched yet, so
// `keepalive` can't rescue it if mobile Safari freezes the tab):
//   1. the spacing is short (800ms, was 6s), and
//   2. `flushDiscordQueue()` drains the park the instant the page hits
//      `pagehide`/`visibilitychange=hidden`, so the fetch fires (and its
//      keepalive takes over) before teardown. See mistakes.md.
//
// This module is the single home for that queue + the logged caller.
// Domain modules (projects/notify.js, notify.js) build their own payloads
// and hand them here; they must NOT keep private copies of the queue.
//
// Usage:
//   import { sendDiscord, callGAS, queueDiscord } from './discord-queue.js';
//   sendDiscord(NOTIFY_FN_URL, 'notifyProjectDiscord', { title, fields });
// ==============================================

// 800ms: enough to break up perfectly-parallel POSTs from one tab (keeps
// us well under Discord's 5/2s bucket at ~2.5 msg/2s worst case) while
// keeping the in-queue park window short so a backgrounded/closed tab is
// far less likely to lose a not-yet-fetched notify. The Function's 429
// retry is the real rate-limit backstop; this is just parallel-guard.
// (Was 6s in the GAS/1015 era — see the header note above.)
let minSpacingMs = 800;

let discordChain = Promise.resolve();
let lastDiscordEndedAt = 0;

// Last-mile drop guard. The spacing park (above) is the one window where a
// fire-and-forget notify hasn't been fetched yet, so `keepalive` can't
// rescue it if the tab is closing/freezing (mobile Safari). When the page
// is about to be hidden/unloaded we DRAIN: skip all remaining spacing so
// every queued call fires immediately — its `keepalive:true` fetch then
// survives the teardown. `draining` resets when the page is shown again so
// normal spacing resumes for a mere tab-switch. See mistakes.md.
let draining = false;
let pendingSpacingResolve = null;

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
    const wait = draining ? 0 : Math.max(0, minSpacingMs - (Date.now() - lastDiscordEndedAt));
    if (wait > 0) {
      await new Promise((resolve) => {
        pendingSpacingResolve = resolve;
        setTimeout(() => {
          if (pendingSpacingResolve === resolve) pendingSpacingResolve = null;
          resolve();
        }, wait);
      });
    }
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
 * Fire everything currently parked in the inter-call spacing RIGHT NOW and
 * keep spacing at zero until the page is shown again. Called on
 * `pagehide` / `visibilitychange=hidden` so a not-yet-fetched notify
 * leaves the tab before it freezes. Idempotent and safe to call anytime.
 */
export function flushDiscordQueue() {
  draining = true;
  if (pendingSpacingResolve) {
    const resolve = pendingSpacingResolve;
    pendingSpacingResolve = null;
    resolve();
  }
}

// Wire the page-lifecycle drain (browser only; no-op under Node/Vitest).
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushDiscordQueue);
  window.addEventListener('pageshow', () => { draining = false; });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDiscordQueue();
    else draining = false;
  });
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
  draining = false;
  pendingSpacingResolve = null;
}
