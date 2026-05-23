# STATE — current task & latest known state

Last updated: 2026-05-23

## Branches

Both `main` and `refactor/modular` are at commit `edaacc1` (in sync).

- `main` → `samomdkkuweb.pages.dev` (production)
- `refactor/modular` → `refactorsamomdkkuweb.pages.dev` (preview)

## Most recent merge

`refactor/modular` was merged to `main` (`d91a32a`) as the Supabase cutover.
Two conflicts resolved: `.gitignore` (kept both branches' rules) and
`index.html` (took the slim refactor version over main's 2700-line monolith).
`functions/api/submit.js` deleted — refactor talks to Supabase directly.

## Currently working

Nothing active. The memory-system extraction (CLAUDE.md router, STATE.md,
`.claude/rules/{mistakes,security}.md`, `skills/*.md`, `docs/CONTEXT.md`,
and `.github/workflows/build.yml`) was just committed. No bug under
investigation.

## Recent fixes (latest first, last ~10 commits)

| Commit | What |
|---|---|
| _(this commit)_ | Memory system: CLAUDE.md router + STATE.md + `.claude/rules/` + `skills/` + `docs/CONTEXT.md` + CI build |
| `edaacc1` | Sort PR/VS tickets by `timestamp` (not `created_at`) — avoids needing a backfill |
| `5df7f65` | Migrate script writes `created_at` from CSV timestamp (defense in depth) |
| `92c039b` | Gate auth-subscriber side-effects (showAdminLanding, modal close, VS form autofill) on real transitions only — fixes "kanban resets when switching tabs" |
| `4779c88` | Migrate other_platforms + other_platform_reason (silently dropped, CSV cols 21/22 have empty headers) |
| `074d653` | Migrate assignees from CSV col 20 via positional `_raw[20]` access |
| `5493c11` | THE big one — wrap onAuthStateChange body in `setTimeout(0)` to escape supabase-js auth-lock deadlock (issue #762) |
| `d97756f` | Add `dbRest()` raw-fetch helper in `db.js`; convert PR tracking calls |
| `58d1ead` | Bypass supabase-js for PR/VS inserts using raw fetch + AbortController |

## Open / deferred

- **`PR-0Y0E2R` recovery**: user accidentally deleted a ticket via kanban. CSV
  has it. Running `MIGRATE_RESTORE_ONLY=1 npm run migrate` will restore it; the
  user has already retrieved it (confirmed visible).
- **Supabase Edge Functions for Discord (`notify-pr`, `notify-vs`)**: code
  exists in `supabase/functions/` but returns 502 in our project (suspected
  Edge Runtime version mismatch). Currently routing Discord notifies via the
  GAS proxy instead. Defer.
- **Phase 4 file storage**: deliberately staying on Drive (2 TB) instead of
  Supabase Storage (1 GB free tier). Documented in `docs/SUPABASE-MIGRATION.md`.

## Known caveats

- Discord notifications travel through GAS `notifyPROnly` / `notifyVSOnly` /
  `notifyVSConsult` actions. Both prod GAS deployments must have the slim
  `appscript/*.gs` (104 + 154 lines) code live.
- Drive uploads also go through GAS `uploadPRFile`. Same redeploy requirement.
- Synthetic email domain is `samomdkku.app` (NOT `.local`). Supabase Auth
  rejects RFC-reserved TLDs. Don't switch back.
- Supabase auto-refresh is **disabled** in `db.js`; a 25-min `setInterval`
  calls `refreshSession()` instead. Don't re-enable `autoRefreshToken` without
  reading `.claude/rules/mistakes.md` first.

## Reproducible smoke tests

After any deploy:

1. Sign in with Google + a fresh password account
2. Submit a PR ticket — Discord pings, row in Supabase
3. Submit a second PR ticket without reloading — must succeed (regression test for the deadlock)
4. Submit a VS ticket — Discord pings target dept
5. Admin → PR Management → kanban shows tickets in correct chrono order, dept filter works
6. Edit an announcement (as `samomdkkupr` or `samomdkkudev`) — changes persist
