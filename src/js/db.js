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
if (typeof window !== 'undefined') {
  const REFRESH_INTERVAL_MS = 25 * 60 * 1000;
  setInterval(() => {
    db.auth.refreshSession().catch((e) => console.warn('[db] periodic refresh failed:', e?.message || e));
  }, REFRESH_INTERVAL_MS);
}

// Convenience: announcements bucket / file storage hooks would go here
// when we move from Drive to Supabase Storage. For now, file uploads
// stay on the GAS uploadPRFile endpoint (2 TB Drive quota).
