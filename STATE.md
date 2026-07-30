# STATE — current task & latest known state

Last updated: 2026-07-30. Slim by design — "what is true right now". Shipped
detail pruned out of here most recently:
`docs/state-archive/2026-07-30-pre-clear.md`; earlier narrative:
`docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: `.claude/rules/mistakes.md`.

## SHIPPED THIS SESSION — ทีม SAMO portraits + ปีการศึกษา (0104) — LIVE

Migration **0104 applied**, frontend **deployed to the VM**, Apps Script
**deployed @47**. Nothing from this work is in flight.

**What it is**
- Public ทีม SAMO (`/team`, inside เกี่ยวกับเรา) opens with a docchula-style
  คณะกรรมการ grid — large 3:4 portrait cards, 4 across, for the ตำแหน่ง flagged
  `team_nodes.is_board` (seeded to นายกฯ + the 10 อุปนายกฝ่าย = 11). The full
  searchable spine tree follows, using the SAME card at ~130px. No circular
  avatars anywhere — one card shape, two sizes.
- **ปีการศึกษา switcher.** The LIVE tree is always the current term. Past terms
  are a frozen-but-EDITABLE snapshot in `team_terms` + `team_archive_nodes` +
  `team_archive_members`, written by `publish_team_term(year)` and read by
  `get_public_team_chart(year)`. `get_public_org_chart()` is now a one-line
  delegate to it, so the live projection has exactly ONE body.
  Admin surface: a third mode in ทีม SAMO ("ปีการศึกษา", `src/js/team/terms.js`).
- **Photo pipeline.** Browser downscales to a 2400px WebP master
  (`src/js/image-resize.js`), files it in Drive as
  `SAMO_Team/<ปี>/<ฝ่าย>/<ลำดับ>-<ชื่อ>.webp` (GAS `uploadTeamFile`), and renders
  via lh3 option strings `=w<W>-h<H>-c-rw` — server-side crop to the card aspect
  plus WebP. Measured on a live file: 520x693 WebP = **37.6 KB**, vs 77.6 KB for
  the uncropped source a CSS crop would need. Per-shape `srcset`, so the 130px
  tree card never fetches the 250px board card's file.
  `photo_focus` (`top|center|bottom`, CHECK-constrained because it reaches CSS)
  drops the server crop for the cases where a centre crop would cut the head.

**Why Drive/lh3 and not the VM** (asked and answered with measurements): lh3 is a
real image CDN — it resizes, crops and serves WebP. Self-hosting buys ~100ms of
connection setup for an nginx location + a sync tool + a deploy step. Storage at
2400px is ~600 KB/photo → all 401 members ≈ 240 MB/year, 12 years ≈ 2.9 GB of a
2 TB quota. The master size costs NOTHING at render — the browser only ever
fetches the derivative. **Do not "optimise" this by moving to the VM.**

**Why the archive is separate from the live tree — do not merge them.**
`team_nodes`/`team_members` feed the permission engine (managed_permissions, VS
scopes, project seats, passport scopes) through a statement-level recompute
trigger. A `term_year` column on them would mean a 2565 row still resolving to a
live grant for someone who left three years ago. The archive tables carry ONLY
the columns the public projection publishes, so there is nothing on an archived
row for any resolver to read.

**0105/0106 — every year is uniform now** (this replaced 0104's confusing
special case, where the current year always rendered from the live tree):
`get_public_team_chart(year)` resolves **published archive → live tree (current
year only, as bootstrap) → empty**. So a year becomes real the moment it is
published, the public page shows exactly what the admin edits, and every
published year — current included — is editable via "แก้ไขรายชื่อ/รูป".

Two consequences to keep in mind:
- Once the current year is published, live-tree edits need a **re-publish** to
  appear. `team_term_status()` detects this (live max(updated_at) > published_at,
  current year only) and the pane shows "ผังสดเปลี่ยนแล้ว · ควรเผยแพร่ซ้ำ".
  **Do NOT auto-publish on tree edits** — it would overwrite hand-corrected
  archive rows, which is what the archive exists to preserve.
- `publish_team_term` rebuilds the archive wholesale, so 0106 makes it carry a
  photo forward when the live tree has none: **live photo > this year's archived
  photo > null**, keyed on `team_archive_members.src_member_id`. Without it the
  re-publish we ourselves prompt for would delete every portrait uploaded through
  the archive editor. Names/nicknames/positions are still overwritten — that is
  what re-publish means.

**Proofs** (re-run after touching any of this):
- `node tools/team0104-terms.mjs` → 40/40 — snapshot fidelity (0 orphan parents,
  depth preserved, board flags carried, re-publish replaces), non-public subtrees
  excluded, projection allow-list, anon reads 0 rows from all three new tables,
  `team` permission works on writes AND reads, RPC fails closed on a null role,
  anon cannot execute it.
- Regression set, all green: `team0089-manage` 5/5, `proj0086-seats` 24/24,
  `proj0092-seat-parity` 13/13, `prof0095-seat-parity` 10/10, `vs0083-scope`
  16/16, `security-sweeps` clean, 195 unit tests.

**Verified live** (anon, against prod): `get_public_team_years` → `[2569
is_current]`; `get_public_team_chart(null)` → 279 nodes / 401 members / 11 board;
member keys exactly `name,nickname,node_id,photo_focus,photo_url,position`; no
`@`, no `student_id`, no `kkumail` anywhere in the payload; anon reads **0 rows**
from `team_members`, `team_terms`, `team_archive_nodes`, `team_archive_members`.
Page renders 11 board cards + 401 tree cards, year picker correctly hidden (only
one year exists so far).

**Open / next for this feature** (none blocking):
1. **No photos are uploaded yet** — 401 members, 0 with `photo_url`, so every card
   renders initials. That is the designed fallback, not a bug. Upload via
   ทีม SAMO → edit a member → รูปประจำตัว.
2. `is_board` is seeded to the obvious 11 and otherwise uncurated.
3. The year picker stays hidden until a SECOND year is visible — a year shows
   publicly only if it is published or is the current term. There is a 2570 term
   (added during testing, unpublished, not current) which is therefore correctly
   invisible.
4. **Deploys no longer break open tabs.** `deploy.sh publish()` adds assets
   additively and prunes after 7 days, so the previous build's chunks keep
   serving; verified live (the prior bundle still 200s after a deploy).
   `build-check.js` also re-checks on tab-foreground, gated by `pageIsIdle()` so
   it never reloads over an open modal or typed-in field.

## APPS SCRIPT — automated deploys (new)

`npm run deploy:gas` (`tools/deploy-gas.mjs`). Live state: script `179DfoS1…`,
deployment `AKfycbw1iHE4…` **@47**, `/exec` URL unchanged.

- Setup already done on this Mac: `npx clasp login` (as
  `mdstuddata.beta@gmail.com`), Apps Script API enabled, `GAS_SCRIPT_ID` in
  `.env.local`.
- **Never runs `clasp deploy`** — that mints a NEW deployment with a NEW `/exec`
  URL while `GAS_API_URL` stays hard-coded, which presents as "every upload
  silently fails". It does `create-version` + `update-deployment` on the same id.
- The deployment id is derived from `GAS_API_URL` in `src/js/config.js` (its path
  segment IS the id). That matters: this script has **THREE** deployments (one
  `@HEAD`, the live web app, an old `@25` kept for rollback), so "pick the only
  non-HEAD one" is ambiguous.
- Diffs the remote before overwriting and refuses if the remote has lines the
  repo doesn't (someone edited in the browser); `--force` overrides,
  `--dry-run` reports only, `--verify` probes the live endpoint.
- Canary: `POST {action:'uploadTeamFile'}` with no `folderPath` → the handler
  validates before touching Drive, so it proves the new code is serving while
  writing nothing. `folderPath is required` = new, `Unknown action` = old.
- Rollback: `cd .gas-build && npx clasp update-deployment AKfycbw1iHE4… -V 46`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- **samoweb**: `ebca449`, **deployed 2026-07-30**, `buildId 56c800cd6811`. Latest change: the ทีม SAMO portrait board + ปีการศึกษา
  archive (0104) — see the section above. Verified in the SERVED bundles:
  `get_public_team_chart` / `get_public_team_years` / `org-board-card` in
  `/assets/public-*.js`, `.org-board-grid` in `/assets/public-*.css`,
  `id="orgYears"` + `id="orgBoard"` in `/index.html`;
  `data-team-mode="years"` / `teamTermsPane` / `teamNodeIsBoard` /
  `teamMemberPhotoFocus` in `/admin/index.html` and `publish_team_term` in
  `/assets/admin-*.js`. `/`, `/admin/`, `/passport/`, `/pr`, `/news` all 200;
  `/notify` → `{"ok":true,...}`.
  (BOTH apps' assets are served from `/assets/`, NOT `/admin/assets/` — a grep
  against the latter 404s and silently "finds nothing", which reads exactly like
  a failed deploy. **And the admin entry is split across TWO chunks**: `admin-*.js`
  plus a shared `analytics-*.js` that carries `auth.js`, `uploads.js` and
  `image-resize.js` — grepping only `admin-*.js` for `SAMO_Team` / `image/webp`
  reports a false MISSING.)
  A VM/STATE mismatch of a few `docs(state):` commits is normal and does NOT mean a
  deploy is pending — check `git diff --name-only <vm>..HEAD` for anything outside
  `STATE.md` / `.claude/` / `docs/` / `tools/` first.
- **passport** (separate repo): code `b57eb1e` **deployed 2026-07-30** (pulled
  + built by `deploy.sh` alongside samoweb). Served bundles
  verified by grep: `stamp_scan` in the scan chunk, `leaderboard_names` in
  dashboard, `admin_leaderboard` + the shared-admin email in admin,
  `sb-passport-legacy-admin` in the shared chunk, and no `from('scans').insert`.
- Migrations: samoweb `public` 0081–0106; passport `db/0010` + `db/0011` + `db/0012`
  ALL applied — passport authorization is now enforced server-side (NEXT #3).
- Verify any deploy by grepping the served bundle for feature strings — NOT by
  hash (Mac vs VM hashes differ). For samoweb the shared `analytics-*.js` chunk
  carries auth.js.
- Deploy method: `ssh samo-vm` → `cd ~/samo-projects/samomdkkuweb` →
  `./server/deploy.sh` (pull → `npm ci` → build → `sudo rsync dist/` →
  `/var/www/samo-web` → chown → restart notify → `nginx -t` + reload; also builds
  passport with `PASSPORT_BASE=/passport/`). `deploy.sh` uses BARE `sudo`, which
  needs a tty — run over `ssh -tt`, and prime the cred cache first in the SAME
  session: `printf '%s\n' "$PW" | ssh -tt samo-vm 'read -rs PW; echo "$PW" | sudo -S
  -v && ./server/deploy.sh'` (PW = `.env.local` `SAMO_VM_SUDO_PASSWORD`; a lone
  `sudo -S -v` without `-tt` primes nothing — deploy.sh's next `sudo` still errors
  "A terminal is required to authenticate"). Bundle content-hashes differ Mac vs VM
  (dep/Node deltas) — verify a deploy by grepping the served bundle for feature
  strings, not by hash-matching.
