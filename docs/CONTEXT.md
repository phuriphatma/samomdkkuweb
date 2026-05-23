# CONTEXT — architecture, schema, deploy plumbing

Read this when editing:
- Anything in `supabase/migrations/`
- Anything that crosses the frontend ↔ backend boundary
- The auth model or RLS policies
- The deploy / env-var story for either Cloudflare project

For day-to-day feature work, `CLAUDE.md` is enough.

---

## Overall request flow

```
Browser (Cloudflare Pages-hosted SPA)
  │
  ├─→ Supabase PostgREST (data CRUD)         ── primary read/write path
  │     ↳ public.users / pr_tickets / vs_tickets / announcements / pr_agents
  │     ↳ gated by RLS policies (see schema below)
  │
  ├─→ Supabase Auth /auth/v1/*               ── sign in / out / refresh
  │     ↳ Google OAuth + email/password (synthetic emails)
  │
  └─→ GAS /exec (legacy proxy)               ── narrow & specific
        ↳ uploadPRFile  → writes to Google Drive
        ↳ notifyPROnly  → fires Discord webhook
        ↳ notifyVSOnly  / notifyVSConsult → fires Discord webhooks
```

GAS is intentionally minimal post-migration. Drops to 104 + 154 lines.
Everything that USED to be in GAS (submit, track, staff dashboards,
announcements) now talks to Supabase directly.

---

## Frontend module map

```
src/js/
├── main.js              ─ entry point; wires window.* handlers; auth subscriber
├── db.js                ─ Supabase client + dbRest() raw-fetch helper
├── auth.js              ─ sign in / out, currentUser, onAuthChange subscribers
├── pr-auth.js           ─ reflects auth state into PR form's hidden inputs
├── pr-form.js           ─ PR ticket submit (raw fetch, idempotent retry)
├── pr-tracking.js       ─ user-facing PR history + ticket lookup
├── pr-staff.js          ─ kanban dashboard, modal, agents management
├── vs-form.js           ─ VS ticket submit
├── vs-tracking.js       ─ VS user history + ticket lookup + reply
├── vs-staff.js          ─ VS staff dashboard
├── announcements.js     ─ announcement CRUD via dbRest
├── notify.js            ─ Discord webhook fire-and-forget (via GAS)
├── uploads.js           ─ Drive upload via GAS uploadPRFile
├── config.js            ─ GAS_API_URL + GAS_VITAL_SOUND_URL (prod)
└── utils.js             ─ formatThaiDate, renderTimeline, decodeJwtResponse

src/html/                ─ Vite HTML partials. index.html includes them.
src/css/                 ─ Bootstrap + brand vars in base.css + topic CSS files.
```

---

## Supabase schema (canonical: `supabase/migrations/0001_initial_schema.sql`)

Tables, condensed:

```
users (uuid id PK, email, username, display_name, method, role, department,
       created_at, last_seen_at)
  ↳ FK to auth.users (cascade delete)
  ↳ role IN ('user', 'pr_staff', 'vs_staff', 'dev')
  ↳ Trigger handle_new_auth_user populates from raw_user_meta_data on signup

announcements (bigserial id PK, title, content, department, thumbnail_url,
               status, created_by FK users(id), created_at, updated_at)
  ↳ Trigger touch_updated_at on update

pr_tickets (text id PK ["PR-XXXXXX"], timestamp, department, contact,
            content_name, job_type, platforms text[], posting_channel,
            publish_date, deadline_status, rush_reason, brief, caption,
            file_url, silent_notify boolean, project_account, copost_with,
            submitter_id FK users(id), submitter_label, status,
            remarks jsonb, assignees text[], other_platforms text[],
            other_platform_reason, created_at)

vs_tickets (text id PK ["VS-YYMMDD-HHMM"], timestamp, display_name, year,
            submitter_id FK users(id), submitter_label, problem text,
            target_dept, requested_dept, status, is_emergency boolean,
            remarks jsonb, created_at)

pr_agents (id integer PK = 1 [single-row config table], agents text[],
           updated_at)

reserved_staff_usernames (username PK, role, email, created_at)
  ↳ Lists samomdkkupr / samomdkkuvssound / samomdkkudev for the migrator
```

