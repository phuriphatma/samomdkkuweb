# Supabase Migration — Step-by-Step Plan

Status: **Phase 1 in code, not yet deployed.** See the phase tracker at the
bottom of this doc for what's done and what's left.

This is the playbook for moving from the current Google Sheets + Apps
Script backend to Supabase (Postgres + Edge Functions + Auth + Storage)
**without data loss**.

## Why migrate

| Pain                                                  | Supabase fixes it                                    |
|-------------------------------------------------------|------------------------------------------------------|
| Passwords stored in plaintext in `Tickets` sheet      | Supabase Auth handles hashing properly               |
| No unified user table; PR/VS each invent their own    | One `users` table with foreign-key references        |
| `getStaffPRTickets` returns *every* row, slow at scale| SQL with proper indexes                              |
| Google Drive image URLs blocked for embedding         | Supabase Storage public URLs work in `<img>` directly|
| Apps Script request size / time limits                | Postgres has no such constraints                     |
| No real auth state on the backend                     | RLS (row-level security) gates every read/write      |
| Hard to script schema changes                         | Versioned SQL migrations                             |

## Pre-migration prerequisites

1. **Decide what migrates** — out of scope for v1 likely: Discord
   webhooks (Supabase Edge Functions can call them), file uploads
   currently on Drive (re-host on Supabase Storage).
2. **Lock the production schema.** Confirm with stakeholders what
   columns must survive — don't migrate stale columns.
3. **Backup everything.** Export each sheet as CSV via File → Download →
   Comma-separated values. Store the CSVs in a private folder.

## Step 1 — Stand up Supabase

```bash
# Free tier, no credit card.
# Create a new project at https://supabase.com/dashboard
# Region: choose Singapore (closest to KKU).
```

Note the **project URL** and **anon public key** from Settings → API.

## Step 2 — Define the schema

In Supabase SQL editor, create the tables:

```sql
-- Single user identity. Supabase Auth provides auth.users; we
-- mirror profile data here for app-specific fields.
create table public.users (
  id              uuid primary key references auth.users(id),
  email           text unique,
  display_name    text not null,
  role            text not null default 'user'
                  check (role in ('user', 'pr_staff', 'vs_staff', 'dev')),
  department      text,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz
);

create table public.announcements (
  id              bigserial primary key,
  title           text not null,
  content         text not null,        -- HTML from Quill
  department      text not null,
  thumbnail_url   text,
  status          text not null default 'approved',
  created_by      uuid references public.users(id),
  created_at      timestamptz not null default now()
);

create table public.pr_tickets (
  id              text primary key,     -- "PR-XXXXXX" matches current scheme
  submitter_id    uuid references public.users(id),
  department      text not null,
  contact         text,
  content_name    text not null,
  job_type        text,
  platforms       text[],
  posting_channel text,
  publish_at      timestamptz,
  is_rush         boolean default false,
  rush_reason     text,
  brief           text,
  caption         text,
  file_urls       text[],
  silent_notify   boolean default false,
  project_account text,
  copost_with     text,
  status          text not null default 'รอ PR รับเรื่อง',
  remarks         jsonb default '[]'::jsonb,
  assignees       text[] default '{}',
  other_platforms text[],
  other_platform_reason text,
  created_at      timestamptz not null default now()
);

create table public.vs_tickets (
  id              text primary key,     -- "VS-XXXXXX"
  submitter_id    uuid references public.users(id),
  display_name    text,                 -- nullable for anonymous reports
  year            text,
  problem         text not null,        -- HTML from Quill
  target_dept     text not null,
  requested_dept  text,
  status          text not null default 'รอ SE รับเรื่อง',
  is_emergency    boolean default false,
  remarks         jsonb default '[]'::jsonb,
  created_at      timestamptz not null default now()
);
```

Add **RLS policies**:

