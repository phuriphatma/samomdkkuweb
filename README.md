# MDKKU SAMO — Student Portal

Web portal for the Medical Student Union of Khon Kaen University (MDKKU SAMO).
Single-page Vite app for student announcements, public-relations (PR) job
intake, and the Vital Sound grievance/ticket system.

## Live

- **Production**: <https://samomdkkuweb.pages.dev> (tracks `main`)
- **Preview**:    <https://refactorsamomdkkuweb.pages.dev> (tracks `refactor/modular`)

Both Cloudflare projects hit the same Supabase backend.

## Key features

- **Announcements board.** Public read; staff post via a Quill-based rich-text
  editor. Per-department thumbnails and theming.
- **PR submission.** Form-based job intake with file upload, deadline mode,
  multi-platform targets, and idempotent submit (safe to retry on network blip).
- **Vital Sound tickets.** Confidential intake with dynamic department routing,
  remarks thread, and cross-department consult/transfer for staff.
- **Kanban dashboard.** Status-column board for PR staff with department filter
  and quick-edit modal.
- **Global auth.** One sign-in (Google OAuth + username/password). Roles:
  regular user, `pr_staff`, `vs_staff`, `dev`. Role gates the Admin tab and
  dev-only flags like silent Discord notify.

## Tech stack

- **Frontend**: Vite 6 + Vanilla ES modules + Bootstrap 5 + Quill
- **Auth + DB**: Supabase (Auth, Postgres, Row-Level Security)
- **Files**: Google Drive via Apps Script proxy (chosen for 2 TB quota)
- **Discord**: Apps Script webhook proxy (`notifyPROnly` / `notifyVSOnly` /
  `notifyVSConsult`)
- **Hosting**: Cloudflare Pages (two projects, one per branch)

For the full architecture map, schema, and deploy plumbing see
`docs/CONTEXT.md`.

## Quick start

Prerequisites: Node 20+.

```bash
git clone https://github.com/phuriphatma/samomdkkuweb.git
cd samomdkkuweb
npm install
```

Create `.env.local` with your Supabase credentials:

```bash
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key from Supabase Settings → API>
```

Apply the SQL migrations in `supabase/migrations/` to your project (paste
each file into the Supabase SQL editor and run, in order).

```bash
npm run dev    # http://localhost:5174 with HMR
```

To test Google sign-in locally, add `http://localhost:5174` to your Supabase
project's URL Configuration and to the Google Cloud Console OAuth client's
Authorized JavaScript origins.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on :5174 with HMR |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve `dist/` locally on :4173 |

## Project layout

```text
src/
  html/        HTML partials inlined into index.html at build time
  css/         Brand tokens (base.css) + per-tab CSS, all @imported from main.css
  js/          ES modules — one file per concern
index.html     Slim shell; tabs/modals/navbar pulled from src/html/
supabase/
  migrations/  SQL migrations (canonical schema)
appscript/     Slim Apps Script source — file upload + Discord webhook proxy
docs/          Architecture, schema, deploy plumbing — read on demand
skills/        Procedure playbooks (deploy-gas)
.claude/       Rules + memory for AI agents working in this repo
```

For per-module detail see the Frontend module map in `docs/CONTEXT.md`.

## Contributing

See **[CONTRIBUTING.md](./CONTRIBUTING.md)** — branch model, touch-zone
table (what you can self-merge vs. what needs review), test-without-
spamming-prod tips, hard "don'ts" from past bugs.

Short version:

1. New visual components (tabs, modals) go in `src/html/` and are included
   from `index.html` via the Vite partial plugin.
2. No inline CSS or JS in `index.html`. CSS lives in `src/css/`, JS in
   `src/js/` as ES modules.
3. Functions wired into HTML attributes (e.g. `onclick="..."`) must be
   exposed on `window` from `src/js/main.js`.
4. Before touching `src/js/auth.js` or `src/js/db.js`, read
   `.claude/rules/mistakes.md` first — those modules carry hard-won
   workarounds.

## Where to look next

- **Contributor onboarding (read first):** `CONTRIBUTING.md`
- **Current state / what just shipped:** `STATE.md`
- **Agent / day-to-day work router:** `CLAUDE.md`
- **Architecture + schema + deploy:** `docs/CONTEXT.md`
- **Migration history & open phases:** `docs/SUPABASE-MIGRATION.md`
- **Merge protocol (refactor → main):** `docs/MERGE-CHECKLIST.md`
- **Anti-patterns (READ before touching auth/network):** `.claude/rules/mistakes.md`
- **Procedure playbooks:** `skills/*.md`

## License

Internal student-association project. No public license assigned. Contact the
maintainers before reusing or forking.
