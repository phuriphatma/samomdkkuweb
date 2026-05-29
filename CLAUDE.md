# Claude / Agent Router — samomdkkuweb

Slim entry point. Everything else is read on demand.

## Project

MDKKU SAMO student-portal SPA. Vite + Vanilla JS + Bootstrap, backed by
Supabase (auth + Postgres + RLS). Apps Script (`appscript/`) survives as a
thin proxy for Discord webhooks and Drive file uploads only.

Live URLs:
- Production: `https://samomdkkuweb.pages.dev` (main branch)
- Preview:    `https://refactorsamomdkkuweb.pages.dev` (refactor/modular branch)

Supabase project: `fheueuowbchsnsvbcgil`. Both Cloudflare projects hit it.

## Tech stack (quick)

- **Frontend**: Vite 6, Vanilla ES modules, Bootstrap 5, Quill (rich text)
- **Auth + DB**: Supabase Auth (Google + username/password), Postgres with RLS
- **Files**: Google Drive via GAS `uploadPRFile` (chosen for 2 TB quota)
- **Discord**: GAS proxy actions `notifyPROnly` / `notifyVSOnly` / `notifyVSConsult`
- **Hosting**: Cloudflare Pages (2 projects, both auto-build on push)
- **Env vars**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` set in
  Cloudflare dashboard. `SUPABASE_SERVICE_ROLE_KEY` only in local `.env.local`.

## Commands

```bash
npm run dev          # Vite dev server on :5174
npm run build        # production build → dist/
npm run preview      # serve dist locally on :4173
```

## File placement

| Adding | Goes in |
|---|---|
| New HTML tab/modal | `src/html/*.html` (HTML partial; include from `index.html`) |
| New CSS | `src/css/*.css` (then `@import` from `src/main.css`) |
| New JS module | `src/js/*.js` (ES module) |
| Window-bound function (for `onclick=""`) | Wire in `src/js/main.js` |
| New Supabase schema | New numbered file in `supabase/migrations/` |
| Backend GAS edit | `appscript/*.gs` (then redeploy — see skills/deploy-gas.md) |

## UI/UX guidelines

- **Brand**: white-dominant, gray gradient body, green primary + orange accent
- **Wordmark**: `MDKKU` in `--brand-primary` (#105922), `SAMO` in `--brand-orange` (#FF6F30)
- **Per-tab accents** (scoped via tab-level class on the pane):
  - PR form → pink (`--pink-*` keeps its original pink scale)
  - VS form → teal (`.vs-tab` overrides `--pink-*` to teal scale)
  - Announcements/Creator → slate (`.an-tab` overrides to neutral)
  - Admin → green primary
- **Departments**: 10 unique color identities (see `src/css/base.css` `--dept-*`)
- **Fonts**: Noto Sans Thai (body, English + Thai), Prompt (brand-fixed pill + secondary fallback). Loaded via Google Fonts. System fallback chain (`system-ui`, `-apple-system`, `Segoe UI`) kept in CSS for when Google Fonts is blocked.
- **Density**: tight spacing on mobile, generous on desktop. Use Bootstrap utility classes.
- **No emojis in UI text** unless the user explicitly asks.

## Read these on demand (not auto-loaded)

- `STATE.md` — current task / open issues / latest deploy
- `README.md` — public/human-facing onboarding (commands, env, layout). Not for agents to read; check it only when verifying README accuracy.
- `CONTRIBUTING.md` — human collaborator guide (branch model, touch zones, dos/don'ts). Reflects the same rules; cross-check when editing project policy.
- `docs/CONTEXT.md` — architecture map, RLS policies, schema, deploy plumbing, developer workflows
- `docs/SUPABASE-MIGRATION.md` — phase tracker
- `docs/MERGE-CHECKLIST.md` — when merging refactor → main
- `docs/AUTH-MODEL.md` — unified user model proposal (future)
- `docs/PROJECT-ARCHITECTURE.md` — multi-project engine proposal — DEFERRED, kept as future reference
- `.claude/rules/mistakes.md` — hard-learned anti-patterns (READ before touching auth/network code)
- `.claude/rules/security.md` — API key hygiene
- `skills/*.md` — playbooks for the non-obvious workflows

When working in `src/js/auth.js` or `src/js/db.js` — ALWAYS read
`.claude/rules/mistakes.md` first. Those modules carry sharp edges.

## End-of-turn loop (MANDATORY)

Before sending the final response on any task that modified files:

1. **Update `STATE.md`** — current branch, what just changed, anything pending.
2. **If a new bug class was discovered**: append to `.claude/rules/mistakes.md`.
3. **If a repeatable multi-step workflow appeared**: create or update a file under `skills/`.
4. **Documentation (conditional — only if any of these are true):**
   - User-visible feature added or removed → update the "Key features" list in `README.md`.
   - Architecture, schema, RLS, deploy plumbing, or auth flow changed → update `docs/CONTEXT.md`.
   - Build / install / env setup changed → update `README.md` (Quick start, Commands, Environment).
   - **If the change is internal-only (refactor, bugfix, test, comment) — skip this step.** Doc edits should be a side-effect of meaningful change, not a tax on every commit.
5. State in the user-facing response: "Updated STATE.md / mistakes.md / skills/* / docs as needed."

This loop keeps cold-start agents from re-walking the bugs we already paid for, AND keeps human-facing docs from going stale — without taxing routine commits.

## Authority model

- Default behavior: ask before destructive ops (force push, schema deletes, prod GAS redeploys).
- The user has authorized: commit + push on feature branches without prompting, except force push.
- The user has NOT authorized: amending pushed commits, dropping tables, mass-deleting rows.

## Notes that change frequently

Everything that decays — current task, what's in flight, what just broke —
lives in `STATE.md`, not here.
