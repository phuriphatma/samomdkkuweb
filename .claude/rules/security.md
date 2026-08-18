# Security rules — API keys and secrets

## What's safe to commit, what's not

| Token / value | Bundle / git? | Where it lives |
|---|---|---|
| `VITE_SUPABASE_URL` | ✅ yes | bundled at build time ON THE VM, public |
| `VITE_SUPABASE_ANON_KEY` | ✅ yes | bundled at build time, public (RLS gates) |
| Supabase `service_role` key | ❌ NEVER | not currently used — keep out of repo / browser if ever re-introduced |
| Google OAuth client secret | ❌ NEVER | Supabase dashboard only |
| Discord webhook URLs | ❌ NEVER (in frontend code) | embedded in `appscript/*.gs` only |
| Apps Script `/exec` URLs | ✅ yes (treated as public webhooks) | `src/js/config.js` |
| Shared VP/staff account passwords (the old `samo69*` pattern) | ❌ NEVER in git | **RETIRED 2026-08-17** — 14 shared admin accounts + passportadmin were DELETED PERMANENTLY (auth + public.users rows removed after their data was reassigned to real people); staff now sign in with personal @kkumail.com via ทีม SAMO. The `samo69*` literals were scrubbed from `tools/` + `docs/`. Do NOT re-introduce a hardcoded shared password |
| `sastaff` / `saprof` weak password (`1234`) | ❌ NEVER in git | **RETIRED 2026-08-18** — the last two shared หนังสือโครงการ logins were DELETED (auth + `public.users`) after their work was reassigned to the named เจ้าหน้าที่คณะ / อาจารย์ who already held the ทีม SAMO seat. Both usernames stay RESERVED in `auth.js` so nobody can squat them. `samomdkkudev` password is owner-managed. No shared password account remains except `samomdkkudev` |
| Supabase PAT (`SUPABASE_ACCESS_TOKEN=sbp_…`) | ❌ NEVER | `.env.local` only — account-wide Management-API token; used by `tools/apply-migration.mjs` to run DDL. Revoke at dashboard/account/tokens when done |
| Supabase DB URL (`SUPABASE_DB_URL=postgresql://…`) | ❌ NEVER | `.env.local` only (optional) — direct Postgres conn string incl. password; psql path for `apply-migration.mjs` |
| clasp OAuth creds (`~/.clasprc.json`) | ❌ NEVER | outside the repo, in `$HOME`. Written by `npx clasp login`; a full Google OAuth credential for the account (Drive + Apps Script). `.gitignore` carries `.clasprc.json` in case one is ever written into the repo root. Revoke at myaccount.google.com/permissions |
| GAS script / deployment ids (`GAS_SCRIPT_ID`, `GAS_DEPLOYMENT_ID`) | ❌ keep in `.env.local` | not secrets in the crypto sense — the `/exec` URL is already public and treated as a webhook — but they identify the project to write to, so they stay out of git to keep `tools/deploy-gas.mjs` from being pointed at the wrong one |
| clasp local OAuth creds (`creds.json` from a Desktop OAuth client) | ❌ NEVER | needed only for `clasp run` (see `skills/deploy-gas.md`). Keep OUTSIDE the repo or in `.env.local`'s directory, gitignored. Re-authorising with it rewrites `~/.clasprc.json` with the SCRIPT's scopes — which, because `prform.gs` uses `DriveApp`, means a token that can reach the entire Drive of the SAMO account (exam keys and all). Google has no folder-scoped Drive scope, so this cannot be narrowed; bound it by moving the app tree to a Shared Drive with its own identity instead. Revoke at myaccount.google.com/permissions |
| KKU SSO `KKU_SSO_CLIENT_SECRET` | ❌ NEVER | `.env.local` only — exchanges an SSO auth `code` for an access token that reads a person's KKU profile (incl. `citizenId`). **Server-side only**: it can never live in a `VITE_*` var or any file under `src/`. Rotate via the KKU digital-services team. |
| KKU SSO `KKU_SSO_APP_ID` / `KKU_SSO_CLIENT_ID` | ⚠️ not secret, still `.env.local` | the App ID travels in the public login URL (`sso…/login?app=<AppID>`), so it is not confidential — kept out of git only so nothing points at the wrong registration |
| KKU VM sudo password (`SAMO_VM_SUDO_PASSWORD=…`) | ❌ NEVER | `.env.local` only — piped over ssh to `sudo -S` during prod deploys (rsync to `/var/www`, nginx reload). Never write to a git-tracked file, the VM disk, or chat. Rotate if leaked. |

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
   - the KKU VM's build environment (`server/deploy.sh`). **Cloudflare Pages is
     RETIRED** — its dashboard env vars reach nothing, so a secret added there
     is not "stored", it is lost.
   - (If we ever bring Edge Functions back: `supabase secrets set NAME=value`.)
3. Add a row to the table above.

## Don't trust file paths that look like secrets

`.claude/settings.local.json` is gitignored. Do not commit it. Do not echo
its contents.
