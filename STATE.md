# STATE — current task & latest known state

Last updated: 2026-07-21. Slim by design — "what is true right now",
not a project diary. Session narratives live in `git log`; architecture
in `docs/CONTEXT.md`; bug post-mortems in `.claude/rules/mistakes.md`.

## PROJECTS: ปีงบประมาณ (Thai fiscal year) filter on หนังสือโครงการ — DEPLOYED (2026-07-22)

The หนังสือโครงการ grid toolbar gained a **ปีงบประมาณ dropdown** (`#projectsFiscalYear`
in `tab-projects.html`). Thai budget year = 1 ต.ค. – 30 ก.ย., named for the year it ENDS
in (ปีงบ 2569 = 1 ต.ค. 2568 → 30 ก.ย. 2569), so Oct–Dec roll into the next BE year —
`fiscalYearBE()` in `inbox.js` encodes exactly that (`getFullYear()+543 + (month>=9?1:0)`,
viewer-local calendar; audience is ICT). Options are **data-driven** from the fiscal years
present (newest first) + ทุกปีงบ, so the list self-extends each budget year. FY is the
**OUTERMOST filter** — both the chip counts and the grid read the same
`projectsInSelectedFY()` base (keyed on project `created_at`), so a year with 0 "ของฉัน"
reads as cleared, not empty; a selected year with no projects shows a dedicated empty state.
Filter is session-only (not persisted). Code: `src/js/projects/inbox.js`,
`src/html/tab-projects.html`, `src/css/projects.css` (`.projects-fy-filter`).

**Deployed to prod VM (2026-07-22):** `main` ff to `3a72491`, rsync → `/var/www/samo-web`,
nginx reloaded; `/admin/` 200. Both branches in sync at `3a72491`. Client-only, no
migration. Follow-up fix `3a72491`: the ปีงบ `<select>` used `flex:0 1 auto` so on the
narrower iPad toolbar it shrank below its content width and the label ran under Bootstrap's
chevron — pinned `flex-shrink:0` + `min-width` (`.projects-fy-filter`).

## SHOP ADMIN: แหล่งที่มา (source) order filter + per-user default (2026-07-22)

Admin คำสั่งซื้อ page gained a **แหล่งที่มา (owning-dept) facet** — item-level, same
faceted pattern as the other filters (an order shows iff it has ≥1 item of a selected
source; matching item rows only). Each order row now shows a colored source dot+label.
Filtering keys off `itemSource(it)` = frozen `product_source` (0058) → live product
fallback (in `visibleOrderItems` + `itemPassesExcept`; CSV export aligned to the frozen
source too). Each admin can pin their **current source selection as a personal default**
(dropdown footer "ตั้งเป็นค่าเริ่มต้นของฉัน" / clear) — persisted in **localStorage keyed by
user id** (`samoshop.admin.orderSourceDefault.<uid>`). Applied **once per user id**
(`applySourceDefaultOnce` / `sourceDefaultAppliedUid`) — defers until getUser() resolves
and RE-applies on account-switch (no reload), a no-op on repeat calls for the same user so
manual tweaks are preserved. So MDI can default to MDI-only, MD to MD, anyone to all/any
combo. Per-device (not cross-device) by design — no migration. Code: `src/js/shop/admin.js`,
`src/html/tab-admin.html` (แหล่งที่มา dropdown).

**Deploy status:** DEPLOYED TO PROD VM (2026-07-22). `main` fast-forwarded to `38fee93`
and pushed; VM (`samo.md.kku.ac.th`) pulled → `npm ci && npm run build` → rsync `dist/` →
`/var/www/samo-web` → nginx reloaded (build `ddba5406e665`). Smoke tests: `/`, `/admin/`,
`/notify`, `/passport/` all 200; served `build.json` matches. The 0058 DB migration + the
`samomdkkumdi` samoshop grant were already live on the shared Supabase DB. Both branches
in sync at `38fee93`.

## SHOP MULTI-DEPARTMENT: migration 0058 APPLIED (2026-07-22)

MDI now co-manages the shop alongside MD (more departments possible later).
Chosen model = **A (shared shop, trust-based)**: `shop_products.source` is the
OWNERSHIP KEY (department that owns/fulfils a product); `mdi` is already a valid
`source`; per-product `promptpay_qr_id` + `pickup_location_id` (0057) already route
money + logistics per department. Access control stays **global** (any `shop_admin`
sees everything) — fine for a few trusting teams. **Operational onboarding = data
only, no code**: create MDI's `shop_promptpay_qrs` row + `shop_pickup_locations`
row, grant the MDI operator `shop_admin`, tag their products `source='mdi'`.

`supabase/migrations/0058_shop_order_item_source.sql` — **APPLIED to live DB**
(verified: col + trigger present, all 7 existing items backfilled, 0 nulls). Freezes
`shop_products.source` onto `shop_order_items.product_source` at insert via a
SECURITY DEFINER `before insert` trigger (`shop_order_item_stamp_source`) that
ALWAYS overrides the client value (unspoofable) — same freeze pattern as `unit_price`.
This is the ONLY groundwork needed so a future **Model B** (per-department scoping:
a `shop_admin` writes/sees only their own `source`) is an additive RLS change with
**no data backfill** — a mixed-department cart must filter order ITEMS not whole
orders, so the item needs its owner frozen on it. Deliberately did NOT build Model B
now (YAGNI for 2 trusting teams). Model B, when needed: add `current_user_shop_dept()`
(security-definer helper, mirror `current_user_dept()` 0016) + scope the write policy
`AND source = current_user_shop_dept()` with a super-admin bypass + admin-UI source filter.

**Shop admin identity (live, confirmed 2026-07-22):**
- **Cross-dept SUPER-admins** = `dev` role (`samomdkkudev`, `samomdkkupresident`) +
  **VPA** (the `vp_admin` account, dept `อุปนายกฝ่ายบริหารองค์กร`; already carries
  `permissions=['projects','samoshop']`). Under Model A these already see everything.
