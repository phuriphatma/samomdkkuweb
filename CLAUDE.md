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

## Memory layout — what loads, what you fetch

**Auto-loaded into every session** (`CLAUDE.md` + everything in
`.claude/rules/`): this file, `.claude/rules/mistakes.md` (recurring bug
CLASSES + a one-line index of all 117 write-ups), `.claude/rules/security.md`
(key hygiene). Budget ~26k chars total, enforced by `npm run check:context`,
which `npm test` runs. **Never put a bug write-up, a session narrative, or
anything long in `.claude/rules/` — it is charged to every future session.**

**Read on demand** — everything below. Fetch the one you need; don't preload.

- `docs/mistakes/*.md` — the 117 bug write-ups, nine files by area. The index
  in `.claude/rules/mistakes.md` says which file; `grep -rin "<symptom>"
  docs/mistakes/` is usually faster. **Read the matching file BEFORE touching
  `src/js/auth.js`, `src/js/db.js`, any RLS policy / `current_user_*` helper /
  SECURITY DEFINER function, `server/deploy.sh`, or `appscript/*.gs`.**
- `STATE.md` — current task / open issues / latest deploy
- `README.md` — public/human-facing onboarding (commands, env, layout). Not for agents to read; check it only when verifying README accuracy.
- `CONTRIBUTING.md` — human collaborator guide (branch model, touch zones, dos/don'ts). Reflects the same rules; cross-check when editing project policy.
- `docs/CONTEXT.md` — architecture map, RLS policies, schema, deploy plumbing, developer workflows
- `docs/SUPABASE-MIGRATION.md` — phase tracker
- `docs/MERGE-CHECKLIST.md` — when merging refactor → main
- `docs/VERSIONING.md` — release numbering + workflow. READ BEFORE bumping a
  version or adding a release note; `npm run release` does the mechanical half.
- `docs/AUTH-MODEL.md` — unified user model proposal (future)
- `docs/PROJECT-ARCHITECTURE.md` — multi-project engine proposal — DEFERRED, kept as future reference
- `skills/*.md` — playbooks for the non-obvious workflows

## End-of-turn loop (MANDATORY)

Before sending the final response on any task that modified files:

1. **Update `STATE.md`** — only if real state changed (branch HEAD, pending migrations, in-flight work, blocking issues). Do NOT append a session narrative — `git log` is the archive. Keep STATE.md under ~200 lines; if it bloats, prune past-session sections to `docs/state-archive/YYYY-MM-DD.md` and trust `git log --oneline` for the chronology.
2. **If a bug was found and fixed**: write it up in the matching
   `docs/mistakes/*.md` (**Symptom → Cause → Fix → Where it lives now**, ending
   with the general rule; lead with the symptom AS REPORTED — that is what the
   next reader greps for), then run `npm run mistakes:index`. If it is a new
   instance of one of the seven classes, add the site to that class's list in
   `.claude/rules/mistakes.md`. Prefer a guard test over a paragraph: this repo
   has learned that writing a hazard down does not make anyone check it.
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
