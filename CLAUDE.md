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
npm run migrate      # run the CSV→Supabase data migration (see skills/migrate-data.md)
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
- **Fonts**: Sora (English), Cloud (Thai), Prompt fallback. Loaded via Google Fonts.
- **Density**: tight spacing on mobile, generous on desktop. Use Bootstrap utility classes.
- **No emojis in UI text** unless the user explicitly asks.

## Read these on demand (not auto-loaded)

- `STATE.md` — current task / open issues / latest deploy
- `docs/CONTEXT.md` — architecture map, RLS policies, schema, deploy plumbing
- `docs/SUPABASE-MIGRATION.md` — phase tracker
- `docs/MERGE-CHECKLIST.md` — when merging refactor → main
- `docs/AUTH-MODEL.md` — unified user model proposal (future)
- `.claude/rules/mistakes.md` — hard-learned anti-patterns (READ before touching auth/network code)
- `.claude/rules/security.md` — API key hygiene
- `skills/*.md` — playbooks for the non-obvious workflows

When working in `src/js/auth.js`, `src/js/db.js`, or `supabase/functions/` —
ALWAYS read `.claude/rules/mistakes.md` first. Those modules carry sharp edges.

## End-of-turn loop (MANDATORY)

Before sending the final response on any task that modified files:

1. **Update `STATE.md`** — current branch, what just changed, anything pending.
2. **If a new bug class was discovered**: append to `.claude/rules/mistakes.md`.
3. **If a repeatable multi-step workflow appeared**: create or update a file under `skills/`.
4. State in the user-facing response: "Updated STATE.md / mistakes.md / skills/* as needed."

This loop keeps cold-start agents from re-walking the bugs we already paid for.

## Authority model

- Default behavior: ask before destructive ops (force push, schema deletes, prod GAS redeploys).
- The user has authorized: commit + push on feature branches without prompting, except force push.
- The user has NOT authorized: amending pushed commits, dropping tables, mass-deleting rows.

## Notes that change frequently

Everything that decays — current task, what's in flight, what just broke —
lives in `STATE.md`, not here.
