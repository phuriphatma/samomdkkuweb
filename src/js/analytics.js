// ==============================================
// analytics.js — cookieless, anonymous usage tracking.
//
// Sends one lightweight event per page load and per tab/section switch
// to public.analytics_events (migration 0065). Powers the "how often /
// return visits / top tabs" metrics that the raw engagement tables
// can't show. See the admin สถิติ dashboard + the public stat strip.
//
// Privacy / design notes:
//   * session_id is a random id kept in sessionStorage — it dies when the
//     tab closes, so it's NOT a persistent cross-site cookie and carries
//     no PII. It only lets us count "unique browser sessions" within a day.
//   * user_id is attached only when the visitor is signed in (their own
//     uuid), so the dashboard can split anonymous vs authenticated use.
//   * Fire-and-forget: every write is best-effort and fully swallowed —
//     a tracking failure must NEVER surface to the user or block the app.
//   * Uses dbRest (raw PostgREST + anon-key fallback) so it works for
//     signed-out visitors exactly like signed-in ones.
// ==============================================

import { dbRest } from './db.js';

const SID_KEY = 'samo.sid';
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL || '';
const PROJECT_REF = (SUPA_URL.match(/\/\/([^.]+)\./) || [])[1] || '';
const SESSION_TOKEN_KEY = PROJECT_REF ? `sb-${PROJECT_REF}-auth-token` : null;

let APP = 'public';          // 'public' | 'admin' — set in initAnalytics()
let lastEventKey = '';       // dedupe rapid duplicate hits
let lastEventAt = 0;

/** Stable-per-tab random session id (ephemeral — sessionStorage). */
function sessionId() {
  try {
    let id = sessionStorage.getItem(SID_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() || `s_${Date.now()}_${Math.random().toString(36).slice(2)}`).slice(0, 64);
      sessionStorage.setItem(SID_KEY, id);
    }
    return id;
  } catch {
    return 's_nostorage';
  }
}

/** Read the signed-in user's uuid from the persisted Supabase session,
 *  without importing auth.js (keeps this module dependency-light and
 *  safe to load on the public site before auth initialises). */
function authInfo() {
  if (!SESSION_TOKEN_KEY) return { isAuthed: false, userId: null };
  try {
    const raw = localStorage.getItem(SESSION_TOKEN_KEY);
    if (!raw) return { isAuthed: false, userId: null };
    const s = JSON.parse(raw);
    const userId = s?.user?.id || s?.currentSession?.user?.id || null;
    return { isAuthed: !!(s?.access_token || s?.currentSession?.access_token), userId };
  } catch {
    return { isAuthed: false, userId: null };
  }
}

/** Post one event. Fully best-effort — never throws, never awaited. */
function send(event, path) {
  const now = Date.now();
  const key = `${event}:${path}`;
  // Swallow a repeat of the exact same event fired within 1.5s (double
  // fire from overlapping tab/route handlers).
  if (key === lastEventKey && now - lastEventAt < 1500) return;
  lastEventKey = key;
  lastEventAt = now;

  const { isAuthed, userId } = authInfo();
  const row = {
    event: String(event || 'pageview').slice(0, 32),
    path: (path || '').slice(0, 200) || null,
    is_authed: isAuthed,
    user_id: userId,
    referrer: (event === 'pageview' ? (document.referrer || '') : '').slice(0, 300) || null,
    app: APP,
    session_id: sessionId(),
  };

  // return=minimal — we don't read the inserted row back.
  dbRest('/analytics_events', { method: 'POST', body: row, prefer: 'return=minimal', timeout: 8000 })
    .catch(() => {});
}

/** A page view (initial load or SPA hard route). */
export function trackPageview(path) {
  try { send('pageview', path || location.pathname + location.hash); } catch { /* ignore */ }
}

/** A tab / admin-section switch — powers the "top tabs" breakdown. */
export function trackTab(path) {
  try { send('tab', path); } catch { /* ignore */ }
}

/** Wire up automatic tracking. `app` is 'public' or 'admin'.
 *  - Sends an initial pageview.
 *  - On the public shell, listens for Bootstrap 'shown.bs.tab' so every
 *    tab activation is recorded. The admin shell calls trackTab() from
 *    showAdminSide() directly (no Bootstrap tablist there). */
export function initAnalytics(app = 'public') {
  if (typeof window === 'undefined') return;
  APP = app === 'admin' ? 'admin' : 'public';

  // Initial view (defer so it never competes with first paint / auth boot).
  const fire = () => trackPageview();
  if (document.readyState === 'complete') setTimeout(fire, 400);
  else window.addEventListener('load', () => setTimeout(fire, 400), { once: true });

  if (APP === 'public') {
    document.addEventListener('shown.bs.tab', (e) => {
      const id = e.target?.id || e.target?.getAttribute?.('href') || '';
      // 'pills-shop-tab' -> 'shop'
      const name = id.replace(/^pills-/, '').replace(/-tab$/, '');
      if (name) trackTab(`tab:${name}`);
    });
  }
}