- One Supabase project `fheueuowbchsnsvbcgil` (web `public` + passport in `passport`
  schema). Migrations applied through `tools/apply-migration.mjs` (Management-API PAT).
  **To INVESTIGATE the DB, use `tools/db-query.mjs <file.sql>`, not
  apply-migration** — the latter truncates its echoed result at 2000 chars
  without saying so, which turns any introspection query (policy dumps,
  `pg_get_functiondef` sweeps, column lists) into a confidently wrong answer.
  Both run as the Postgres SUPERUSER: `auth.uid()` is null and RLS is bypassed,
  so to see what a REAL user sees you must `set_config('role', …)` +
  `set_config('request.jwt.claims', …)` inside `begin; … rollback;` — every
  `tools/*` proof script is built that way and is the template to copy.

## Shipped earlier, pruned to the archive

Full text: `docs/state-archive/2026-07-30-pre-clear.md`. All applied + deployed.

- **ทีม SAMO is the grant engine (0081–0088).** The tree issues real permissions
  via `managed_permissions` / `managed_vs_depts` / `managed_project_seats` /
  `managed_passport_*`, recomputed by a statement-level trigger. Proofs:
  `tools/team0089-manage.mjs`, `proj0086-seats.mjs`, `proj0092-seat-parity.mjs`,
  `prof0095-seat-parity.mjs`, `vs0083-scope.mjs`.
