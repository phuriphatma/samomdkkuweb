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
- **SAMO Shop.** Product catalogue (filter by source / type, sort, search),
  cart with localStorage persistence, checkout with required
  name+email+phone contact step (phone auto-fills from the signed-in
  profile), static PromptPay QR + slip upload to Drive, order timeline
  (pending → review → paid → produce → ready → done), per-order QR codes
  (customers show, admins scan via the camera viewfinder in the orders
  tab — `/admin/?scan=<id>` also opens the order directly), pickup-batch
  announcements, an admin-curated swipe-banner carousel for both
  เปิดตัวล่าสุด and ประกาศ (upload + reorder + per-placement), and full
  admin (orders table with size/colour variant dropdowns on order
  create/edit, slip-verify queue, batches, product CRUD, QR settings).
- **Project-document tracking.** SAMO VP-Administration sends "หนังสือโครงการ"
  (projects containing multiple documents) to a designated university officer.
  Document workflow: sent → received → in progress → completed (with off-path
  returned + cancelled). Files (Word / PDF / etc.) upload to Drive under
  organised per-project folders; replace is non-destructive (old versions
  kept). Receiver gets in-app + email notifications; sender gets in-app +
  Discord webhook on every status change / comment. Bookmarkable deep links
  (`#projects/PRJ-XXXX-NNNN/doc/DOC-…`). Per-project QR code generates a
  scannable link to the Drive folder so the whole project (organised as
  one subfolder per หนังสือ, each with its file attachments) can be
  shared in one tap. **Customer mirror** at `/projects-view` exposes the
  same surface read-only to anonymous visitors (gated by migration 0032);
  reuses the admin renderers via `role='customer'` so admin UI changes
  flow through without drift.
- **Departments tab (`ฝ่าย`).** Top-level navbar entry showing all 10
  ฝ่ายในสโมสร with per-dept tool drill-down. Each ฝ่าย links to its
  own tools (SAMOShop + customer หนังสือโครงการ for บริหารองค์กร,
  PR Form for ดิจิทัล, VitalSound + SAMO Passport for ยุทธศาสตร์,
  Notion resource DB for วิชาการ, external sites for เวชนิทัศน์ /
  รังสีเทคนิค). All links are also surfaced in the เครื่องมือ launcher
  search.
- **SAMO Team directory.** Admin section (vp_admin + dev) managing the org as
  an editable tree — divisions → departments → roles → subroles at unlimited
  depth — with people under each role (KKU mail, name, nickname, student id,
  year, สาขา, confirm). Add / edit / move / delete and drag-and-drop reparent +
  reorder for both roles and members; per-role app-permission tagging with
  inheritance (in a separate "จัดการสิทธิ์" mode). Live multi-editor sync
  (Supabase Realtime + presence) and JSON / CSV import-export. Responsive
  desktop / iPad / phone.
- **Global auth.** One sign-in (Google OAuth + username/password). Roles:
  regular user, `pr_staff`, `vs_staff`, `shop_admin`, `vp_admin`, `uni_staff`,
  `dev`. Role gates the Admin tab, the project-tracking tab + bell, and
  dev-only flags like silent Discord notify.
- **Profile self-edit.** Every signed-in user can change their display
  name, add/verify a real email (Supabase magic-link), and link a Google
  identity to a username/password account so they can sign in with
  either after verifying.

## Tech stack

- **Frontend**: Vite 6 + Vanilla ES modules + Bootstrap 5 + Quill
- **Auth + DB**: Supabase (Auth, Postgres, Row-Level Security)
- **Files**: Google Drive via Apps Script proxy (chosen for 2 TB quota)
- **Discord**: Cloudflare Pages Function `/notify` (`functions/notify.js`),
  one proxy for PR / Vital Sign / หนังสือโครงการ webhooks
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