- **MD operator** = `samomdkkushop` (`role=shop_admin`, global).
- **MDI** = `samomdkkumdi` (`vp_admin`, dept `อุปนายกฝ่ายเวชนิทัศน์`) — **GRANTED
  `'samoshop'` 2026-07-22** (`permissions=['samoshop']`, `has_shop=true`); now a
  (global, Model A) shop admin. The grant tripped `users_self_update_guard` on a
  plain UPDATE, so it was done by disabling the guard for one atomic tx via
  `apply-migration.mjs` (superuser) — see the mistakes.md service-role-seed entry's
  "existing row with FK dependents" method. Guard verified re-enabled after.
  Still needs (optional): MDI's own `shop_promptpay_qrs` + `shop_pickup_locations`
  rows so their products route money/pickup separately (data entry via admin UI).
- **Model B super-admin marker:** don't hardcode the VPA username (it's actually NULL)
  or dept string (anti-pattern — see mistakes-archive reserved-username-list entry).
  Add a `'samoshop_super'` permission; super = `role='dev' OR has_permission('samoshop_super')`.
  Grant VPA `'samoshop_super'` in the same migration (else Model B scopes it down to its
  own product-less dept). `'samoshop'` becomes the dept-scoped operator grant.

## SHOP CATALOG CONFIG: migration 0057 APPLIED + DEPLOYED (2026-07-22)

**Prod (KKU VM) is LIVE at commit `64e0b21`** (build `6642d6445ff5`) — deployed via
ssh (rsync `dist/` → `/var/www/samo-web`, nginx reloaded); `/`, `/admin/`, `/notify`
all 200. VM sudo password now stored in `.env.local` as `SAMO_VM_SUDO_PASSWORD`
(gitignored), piped to `sudo -S` for future deploys — no longer need to prompt.


`supabase/migrations/0057_shop_catalog_config.sql` — **APPLIED to the live DB**
(`fheueuowbchsnsvbcgil`) via `tools/apply-migration.mjs` (Supabase Management API +
a PAT in `.env.local`). Verified: 5 product types seeded, 1 `is_default` QR seeded
from `shop_settings`, both new `shop_products` columns present, RLS live and readable
through the anon key. Re-apply the same file with the tool if it's ever needed elsewhere.
Adds three admin-managed lists that were hardcoded/single-valued:
- `shop_product_types` (was static `SHOP_TYPES`; seeded with the 5 existing types)
- `shop_promptpay_qrs` (per-account PromptPay list; seeds one `is_default` row
  from the current `shop_settings` QR) + `shop_products.promptpay_qr_id`
- `shop_pickup_locations` + `shop_products.pickup_location_id`

Frontend already ships (build + 115 tests green) and degrades gracefully until
the migration lands: `api.js` list helpers warn-once + return `[]` on a missing
table; `upsertProduct` strips the new columns on a 400. Once applied:
- **Checkout is split-by-account** — a cart spanning multiple PromptPay accounts
  renders one QR + slip per account and places **one `shop_orders` row per group**
  (`checkout.js buildGroups`/`resolveQrForProduct`; reuses the single-slip
  pipeline). Per-product pickup shows on the product modal + checkout review.
- Admin: new "ประเภท/สถานที่" sub-tab (types + pickup managers) + QR-list manager
  in the PromptPay tab; product editor gains QR + pickup selects.
Caches live in `data.js` (`getShopTypes`/`getPromptpayQrs`/`getPickupLocations`),
loaded by `index.js loadCatalogConfig` (customer) + `admin.js refreshCatalogConfig`.

## IN FLIGHT: migrating hosting Cloudflare Pages → KKU VM (Supabase Cloud stays) (2026-07-21)

Moving frontend hosting + the Discord notify function onto a KKU VM
(`samo.md.kku.ac.th` → `https://10.101.111.181`, Nginx, behind the KKU
reverse proxy). **Supabase stays on Supabase Cloud** (`fheueuowbchsnsvbcgil`) —
no DB migration. Full runbook: `docs/SELF-HOST.md`.
- The move breaks 3 Cloudflare-only mechanisms unless replicated (they were
  the gap in the first server setup): `/notify` Pages Function, `public/_headers`
  cache policy, `public/_redirects` SPA fallback. All three now have VM
  equivalents in `server/`.
- `server/notify-server.mjs` — Node http server that reuses `functions/notify.js`
  UNCHANGED (same code vitest covers); `functions/package.json` (`type:module`)
  lets `node` import it while the repo root stays CommonJS for Vite. Runs under
  `server/samo-notify.service` (systemd), secrets in `/etc/samo-notify.env`
  (Discord webhooks copied from the old Cloudflare Pages env vars), Nginx
  reverse-proxies `POST /notify` → `127.0.0.1:8787`.