- **VitalSound 0096–0099** — remark visibility ladder, unknown-category
  fail-closed, self-public context. Proof: `tools/vs0096-remark-vis.mjs`.
- **Pre-/clear security scan (2026-07-29)** — 4 real bugs, all fixed. The
  standing sweep is `tools/security-sweeps.mjs` (run it after any RLS change).

## NEXT — HANDOVER (nothing below is in flight; all of it is un-started)

Ordered by what will bite first. Everything named here is verified true as of
HEAD; the proof scripts and migrations referenced all exist and pass.

### 1. Nothing behind the ADMIN LOGIN has had a signed-in browser run
Every server path is proven by the 12 scripts (234 checks, all re-run green at
session end). The PUBLIC half is browser-verified; everything requiring a login is
not, because the agent session cannot authenticate. Check these first — likeliest
place a regression hides.

**Added 2026-07-30 — shipped this session, server-proven, NOT clicked:**
- **ทีม SAMO photo upload** — member form → รูปประจำตัว. Goes through
  `uploadImageToDrive` (GAS `uploadPRFile`), then `photo_url` saves with บันทึก.
  The whole GAS upload leg is untested here; if it fails, check the GAS deploy
  before suspecting the column. Preview + "นำรูปออก" also unclicked.
- **จัดการสิทธิ์ search** — typing a PERSON's name there now filters (the member
  scan used to be gated to จัดการทีม). Type a ชื่อเล่น and confirm the person
  appears with their ตำแหน่ง ancestors.
