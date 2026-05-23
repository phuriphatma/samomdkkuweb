# STATE — current task & latest known state

Last updated: 2026-05-23

## Branches

`refactor/modular` is ahead of `main` by 1 commit (audit fixes, not yet
merged). `main` still at `ac3d0b6`.

- `main` → `samomdkkuweb.pages.dev` (production)
- `refactor/modular` → `refactorsamomdkkuweb.pages.dev` (preview)

## Most recent merge

`refactor/modular` was merged to `main` (`d91a32a`) as the Supabase cutover.
Two conflicts resolved: `.gitignore` (kept both branches' rules) and
`index.html` (took the slim refactor version over main's 2700-line monolith).
`functions/api/submit.js` deleted — refactor talks to Supabase directly.

## Currently working

**Pending design decisions** — see `docs/PROJECT-ARCHITECTURE.md`. The
user wants to refactor PR + VS into a shared engine + per-project
config so adding project N+1 is a config drop, not a fork. Five open
questions in that doc. Don't touch code until they're answered.

Most recent change: audit pass — three commits.
1. Closed six RLS-silent-success sites + announcement button label +
   VS ticket-ID collision + fragile selector.
2. Cleanup pass: partial-upload state in error message, `fileInput.value=''`
   after reset (latent), `decodeJwtResponse` input guards, `escHtml` helper
   in utils.js applied to announcement renderers (title/dept/snippet only —
   `post.content` stays raw Quill HTML), two stale "sendBeacon" comments,
   one unused import.
3. Dead-code removal: deleted `supabase/functions/notify-pr/` and
   `notify-vs/` (~300 LOC of Deno code that was returning 502 — Discord
   stays on GAS by design now). Trimmed 8 stale references across docs
   and agent rules; net -411 LOC.
4. Migration-tool removal: deleted `tools/migrate-from-sheets.mjs`
   (529 LOC), `sheetexample/` (~800 KB student data dumps; already
   gitignored so never on GitHub), `skills/migrate-data.md`,
   `skills/recover-ticket.md`. Removed `npm run migrate` from
   package.json + the unused `dotenv` dep. Updated 6 doc files to
   remove the now-dead references.

## Recent fixes (latest first, last ~10 commits)

| Commit | What |
|---|---|
| _(this commit)_ | Remove one-shot migration tool: tools/migrate-from-sheets.mjs, sheetexample/, two skills, dotenv dep, npm run migrate, 11 references |
| `49d4ca1` | Remove dead Edge Function source (notify-pr, notify-vs) + 8 stale doc references. Discord stays on GAS by design |
| `a91fa17` | Audit cleanup pass: partial-upload state in pr-form error msg; `fileInput.value=''` after reset; `decodeJwtResponse` guards; `escHtml` helper + applied to announcement renderers; stale comments; unused import |
| `6a8193e` | Audit pass: close 6 RLS-silent-success sites (pr-staff status/delete/agents, vs-staff status, vs-tracking remarks, auth.setDepartment); fix announcement publish-btn label after edit; VS ticket-ID collision; selector |
| `acc3ef1` | Docs pass 2: rewrite stale `README.md`, add Developer workflows section to `docs/CONTEXT.md`, add conditional rule 4 to CLAUDE.md auto-update loop |
| `ca20e10` | Memory system: CLAUDE.md router + STATE.md + `.claude/rules/` + `skills/` + `docs/CONTEXT.md` + CI build |
| `edaacc1` | Sort PR/VS tickets by `timestamp` (not `created_at`) — avoids needing a backfill |
| `5df7f65` | Migrate script writes `created_at` from CSV timestamp (defense in depth) |
| `92c039b` | Gate auth-subscriber side-effects (showAdminLanding, modal close, VS form autofill) on real transitions only — fixes "kanban resets when switching tabs" |
| `4779c88` | Migrate other_platforms + other_platform_reason (silently dropped, CSV cols 21/22 have empty headers) |
| `074d653` | Migrate assignees from CSV col 20 via positional `_raw[20]` access |
| `5493c11` | THE big one — wrap onAuthStateChange body in `setTimeout(0)` to escape supabase-js auth-lock deadlock (issue #762) |
| `d97756f` | Add `dbRest()` raw-fetch helper in `db.js`; convert PR tracking calls |
| `58d1ead` | Bypass supabase-js for PR/VS inserts using raw fetch + AbortController |

## Open / deferred

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