- `server/nginx-samo.conf` — replicates cache headers + fixes `/admin/*`
  fallback (Gemini's config sent admin refreshes to the public app) + passport
  at `/passport/`. `server/deploy.sh` = pull+build+publish+restart.
- **LIVE on the VM (2026-07-21)**: `setup.sh` ran — `samo-notify` service active,
  Nginx on the correct config (`/notify` proxied to `127.0.0.1:8787`, `/admin/`
  fallback fixed, cache headers restored), fresh web build published. Smoke
  tests pass: `/build.json`, `/notify` health, `/`, `/admin/`, `/passport/` all
  200; HTML `no-cache`, assets `immutable`. SSH is now **key-only**
  (`PasswordAuthentication no` via `/etc/ssh/sshd_config.d/99-hardening.conf`);
  reach it with `ssh samo-vm` (alias → key `~/.ssh/id_samo_vm`).
- **Discord notify CONFIGURED + TESTED (2026-07-21)**: `/etc/samo-notify.env` holds
  the real PR/PROJECTS webhooks + a 12-key VS map (all VS dropdown targets →
  the one VS channel, since notifyVSConsult has no fallback). Live-test from the
  VM egress: all 3 channels HTTP 204. Notifications work end-to-end.
- **READY TO CUT OVER (2026-07-22)** — all functional blockers cleared:
  (1) samoweb Google sign-in on samo.md.kku.ac.th — **DONE** (redirect URLs +
  Google JS origin on `fheueuowbchsnsvbcgil`; login returns per-origin).
  (2) passport Google sign-in on /passport — **DONE** (user added the passport
  project `idwlabpbwiwgaoqwbozz` redirect URLs + Google JS origin).
  (3) off-VPN public reachability — **CONFIRMED** by user.
  (4) **Email notify — CONFIRMED enabled + host-independent.** Live
  `project_settings` (id=1): `notify_uni_email=true`, `uni_staff_email=
  woratho@kku.ac.th`; `notify_prof_email=true`, `prof_email=prakasa@kku.ac.th`.
  Email goes browser→GAS `/exec` MailApp at an ABSOLUTE URL (`config.js
  GAS_API_URL`), so it's identical on pages.dev and the VM — the domain switch
  does not touch it. (Only Discord uses the same-origin `/notify` path, already
  replicated on the VM.) Deep-links in emails derive from `window.location`, so
  they self-target the sending host.
  Remaining = hygiene only: rotate the VM sudo password (pasted in chat);
  notify_log (0055) optional via `SUPABASE_*` in the env file.
- **DB is NOT touched by the switch — zero data-loss risk.** This is a HOSTING
  move only. Web DB stays on Supabase Cloud `fheueuowbchsnsvbcgil`; passport DB
  stays on `idwlabpbwiwgaoqwbozz` (passport still runs on project B — the
  Phase-0/1 merge into project A's `passport` schema is NOT activated). The VM
  frontend points at the same Supabase URLs via the same env vars. Only caveat:
  sessions don't carry across origins, so users re-sign-in once on the new domain.
- **pages.dev "we've moved" splash (2026-07-22, this repo).** `public/moved.html`
  — self-contained animated splash (relocation-arc SVG, brand pine/orange,
  countdown auto-redirect, deep-link-preserving). A guard `<script>` at the top
  of `index.html` + `admin/index.html` fires ONLY on `*.pages.dev`
  (`/\.pages\.dev$/i.test(hostname)`) and `location.replace('/moved.html?next=…')`;
  never on samo.md.kku.ac.th or localhost. Same repo builds the VM (splash is a
  dead file there — guard never fires). `/moved.html` is a real static asset so
  Pages serves it before the `_redirects` SPA catch-all. **Passport splash is a
  separate repo (phuriphatma/samomdkkupassport) — NOT yet added there;** drop an
  equivalent `moved.html` (target `https://samo.md.kku.ac.th/passport/`) + the
  same guard in passport's entry to cover samomdkkupassport.pages.dev.
  **PASSPORT SPLASH DONE (2026-07-22):** `public/moved.html` (target
  `.../passport/`) + guard in all 4 passport entries (index/dashboard/admin/scan);
  builds clean. **CUTOVER EXECUTED (2026-07-22):** verified live on the refactor
  preview — guard deployed, `/moved.html` 308→`/moved` preserves `?next=`, splash
  renders with the correct VM target; VM 200 off-VPN on `/` + `/passport/`. Web
  shipped to prod: `main` ff to `6cec725` (both branches in sync). Passport splash
  rebased onto `c124b5c` (subpath fix intact) + pushed to origin/main `b64f15a`.
  DB untouched (no migration/db diff — bug-scanned clean). **Cloudflare prod
  builds were triggered by the pushes; confirm they went live with:**
  `curl -s https://samomdkkuweb.pages.dev/ | grep -q "encodeURIComponent" && echo LIVE`
  (same for `samomdkkupassport.pages.dev`). Old pages.dev deep-links + printed QR
  codes keep working (redirect through the splash to the VM, query preserved).
  Note: pages.dev sessions don't carry to the VM origin — users re-sign-in once.
  Passport local clone (`/Users/xeno/development/samodevmdkku69/passport`) has
  pre-existing untracked `.agents/` + `AGENTS.md` — NOT ours, leave them.
  Splash tuning (both repos, pushed 2026-07-22): auto-redirect countdown is **30s**
  (was 9s); fixed an **iPad unscrollable** bug — the splash `body` had
  `height:100% + overflow:hidden` which clipped the card when taller than the
  viewport; now `overflow-x:hidden` + no fixed height so it scrolls (see
  mistakes-archive). Cutover guards confirmed LIVE on both prod pages.dev.
- passport is a SEPARATE Supabase project (`idwlabpbwiwgaoqwbozz`) → a passport
  change cannot touch the web DB. Keep it that way after the shared-login merge:
  one repo → one project ref → one migrations folder; share ONLY auth.

## Passport→samoweb merge: Phase 1 REAL COPY DONE + verified lossless (2026-07-22)

Playbook: `docs/PASSPORT-MERGE.md`. Decided shape: one Supabase project
(A=`fheueuowbchsnsvbcgil`) for SSO, passport data in an isolated `passport`
schema, two repos stay separate. **Identity model = Option B (email-keyed):**
copy ALL passport rows into A up front keyed by `email`, drop the two auth FKs
so passport-only students (no A auth.users row yet) can be carried, back-fill
the A auth uid lazily on each student's first login. Chosen over pre-provisioning
~469 auth.users (Option A: pollutes public.users + fires the signup trigger at
scale near the 0041 blast radius, and can't create a 2nd account for a both-
systems email → duplicate-identity risk). User approved 2026-07-22.

**Access mechanism (KEY FACT):** the account-wide `SUPABASE_ACCESS_TOKEN` (PAT)
in `.env.local` reaches BOTH projects via the Management API `database/query`
endpoint — so B is fully readable/writable without its DB password. (B's DB
password `PASSPORT_B_DB_PASSWORD` / `PASSPORT_B_DB_URL` now also stored in
`.env.local` as a psql fallback — pasted in chat, rotate B at end.)

- **0059 APPLIED** (`0059_passport_email_key_merge.sql`): dropped
  `passport.profiles_id_fkey` + `passport.scans_user_id_fkey` (the two
  auth.users hard-FKs). PKs, NOT NULLs, intra-passport FKs, and the
  `on_new_scan` points trigger all preserved. Reversible.
- **Phase 1 REAL copy done + VERIFIED (2026-07-22):** copied all 11 tables
  B→`passport.*` (into the REAL tables this time, not `_stg_*`) via
  `scratchpad/copy.mjs` (jsonb_populate_recordset per table, dependency order,
  preserving B uuids). Schema pre-checked **byte-identical** B.public vs
  A.passport (no drift). `on_new_scan` DISABLED during the scans insert so
  `total_km` (copied directly) wasn't re-incremented, then re-enabled.
  Identity seqs (continents/departments/sub_departments/scans) advanced past
  copied ids. **Verified:** profiles 469=469, distinct emails 469, **total_km
  93,846 = 93,846 (no double-count)**, scans 537=537, 0 orphan scans, top-8
  leaderboard byte-identical, trigger re-enabled. (Counts grew vs the
  2026-07-21 staging dry-run — 465→469 profiles, 535→537 scans — because B is
  still live and taking scans; expected.)
- **B is NOT yet deletable.** B is still the LIVE passport backend taking new
  scans, so this copy is a point-in-time snapshot (the validated Phase-1
  dry-run into real tables). B becomes deletable only after the scheduled
  cutover: a fresh delta re-copy at a quiet window → flip passport env to A →
  kill split-brain. Nothing on A is API-exposed yet, so no real students are on
  A (safe to leave the copied data in place; Phase 3 re-copies fresh).

### Remaining to cut over (coordinated, needs a quiet window + 2 dashboard steps)
1. **Lazy-link trigger on A — DONE + isolate-tested (2026-07-22).** Migration
   `0060_passport_login_link.sql` APPLIED: `on_auth_user_created_passport_link`
   → `public.passport_link_user_by_email()` (SECURITY DEFINER, best-effort,
   whole body wrapped so it can NEVER raise → cannot brick signups; writes only
   passport.*). On a new auth signup it finds `passport.profiles` by email and
   re-keys profile.id + scans.user_id + season_results.user_id from the old B
   uuid to the new A uid; no-op for non-passport emails. Verified via admin-API
   throwaway users: (a) sameweb-only signup succeeds + passport untouched; (b)
   passport email re-keys profile+scans, total_km preserved exactly, no dup
   scans, old uid gone; real data restored 469/93,846/537 with no leftovers.
2. **Expose `passport` schema** in A's API (dashboard: Settings → API → Exposed
   schemas → add `passport`). User-only.
3. **Passport repo**: point supabase client env at A + `{ db: { schema:
   'passport' } }`, move the `@kkumail.com` gate to an app-level check, rebuild,
   deploy to VM (`/var/www/passport`). Separate repo.
4. **Kill split-brain**: retire `samomdkkupassport.pages.dev` or repoint its
   env at A — after cutover NO frontend may write to B.
5. **Fresh delta re-copy** B→A at the window (truncate `passport.*` user data,
   re-run `copy.mjs`), flip, verify live (sign in as a student, scan, check km).
6. Keep B paused as backup weeks, then delete.

### Phase 0 (done 2026-07-21)
- **Phase 0 APPLIED to project A**: migration `0056_passport_schema.sql`
  (faithful `pg_dump` port of live passport project B, re-homed under
  `passport.*`) — 11 tables + `user_tiers` view + `handle_new_scan` points
  trigger + RLS. Verified isolated: `public` stayed 23→23 tables, 0 leakage.
  Reversible via `drop schema passport cascade`. The `auth.users`
  `handle_new_user` trigger is DELIBERATELY NOT wired (0041 signup-brick risk);
  profiles come from Phase 1 data copy + a guarded cutover mechanism.
- passport repo now has `base: '/passport/'` committed (subpath hosting).
- **Phase 1 DRY-RUN (2026-07-21)** superseded by the real copy above — original
  dry-run used throwaway `passport._stg_*` staging (dropped). Historical note:
  a few leaderboard users are @gmail.com, so B's "@kkumail.com only" gate isn't
  fully enforced — decide the app-level domain gate at cutover.
- **SECURITY**: both projects' DB passwords were pasted in chat — ROTATE BOTH
  (Supabase → Settings → Database → Reset password) once the merge is done.

### New-domain auth + passport-subpath bugs — DIAGNOSED, fixes pending (2026-07-21)

On `samo.md.kku.ac.th`, three reported symptoms, TWO root causes:
1. **Login on samo.md.kku.ac.th → redirects to *.pages.dev** (both samoweb AND
   passport). ROOT CAUSE: `samo.md.kku.ac.th` is NOT in either Supabase
   project's Auth → URL Configuration → **Redirect URLs**, so the OAuth
   `redirectTo` (correctly = current origin) is rejected and GoTrue falls back
   to the **Site URL** (still pages.dev). FIX (user/dashboard, no code): add
   `https://samo.md.kku.ac.th/**` to Redirect URLs on BOTH projects
   (`fheueuowbchsnsvbcgil` + `idwlabpbwiwgaoqwbozz`), and add
   `https://samo.md.kku.ac.th` to the Google OAuth client's Authorized
   JavaScript origins. Leave Site URL = pages.dev (keeps pages.dev working).
   **RESOLVED 2026-07-21**: redirect URLs + Google JS origin added; login on
   samo.md.kku.ac.th now returns to samo.md.kku.ac.th, pages.dev to pages.dev.
   Confirmed the mechanism: the `/callback` sends the browser to the validated
   `redirect_to`, NOT unconditionally to Site URL — Site URL is only the
   fallback when `redirect_to` is absent/rejected. One Site URL serves all
   origins.
2. **"Admin Portal" on /passport → samoweb; passport nav broken at subpath.**
   ROOT CAUSE: passport's internal nav was ROOT-ABSOLUTE (`/html/admin.html`,
   `/`) and Vite does NOT rebase `<a href>` / JS string paths, so at `/passport/`
   they escaped to samoweb. **FIXED + DEPLOYED to VM 2026-07-21** (passport repo,
   commit `707977b`): (a) `js/routes.js` derives paths from
   `import.meta.env.BASE_URL` (= Vite base: `/` on pages.dev, `/passport/` on VM);
   (b) nav links made relative — `index.html` Admin Portal → `html/admin.html`;
   `html/admin.html` Back → `../`; `profile-menu.html` Home → `../`;
   `html/scan.html` CTAs → `dashboard.html`. **Verified pages.dev-safe**: the
   base=/ build inlines BASE="/" and relative links resolve to root → byte-
   identical behavior to today's pages.dev; only the /passport/ build changes.
   Live-verified on VM: Admin Portal → /passport/html/admin.html (passport admin,
   base-prefixed assets), passport index still 200.
   **PUSHED to passport GitHub 2026-07-21** as `c124b5c` (via git bundle from VM
   → this machine's gh creds; the VM has no gh creds). The stray npm-version
   lockfile churn `git commit -a` swept in was stripped before push (5 files
   only). VM was `git reset --hard origin/main` → VM==origin==c124b5c, clean
   tree, so `deploy.sh git pull --ff-only` stays a clean no-op. pages.dev
   auto-rebuild from c124b5c **VERIFIED LIVE + healthy** (index 200; admin link
   now relative `html/admin.html` → resolves to `/html/admin.html` at base=/,
   same as the old absolute link — the pre-existing CF 308→`/html/admin` is
   unchanged). **Bug scan clean**: no other subpath-breaking nav (`<a>`, JS
   location/fetch/window.open all base-aware or relative); built assets are
   `/passport/assets/*` (Vite-rebased), all 200 at the subpath. Also the
   post-scan OAuth redirectTo (`scanning.js` → origin+ROUTES.DASHBOARD) now
   lands on /passport/... so it must be on the passport Supabase allow-list.
   **STILL TODO (dashboard, user-only): passport OAuth login → pages.dev.**
   Passport Supabase project `idwlabpbwiwgaoqwbozz` → Auth → URL Configuration →
   Redirect URLs: add `https://samo.md.kku.ac.th/passport/**` (+ exact
   `https://samo.md.kku.ac.th/passport/`). Leave Site URL = pages.dev. Add
   `https://samo.md.kku.ac.th` to the passport Google OAuth client's Authorized
   JS origins. Same fix shape as samoweb item 1 above, different project.
3. **Bare `/passport` (no trailing slash) → served samoweb / "not found".**
   ROOT CAUSE: nginx `location /passport/` only matches URIs starting with
   `/passport/`; bare `/passport` fell through to the catch-all `location /`
   → samoweb index. Nginx's auto-trailing-slash-redirect didn't fire (no
   `passport` dir under /var/www/samo-web). **FIXED + DEPLOYED 2026-07-21**:
   added `location = /passport { return 301 /passport/; }` to
   `server/nginx-samo.conf`; installed to the VM + `nginx -t` + reload.
   Verified live: /passport → 301 /passport/ → 200 passport app. (`/admin`
   bare has the same latent gap — not yet patched.)
- passport `base` is now env-driven (`process.env.PASSPORT_BASE||'/'`); pages.dev
  builds '/', VM builds '/passport/' (server/deploy.sh sets it). Both verified
  200 on assets after the base-hardcode incident was fixed.

## notify_log (0055) shipped + hardened — MIGRATION PENDING, 2 manual steps to enable (2026-07-21, main + refactor in sync)

PR #16 (durable Discord-notify logging + 6s→800ms queue spacing) was merged
straight into `main`, diverging it from `refactor/modular` (which had PR #15
creator-crop). **Reconciled**: merged main→refactor, then shipped review
fixes on top, then ff-deployed main from refactor. Both branches in sync again.
Review fixes on top of #16:
- **notify_log hardened** (`0055_notify_log.sql`): per-column `char_length`
  CHECKs (caps per-row size — table is anon-INSERTable via `with check(true)`)
  + `prune_notify_log(retain_days=30)` security-definer retention fn (NOT
  granted to anon/authenticated; run in SQL editor or schedule via pg_cron).
- **Last-mile drop fix** (`discord-queue.js`): `flushDiscordQueue()` drains
  the spacing park on `pagehide`/`visibilitychange=hidden` so a not-yet-fetched
  notify leaves the tab before mobile Safari freezes it. Closes follow-up (a).
- `notify.js` `firstStatus ?? null` (was `|| null`, dropped a real 0).

**To actually enable logging (NOT done yet — safe no-op until then):**
1. Apply `supabase/migrations/0055_notify_log.sql` in the Supabase SQL editor
   (real project `fheueuowbchsnsvbcgil`).
2. Add `SUPABASE_URL` + `SUPABASE_ANON_KEY` to Cloudflare Pages env (same
   values as the `VITE_` ones), on BOTH Pages projects.
Until both are done the Function skips logging entirely. The 800ms spacing +
flush changes are already LIVE (client-only, no gating). After the next drop:
`select at, ticket_id, ok, discord_status, attempts from notify_log where not ok order by at desc;`
(no row for a ticket → it died client-side before reaching /notify).

## CI green again + shop delete degrades to archive (2026-06-20, main + refactor in sync)

Deployed: `main` fast-forwarded to `refactor/modular` at `05abc55`; CI green
on both. Two fixes (client + CI only, no migration):
- **CI build was red on every push** (Node 20 + supabase-js `npm test`
  WebSocket throw). `.github/workflows/build.yml` now runs **Node 22**;
  README prerequisite bumped to 22+. See mistakes-archive.md entry.
- **Admin shop ลบสินค้า on an ordered product** failed with raw 23503 FK
  JSON. `deleteProduct` now detects the `ON DELETE RESTRICT` FK and the
  handler offers to **archive** (`is_active = false`, already-existing
  column + read policy) instead. `archiveProduct` added to `shop/api.js`.
Latent parallel: `project_doc_types` has the same restrict-FK but no
delete UI — apply the same pattern if one is ever added.

## Migrations through 0054 APPLIED — 0055 PENDING

All migrations through **0054 are APPLIED** to Supabase (real project
`fheueuowbchsnsvbcgil`). **0055 (`notify_log`) is NOT applied yet** — see the
top section for the two enable steps. SAMO Team: 0046–0049. Professor signing: 0050
(workflow) + 0051 (prof comment via column-guarded project_documents UPDATE)
+ 0052 (`signs_file_id` link for inline signed-file UI) + 0053 (sa_prof may
delete his own signed files for re-sign). 0054 (`announcements.pinned` flag —
home featured post). The latest signing-UX round (return/resend persistence +
batching, comment notify-scope, collapsible sign status, multi-page e-sign) is
**client-only — no migration**.

`main` and `refactor/modular` are **in sync at the same commit** — refactor
fast-forwarded into main on 2026-06-17, shipping three client-only feature PRs
(no migration): PR #14 (MDKKU Self Exam Bank link on ฝ่ายวิชาการ), PR #13
(ฝ่ายบริหารองค์กร announcement-style resource cards + base `.launcher-tool`
accent-bar curve fix — `overflow:hidden`), PR #12 (mobile top-bar login/logout
buttons). FOLLOW-UP (external content, not code): the ฝ่ายบริหารองค์กร
**treasurer Guidebook** Canva link redirected to a Canva login page in HTTP
checks — confirm its share setting is "anyone with the link can view" (the
other dept-card links opened fine; the Project 1st Step Google Form returned
401, likely KKU-login-gated by design). `announcements.pinned` (0054) is live — verified
queryable via anon PostgREST (`select=pinned` → 200). The loader self-heals if
the column is ever absent (warns once, disables pin), and `baseSelect` excludes
`pinned` so the excerpt/display_order fallbacks never re-request it. No new RLS
policy (announcements_write already covers staff/dev/creator UPDATE).

