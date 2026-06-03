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
  │     ↳ projects / project_documents / project_files / project_notifications
  │     ↳ gated by RLS policies (see schema below)
  │
  ├─→ Supabase Auth /auth/v1/*               ── sign in / out / refresh
  │     ↳ Google OAuth + email/password (synthetic emails)
  │
  └─→ GAS /exec (legacy proxy)               ── narrow & specific
        ↳ uploadPRFile        → writes to Google Drive (PR_Submissions/)
        ↳ uploadShopFile      → writes to Drive at SAMO_Shop/<nested path>
        ↳ uploadProjectFile   → writes to Drive at Projects/<nested path>
        ↳ notifyPROnly        → fires Discord webhook (PR team)
        ↳ notifyVSOnly / notifyVSConsult → fires Discord webhooks (per dept)
        ↳ notifyProjectEmail  → MailApp.sendEmail to uni_staff
        ↳ notifyProjectDiscord → fires SAMO admin Discord webhook
                                  (URL in Script Property PROJECT_DISCORD_WEBHOOK_URL)
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
├── utils.js             ─ formatThaiDate, renderTimeline, decodeJwtResponse,
│                          escHtml, safeUrl
└── shop/                ─ SAMO Shop feature (browse, cart, checkout, orders,
    │                       admin). Lazy-loads its data on first tab-show.
    ├── index.js          ─ initShop() entry; sub-nav, FAB, auth subscriber
    ├── data.js           ─ SHOP_SOURCES / SHOP_TYPES / STAGES_*; thb, fmtDate
    ├── api.js            ─ dbRest CRUD: products, orders+items, batches, settings
    ├── state.js          ─ cart store (localStorage), subscribers
    ├── uploads.js        ─ uploadShopFile(file, folderPath) — Drive via GAS
    ├── products.js       ─ browse grid, filter bar, launch strip, detail modal
    ├── cart.js           ─ offcanvas cart drawer + floating FAB
    ├── checkout.js       ─ checkout panel, slip upload, place-order
    ├── orders.js         ─ "My Orders" timeline, status filter, pickup callout
    └── admin.js          ─ orders table, slip-verify queue, batches CRUD,
                            product CRUD, QR settings (mounts into tab-admin)

└── projects/            ─ Project / document tracking workflow (vp_admin →
    │                       uni_staff). Lazy-loaded on first tab-show.
    ├── index.js          ─ initProjects(); role gating; sub-nav; hash routing
    ├── data.js           ─ statuses, formatters, id generators, Drive paths
    ├── api.js            ─ dbRest CRUD: projects, documents, files,
    │                       notifications, settings, doc types
    ├── uploads.js        ─ uploadProjectFile(file, folderPath) via GAS
    ├── notify.js         ─ fan-out: in-app row + email (uni) + Discord (vp)
    ├── send.js           ─ VP-Admin create-project / send-document modal
    ├── inbox.js          ─ 2-pane list + detail panel; per-doc actions,
    │                       file replace (non-destructive supersede chain)
    ├── manage.js         ─ doc type lookup CRUD + settings (recipient
    │                       email, notification preferences)
    └── notifications.js  ─ navbar bell + offcanvas drawer, polling

src/html/                ─ Vite HTML partials. index.html includes them.
src/css/                 ─ Bootstrap + brand vars in base.css + topic CSS files.
```

---

## Supabase schema (canonical: `supabase/migrations/0001_initial_schema.sql`)

Tables, condensed:

```
users (uuid id PK, email, username, display_name, method, role, department,
       permissions, has_password, phone, created_at, last_seen_at)
  ↳ FK to auth.users (cascade delete)
  ↳ phone (mig 0036): self-set contact phone; autofills samoshop checkout.
    Self-writable (NOT a privileged column per the 0028 self-update guard).
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
  ↳ Lists samomdkkupr / samomdkkuvssound / samomdkkushop / samomdkkudev
    for the migrator. Role check allows pr_staff, vs_staff, shop_admin, dev.
```

### SAMO Shop (canonical: `0003_samoshop_schema.sql`, `0004_seed_shop_admin.sql`)

```
shop_products (text id PK, name, sub, description, type, source,
               price, sizes text[], colors jsonb, fits text[],
               hue, image_url, is_new, is_presale, presale_note,
               popularity, is_active, stock_matrix jsonb,
               added_at, created_by FK users(id), updated_at)
  ↳ source IN ('project','fund','rt','mdi','merch')

shop_orders (text id PK ["<CODE>NNNN"], buyer_id FK users(id) [null=admin-created],
             buyer_label, buyer_name, buyer_email, buyer_phone, status,
             subtotal, fee, total, is_preorder [any item preorder@buy-time],
             slip_url [=latest], slips jsonb [{url,at}…], slip_uploaded_at,
             pickup_location, pickup_batch_id FK shop_pickup_batches(id),
             buyer_note, admin_note, cancel_reason,
             timeline jsonb, placed_at, updated_at)
  ↳ status (PAYMENT phase) IN ('pending','review','paid', +cancel/refund_pending/
    refunded/slip_mismatch/no_show + legacy produce/ready/done/exchange)

shop_order_items (bigserial id PK, order_id FK shop_orders(id) CASCADE,
                  product_id FK shop_products(id) RESTRICT,
                  size, color, fit, qty, unit_price,
                  item_status, item_timeline jsonb, is_preorder)
  ↳ item_status (FULFILMENT phase) IN ('paid','produce','ready','done',
    'exchange','no_show'); is_preorder = frozen is_presale snapshot @ buy-time

shop_banners (uuid id PK, image_url, caption, link_url, display_order,
              is_active, placement, created_at)   [mig 0019, 0037]
  ↳ placement IN ('launch','announcement'), default 'launch'. Drives two
    customer swipe carousels (เปิดตัวล่าสุด / ประกาศ) off one admin UI;
    display_order is scoped per-placement. RLS: public read, shop-admin write.
```

**Hybrid order model (migrations 0033–0035).** The order's `status` carries
only the PAYMENT phase; once paid, each line item carries its own
fulfilment `item_status` so products in one order progress independently.
The overall display stage is a JS rollup (`rollupOrderStage` in
`src/js/shop/data.js` — least-progressed item). `place_shop_order(...)`
(0034, SECURITY DEFINER) stamps per-item `is_preorder` + seeds
`item_status`, validates stock atomically under a row lock, and persists
`buyer_phone` + `slips`. `apply_product_production_status` (stock tab) and
the order→paid trigger cascade to `item_status`, not the whole order.
Reserved-stock aggregates (`shop_reserved_matrix_all`) count at the item
level (an item stops reserving once `item_status='done'`).
```

shop_pickup_batches (bigserial id PK, title, product_ids text[],
                     location, dates text[], hours, note,
                     contact_gmail, contact_instagram, is_active,
                     created_by FK users(id), created_at, updated_at)

shop_settings (id integer PK = 1 [single-row config], promptpay_name,
               promptpay_id, promptpay_qr_url, instructions,
               contact_gmail, contact_instagram, updated_at)
```

Also: `users.role` check constraint expanded to admit `shop_admin`.
Helper `public.current_user_is_shop_admin()` returns true for
`shop_admin` or `dev`.

### Project tracking (canonical: `0005_project_tracking_schema.sql`, `0006_seed_project_accounts.sql`)

Workflow: SAMO VP-Administration sends "หนังสือโครงการ" containing one or
more documents to a designated university officer ("พี่นิค"). Each document
has N attached files (Word / PDF / etc.) and an independent status; documents
within the same project may be sent days/weeks apart.

```
project_doc_types (text id PK, label_th, sort_order, is_active)
  ↳ seeded with 4 entries — admin can add more in-app
  ↳ types: หนังสือโครงการ / หนังสือเชิญอาจารย์ /
           หนังสือขอความอนุเคราะห์ sponsor / หนังสืออื่นๆ

projects (text id PK ["PRJ-YYMM-NNNN"], name, description, status,
          created_by, timestamps)
  ↳ status IN ('open','in_progress','completed','cancelled')

project_documents (text id PK ["DOC-YYMMDD-HHMM-XXXX"],
                   project_id FK projects(id) CASCADE,
                   type_id FK project_doc_types(id),
                   title, note, sequence_no, status, return_reason,
                   sent_at, received_at, completed_at,
                   timeline jsonb, drive_folder, created_by, timestamps)
  ↳ status IN ('draft','sent','received','in_progress','returned',
               'completed','cancelled')
  ↳ unique(project_id, sequence_no) → "หนังสือ 1 / 2 / 3" per project

project_files (bigserial id PK, document_id FK CASCADE,
               file_name, drive_file_id, drive_view_url, mime_type,
               size_bytes, uploaded_by, uploaded_at,
               superseded_by FK project_files(id))
  ↳ replace = insert new + set superseded_by on old (non-destructive)

project_notifications (bigserial id PK, user_id FK users(id) CASCADE,
                       project_id, document_id, kind, body,
                       is_read, created_at)
  ↳ kind: 'sent','received','status','returned','comment',
          'file_replaced','completed'

project_settings (singleton id=1, uni_staff_email, uni_staff_label,
                  vp_admin_label, notify_uni_in_app, notify_uni_email,
                  notify_vp_in_app, notify_vp_discord, updated_at)
```

Roles: `users.role` CHECK expanded to admit `vp_admin` (SAMO sender) and
`uni_staff` (university officer receiver). `reserved_staff_usernames` seeds
`samomdkkuvpa` (vp_admin) + `sastaff` (uni_staff). Helper
`public.current_user_is_project_actor()` returns true for `vp_admin`,
`uni_staff`, or `dev`.

RLS: all six tables are gated to project actors. Both vp_admin and
uni_staff can SELECT + UPDATE projects + documents + files (the workflow
needs two-way writes); only vp_admin/dev can INSERT projects/documents
or DELETE. Notifications are scoped to `user_id = auth.uid()` for
read/update. `project_settings` write is vp_admin/dev only.

**Customer-mirror addendum (migration 0032).** Five tables —
`projects`, `project_documents`, `project_files`,
`project_doc_types`, `project_settings` — additionally carry a
`*_read_public` policy `for select to anon, authenticated using (true)`
so the public `/projects-view` read-only mirror works for anonymous
visitors. Policies OR-combine so the actor-gated `*_read` policies
keep working for signed-in staff. Writes are untouched — still
gated to vp_admin / uni_staff. `project_notifications` and
`project_doc_views` are intentionally NOT publicised (they're per-
user state). Customer mode in the JS module skips notification
mounts and no-ops `markDocSeen` so anonymous viewers never need
identity-keyed state.

Drive layout (lazily created by GAS on first upload):

```
My Drive/Projects/
└── PRJ-2605-0001_<safe-name>/
    └── DOC-260526-1430-XXXX_<type>/
        └── <file>.pdf
```

Allow-listed: `uploadProjectFile` only writes under `Projects/...` and
rejects `..` segments.

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
- **shop_products / shop_pickup_batches**: public SELECT when
  `is_active = true`; admin (shop_admin or dev) full write.
- **shop_orders**: SELECT for buyer (own rows) or admin. INSERT for the
  buyer (`buyer_id = auth.uid()`) OR admin (0035 — walk-in/phone orders,
  buyer_id null). UPDATE allowed for admin always; allowed for buyer only
  while status is `pending` / `review` / `slip_mismatch` (slip add/remove).
  DELETE admin-only.
- **shop_order_items**: read/insert piggy-back on parent order's policy.
- **shop_settings**: public SELECT (so checkout can show the QR); admin
  write only.

Helper SQL functions: `current_user_role()`, `current_user_is_staff()`
(both `security definer set search_path = public`); plus
`current_user_is_shop_admin()` added in 0003.

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
- **Staff seeding**: done. The three reserved usernames
  (`samomdkkupr`, `samomdkkuvssound`, `samomdkkudev`) were created via
  `admin.auth.admin.createUser` during the one-time Sheets cutover. If
  another staff seat ever needs to be added: do it from the Supabase
  dashboard (Auth → Users), then `INSERT` the matching row into
  `public.users` with the right role.

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

- `prform` — owns the `PR_Submissions` Drive folder + PR-team Discord webhook +
  the SAMO Shop Drive tree (`SAMO_Shop/Slips/...`, `SAMO_Shop/Products/...`,
  `SAMO_Shop/QR/`). Add a new file-upload destination by passing a new
  `folderPath` prefix to `uploadShopFile`.
- `vssound` — owns the per-dept Discord webhook map

Slim source files in `appscript/`. Redeploy procedure in `skills/deploy-gas.md`.

### Drive folder layout (lazily created by GAS on first upload)

```
My Drive/
├── PR_Submissions/                ← PR ticket attachments (uploadPRFile)
└── SAMO_Shop/                     ← Shop assets (uploadShopFile)
    ├── Slips/
    │   └── YYYY-MM/               ← monthly partition: keeps any one folder
    │                                  well under Drive's per-folder cap
    │       └── <buyerId>_<ts>.jpg
    ├── Products/
    │   └── <productId>/
    │       └── <name>_<ts>.jpg
    └── QR/
        └── promptpay_<ts>.png     ← admin-uploaded PromptPay scan
```

`uploadShopFile` is allow-listed: it only writes under `SAMO_Shop/...` and
rejects `..` segments. Folders are created lazily on first write.

### Supabase project

- Region: Southeast Asia (Singapore)
- Free tier (1 GB DB + 1 GB storage — we use Drive for files instead)
- Auth providers enabled: Email (synthetic), Google OAuth
- URL Configuration must include both Cloudflare URLs + localhost
- Migrations applied: `supabase/migrations/0001_initial_schema.sql` +
  `0002_seed_staff_accounts.sql` +
  `0003_samoshop_schema.sql` + `0004_seed_shop_admin.sql` +
  `0005_project_tracking_schema.sql` + `0006_seed_project_accounts.sql`

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

## Developer workflows

### The frontend ↔ backend boundary

There are three boundaries the SPA crosses, in descending order of frequency:

1. **PostgREST (Supabase)** — almost all reads/writes. Auth is automatic via
   the `sb-<project-ref>-auth-token` cookie/localStorage entry. Either use
   the supabase-js client (`db.from('table')...`) OR the raw-fetch helper
   `dbRest('/table?...')` from `src/js/db.js`. Prefer `dbRest()` for any
   hot path — supabase-js has known intermittent hang modes
   (see `.claude/rules/mistakes.md`).
2. **Supabase Auth** — `db.auth.signInWithOAuth({ provider: 'google' })` for
   Google, `db.auth.signInWithPassword({ email, password })` for username
   accounts. `db.auth.onAuthStateChange()` callbacks MUST wrap their body
   in `setTimeout(() => ..., 0)` to escape the GoTrue lock deadlock (issue
   #762). Don't touch this without reading mistakes.md.
3. **GAS `/exec`** — only for `uploadPRFile` (Drive upload) and the three
   Discord-notify actions. Always `fetch(url, { keepalive: true, ... })` —
   do NOT use `sendBeacon` (doesn't follow GAS's mandatory 302 redirect).

### State management

There is no state framework. Pattern:

- **Auth state** lives in `src/js/auth.js` as a module-scoped `currentUser`.
  Subscribe via `subscribeToAuth(callback)`. Callbacks fire on real
  transitions (sign in, sign out) AND on token refresh — gate any UI
  side-effects (e.g. `showAdminLanding`) behind a `prevAuthKey !== nextKey`
  check, otherwise the kanban will reset on every token refresh.
- **Form state** lives in the DOM (`<input>` `.value`). Hidden inputs are
  re-populated from `authGetUser()` after every `form.reset()` because
  reset clears them too (see mistakes.md).
- **Tab state** is Bootstrap's. We listen for `shown.bs.tab` to close
  parent dropdowns that Bootstrap left open.
- **Server state** is fetched on-demand per panel. No client cache. The
  kanban / dashboards refetch on every open. Reads are fast enough at our
  scale (low hundreds of rows) that caching isn't justified.

### Testing locally

There is no automated test suite. The reproducible smoke tests in `STATE.md`
are the regression bar — exercise them after any auth, network, or form
change.

**Mocking external services:**

- **Supabase**: we don't mock it. Use the real dev project (same as prod
  currently — there's no separate dev branch). Sign in with a throwaway
  password account. The migration script is idempotent; you can wipe a
  table and re-seed from the CSVs.
- **Discord webhooks**: don't fire them during dev. Either:
  - Toggle the `silent_notify` flag on the PR form (dev-role only), OR
  - Temporarily point `GAS_API_URL` in `src/js/config.js` at a no-op GAS
    deployment, OR
  - Point the Apps Script `DISCORD_WEBHOOK_URL` Script Property at a private
    test channel and redeploy.
- **Drive uploads**: same project as prod. Files go into `PR_Submissions/`
  in the GAS owner's Drive. Test files accumulate there — clean up
  periodically.

There is no record-and-replay or local Apps Script emulator. The lowest-cost
loop is a real submit against the real backend with a `_test_` prefix in
the content.

### When you suspect supabase-js is hanging

Switch to `dbRest()`. It's a raw-fetch + AbortController wrapper against
PostgREST with the same auth headers supabase-js sends. Used today by
`pr-form.js`, `vs-form.js`, `pr-tracking.js`, `announcements.js`.

```js
import { dbRest } from './db.js';
const rows = await dbRest('/pr_tickets?id=eq.PR-XYZ123&select=*');
```

If the symptom is "hangs only after sign-in", check `auth.js` —
`onAuthStateChange` body must be inside `setTimeout(() => ..., 0)`.

### When you change the schema

1. Add a new numbered file under `supabase/migrations/` (e.g.
   `0003_add_priority_column.sql`). Don't edit `0001_*` in place.
2. Apply it via the Supabase SQL editor (or Supabase CLI if you have it
   wired).
3. Update the Tables section of `docs/CONTEXT.md` and the RLS section if
   policies changed.
4. If the change is breaking (column rename, type change), update affected
   queries in `src/js/*.js` and audit `dbRest()` paths.

### When you add a new department or role

- Departments are enumerated in `src/css/base.css` as `--dept-*` variables.
  Add the new key there for color theming.
- Department keys are referenced as strings in form `<option>` values and
  in `pr_tickets.department` / `vs_tickets.requested_dept`. There is no
  enum on the DB side — strings are free-form.
- Roles are in `users.role` (CHECK constraint). Adding a role requires a
  migration to extend the CHECK constraint AND updating
  `current_user_is_staff()` / RLS policies that reference roles.

---

## When this doc goes stale

It WILL drift. Trust the code over this doc when they disagree:

- Authoritative schema: `supabase/migrations/0001_initial_schema.sql`
- Authoritative auth flow: `src/js/auth.js`
- Authoritative deploy config: Cloudflare Pages dashboard +
  `appscript/*.gs` deployment dropdowns
