// ==============================================
// DB — Supabase client (single shared instance)
//
// Imports from Vite env vars. For local dev, set them in .env.local
// (gitignored). For Cloudflare Pages, set them under the project's
// Environment Variables in the dashboard.
//
// The anon key is safe to ship in the bundle; RLS policies enforce
// security on the server. Don't ever expose the service-role key here.
// ==============================================

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Hard-fail at module load. The site can't function without these and
  // a clear error is better than mysterious "fetch failed" later.
  console.error(
    '[db] Missing Supabase env vars. Set VITE_SUPABASE_URL and '
    + 'VITE_SUPABASE_ANON_KEY in .env.local (dev) or Cloudflare Pages '
    + 'env vars (production).'
  );
}

export const db = createClient(url || 'http://invalid', anonKey || 'invalid', {
  auth: {
    persistSession: true,
    // autoRefreshToken disabled by design. The supabase-js auto-refresh
    // sometimes stalls inline before a foreground request, hanging the
    // user's submit. We refresh proactively on a 25-minute interval
    // (well below the 1-hour JWT TTL) so the token never reaches the
    // "needs refresh now" state during a user action.
    autoRefreshToken: false,
    detectSessionInUrl: true,
  },
});

// Proactive refresh: keep the JWT fresh on a fixed interval so it never
// expires mid-submit. 25 min < 1 hour default TTL → plenty of margin.
// Skips refresh when there's no stored session — otherwise long-lived
// signed-out tabs emit a warn every 25 min for the missing-session error.
if (typeof window !== 'undefined') {
  const REFRESH_INTERVAL_MS = 25 * 60 * 1000;
  const projectRefForGate = (url || '').match(/\/\/([^.]+)\./)?.[1] || '';
  const sessionKeyForGate = projectRefForGate ? `sb-${projectRefForGate}-auth-token` : null;
  setInterval(() => {
    if (sessionKeyForGate && !localStorage.getItem(sessionKeyForGate)) return;
    db.auth.refreshSession().catch((e) => console.warn('[db] periodic refresh failed:', e?.message || e));
  }, REFRESH_INTERVAL_MS);
}

// Convenience: announcements bucket / file storage hooks would go here
// when we move from Drive to Supabase Storage. For now, file uploads
// stay on the GAS uploadPRFile endpoint (2 TB Drive quota).


// ============================================================
// dbRest — raw-fetch PostgREST helper
//
// Use this instead of db.from(...) for queries/mutations that have to
// be reliable. supabase-js's request layer has been stalling after the
// first call in a session despite extensive debugging (autoRefresh
// disabled, response bodies drained, etc.). Raw fetch sidesteps
// whatever internal state was going bad.
//
// Auth: pulls the current session's access token from localStorage.
// Falls back to anon key (RLS will still gate non-public reads).
//
// Returns Supabase-style { data, error } so call sites look familiar.
//
//   const { data, error } = await dbRest('/pr_tickets?id=eq.PR-ABC&select=*');
//   const { error }       = await dbRest('/pr_tickets', { method: 'POST', body: row });
//   const { error }       = await dbRest('/pr_tickets?id=eq.PR-ABC', { method: 'PATCH', body: { status: 'done' } });
// ============================================================

const PROJECT_REF = (url || '').match(/\/\/([^.]+)\./)?.[1] || '';
const SESSION_STORAGE_KEY = PROJECT_REF ? `sb-${PROJECT_REF}-auth-token` : null;

function currentAccessToken() {
  if (!SESSION_STORAGE_KEY) return anonKey;
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) return anonKey;
    const parsed = JSON.parse(stored);
    return parsed?.access_token || anonKey;
  } catch {
    return anonKey;
  }
}

export async function dbRest(path, opts = {}) {
  const {
    method = 'GET',
    body,
    headers: extraHeaders = {},
    timeout = 15000,
    prefer,
  } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = {
      apikey: anonKey,
      Authorization: `Bearer ${currentAccessToken()}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...extraHeaders,
    };
    // GET cache busting. iOS Safari shipped the fetch `cache` option
    // only in 16.4; on older iPads the `cache: 'no-store'` below is
    // silently ignored and Safari happily serves a stale disk copy of
    // /projects?select=*&… — surfacing as "comment is in the DB but
    // the inbox shows yesterday's timeline → no highlight, only
    // incognito works". A unique query parameter side-steps the cache
    // at the URL-key level, which every browser honours. PostgREST
    // ignores unknown query params so this is safe to add to any GET.
    let finalPath = path;
    if (method === 'GET') {
      const sep = path.includes('?') ? '&' : '?';
      finalPath = `${path}${sep}_=${Date.now()}`;
    }
    const res = await fetch(`${url}/rest/v1${finalPath}`, {
      method,
      headers,
      body: body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: controller.signal,
      // Modern browsers (Safari 16.4+, all Chromium/Firefox) honour
      // this — see the cache-buster comment above for the older-iOS
      // story.
      cache: 'no-store',
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { data: null, error: { status: res.status, message: text || res.statusText } };
    }
    const data = res.status === 204
      ? null
      : await res.json().catch(() => null);
    return { data, error: null };
  } catch (e) {
    clearTimeout(timer);
    return { data: null, error: { message: e?.message || String(e), name: e?.name } };
  }
}