- **Mobile drag on ทีม SAMO** — needs a REAL phone. A scroll starting on a drag
  handle must scroll; a ~220ms hold must start a drag and highlight the row; drag
  must be absent entirely in จัดการสิทธิ์.
- **สถิติการใช้งาน** — proven server-side for a tree grantee (0102), but open it
  as a non-staff grantee once to confirm the dashboard renders rather than erroring.
- **Public /team org chart** — verified at desktop width only. **Not verified at
  mobile width**: the browser extension screenshots at a fixed size regardless of
  window resize, so the sub-768px stacking rests on the media queries alone.
- **VS บันทึกข้อความ (0096)** — the visibility select in the staff ticket modal;
  a `thread` note written on a canonical must appear on a duplicate's tracking
  timeline tagged "จากเรื่องที่เกี่ยวข้อง"; a `public` note must appear in
  ความคืบหน้าจากทีมงาน on the board (separate from comments).
- **VS staff modal (0099 UX)** — บันทึกข้อมูล must now KEEP the ticket open,
  repaint its timeline, and show "บันทึกแล้ว" inline in the footer.
- **VS จัดการหมวดหมู่ / จัดการแท็กภายใน** — ลบ works, its confirm names the
  usage count, and a newly ADDED หมวดหมู่ is immediately selectable in the open
  ticket without closing it.
- **อาจารย์ (0095)** — `phuriphat.ma@kkumail.com` holds the `prof` seat and must
  now see the SAME 11 หนังสือ as `saprof` (26 exist; 11 carry a signature
  request). If it shows 0, the seat resolution broke, not the RLS.
- **SAMO Shop (0094)** — unscoped again for everyone; the ทีม SAMO picker should
  have NO แหล่งที่มา field.
