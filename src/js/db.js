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
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Convenience: announcements bucket / file storage hooks would go here
// when we move from Drive to Supabase Storage (Phase 4 in the migration
// plan). For now, file uploads stay on the GAS uploadPRFile endpoint.