```sql
alter table public.users enable row level security;
alter table public.announcements enable row level security;
alter table public.pr_tickets enable row level security;
alter table public.vs_tickets enable row level security;

-- Anyone authenticated can read announcements.
create policy "announcements: read" on public.announcements
  for select using (true);

-- Only pr_staff/dev can write announcements.
create policy "announcements: write" on public.announcements
  for all using (
    exists (select 1 from public.users u
            where u.id = auth.uid()
              and u.role in ('pr_staff', 'dev'))
  );

-- PR tickets: submitters see their own; pr_staff/dev see all.
create policy "pr_tickets: read own" on public.pr_tickets
  for select using (
    submitter_id = auth.uid()
    or exists (select 1 from public.users u
               where u.id = auth.uid()
                 and u.role in ('pr_staff', 'dev'))
  );

-- (Similar policies for vs_tickets — VS staff sees own role's tickets.)
```

## Step 3 — Migrate data

Export current sheet data as CSV (one CSV per sheet). Transform with a
local Python/Node script — match each existing row to a `users` row
(create new users when not found), then `psql \copy` the rows in.

Sketch:

```python
# migrate.py
import csv, uuid, psycopg2
conn = psycopg2.connect(SUPABASE_DB_URL)
cur = conn.cursor()

users = {}  # identifier -> uuid

def ensure_user(identifier, display_name, method='password'):
    if identifier in users: return users[identifier]
    uid = uuid.uuid4()
    cur.execute(
        "insert into users (id, display_name, role) values (%s, %s, %s)",
        (uid, display_name, 'user'))
    users[identifier] = uid
    return uid

with open('Submissions.csv') as f:
    for row in csv.DictReader(f):
        submitter = row['submitterEmail'] or 'guest@unknown'
        uid = ensure_user(submitter, submitter)
        cur.execute("""insert into pr_tickets
            (id, submitter_id, department, content_name, ...)
            values (%s, %s, %s, %s, ...)""", (...))

conn.commit()
```

**Critical:** test the migration against a **copy** of the prod sheets
first. Run it twice (idempotency check). Verify counts match.

## Step 4 — Rewrite frontend data layer

Add `@supabase/supabase-js`:

```bash
npm install @supabase/supabase-js
```

Replace `GAS_API_URL` / `GAS_VITAL_SOUND_URL` in `config.js` with a
Supabase client:

```js
// src/js/db.js
import { createClient } from '@supabase/supabase-js';
export const db = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

Each module's `fetch(GAS_*, ...)` call gets replaced with the equivalent
Supabase call. Auth becomes:

```js
// auth.js
db.auth.signInWithPassword({ email, password });
db.auth.signInWithIdToken({ provider: 'google', token: googleJWT });
```

This is mechanical but tedious — budget ~3 days.

## Step 5 — File storage

Move from the `uploadPRFile` GAS action to Supabase Storage:

```js
const { data, error } = await db.storage
  .from('pr-uploads')
  .upload(`${ticketId}/${file.name}`, file);