- **ประกาศ (0093B)** — a `creator` grantee must see their own drafts/pending in
  เขียนประกาศ + ลำดับการแสดงประกาศ (before 0093 they could write and not read).
- **Admin account switch** — switching accounts must hard-reload `/admin/`.
- **Public article แก้ไข/ลบ** — now `data-perm-only="creator"`; a tree-granted
  creator should see them, a plain user should not.
- **Passport** — the Google sign-in round-trip and the dept-scoped admin view.
  This is the one I could not test at all (no way to drive OAuth from here).

### 2. Passport `admin`/`1234` — a deliberate TEMPORARY second door, not a bug
**The intended model, confirmed by the user 2026-07-30**: whoever holds the
`passport` permission (or a dept scope) in ทีม SAMO is a passport admin. That is
exactly what `public.passport_admin_context()` implements — `is_admin` = blanket
`passport` perm or `role='dev'` (→ `all_departments: true`) OR any
`managed_passport_scopes` entry; null `auth.uid()` fails closed. Nothing to
change here.

`admin`/`1234` is a knowingly-temporary alternate entrance, and since 2026-07-30 it
**signs into a real shared Supabase account** rather than comparing strings —
`passportadmin@samomdkku.app`, `permissions={passport}`, on its own client with its
own `storageKey` so it can never disturb an organiser's personal Google session.
That is what let `db/0011` land while the door keeps full admin. Credentials live
in `VITE_PASSPORT_ADMIN_EMAIL` / `VITE_PASSPORT_ADMIN_PASSWORD` (this Mac's
`passport/.env.local` AND the VM's `~/samo-projects/samomdkkupassport/.env.local`)
— **not in the public repo**, though they do ship in the built bundle because they
must be usable. So the door is no more secure than '1234' was; what changed is that
everyone NOT using it now has no write access at all, and its writes carry a uid.

To retire it: `LEGACY_PASSWORD_LOGIN = false` in passport `js/admin-scope.js`,
redeploy, confirm every admin can sign in with Google, then delete the marked
block, `handleLegacyLogin` in `admin-page.js`, `#admin-legacy-box` in
`html/admin.html`, the two env vars in both places, and finally strip the shared
account's grant (`array_remove(permissions,'passport')` — needs the
`users_self_update_guard` disable dance, see mistakes.md) or delete the auth user.
**Who keeps access when that flag flips** (live, 2026-07-30 — the previous note
here said 2 people and was STALE):
- ทุกฝ่าย: `kita.a@kkumail.com`, `putita.s@kkumail.com`, `worapat.c@kkumail.com`
- dept-scoped `d:1`: `jinjutha.t@kkumail.com`, `phuriphat.ma@kkumail.com`

Re-run the check before flipping — the tree changes:
`select email, managed_passport_scopes, managed_permissions from users where
'passport' = any(managed_permissions) or managed_passport_scopes <> '{}';`

### 3. Passport authorization — DONE. Two small follow-ups remain
Narrative: `docs/state-archive/2026-07-30-passport-authz.md`. `db/0010` + `0011` +
`0012` applied, app deployed. `tools/pass-anon-probe.mjs` (real anon key over
HTTPS) went **6/9 → 9/9**: student emails, the roster via `user_tiers`, and
`PATCH /scans` are all refused now; the catalog and scan-points reads the app needs
before sign-in still work. `tools/pass-hardening.mjs` = **60 checks** over seven
principals, applying the lockdown inside a rolled-back transaction.

**`admin`/`1234` still works as a FULL admin** — user's standing requirement, many
people use it. It now signs into a shared Supabase account so it carries a real
JWT (see the archive for why nothing else could work). **Do not retire it without
asking**; checklist in #2.

**Follow-ups, neither urgent:**
1. **`activities.static_token` is anon-readable** because the whole row is — RLS
   cannot hide a column. Impact is small now (`stamp_scan()` pins the scan to
   `auth.uid()` and derives the km itself), so a leaked token only lets a signed-in
   kkumail student stamp something they did not attend. To close: drop the
   `isStaticMatch` client pre-check, switch `scanning.js` off `select('*')` to an
   explicit column list, THEN
   `revoke select (static_token) on passport.activities from anon, authenticated`.
   That order, or the scan page 400s.