## RLS policies (canonical: same migration file)

- **users**: any authenticated user can SELECT all (needed for staff
  dashboards to render submitter names). UPDATE allowed on own row OR by
  staff.
- **announcements**: SELECT for everyone (incl. anon) where status =
  'approved'; all writes restricted to `pr_staff` / `dev`.
- **pr_tickets**: SELECT for submitter OR staff/dev. INSERT for anyone
  (guest submissions). UPDATE / DELETE for staff/dev only.
- **vs_tickets**: same shape as pr_tickets (insert-open, mutate-staff).
- **pr_agents**: any staff role read; pr_staff/dev write.

Helper SQL functions: `current_user_role()`, `current_user_is_staff()`
(both `security definer set search_path = public`).

## Auth model details

- **Google OAuth**: routed through Supabase's `signInWithOAuth({ provider:
  'google' })`. Browser redirects to Google → Supabase callback → app.
  Authorized origins / redirect URIs must include both Cloudflare URLs
  AND localhost for dev.
- **Username/password**: synthetic email `<username>@samomdkku.app`.
  Supabase Auth treats it as an email-based account. The user only ever
  sees the username.
- **Email confirmation**: must be OFF in Supabase (synthetic emails don't
  receive mail). See `.claude/rules/mistakes.md`.
- **Staff seeding**: `tools/migrate-from-sheets.mjs` calls
  `admin.auth.admin.createUser` for the three reserved usernames and sets
  their passwords via `updateUserById`. Idempotent.

---

## Deploy plumbing

### Two Cloudflare Pages projects

| Project | Branch | URL |
|---|---|---|
| `samomdkkuweb` | `main` | <https://samomdkkuweb.pages.dev> |
| `refactorsamomdkkuweb` | `refactor/modular` | <https://refactorsamomdkkuweb.pages.dev> |

Both share the same Supabase + GAS backends. Different env vars must be set
on EACH project (Cloudflare doesn't share env between projects).

Required env vars on both:
- `VITE_SUPABASE_URL = https://fheueuowbchsnsvbcgil.supabase.co`
- `VITE_SUPABASE_ANON_KEY = <anon key from Supabase Settings → API>`

Build config on both:
- Framework: Vite (or None)
- Build command: `npm run build`
- Output dir: `dist`

### Apps Script projects (2)

- `prform` — owns the `PR_Submissions` Drive folder + PR-team Discord webhook
- `vssound` — owns the per-dept Discord webhook map

Slim source files in `appscript/`. Redeploy procedure in `skills/deploy-gas.md`.

### Supabase project

- Region: Southeast Asia (Singapore)
- Free tier (1 GB DB + 1 GB storage — we use Drive for files instead)
- Auth providers enabled: Email (synthetic), Google OAuth
- URL Configuration must include both Cloudflare URLs + localhost
- Migrations applied: `supabase/migrations/0001_initial_schema.sql` +
  `0002_seed_staff_accounts.sql`

---

## Notable design decisions

- **Drive for files, not Supabase Storage**: 2 TB vs 1 GB free tier.
- **GAS for Discord, not Edge Functions**: Edge Functions return 502 in our
  project (Edge Runtime version mismatch); GAS works. Phase 5 in
  `docs/SUPABASE-MIGRATION.md` tracks this.
- **Raw `fetch` via `dbRest()` for hot paths**: supabase-js has been a
  source of intermittent hangs. The raw-fetch escape hatch is used in
  pr-form, vs-form, pr-tracking, announcements.
- **Disabled autoRefreshToken**: replaced with a 25-min `setInterval` in
  `db.js`. Avoids inline refresh stalling the next user action.
- **setTimeout(0) wrapper in onAuthStateChange**: workaround for supabase-js
  auth-lock deadlock (issue #762).

---

## When this doc goes stale

It WILL drift. Trust the code over this doc when they disagree:

- Authoritative schema: `supabase/migrations/0001_initial_schema.sql`
- Authoritative auth flow: `src/js/auth.js`
- Authoritative deploy config: Cloudflare Pages dashboard +
  `appscript/*.gs` deployment dropdowns