## Vital Sound emergency toggle — TEMPORARILY HIDDEN on customer view (main + refactor, 88de664)

The 🚨 "กรณีฉุกเฉิน (ส่งเรื่องตรงถึงอุปนายกทันที ข้ามทีม SE)" checkbox is
commented out in `src/html/tab-vitalsound.html` per request (temporary).
`toggleEmergency()` in `src/js/vs-form.js` is now null-safe (early-returns when
`#vsEmergency` is absent), so submits default to non-emergency routing (→ SE,
status "รอ SE รับเรื่อง"). **To restore: un-comment the HTML block** — no other
change needed; staff-side `is_emergency` rendering is untouched. Live on main.

## Vital Sound PDPA consent gate — client-only, SHIPPED (main + refactor)

Sending a Vital Sound report pops a non-dismissible PDPA consent modal on
EVERY send (`src/html/modal-vs-consent.html`, included in `index.html`;
`vs-tab` teal accent; `data-bs-backdrop="static"` + no keyboard/X so the
visitor must choose ยินยอม / ไม่ยินยอม). Flow: `handleVsFormSubmit` validates
the form first (account/content), then parks the real send in `pendingSubmit`
and shows the popup; ยินยอม runs `sendVsReport(form)`, ไม่ยินยอม clears it and
shows a "การส่งถูกยกเลิก" notice. Nothing is persisted — consent is asked every
time. Wiring: `initVsConsent` in `src/js/vs-form.js`, called from `main.js`
after `initVsForm`. No migration — no personal data stored beyond the existing
problem text. Public bundle only (absent from admin build).