2. **Per-ฝ่าย WRITE scoping is unenforced** — the write policies check
   `is_admin()`, not the department, so a scoped admin can still edit another
   ฝ่าย's activity via DevTools. `passport.admin_covers_dept(dept, sub_dept)`
   already exists for it. Pointless while the all-departments `1234` door is open,
   so sequence it after retiring that door.

### 4. Shared → personal accounts: the AUTHORIZATION is DONE — only read-state cosmetics remain
**The intended model, confirmed by the user 2026-07-30**: a ทีม SAMO seat IS the
shared account's role. `เจ้าหน้าที่คณะ` ≡ `sastaff`, `อาจารย์` ≡ `saprof`,
`ผู้ส่งหนังสือ` ≡ `samomdkkuvpa`. **That is what ships** — `projectSeatRole()`
maps the seat to the role string the module branches on, `current_user_project_seats()`
carries it into RLS, and 0095 made the อาจารย์ seat see the same signature queue
as `saprof` rather than a per-uid subset. A seat holder needs NO migration to do
the job. Earlier notes framed this as a pending "migration", which overstated it.

The ONE thing a grant cannot carry is per-user state, and neither piece affects
access:
- `project_doc_views` — which documents *you personally* have opened, i.e. the
  "อัปเดต" badge. Live: `samomdkkuvpa` 28/28 docs, `sastaff` 25, `saprof` 11,
  `phuriphat.ma` 22 (from the one handover already run).
- `project_notifications` — historical bell rows addressed to the shared
  account's uid. NEW notifications already reach seat holders (0091
  `list_project_seat_users`).

So `tools/proj-handover.mjs` is **optional badge parity**, worth running only
when RETIRING a shared account and you want day-one badges to match it. Skip it
and the first-run BASELINE marks everything seen — the sane default for someone
joining today. `--sign-requests` is NOT needed for an อาจารย์ to see the queue
(0095); run it only to re-attribute history away from `saprof`.
Residual if you do run it: `getDocSeenAt()` falls back to a localStorage map when
the server has no row, so a badge can look wrong on a device the target already
browsed on — clear site data there.

### 5. Inert columns from the reverted shop scope
`team_nodes.shop_source`, `team_members.shop_source`,
`users.managed_shop_sources` exist and NOTHING reads them (0094 reverted the
feature). Drop statements are in 0094's header; after dropping, also strip them
from `sync_my_team_permissions`, `recompute_team_managed_permissions`,
`users_self_update_guard` and `current_user_has_any_grant`, which still name
them. Left in place because dropping columns is destructive and was not asked
for. **Do not re-add a SAMO Shop source scope without being asked** — it was
declined because orders cannot be scoped (one order holds items from several
sources), so a product-only scope isolates nothing.

### 6. Watch-outs a future change must not break
- **0095 tradeoff**: every อาจารย์ now sees every signature request. Correct for
  one shared role; the day per-professor privacy is wanted the fix is the uid
  check PLUS a "which professor am I" dimension — a plain revert re-empties the
  seat.
- **Never widen `current_user_is_staff()`** — `users_self_update_guard` trusts it
  for privileged-column writes, so widening it lets any grantee self-promote to
  `dev`. `tools/grant0093-reads.mjs` asserts this with a real attempt.
- **`tools/vp-accounts.mjs`** still does a plain `.update({role})` and will hit
  `users_self_update_guard` if re-run — port the select→delete→insert fallback
  from `tools/president-account.mjs` first (see mistakes.md).

### 7. Not started
- ~~**Org-chart renderer**~~ **DONE 2026-07-30** — public `/team` page, migration
  0103. Detail: `docs/state-archive/2026-07-30-passport-authz.md`.
  **Live privacy constraint**: a member's name + photo go public as soon as their
  ตำแหน่ง sits in a public subtree. `team_nodes.is_public` is the ONLY control —
  there is no per-member opt-out. `get_public_org_chart()` remains the only
  sanctioned publisher; a new `team_members` column is not published until it is
  named in that function's jsonb.