const publicUrl = db.storage.from('pr-uploads').getPublicUrl(data.path).data.publicUrl;
```

Existing Drive URLs in the migrated `pr_tickets.file_urls` stay valid
during the cutover (they're public links), but plan a one-time job to
copy historical files into Supabase Storage if you want to fully retire
the Drive folder.

## Step 6 — Discord webhooks via Edge Functions

The current `sendDiscordNotification` runs inside Apps Script. Port to a
Supabase Edge Function (Deno):

```ts
// supabase/functions/notify-discord/index.ts
Deno.serve(async (req) => {
  const { webhook_url, payload } = await req.json();
  await fetch(webhook_url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return new Response('ok');
});
```

Trigger from a Postgres trigger on `pr_tickets` insert.

## Step 7 — Cutover

This is the most sensitive step. Order matters:

1. **Freeze writes** to the production GAS (display a maintenance banner
   on the live site).
2. Run the migration script against the frozen sheets.
3. Spot-check: random sample of 10 PR tickets and 10 VS tickets — do
   they appear in Supabase with the right submitter, content, status?
4. Flip Cloudflare Pages env vars (`VITE_SUPABASE_*`) for the production
   environment and trigger a redeploy.
5. Unfreeze the site.
6. **Keep the old sheets read-only for 30 days** — they're your rollback.

## Rollback

If something blows up after cutover:

1. Revert the Cloudflare env vars to the GAS URLs.
2. Trigger a redeploy.
3. Restore the GAS deployment.

Any data written to Supabase during the broken window is lost from the
prod perspective, but recoverable manually from Supabase if needed.

## Out of scope (for this migration)

- Analytics / reporting dashboards on the new schema
- Per-department permission granularity (currently single `role` field)
- Bot user that posts the Discord notifications under a stable identity

---

## Phase tracker (current implementation status)

### ✅ Phase 1 — Foundation (done in this branch)

- `@supabase/supabase-js` + `dotenv` installed
- `src/js/db.js` shared client; reads `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
- `.env.example` documents required env vars
- `supabase/migrations/0001_initial_schema.sql` — full schema:
  - `users` (linked to `auth.users` via trigger)
  - `announcements` + `pr_tickets` + `vs_tickets` + `pr_agents`
  - RLS policies on every table
  - Role helper functions
- `supabase/migrations/0002_seed_staff_accounts.sql` — reserved staff usernames table
- `tools/migrate-from-sheets.mjs` (`npm run migrate`) — idempotent CSV→Supabase import
- `src/js/auth.js` rewritten on top of Supabase Auth (Google + password)
- `src/js/announcements.js` reads/writes via Supabase
- PR submitter identifier (`pr-tracking.js`, form auth) sourced from
  unified auth state

### ✅ Phase 2 — PR data layer (done)

All PR data calls now go to Supabase. GAS only fires Discord webhooks.

- `src/js/pr-form.js` — submit writes via `db.from('pr_tickets').insert(...)`.
  Generates the `PR-XXXXXX` ID client-side. After insert succeeds, fires
  a fire-and-forget POST to GAS `notifyPROnly` so the team still gets
  Discord pings.
- `src/js/pr-tracking.js` — `trackPRTicket`, `loadPRHistory`,
  `refreshPRTicketDashboard` all read from `pr_tickets`. New `rowToTicket`
  helper maps DB columns to the legacy camelCase shape the renderers
  expect, so no UI code had to change.
- `src/js/pr-staff.js` — kanban fetches via `pr_tickets.select`. Updates
  + deletes via `.update()` / `.delete()`. Now <200ms instead of multi-
  second GAS roundtrip. Agents list in `pr_agents`.
- `appscript/prform.gs` — new `notifyPROnly` action does just the
  Discord webhook (no sheet writes). Old `submitPR` etc. still exist
  for back-compat / prod use but the frontend doesn't call them.

### ✅ Phase 3 — VS data layer (done)

All VS data calls now go to Supabase; GAS only fires Discord webhooks.

- `src/js/vs-form.js handleVsFormSubmit` — inserts into `vs_tickets`.
  Ticket ID generated client-side. Submitter linked via `submitter_id`
  (auth.uid) and `submitter_label` (denormalized identifier for legacy
  matching). SE routing logic preserved.
- `src/js/vs-tracking.js` — `trackWithTicketId`, `loginToViewHistory`,
  `submitUserRemark` use `db.from('vs_tickets')`. History lookup matches
  by submitter_id OR submitter_label so it works for both new tickets
  and migrated legacy rows.
- `src/js/vs-staff.js` — `fetchStaffTickets` filters by role:
  SE sees `target_dept = 'SE'`; aupanayoks see tickets routed to their
  exact dept name. `submitStaffAction` merges remarks and updates
  status/dept via Supabase; Discord notify via GAS thin proxy.
- `appscript/vssound.gs` — new `notifyVSOnly` and `notifyVSConsult`
  actions fire webhooks only (no sheet writes).

### ✅ Phase 4 — File storage (Drive by design)

We chose to **keep file uploads on Google Drive** instead of moving to
Supabase Storage. Reason: Drive gives 2 TB on the personal account that
owns the GAS, vs. 1 GB free on Supabase Storage. For image-heavy PR
submissions and announcement covers, Drive is the right fit.

- `src/js/uploads.js uploadImageToDrive` continues to use GAS
  `uploadPRFile`. Returns the Drive thumbnail URL (`drive.google.com/
  thumbnail?id=...`) which embeds directly in `<img>`.
- `convertDriveUrl` normalizes any Drive URL form (viewer page, `uc?id`)
  to the thumbnail form so embeds always work.
- **This is the only thing the GAS deployment is still used for.**
  Every other action in `prform.gs` / `vssound.gs` exists for back-compat
  but the frontend doesn't call them.

### ⏳ Phase 5 — Discord notifications (abstracted; running on GAS)

- `src/js/notify.js` — single `sendNotify(system, payload)` helper.
  Every notification call site (`pr-form.js`, `vs-form.js`,
  `vs-staff.js`) routes through this. Backend swap = change one file.
- Currently routes to the GAS endpoints (`notifyPROnly`, `notifyVSOnly`,
  `notifyVSConsult`) defined in `appscript/*.gs`.
- `supabase/functions/notify-pr/` and `notify-vs/` exist (Deno code +
  CORS/error handling), but are currently returning 502 in our project.
  Likely Supabase Edge Runtime version mismatch; needs more diagnosis.
  When fixed, `notify.js` swaps GAS URLs for `db.functions.invoke()`.

#### Deploying the Edge Functions

```bash
# One-time setup (per machine)
npm install -g supabase
supabase login                       # opens browser
supabase link --project-ref fheueuowbchsnsvbcgil

# Set the secrets
supabase secrets set \
  PR_DISCORD_WEBHOOK_URL='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_SE='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_ADMIN='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_DIGITAL='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_INTERNAL='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_EXTERNAL='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_UNIVERSITY='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_ACADEMIC='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_STRATEGY='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_QUALITY='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_MEDIA='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_RADIOLOGY='https://discordapp.com/api/webhooks/...' \
  VS_WEBHOOK_DEFAULT='https://discordapp.com/api/webhooks/...'

# Deploy
supabase functions deploy notify-pr --no-verify-jwt
supabase functions deploy notify-vs --no-verify-jwt
```

The webhook URLs are the same ones currently hardcoded in `prform.gs`
`DISCORD_WEBHOOK_URL` and `vssound.gs` `WEBHOOK_MAP`. Copy them over
to Supabase secrets.

After deploy: test by submitting a PR ticket and a VS ticket; pings
should arrive in the matching Discord channels.

---

## Quick-start for setting up Supabase (Phase 1)

1. Create a new project at https://supabase.com/dashboard (free tier).
   Region: Singapore.
2. Settings → API → copy:
   - **Project URL** → paste into `.env.local` as `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`
   - **service_role secret** → `SUPABASE_SERVICE_ROLE_KEY` (used only by
     `npm run migrate`, never exposed to the browser)
3. SQL Editor → paste `supabase/migrations/0001_initial_schema.sql` →
   Run. Then `0002_seed_staff_accounts.sql` → Run.
4. Authentication → Providers → enable **Google** (use your existing
   Google Cloud OAuth credentials).
5. Authentication → URL Configuration → add your Cloudflare Pages preview
   URL + production URL to "Site URL" and "Redirect URLs".
6. Place CSV exports of the prod sheets into `sheetexample/` (gitignored)
   and run `npm run migrate`.
7. `npm run dev` → test sign-in (Google + password) and announcement
   create/edit. PR + VS still hit GAS — that's expected for Phase 1.