## Professor (saprof) signing workflow — SHIPPED (main, ab3cb89)

Third seat in หนังสือโครงการ: **`saprof` / role `sa_prof`** signs documents.
sastaff sends a chosen SUBSET of a หนังสือ's files to the professor; he accepts
(in-browser e-sign on the PDF, or upload an externally-signed file) or rejects
(back to sastaff). vpa sees all progress. sastaff also got file add/replace/remove
parity with vpa (file ops now notify the other seat + the prof if shown to him).
The prof can also COMMENT (0051) and is wired into the inbox highlight system
(permanent "รอลงนาม" pill + seenAt "อัปเดต"). Accepting does NOT require a signed
file (it's an approval; signing is optional). Signing status is shown INLINE on
each attached file with the signed version nested beneath it (renderFileCard) —
the old separate "การลงนาม" section is now a collapsible request-status bar
(auto-expands + "ใหม่" indicator on a new decision, like the comments thread).

Latest UX round (client-only): (1) **ส่งกลับ persistence** — the ตีกลับ reason
persists for vpa until ส่งใหม่, and the resend summary + the files vpa changed
stay highlighted for sastaff until they change status (status-keyed, NOT
clear-on-view — `renderReturnContextBanner` + `persistIds` in loadFilesForDoc).
(2) **Notification batching** — during the ส่งกลับ phase (status=returned) vpa's
per-file edits do NOT ping sastaff each time; they're consolidated into the one
ส่งใหม่ notification (`fanFileOp` skip + `summarizeFileOpsSince`). Other statuses
still notify per edit. (3) **Comment notify-scope** — author picks "ทุกคน"
(default) or a single seat (`commentTargetSeats` + the prompt's new select; entry
carries `notify`). (4) **Sign picker** defaults to no files + เลือก PDF/ทั้งหมด/
ล้าง buttons. (5) **Multi-page e-sign** — stamp the signature on any/all pages
(per-page `placements` Map + "ทุกหน้า"); high-DPI pad capture so the embedded
signature is crisp, not pixelated. (6) **Signing audit log** — every prof
sign / re-sign / signed-file upload writes a timestamped `signed_file` entry to
the doc timeline (หนังสือ + original file + output + method + replaced flag) via
`logSignToDoc`; surfaced to the actors' update banner. (7) UI: หนังสือโครงการ
defaults to LIST view, project names wrap (no truncation), and long-Thai text
blocks wrap instead of overflowing on mobile/iPad.

Live: migration 0050 applied, `saprof` seeded (password `1234`; synthetic email
never delivers), GAS redeployed with `getProjectFileData` (e-sign Drive-bytes
round-trip; the reupload fallback works without it). **Remaining setup:** set the
prof email in การตั้งค่า (admin manage tab) if email-to-prof is wanted.

Key design note — the project tables are world-readable (0032 `*_read_public`),
so the prof's "only docs sent to him" scope is a UI/query filter
(`scopeProjectsForRole` in `index.js`, file filter in `loadFilesForDoc`), NOT
RLS; the real signal is that `project_sign_requests` has no public policy (see
`.claude/rules/mistakes.md`). New deps: `pdf-lib`, `pdfjs-dist` (e-sign is a
lazy-loaded chunk, kept out of the public bundle). Modules:
`src/js/projects/{sign,esign}.js`, `src/html/modal-project-{sign,esign}.html`,
`tools/saprof-account.mjs`.
## Announcement pinning + home featured + card manage page (feat/announcement-pin-cards)

The home featured (large) card is now driven by an explicit `pinned` flag,
NOT list position. The **"ลำดับการแสดงประกาศ" admin section** is its own sidebar tab below
เขียนประกาศ (`data-admin-side="order"` → pane `data-admin-pane="order"`,
`src/html/tab-announcement-order.html`, gated same as creator via
`SIDE_FEATURE.order = 'creator'`, rendered by `enterAnnouncementOrder()`). It
renders each announcement as an **editorial card** (reuses the public
`news-grid--archive` look) via `renderAnnouncementOrderList` → `renderOrderCard`:
drag handle + pin chip overlay the image, click the card to edit. SortableJS
reorders (handle `.order-card-handle`, items `.order-card`); pin chip →
`togglePinAnnouncement` (unpins others, at most one pinned).

**Editing is a popup overlay, not a redirect.** Clicking a card calls
`editAnnouncementById` → `editAnnouncement(id)` + `openEditorOverlay()`, which
floats the SINGLE existing creator editor (the `#creatorPane`) on top via the
`.editor-overlay` class (z-index 1040, below Bootstrap modals so the cover
cropper still stacks). No duplicate editor / Quill instance. Close via the X
or cancel (`window.closeAnnouncementEditor`), or automatically after
publish/delete: `announcements.js` dispatches `announcement:changed`, and
admin-main's listener closes the overlay + re-renders the cards. เขียนประกาศ
sidebar tab still shows the same editor inline for NEW posts (`enterCreator`
calls `cancelEdit()` for a clean form); `#creator/{id}` deep links also edit
inline.

CSS bundling note: `src/admin.css` now imports `news.css` (so the manage
cards reuse the public news-card system) + a new `css/announcements-admin.css`
(the `.order-card*` + `.editor-overlay*` styles, moved out of the public-only
`article.css`). Previously admin.css excluded news/article as "public-only".
Home render: **pinned post = big card on top + the 2 most recent others as
small cards**; if nothing is pinned, all posts render small (no featured).
Also this session: announcement archive page (`news-grid--archive`) switched
to side-by-side cards (3:4 image left, text right, 3 per row desktop / 2
tablet / 1 mobile); home grid is 2-up horizontal (`news-grid--home`); a
`/welcome-banner.svg` home banner was added; archive + manage cards show 2 per
row on phones. Files: `src/js/announcements.js`, `src/js/admin-main.js`,
`src/css/news.css`, `src/css/article.css`, `src/css/cards.css`,
`src/css/announcements-admin.css`, `src/html/tab-home.html`,
`src/html/tab-announcement-order.html`.

## Shipped features (detail archived)

These are live on main + applied; full per-feature write-ups moved to
`docs/state-archive/2026-06-08.md` to keep this file lean (git log is the
authoritative history):
- **SAMO Team management** (ทีม SAMO admin section, migrations 0046–0049) —
  org tree (divisions→departments→roles→people), drag + picker move,
  multi-select bulk ops, per-node permissions (org metadata only, NOT wired to
  live auth yet), live Realtime multi-editor sync, JSON/CSV import-export with a
  per-conflict resolver. Files: `src/js/team/*`, `src/html/tab-team.html`,
  `src/css/team.css`.
- **President account + นายกสโม VS dept** — `samomdkkupresident` (role=dev,
  dept=นายกสโม) via `tools/president-account.mjs seed`; นายกสโม added as a VS
  target dept across form/dashboard/transfer/Discord, with its own VS webhook.

## หนังสือโครงการ email — works; channel config is the only switch (this session)

GAS MailApp email is the deliberate, best free choice (see GAS section below
for the CF-Worker comparison). Plumbing is verified working; it only sends when
`project_settings.notify_uni_email = true` AND `uni_staff_email` is non-empty —
both were off/blank, which is the whole "email doesn't work" story (the
uni_staff account email is synthetic `@samomdkku.app`, never delivers → a
curated recipient field exists for a real address). **Admin sets the recipient
in การตั้งค่า** (left for the user to fill — live DB still has it blank/off).
Manage UI now has a "ทดสอบ" send-test button, an enabled-but-empty warning, and
multi-recipient support (`normalizeRecipients` in `src/js/projects/notify.js`,
splits on `,;`+whitespace, validates, dedupes; unit-tested in
`projects/notify.test.js`). MailApp quota = GAS owner's Gmail: ~100
recipients/day consumer, 1,500/day Workspace; counts recipients not emails; no
documented per-minute/hour throttle; no separate monthly cap.

## Branches

- `main` HEAD: latest production (pages.dev-retirement splash). Auto-deploys to
  `samomdkkuweb.pages.dev` — which now REDIRECTS to samo.md.kku.ac.th (the VM is
  the real host; pages.dev serves only the moved-splash).
- `refactor/modular`: **in sync with main** (preview). Auto-deploys to
  `refactorsamomdkkuweb.pages.dev`. Both branches share an identical base — the
  historical big-bang `MERGE-CHECKLIST.md` risks (creds, dev GAS URLs) are moot;
  refactor→main merges are clean fast-forwards now.

## Recently shipped (pre-team, archived)

Stable applied work — full snapshot in `docs/state-archive/2026-06-06.md`,
authoritative history in `git log`:
- **Ticket soft-delete** (0043–0045): PR/VS delete is soft + recoverable via
  SECURITY DEFINER RPCs (null-role fail-closed). Restore = admin SQL.
- **Signup fixes** (0041 + 0042): unblocked new signups + resilient profile
  insert.
- **Discord → Cloudflare Pages Function** (`/notify`, `functions/notify.js`):
  all Discord proxies through one CF Function (kills the 1015 per-IP limit);
  GAS keeps Drive uploads + projects email only; `vssound.gs` deleted,
  `prform.gs` redeployed. Client serialises via `src/js/discord-queue.js`.
- **Samoshop per-item overhaul + admin UX** (0040): order status = payment
  phase, per-item `item_status`, multi-slip, customer_note, bulk order
  select/delete, stock-tab keyboard fix.

## Automation credentials (live, intentionally un-rotated)

User has **DECLINED rotating** the Discord webhooks + Cloudflare API token
(informed choice — don't nag). Instead, the working creds are stashed in
`.env.local` (gitignored) so automation runs across sessions:
`CLOUDFLARE_API_TOKEN` (Pages:Edit), `CLOUDFLARE_ACCOUNT_ID`,
`NOTIFY_DISCORD_PR_WEBHOOK`, `NOTIFY_DISCORD_PROJECTS_WEBHOOK`,
`NOTIFY_DISCORD_VS_WEBHOOKS` (11-dept JSON). `tools/set-notify-secrets.mjs`
reads these to re-PATCH Pages env vars on `samomdkkuweb` / `refactorsamomdkkuweb`.
`.env.local` also carries `SUPABASE_SERVICE_ROLE_KEY` (used for live DB
inspection / provisioning scripts — NEVER bundle to `src/`).
**NEVER commit or echo these values.** They're live and un-rotated, so treat
`.env.local` as sensitive.

## Open follow-ups (not yet done)

- **Mobile login caveat** — if a phone genuinely evicts localStorage (not
  just slow restore), the boot-gate fix won't help; needs a real-device repro.
- **Migrations tooling — DEFERRED by user (don't re-raise unprompted).**
  Best practice = Supabase CLI with a tracked `schema_migrations` ledger
  (`supabase migration repair --status applied 0001..0045` to baseline the
  already-manually-applied files, then `db push`) + a CI job that replays
  migrations on a fresh Postgres + an optional `supabase/schema.sql` baseline.
  The numbered files themselves are fine (append-only, immutable — NEVER
  squash/rewrite applied ones). Current process = manual SQL-editor apply,
  applied-state tracked here in STATE. User will set up the CLI later.

## DB migrations status (Supabase `fheueuowbchsnsvbcgil`)

Apply in numeric order via the SQL editor. **All migrations through 0049
are APPLIED — none pending.** Full numbered history is in
`supabase/migrations/`; `git log` carries the per-migration context.

## Supabase config notes

- Authentication → Providers → Email → **Confirm email: OFF**. Flipping
  ON breaks signup at the project-wide email rate limit because every
  synthetic `<user>@samomdkku.app` bounces a verification email. See
  `mistakes.md` "Email confirmation must be OFF for synthetic emails"
  for the longer story + the implications for the profile email-add
  flow (`db.auth.updateUser({email})` writes immediately, ownership
  proof is the subsequent `linkIdentity` Google OAuth round-trip).
- Authentication → URL Configuration → Redirect URLs include both
  `https://samomdkkuweb.pages.dev/**` and
  `https://refactorsamomdkkuweb.pages.dev/**`.

## GAS (`appscript/prform.gs`) — Drive uploads + projects email ONLY

**หนังสือโครงการ email = GAS MailApp, by design (NOT moving to Cloudflare).**
The live `/exec` `notifyProjectEmail` path is verified working (test POST →
`{"success":true}`, real Gmail delivered). MailApp sends *as the owner's
Gmail* → correct SPF/DKIM, best deliverability, free, no card, no domain,
~100/day. A CF Worker can't beat this with no custom domain: MailChannels'
free CF tier is dead; Resend/MailerSend need domain verification to email
arbitrary recipients; Brevo-from-Gmail fails SPF alignment → spam. The 1015
per-IP limit that moved *Discord* to CF does NOT apply to MailApp.

Post-cutover, prform.gs serves only Drive uploads (`uploadPRFile` /
`uploadShopFile` / project files+folders) + `notifyProjectEmail` (MailApp).
**All Discord moved to the `/notify` Cloudflare Function**; `vssound.gs` was
deleted. **prform.gs REDEPLOYED** (2026-06-06) — the live /exec now matches
the repo (Discord handlers gone). The `vssound` GAS project + `/exec` can be
deleted at leisure. The 1015 rate-limit problem is moot now (CF egress IP,
not GAS's shared one). Redeploy procedure: `skills/deploy-gas.md`.

## End-of-turn loop reminder

Every meaningful change should:
1. Update STATE.md if real state changed (branch HEAD, migrations,
   in-flight work, blocking issues). Don't append session narratives —
   `git log` is the archive.
2. Append to `.claude/rules/mistakes.md` if a new bug class was
   discovered.
3. Create / update `skills/*.md` if a repeatable workflow appeared.
4. Update README / docs/CONTEXT.md only if user-visible features,
   architecture, or build setup changed — skip for internal-only
   refactors / bugfixes / comment edits.

## Where to look next

| Looking for | Read |
|---|---|
| Project rules, file placement, end-of-turn loop | `CLAUDE.md` |
| Architecture, RLS, schema, deploy plumbing | `docs/CONTEXT.md` |
| Anti-patterns / bug post-mortems / sharp edges | `.claude/rules/mistakes.md` |
| API key hygiene | `.claude/rules/security.md` |
| Merge checklist (refactor → main) | `docs/MERGE-CHECKLIST.md` |
| Multi-step workflows | `skills/*.md` |
| Feature history | `git log --oneline --grep='<topic>'` |
| Who shipped what when | `git log --since=YYYY-MM-DD --oneline` |
| Earlier STATE.md snapshots | `docs/state-archive/*.md` |

## When STATE.md gets bloated again

If a future session balloons this file past ~200 lines, prune:

- Past session narratives → `docs/state-archive/YYYY-MM-DD.md` then
  rewrite STATE.md fresh.
- Big architecture write-ups → `docs/CONTEXT.md`.
- Reusable workflows → `skills/*.md`.
- New bug classes → `.claude/rules/mistakes.md`.
- Cross-conversation user facts → auto-memory under
  `/Users/xeno/.claude/projects/.../memory/`.

This file answers "what is true right now". Nothing else.