- **Notify follow-up (b)** from the notify_log entry in mistakes.md:
  `waitUntil`-deliver + immediate 202, so delivery is decoupled from the client
  connection. Changes the callGAS success-echo contract — do it together with
  making `notify_log` the source of truth for failures.
- Passport repo has untracked `AGENTS.md` + `.agents/` (not mine, left alone).

## PR + VITALSOUND — stable, pruned to the archive

Both shipped and deployed (PR ฝ่าย single-source-of-truth `src/js/pr-depts.js`;
VS service desk + public board, migrations through 0080). Full write-up incl. the
VS confidentiality invariants: `docs/state-archive/2026-07-25-pr-vs.md`.

## OTHER SYSTEMS (stable; details in archive + CONTEXT.md)

- **PR / News / Shop / Projects / Analytics**: unchanged this session. Shop = Model A
  shared admin (0057/0058); projects ปีงบ filter; analytics strip + staff dashboard live.
- **Passport** (separate repo `phuriphatma/samomdkkupassport`, same Supabase project,
  `passport` schema): kkumail-only gate live; 5 gmail→kkumail migrations verified;
  awaiting students' replies at mdstuddata.beta@gmail.com. Dev test still ACTIVE
  (pmphuriphat→phuriphat.ma) — revert SQL in `docs/state-archive/2026-07-24-full.md`
  ("ACTIVE TEST STATE"). Old project B `idwlabpbwiwgaoqwbozz` paused as cold backup —
  rotate its DB password (in `.env.local`) before deleting.
- **notify**: `/notify` Node service on the VM; `notify_log` (0055) recording;
  `main` branch protected (1 approval; owner ff-push exempt).
- Retention jobs NOT scheduled (`prune_analytics`, `prune_notify_log`) — run manually
  if tables grow.

## Housekeeping

- **`.claude/rules/mistakes.md` pruned (2026-07-30): 2340 → ~2040 lines, 74 → 58
  entries.** 16 STABLE + NICHE entries moved to `.claude/rules/mistakes-archive.md`
  (17 → 33 entries) — settled auth/signup config facts, one-off SQL gotchas, and
  UI quirks whose code path no longer changes. Nothing deleted. Two additions
  make the split safe to rely on:
  - the hot file's header now names the **five recurring classes** (per-row
    UPDATE ≠ column policy · unknown-reference fails open · scoped-is-not-full ·
    read authorization is per-path · mirrors drift) as a read-these-first list;
  - it carries a **by-area index of what is in the archive**, so a symptom whose
    entry moved is still greppable from the hot file. Keep that index in step
    when you move the next entry.
  Still ~2040 lines: the remaining bulk is entry VERBOSITY, not entry count, and
  every kept entry is either one of the five classes or on the auth/db hot path.
  Trimming prose is the next lever if it needs to shrink again.

- **STATE.md is ~407 lines against CLAUDE.md's ~200 budget**, and `mistakes.md` is
  back to ~2240 after four new entries this session. Both grew because the session
  shipped a lot; both have been pruned once already. The next prune should move
  COMPLETED NEXT items to `docs/state-archive/` (that is what happened to the
  passport + org-chart narratives at the end of this session) and leave NEXT as
  only what is genuinely un-started. The
  2026-07-29 scan narrative moved to
  `docs/state-archive/2026-07-29-pre-clear-scan.md` and the VS browser-verified
  checklist is now a pointer (it was duplicated verbatim in the 07-29 archive).
  It does not get much shorter without gutting `NEXT`, which is 140 of those
  lines and is the actual handover. Prune `NEXT` items as they are COMPLETED,
  not to hit the number.

- `.env.local` holds the Supabase PAT, VM sudo pw, project-B DB creds — never commit.
- CI = Node 22 (supabase-js WebSocket). `npm run build && npm test` before every
  commit — 140 tests green at session end; isolation proof 23/23.
