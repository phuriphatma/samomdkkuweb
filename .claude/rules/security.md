# Security rules — API keys and secrets

## What's safe to commit, what's not

| Token / value | Bundle / git? | Where it lives |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ yes | bundled at build time, public |
| `VITE_SUPABASE_ANON_KEY` | ✅ yes | bundled at build time, public (RLS gates) |
| Supabase `service_role` key | ❌ NEVER | only `.env.local`, only used by `npm run migrate` |
| Google OAuth client secret | ❌ NEVER | Supabase dashboard only |
| Discord webhook URLs | ❌ NEVER (in frontend code) | embedded in `appscript/*.gs` only |
| Apps Script `/exec` URLs | ✅ yes (treated as public webhooks) | `src/js/config.js` |
| Staff passwords (`samo69pr` etc.) | ⚠️ git ok, do NOT post anywhere public | only in this repo; rotate if leaked |

## Hard rules for the agent

1. **NEVER paste a service_role key, OAuth secret, or Discord webhook URL
   into a chat reply unless the user explicitly asks for it AND the chat is
   private.** They land in chat history that may be retained.
2. **NEVER write a service_role key into `src/`** (anywhere bundled to the
   browser). Service role bypasses RLS — bundling = full DB exposure.
3. **`.env.local` is gitignored. Confirm before writing to it.** Same for
   any other `.env*` variants.
4. **Discord webhook URLs are sensitive.** Embedding them in `appscript/*.gs`
   is acceptable because that file isn't served to browsers. Do not import
   them into frontend modules.
5. **The legacy `appscript/*.gs` Discord webhook URLs were exposed in chat
   history during the session.** Rotate them when convenient: Discord channel
   settings → Integrations → Webhooks → Regenerate URL. Update the .gs files
   afterward.
6. **If the user pastes a key in chat that should be private, advise rotation
   in your next reply.** Don't quietly continue.

## What to do when adding a new secret

1. Decide whether the frontend needs it. If yes, only the Supabase anon-key
   pattern is safe — public but gated by RLS.
2. If backend-only, store in:
   - Apps Script project (Properties → Script properties) for `appscript/*.gs`
   - Cloudflare Pages env vars (NOT exposed to browser via `VITE_*` prefix)
   - (If we ever bring Edge Functions back: `supabase secrets set NAME=value`.)
3. Add a row to the table above.

## Don't trust file paths that look like secrets

`.claude/settings.local.json` is gitignored. Do not commit it. Do not echo
its contents.
