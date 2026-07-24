# STATE — current task & latest known state

Last updated: 2026-07-24. Slim by design — "what is true right now",
not a project diary. Session narratives live in `git log`; architecture
in `docs/CONTEXT.md`; bug post-mortems in `.claude/rules/mistakes.md`.

## VITALSOUND — service-desk model: 4-phase stepper + public Problem board — DEPLOYED (2026-07-24)

VS is a **service-desk / case-management** system, NOT a GitHub issue tracker. The 9 internal
staff statuses STAY the source of truth (user confirmed); the staff kanban is unchanged. Borrow
only 2 GitHub mechanics: duplicate-linking (shipped 0068–0071) + close-with-reason (future slice).
Build-vs-buy settled with user: **build our own** — no SaaS/OSS help desk gives the confidential
lane + kkumail SSO + curated public board (you'd hand-build the board regardless).

**All live on the VM** (build `d3b1f4acbe32`, commits ec31486→975ede0 on `main`; tree clean + synced).

**Slice 1 DONE (client-only, no migration):** the STUDENT tracking view now shows a friendly
4-phase progress stepper derived from the 9 statuses — ส่งเรื่อง / รับเรื่อง / ดำเนินการ /
เสร็จสิ้น. The exact status is still shown as a caption ("สถานะโดยละเอียด: …") so nothing is
hidden. Mapping (`vsPhaseIndex` in `vs-tracking.js`): เสร็จสิ้น→3; ดำเนินการ/ติดต่อคณะ→2;
SE รับเรื่องแล้ว/อุปนายก*/ปฏิเสธ(ส่งคืน SE)→1 (bounce = still "under review", not terminal);
รอ SE รับเรื่อง + unknown/legacy→0. Headline badge + history-list badge now colour by phase
(text still the exact status). Code: `src/js/vs-tracking.js` (`VS_PHASES`, `vsPhaseIndex`,
`renderVsStepper`, `renderUserDashboard`, `renderUserHistoryList`), `src/html/tab-vitalsound.html`
(`#dashStepper`), new `src/css/vs.css` (imported in `main.css`; uses `--pink-*` → teal via
`.vs-tab`). New test `src/js/vs-phase.test.js` (12 cases). `npm run build && npm test` GREEN
(129 tests). **COMMITTED + DEPLOYED** (shipped with the Phase 2 deploy below). Code:
`src/js/vs-tracking.js` (`VS_PHASES`/`vsPhaseIndex`/`renderVsStepper`/`renderVsStepperByPhase`),
`src/html/tab-vitalsound.html` (`#dashStepper`), `src/css/vs.css`, `src/main.css`, `src/js/vs-phase.test.js`.

**Slice 2 DONE + DEPLOYED (2026-07-24, VM build `5cebd2a6f5f0`, commit 9b29294; migration
0073 APPLIED to live DB):** when staff set status→เสร็จสิ้น the modal reveals a required
"เหตุผลการปิดเรื่อง" picker (fixed / forwarded / wont_do+note / duplicate) + optional note;
the submitter sees a friendly "ผลการดำเนินการ" outcome card on their tracking view + a
submitter-visible timeline remark. Additive only: two nullable cols
`vs_tickets.{resolution,resolution_note}` (CHECK-constrained) surface with NO RPC change to
both the owner read (`select=*`) and the guest by-id lookup (`get_vs_ticket_by_id` returns
`setof vs_tickets`). Shared vocab `src/js/vs-resolution.js` (single source for staff+student
labels) + test `vs-resolution.test.js` (11 cases). Code: `src/js/vs-staff.js`
(`setupResolutionUI`/`syncResolutionVisibility`/validation+write in `submitStaffAction`),
`src/js/vs-tracking.js` (`rowToTicket` carries fields, `renderUserDashboard` outcome card),
`src/html/modal-vs-staff.html` (`#staffResolutionBox`), `src/html/tab-vitalsound.html`
(`#dashResolution`), `src/css/vs.css`. `npm run build && npm test` GREEN (134 tests). Auto-
close paths (merge/cascade 0071) still set only status+generic remark — leaving `resolution`
null there is a harmless nicety to add later (set `='duplicate'`). Live smoke test:
`/`, `/admin/`, `/build.json`, `/notify` all 200; served build.json = 5cebd2a6f5f0.
**NEXT (needs a human): end-to-end click** — in `/admin/` open a VS ticket, set status to
เสร็จสิ้น, pick a เหตุผลการปิดเรื่อง, save; then track that ticket as the submitter and
confirm the "ผลการดำเนินการ" outcome card shows. (Write path mirrors the tested status-write
exactly; only the OAuth-gated staff click can't be done from here.)

**Slice 3 (assignee/owner within a dept) — DROPPED (2026-07-24, user call).** Each dept
operates via ONE shared department account; there are no individual members to assign to, so
per-person ownership is meaningless — `target_dept` already encodes it. Do NOT revive this or
generalize PR's `pr_agents` roster to VS. (See memory: depts-use-shared-accounts.)

**Duplicate = LINKED progress-mirror (migration 0074, APPLIED + DEPLOYED to VM build
`63b574e5177f`, commit 7b79ba1) — GitHub-style "follow the real issue" WITHOUT the leak.** Problem the
user raised: closing B as "duplicate" dead-ended B's submitter, because 0071 hides the
canonical A's id (unlike GitHub's uniform visibility). Fix: a duplicate is a LINK that MIRRORS
A's progress to B's submitter, identity-blind.
- **DB (0074):** `vs_cascade_resolve` trigger generalized — on A's status/resolution change it
  propagates A's `status` (and, on close, A's `resolution` — never the `resolution_note`) onto
  its still-open duplicates, so B's stepper advances with A and shows the real outcome. `merge_vs_tickets`
  starts the mirror at link time + adds a GENERIC submitter-visible "handled together with an
  earlier report" remark (no id). New generated col `vs_tickets.is_duplicate` (= duplicate_of is
  not null) — a non-identifying flag for submitter UI.
- **Security fix folded in:** the logged-in submitter's `select=*` owner read (`loginToViewHistory`)
  returned raw `duplicate_of` — 0071 only sanitized the GUEST RPC, so the id still leaked to any
  signed-in submitter via DevTools. Both submitter reads now use an explicit `SUBMITTER_COLS`
  allow-list that OMITS `duplicate_of`; the UI shows the linked banner off `is_duplicate` instead.
  New mistakes.md entry (sanitize-one-path-leak-the-other).
- **"duplicate" removed from the manual close-reason picker** (`MANUAL_VS_RESOLUTIONS` = fixed/
  forwarded/wont_do). Duplicates go only through the merge (เรื่องซ้ำ) action. The enum value stays
  in the CHECK + vocab to render legacy rows.
- **Comments:** B's private staff thread stays OPEN on a linked ticket (reply box not locked); the
  mirror propagates ONLY status+resolution, never remark text, so A's staff replies never leak into
  B. Cross-submitter discussion happens only on the pseudonymous public board (0072), if published.
- **DB-verified** on throwaway rows (scratchpad/test-0074.mjs): is_duplicate flips; B mirrors
  in-progress + done + resolution; note NOT copied; A's id absent from submitter-visible remarks;
  guest RPC returns `duplicate_of=null, is_duplicate=true`. `npm run build && npm test` GREEN (135).
- **Legacy dead-end row:** `VS-260724-1612-5N6` was closed today with resolution='duplicate' + no
  link (the test that surfaced this). It renders with its label but has no canonical to mirror —
  reset it (clear resolution, reopen) via merge, or delete if it's a throwaway. **NEXT: VM deploy +
  human end-to-end (merge two tickets, track the dup as its submitter, watch progress mirror).**
- **Staff duplicate-cluster TREE (client-only, no migration) — DEPLOYED.** เรื่องซ้ำ tab now shows a
  GitHub-style linked tree `canonical → [duplicates]` (staff-only; staff see the real links per 0071),
  each node clickable to open that ticket, marks "เรื่องนี้", shows dept/status + a สาธารณะ badge if
  is_public. `renderDupTree` in `vs-staff.js`, `#staffDupTree` in `modal-vs-staff.html`, `.vs-duptree*`
  in `vs.css`.
- **(2) DONE — submitter linked-context (migration 0075, APPLIED; deployed with build below).**
  `get_vs_linked_context(p_id)` (anon+auth, keyed by ticket-id capability): canonical PUBLIC →
  returns `public_id`+`public_title`+`related_count`, tracking view shows a "ติดตามบนกระดานปัญหา"
  CTA that deep-links to the board (`vsOpenBoardProblem` → board mode + open); canonical
  CONFIDENTIAL → returns ONLY `{linked, related_count}` (no id/title), banner shows "รวม N เรื่อง …
  เก็บเป็นความลับ". Confidential-category re-checked in the RPC. DB-verified 3 cases (public link /
  private+count / not-linked) on throwaway rows. Code: `src/js/vs-tracking.js` (`enhanceLinkedBanner`),
  `src/js/vs-board.js` (`openBoardProblem`), `main.js` (`vsOpenBoardProblem`), `vs.css`.
  (3) **STILL OPEN — "show all staff discussion on public problems" → recommend NO.** The board ALREADY has a
  public thread (`vs_public_comments`, staff reply as "เจ้าหน้าที่"). The INTERNAL `remarks` timeline
  must stay internal — it carries PDPA detail + the `internal:true` dedup cross-refs that name other
  students' ticket ids (republishing = the 0071 breach). Safe transparency = CURATED public updates
  (staff post into the public thread / SE `public_note`), never the raw timeline.

**Next slice (service-desk roadmap):** (4) transition guards drive the status dropdown —
show only valid next-states from the current status (e.g. can't jump รอ SE รับเรื่อง →
เสร็จสิ้น), reducing mis-clicks. Client-only is possible (constrain the dropdown); a DB
trigger would harden it server-side. Public board = Phase 2 below.

### VS board Phase 2 (migration 0072) — schema + RLS + RPCs + UI, all DEPLOYED

**DB layer (migration 0072 `0072_vs_public_board.sql`, applied to the live DB).** Locked product
decisions (recommended defaults; user added comments = the forum-ish public lane): admin-managed
`vs_categories` (6 seeded, `personal`=confidential); **SE-only publish / any-staff hide**;
**me-too = kkumail**; **public comments = non-confidential only, kkumail, pseudonymous-to-peers, staff-moderated**.
- New: `vs_categories` (ref table, RLS read-all/write-staff), `vs_tickets.{category,is_public,public_title,public_note}`,
  `vs_followers(canonical_id,user_id)` PK, `vs_public_comments` (char_length CHECK, `hidden` moderation).
- Public RPCs (anon+auth, curated projection ONLY, confidential re-excluded via `vs_categories` join): `get_public_vs_board`,
  `search_public_vs` (similarity on **public_title only** — never raw problem), `get_public_vs_problem` (returns jsonb,
  comments pseudonymised `นศ.<hash>` / `เจ้าหน้าที่`, never user_id). `vs_public_phase()` mirrors client `vsPhaseIndex`.
- Action RPCs (fail-closed on null role): `vs_add_me_too`/`vs_remove_me_too` (kkumail), `vs_post_public_comment` (kkumail,
  is_staff server-computed, 5/min anti-flood), `vs_set_public` (SE-only, rejects confidential + requires public_title),
  `vs_hide_public_comment` (any-staff).
- **Isolation proof: 23/23 PASS** (`tools/vs0072-isolation.mjs` — anon vs kkumail-student vs SE vs vp_admin on
  throwaway rows, then cleaned up). Confirmed: no raw-text leak on board/detail, confidential hard-excluded even when
  is_public force-set true, direct table reads = 0 rows for anon, publish gate SE-only (vp_admin+student rejected).
  Re-runnable anytime (seeds throwaway rows, asserts, cleans up).

**UI layer — DEPLOYED (build `d3b1f4acbe32`, 129 tests GREEN).**
Live-verified: board renders as the VS default view, 5 non-confidential category chips (personal correctly excluded),
empty state, report-form Quill still renders after the default-view change, no console errors; anon data path
(categories + get_public_vs_board + me-too 401) confirmed on prod. Unified INTO the VitalSound tab (user wanted one
system, not a separate tab). The VS tab mode toggle is now 3-way, **board is the default front door**:
- **กระดานปัญหา (public board)** — new `#vsBoardSection` in `tab-vitalsound.html`; module `src/js/vs-board.js`
  (lazy-loads on first show via a `vs-board-shown` event from `toggleVitalSoundMode`). Cards: category chip + 4-phase
  pill + curated `public_title` + 👥 me-too button (filled if `following`) + 💬 count. Sort hot/new/active, category
  chips, debounced search (`search_public_vs`). Click → detail: `renderVsStepperByPhase` (exported from vs-tracking) +
  me-too + pseudonymous comment thread + composer (kkumail-gated; anon sees a sign-in CTA). All untrusted text escHtml'd.
  Window fns wired in `main.js` (`vsBoard*`, `vsPostComment`). CSS appended to `src/css/vs.css` (teal via `.vs-tab`, light-only).
- **SE publish control (part 3)** — `#staffPublishPanel` in `modal-vs-staff.html` detail tab + logic in `vs-staff.js`
  (`renderPublishPanel`/`setTicketPublic`, `isSEPublisher` gate → hidden for vp_admin). Category select (confidential
  disabled), public_title, public_note, เผยแพร่/อัปเดต/ยกเลิก. Updates local cache to stay in sync without refetch.
- **Category manager (part 4) = DEFERRED** — the 6 `vs_categories` are seeded by the migration, so the board works
  end-to-end without a CRUD UI; add an admin manager later (mirror shop_product_types 0057) if categories need editing.
- **Bug-scan fixes (commit 8f0dc73, deployed):** (1) SCHEMA — `vs_public_comments.author_user_id` was NOT NULL + ON
  DELETE SET NULL (contradiction → user-delete would fail); now ON DELETE CASCADE (idempotent ALTER, verified
  confdeltype=c). (2) FRONTEND — board lazy-loaded once behind a boolean guard → a transient first-load failure left it
  permanently empty + stale counts; now categories load once (retried) and the board list reloads on every show.
  (3) pseudonym hash 3→4 hex chars. Also fixed earlier: raw PostgREST JSON leaking into user-facing alerts (pgMsg parse).
- README key-features + docs/CONTEXT.md UPDATED (commit b468f37).
- **NEXT (needs a human):** the board is empty until SE publishes — in `/admin/` open a VS ticket → เผยแพร่สู่กระดานปัญหา
  panel → category + public title → เผยแพร่; then a @kkumail student can เจอเหมือนกัน + comment. Category-manager CRUD
  (part 4) DEFERRED (6 seeded suffice). Next roadmap slice = resolution reasons on close. UX spec artifact 38ee5426-… .

### VS board — LOAD-BEARING security invariants (keep if extending) + design rationale

**A bug in any of these re-exposes confidential student complaints — treat as invariants:**
1. Public reads = a **curated projection** only — NEVER raw `problem`, submitter identity,
   `remarks`, or `duplicate_of`. `vs_tickets` is NOT world-readable (no `using(true)` SELECT
   policy), so ALL public reads go through the SECURITY DEFINER RPCs, which return the curated
   columns explicitly.
2. **SE writes `public_title`** — a student's raw report is never auto-published verbatim.
3. **Confidential categories are hard-excluded** from every public surface (board / search /
   detail) even if `is_public` is force-set true (re-checked via the `vs_categories` join +
   `vs_set_public` reject). Proven end-to-end by `tools/vs0072-isolation.mjs`.

Design rationale (why board-first beats GitHub for this domain; the 3 product decisions — all
DECIDED + shipped as described above, do NOT re-ask) lives in git history + the UX spec artifact
**"VitalSound — Board-first Duplicate & Visibility Design"**
https://claude.ai/code/artifact/38ee5426-2e3e-4349-a11a-f84f75da8fc6 (user-owned; update in place,
don't mint new). Other artifacts: usage-stats 7a3b948e-…, passport gate f050294b-… .

## DRIVE IMAGES → lh3 CDN so ประกาศ/shop covers load on iOS Safari (live VM 2a29b87, 2026-07-24)

ประกาศ + SAMO Shop images intermittently blank on iPad (fine on desktop; the URL
opened fine when tapped directly; a refresh recovered them). Cause: images embedded
as `drive.google.com/thumbnail?id=…&sz=w2000`, which 302-redirects to googleusercontent
— iOS Safari drops the redirected `<img>` subresource on a cold cache. Fix:
`convertDriveUrl` now emits the redirect-free `lh3.googleusercontent.com/d/<id>=w1200`
and runs at RENDER time too, so it rewrites legacy `thumbnail?id=` URLs already in the
DB (no data migration). Applied at every Drive-image render site (announcements,
departments, shop products/banner/grid, shop-admin). Built + 117 tests pass; deployed to
samoweb on the VM; live shop verified serving lh3. **Needs iPad confirmation from user
(may require clearing the old cached HTML/bundle first).** New mistakes.md entry.

Also this session (passport repo, separate): added "← back to SAMO portal" nav across
passport surfaces (commit 15a4d58, live at /passport/).

## PASSPORT old-QR scans fixed — nginx clean-URL fallback (live VM, 2026-07-23)

Old printed passport QR codes stopped stamping points/activities; freshly-generated
QRs worked. Root cause: old QRs encode the **extensionless** path
`/passport/html/scan?aid=..&tk=..` (Cloudflare Pages served clean URLs), but the VM
nginx `location /passport/` had `try_files $uri $uri/ /passport/index.html` with **no
`$uri.html` fallback** → nginx skipped `scan.html` and served the home page → scan
logic never ran. New QRs use `ROUTES.SCAN = .../html/scan.html` (with extension) so
they resolved. Fix: added `$uri.html` to the passport `try_files`
(`server/nginx-samo.conf` **and applied live** to `/etc/nginx/sites-available/default`
— backup at `/tmp/nginx-default.20260723-152609.bak`, `nginx -t` + graceful reload,
curl-verified). `static_token` is never rotated, so old tokens still match. New
mistakes.md entry. (`server/nginx-samo.conf` committed 975ede0.)
Open UX nit (not done): scans still hit the 30s "we've moved" splash on `pages.dev`
before forwarding — functional now, but a scan could skip the interstitial.

## VITALSOUND DEDUP — Phase 1 (staff-side merge/similar), migration 0068 (2026-07-23)

Manage duplicate VS reports WITHOUT changing the SE↔VP routing workflow (purely additive).
- **0068**: `vs_tickets.duplicate_of` self-FK (canonical model, GitHub "duplicate of #X");
  `find_similar_vs_tickets(p_id,limit)` (pg_trgm on stripped problem, same-dept first, staff-only
  fail-closed); `merge_vs_tickets` / `unmerge_vs_ticket` (staff-only); `vs_cascade_resolve` trigger
  → resolving a canonical (เสร็จสิ้น) auto-closes its duplicates with a remark (verified on
  throwaway rows). pg_trgm installed in `extensions` schema; definer fns using `similarity()` set
  `search_path = public, extensions`.
- **UI** (`vs-staff.js` + `modal-vs-staff.html`): new "เรื่องซ้ำ" tab in the staff modal (loads
  similar on tab-show), "รวมเข้าเรื่องนี้" merge + "แยกออก" unmerge, dup/canonical banner in the
  detail tab, and a "ซ้ำ"/"N" badge + dim on kanban cards (`.vs-kanban-card-dup`).
- **0070 search-to-merge**: staff aren't limited to the suggestions — `search_vs_tickets(query,
  exclude,limit)` (staff-only, vp dept-scoped, fail-closed) powers a debounced search box in the
  เรื่องซ้ำ tab to find ANY canonical to merge into. Shared `mergeTargetRow()` renders both lists.
- **0071 confidentiality (security)**: the GitHub-style "duplicate of A" cross-ref LEAKED — the
  guest lookup `get_vs_ticket_by_id` (anon, by-id) returned `duplicate_of` + the id-bearing remarks,
  so a dup's submitter could read the canonical's id and look up another student's complaint. Fixed:
  dedup remarks tagged `internal:true`; guest RPC now sanitizes (nulls `duplicate_of`, strips
  internal remarks); auto-close shows a GENERIC message to the submitter; staff read the raw table so
  they still see the link. Verified guest-vs-staff on throwaway rows. Design answer: cross-refs stay
  STAFF-INTERNAL in a per-submitter confidential system. New mistakes.md entry.
- **Bug scan fixed 2**: (1) `ORDER BY sim` shadowed the RETURNS TABLE OUT-param → no sort;
  reordered on the explicit `similarity(...)` expression (new mistakes.md entry). (2) `min-w-0`
  isn't a stock Bootstrap class → inline `min-width:0`.
- Admin/staff-only; public submit/track + SE↔VP flow untouched. **Phases 2/3 (visibility column +
  kkumail public board) NOT built** — gated on the two product calls (public-eligible categories;
  SE-only promote). Design mockup: shared artifact this session.
- **0069 (security follow-up, DB-only, no redeploy)**: the 0068 definer RPCs bypass the
  `vs_tickets` read RLS, which scopes `vp_admin` to their own dept — so they leaked other-dept
  snippets. 0069 re-applies `target_dept = current_user_dept()` inside find_similar/merge/unmerge
  for `vp_admin` (vs_staff/dev/has-vs still see all). New mistakes.md entry. Deployed build for the
  UI is 299b2296a298; 0069 is functions-only so no VM rebuild.

## ANALYTICS: usage tracking + public stat strip + staff dashboard — DEPLOYED (2026-07-23, build ae55a760d5ac)

**Date axis (build ae55a760d5ac)**: admin daily bar charts (`barChart` in analytics-dashboard.js)
now render a sparse date axis (~6 evenly-spaced Thai short-date ticks, `.an-axis`) below the bars;
hover tooltip shows the Thai date + value. Fixes "can't tell which date a bar is".

**UX regroup (build eba72b8a3953)**: หนังสือโครงการ metrics were reading as peers of PR/VS —
now they live in their OWN labeled panel (ring + all 6 sub-stats grouped): public
`.home-project-panel` (home-stats.js `projectPanel()`), admin `.an-proj-panel`. PR/VS stay a
2-ring "งานบริการรับเรื่องนักศึกษา" row. Admin's combined "คำขอรายวัน (PR+VS)" chart is now TWO
charts (คำขอ PR รายวัน / คำขอ VitalSound รายวัน) off `requests_by_day` {pr,vs} split.

**หนังสือโครงการ metrics + completion rings (migration 0067, build 51538de03e97)**:
`public_stats()` + `analytics_overview()` add `doc_completed` (status='completed'),
`doc_signed` (sign_requests status='accepted'), `doc_transactions` (SUM of each
document's `timeline` array length — NOT project_notifications, which fan out per
recipient and overcount), `doc_interactions` (comment notifs + project_doc_views).
- Public strip: 3rd donut ring (หนังสือโครงการ 14/23) + activity chip row
  (ธุรกรรม 139 · การโต้ตอบ 263 · ลงนาม 11 · โครงการ 17).
- Admin dashboard: PR/VS/หนังสือ completion rings (`.an-rings`, fill on render) +
  a หนังสือโครงการ stat row. KPI tiles already split คำขอ PR / คำขอ VitalSound.

**PR/VS split + completion rings (migration 0066, build 891b880cf508)**: `public_stats()`
+ `analytics_overview()` now return `pr_total`/`pr_completed` + `vs_total`/`vs_completed`
separately (completed = `status like '%เสร็จสิ้น%'`, `deleted_at is null` filtered).
Public strip gained a "งานบริการนักศึกษา" section with two animated SVG donut rings
(PR + VS, requests vs completed); admin KPIs split into คำขอ PR / คำขอ VitalSound with
completed + %. Live today: PR 111/135 (82%), VS 10/61 (16%). Rings/tiles count-up +
fill on scroll (IntersectionObserver on `.home-stats-inner`, `.is-in`). Preview artifact updated.

"Prove people use the portal" for the boss. In-house on Supabase (no third party).
- **Migration `0065_analytics.sql` APPLIED** to web DB: `analytics_events` (cookieless,
  anonymous, anon-INSERT / staff-SELECT — verified anon insert 201 + anon read blocked),
  `public_stats()` (curated counts, granted anon — powers the public strip),
  `analytics_overview(days)` (staff-only, fails CLOSED via `is not true`), `prune_analytics()`.
- **Tracker** `src/js/analytics.js` — cookieless (sessionStorage id), fire-and-forget page/tab
  events; wired in `main.js` (`initAnalytics('public')`) + `admin-main.js` (`'admin'` + `trackTab`
  in `showAdminSide`).
- **Public cool stat strip** — `#homeStats` in `tab-home.html`, `src/js/home-stats.js`
  (count-up on scroll), `src/css/home-stats.css`. Shows users / requests / works / new-7d.
- **Staff dashboard** — new admin section `analytics` (SECTION_META + `SIDE_FEATURE.analytics=null`
  = any staff; sidebar btn + `tab-analytics.html` pane), `src/js/analytics-dashboard.js` +
  `src/css/analytics.css`. KPI tiles + CSS bar charts (signups/requests/visitors) + top-tabs/roles.
- Live numbers today: users **432**, requests **218**, new-7d **283**, projects+docs **40**.
- `npm run build && npm test` GREEN (115 tests). **DEPLOYED to the VM** (commit 3f77379,
  build 3034198a9b75); live homepage has `#homeStats`, `/admin/` has the สถิติ pane,
  https://samo.md.kku.ac.th → 200. README + `docs/CONTEXT.md` updated.
- Visitor/session/top-tab panels populate as real browser traffic arrives post-deploy
  (curl smoke-tests don't run JS → no events yet). Engagement numbers show immediately.
- **Bug scan before deploy found + fixed 2**: (1) stored XSS — `analytics_events.path` is
  anon-INSERTable so attacker-controlled; escHtml'd in the staff dashboard (new mistakes.md
  entry). (2) count-up showed "0" on deep-link to non-home tab; added `shown.bs.tab` fallback.
- Retention: `prune_analytics(90)` / `prune_notify_log(30)` exist but pg_cron is NOT scheduled —
  run manually or enable pg_cron + `cron.schedule` (see 0065 / 0055 comments) if tables grow.
- **Post-deploy fix (build c92c60507b91)**: strip/dashboard were LIGHT-ONLY'd — the
  `prefers-color-scheme:dark` overrides I'd added made them dark-green on a dark-mode OS while
  the (light-only) site stayed white. App has NO dark theme anywhere; removed all dark rules.
  See new mistakes.md entry. If restyling these, keep them light-only.

## NOTIFY: PR #16 completed (migration applied + VM logging on) + main branch protected (2026-07-23)

PR #16 (`fix/notify-drops-durable-log`, Naphawarit) was self-merged to `main` on
2026-07-11 but its migration was never applied → the durable `notify_log` was inert.
Completed this session:
- **Migration `0055_notify_log.sql` APPLIED** to web DB `fheueuowbchsnsvbcgil` (table +
  `notify_log_insert_any`/`notify_log_select_staff` policies + `prune_notify_log()` verified).
- **VM logging ENABLED**: added `SUPABASE_URL` + `SUPABASE_ANON_KEY` (same values as the
  `VITE_` ones) to `/etc/samo-notify.env`, `systemctl restart samo-notify` (active). The
  handler only writes a row when a webhook resolves + posts, so the FIRST real notify will
  create row 1. Check: `select at, system, ticket_id, ok, discord_status from public.notify_log order by at desc;`
  Failures only: `... where not ok`. (The 6s→800ms client spacing fix shipped with the PR
  and was already live — that's the part that actually reduces dropped prform notifies.)
- **`main` BRANCH PROTECTION added**: requires 1 PR approval (no self-merges — the root cause
  of this incident), `enforce_admins: false` (owner's direct ff-push deploy workflow intact),
  force-push + deletion blocked. Set via `gh api PUT .../branches/main/protection`.

## PASSPORT: kkumail-only login gate + 5 gmail→kkumail migrations — DEPLOYED (2026-07-23)

> **STATUS (2026-07-23):** All 5 verification emails **SENT** to the students' gmails
> (recipients verified against B — each is a real scanning profile, no typo lookalikes).
> Awaiting their ✅"เห็นครบแล้ว" / ❌correction replies at **mdstuddata.beta@gmail.com**.
> Data verified SAFE (staged correctly in A, full backup in B, clean re-key on first login).
> **DECISION DEFERRED (user's call next session — do NOT auto-revert):** whether to revert the
> pmphuriphat↔phuriphat.ma **TEST that is still live** (revert SQL in the "ACTIVE TEST STATE"
> block below). Other open: web `appscript/prform.gs` + `STATE.md` + `mistakes.md` are
> **uncommitted on `main`**.
>
> **How to run the tracker / any A or B query next session** (the session scratchpad `qq.mjs`
> is gone after /clear): POST `{query}` to
> `https://api.supabase.com/v1/projects/<ref>/database/query` with header
> `Authorization: Bearer $SUPABASE_ACCESS_TOKEN` (account-wide PAT in `.env.local`; same
> mechanism as `tools/apply-migration.mjs`, works for reads too). Refs: **A**=`fheueuowbchsnsvbcgil`
> (live, holds the `passport` schema), **B**=`idwlabpbwiwgaoqwbozz` (old passport, resumed = backup).

Login was never restricted to @kkumail.com before launch, so some students scanned with a
personal gmail. Fixed in two parts:

- **Data migration (0064, applied to project A `passport` schema):** new table
  `passport.account_migrations` (read-all RLS, NO anon write — verified: anon SELECT 200,
  anon INSERT 401) records each move. 5 students carried gmail→kkumail:
  wariikung→ingwer.s (250), phuri8980→phurichaya.bo (200), kenkunchai50→kenkunchai.ch (200),
  sirikanrayamasena→sirikanraya.m (200) are **email re-keys** (login trigger 0063 re-keys the
  uuid on first kkumail login); kedsaraporn2007→kedsaraporn.t is a **merge** (target already
  existed at 300 km; the gmail scan was a duplicate → stays 300, no double-count). Verified: 0
  gmail-of-the-5 profiles remain, scans intact on kkumail ids. Certs are client-side from
  scans, so they move with the scans. (These 5 had never logged into project A — B-era data.)
- **App gate (passport repo `dfd7078`, deployed to VM):** `getPassportAccess(user)` in
  `js/auth.js` → `moved` (data left this account) / `blocked` (non-kkumail) / `ok(+receivedFrom)`.
  Old gmail login sees a full-screen "ย้ายไป <kkumail>" block; receiving kkumail sees a
  dismissible "ได้รับจาก <gmail>" banner; both cite Vital Sound. Wired into dashboard init +
  scan flow. `DEV_ALLOWLIST=['pmphuriphat@gmail.com']` bypasses the domain check for dev
  testing. Google `hd=kkumail.com` hint added to both signInWithOAuth calls (UX only).
  **Blast radius:** all other non-kkumail Google accounts are now blocked (only these 5 were
  migrated); admin terminal is unaffected (static admin/1234, not Google).

Live-verified: `/var/www/passport/assets/auth-CbfxjhCA.js` served, contains the gate.
**VM deploy gotcha:** `deploy.sh` uses plain `sudo` (needs a tty); priming with `sudo -v` over
a tty-less ssh does NOT cache a timestamp → "a terminal is required". Ran the publish steps
manually piping the password to `sudo -S -p ""` per command instead (the sanctioned pattern).

### Follow-up: verify the guessed kkumail addresses (email) — BUILT, not yet run (2026-07-23)

The 5 kkumail targets in 0064 were **derived from names, not confirmed**. Data landed on
them (verified), but if a guess is wrong the gmail student is hard-locked out (moved block,
no in-app recovery) and their data sits on a kkumail they may not own. To confirm:
- **`appscript/prform.gs sendMigrationVerifyEmails()`** — one-off, run manually from the GAS
  editor (owner-auth → MailApp sends + Logger works; do NOT wire into doPost). Emails each
  student's KNOWN gmail (deliverable) with their kkumail + passport link; ✅ log in & see
  points = done, ❌ reply with the correct @kkumail.com. `replyTo = samomdkku.ai@gmail.com`.
  `DRY_RUN=true` default → sends all 5 to REPLY_TO tagged `[DRY]` for preview; flip to false
  to send for real. `REPLY_TO = mdstuddata.beta@gmail.com` (the GAS owner Gmail — replies land
  there). Needs the updated prform.gs pasted into the Apps Script editor first.
- Correction handling: a reply → re-run a corrected 0064 for that one mapping.
- Dev preview of the notice UI: `passport` repo `preview-migration.html` (`npm run dev` →
  `/preview-migration.html`) renders the real moved/blocked/received UI with mock data.

### Passport login-flow fixes — DEPLOYED to VM (passport `33ddf07`) (2026-07-23)

Two bugs found while testing with a non-kkumail account (`mdstuddata.beta@gmail.com`),
fixed + pushed + deployed (live bundle `auth-DkvvtGPR.js`, `hd:kkumail` gone; nginx reloaded):
- **`hd=kkumail.com` OAuth hint broke login → ERR_ADDRESS_INVALID.** Forcing the Google
  hosted-domain made Google redirect straight to kkumail.com's third-party SAML IdP
  (`ssonext-api.kku.ac.th/sso/SingleSignOnService/kkumail.com.m`), a malformed SSO URL.
  Removed `queryParams.hd` from BOTH OAuth sites (`js/index.js` login btn, `js/scanning.js`
  change-account). `hd` was only a chooser UX hint — the app-side gate is the real
  kkumail-only enforcement, so no enforcement lost. **NEEDS verification with a REAL kkumail
  login: if ERR_ADDRESS_INVALID persists after this, the fault is KKU's SSO federation, not us.**
- **Landing page had no gate** → a blocked non-kkumail session saw "Welcome back / Board Your
  Flight", then hit the wall one click later on the dashboard. Added `gateBlockedAccount()` in
  `js/index.js` (imports `getPassportAccess`/`renderAccessBlock` from auth.js) so a
  moved/blocked session shows the access block on the landing itself.

**Data verified against the OLD passport DB (project B `idwlabpbwiwgaoqwbozz`, resumed 2026-07-23).**
All 5 gmail→kkumail transfers reconcile EXACTLY (B source-of-truth vs A `passport` schema):
wariikung→ingwer.s 250/2✓, phuri8980→phurichaya.bo 200/1✓, kenkunchai50→kenkunchai.ch 200/1✓,
sirikanrayamasena→sirikanraya.m 200/1✓, kedsaraporn2007→kedsaraporn.t 300/2✓ (merge: the dropped
gmail scan was a true duplicate of activity `5f9abe6e` รับน้องบ้านเขียว that the kkumail already
had → no double-count, no loss). A has 0 leftover gmail-of-the-5, 0 orphan scans, 0 dup emails.
**Open flag (NOT one of the 5):** `mintonaurak@gmail.com` (Mint N) has total_km 2700 / 0 scans and
is a non-kkumail, non-migrated account → the gate now BLOCKS it. If Mint N is a real student, their
2700 needs a migration too; if a test/seed account, ignore. (`pmphuriphat@gmail.com` 2800km is the
DEV_ALLOWLIST dev account — not blocked. `prakasa@kku.ac.th` is @kku.ac.th not @kkumail → blocked,
but 0km.)

**Verification email: SENT to all 5 students — 2026-07-23.** Sent to each student's KNOWN gmail
(deliverable) with their own kkumail in the body, via the live `notifyProjectEmail` GAS action
(`tools`-style loop `scratchpad/send-5.mjs`) — all 5 returned `{"success":true}`. Because that
deployed action is **no-reply**, the CTA points at **mdstuddata.beta@gmail.com** (compose-new,
matches the banner) NOT "reply": ✅ → email "เห็นครบแล้ว" to confirm; ❌ → email the correct
kkumail. Feedback lands in the mdstuddata.beta inbox; cross-check with the tracker query above.
(`sendMigrationVerifyEmails()` in prform.gs still exists as the reply-to variant if a resend is
ever needed via the editor; its copy was updated to the same explicit-address CTA.)
**Data-loss check before send (all clear):** the 5 kkumail totals in A unchanged (250/300/200/
200/200, untouched by the pmphuriphat test); project B still holds every original scan as a full
backup; re-key trigger runs before ensureProfile → no stranding. Worst case = wrong guessed
address (reachability, not DB loss) → the email catches it, B recovers.

**Notice contact text → mdstuddata.beta@gmail.com — DEPLOYED (passport `f4733f8`, bundle
`auth-Dli0DAlk.js`).** Both the moved block (`renderAccessBlock`) and received banner
(`renderReceivedBanner`) now say "ติดต่อ mdstuddata.beta@gmail.com" instead of "Vital Sound".

**FEEDBACK TRACKER (objective ✅ signal, no app code):** run this anytime —
```sql
select m.to_email, (u.id is not null) logged_in, u.last_sign_in_at,
       coalesce(p.total_km,0) km_on_kkumail, (p.id = u.id) data_landed
from passport.account_migrations m
left join auth.users u on lower(u.email)=lower(m.to_email)
left join passport.profiles p on lower(p.email)=lower(m.to_email) order by 1;
```
`logged_in` flips true on first kkumail sign-in; `data_landed` true once the re-key trigger fires.

**ACTIVE TEST STATE (revert when done):** for the dev end-to-end test on
`pmphuriphat@gmail.com → phuriphat.ma@kkumail.com`: (1) `account_migrations` row inserted;
(2) pmphuriphat's scan id 69 (สัมมนาสุดยอดผู้นำ, 200pts) moved to phuriphat.ma so the receiving
side actually shows an activity/stamp (phuriphat.ma had 0 scans; its total_km column stays 1100,
a pre-existing dev quirk). While the row exists, pmphuriphat is BLOCKED (moved wins over
DEV_ALLOWLIST). **Revert both:**
```sql
update passport.scans set user_id='5303b3bb-ef49-4352-9e95-4585402623e9' where id=69;
delete from passport.account_migrations where lower(from_email)='pmphuriphat@gmail.com';
```
Verified: the real 5 kkumail have NO pre-existing A auth.users → their first-login re-key trigger
WILL fire (0064 assumption holds) and they WILL see full points; phuriphat.ma pre-existed, so its
test needed the manual scan move above. Previews: `email-preview.html` + `preview-migration.html`
(dev server only — never built into dist, so never on prod).

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

### CUTOVER EXECUTED — passport LIVE on project A (2026-07-22)
**The flip is done and verified lossless.** Passport (`samo.md.kku.ac.th/passport/`)
now reads/writes the `passport` schema of project A; project B is frozen (no
frontend writes to it) and kept as a cold backup. Sequence run: took passport
down (maintenance page) → final recopy B→A (B frozen) → one-time backfill linked
the **60** passport emails that already had an A account to their existing A uid
→ merged `merge/point-at-project-a`→passport main (`8044263`) → VM rebuild +
deploy pointed at A (fixed the VM's `.env.local` which still forced B — Vite
loads `.env.local` over the app.js fallback) → brought up. **Post-flip reconcile
CLEAN**: A == B exactly (469 profiles / 537 scans / 93,846 km / max scan id 648),
0 B-scans missing from A, 0 B-emails missing from A. `0061` extends the signup
trigger to also CREATE a profile for a brand-new user (mirrors B's
`handle_new_user`; verified). Login coverage: existing-in-both (60) backfilled;
passport-only (409) re-key on first A login via `0060`; brand-new signups get a
fresh profile via `0061`.
- **Human check still needed:** sign into `samo.md.kku.ac.th/passport/` with a
  real passport Google account and confirm km/leaderboard (only a human can do
  the OAuth round-trip).
- **Edge FIXED (2026-07-22):** an EXISTING sameweb user (already has an A account,
  never used passport → no profile; 104 of 166 portal users) now gets their
  profile created on demand. `0062` adds a tightly-scoped `profiles_insert_own`
  RLS policy (`with check auth.uid()=id` — verified end-to-end that a user can
  insert only their OWN row, forging another id 403s). Passport app: shared
  `ensureProfile(user)` in `js/auth.js`, called on dashboard load AND before a
  scan insert (so a direct QR-link scan can't land km-less). Best-effort, never
  blocks the UI; duplicate/linked rows no-op. Deployed to VM (`f30b20a`). The 104
  self-heal as each opens passport — no eager mass-create, no leaderboard
  pollution (scan-driven). Note: staff accounts like `samomdkkuvpa` reach passport
  via the shared A session (same origin+project = SSO) and will likewise get a
  0-km profile on their next passport load; harmless.
- **Full audit (2026-07-22) — CLEAN, no data loss / no merge-introduced bug.**
  Verified B⊆A for all 11 tables: **0 B profiles missing by email** (all 469 +
  537 scans + 93,846 km present; the "61 missing ids" are just re-keyed users
  whose id changed B-uuid→A-uuid — email/km intact). 0 dup emails/ids, 0 dup
  (user_id,activity_id) scans, 0 orphan scans, 0 null user_ids, all triggers
  enabled. Two PRE-EXISTING B behaviors carried over faithfully (NOT merge bugs —
  identical in B): (a) `handle_new_scan` trusts client `points_awarded` +
  `scans_insert with_check=true` ⇒ a crafted request can inflate km (B's existing
  design; fix later with a server-side points recompute + tighter insert policy
  if desired); (b) `removeOwnScan` deletes a scan without decrementing `total_km`
  ⇒ `total_km` can exceed sum(scan points) for 9 users (same 9 in B). The app
  leaderboard recomputes from scans, so neither affects standings.
- **Pollution FIXED (0063):** 0061 created a passport profile for EVERY portal
  signup (undesired — portal-only users became passport rows). Reverted the
  trigger to RE-KEY ONLY; profile creation is now exclusively on-demand via the
  app's `ensureProfile` (only when a user actually opens passport). Verified: a
  new portal signup no longer makes a passport profile; existing-passport re-key
  still works. Only 1 pre-0063 pollution row exists (`auriung01`, harmless 0-km).
- **Portal links repointed + DEPLOYED (2026-07-22):** the 5 "SAMO Passport" links
  in the portal (navbar desktop + offcanvas, tools launcher, admin nav,
  departments card) now use same-origin `/passport/` instead of the retired
  `samomdkkupassport.pages.dev`. Live on the VM (samoweb build redeployed).
- **B (project `idwlabpbwiwgaoqwbozz`) is SAFE TO PAUSE (confirmed 2026-07-22).**
  Nothing live depends on B: the VM passport bundle targets A only (0 B refs),
  auth is on A, all data is in A, and the portal links go to the VM. pages.dev
  passport shows the moved-splash (redirects to VM, no B use). Pausing PRESERVES
  data (it's the intended cold-backup state) and frees a free-tier active slot.
  Caveat: rollback (point the VM back at B) would need UNPAUSING first (~mins),
  so keep B paused-not-deleted for a few weeks. Before eventually DELETING B,
  take a final `pg_dump` for a durable off-Supabase backup.
- **B teardown:** keep B paused as backup for a few weeks, then delete. ROTATE
  B's DB password (`PASSPORT_B_DB_PASSWORD` in `.env.local`, pasted in chat).
  Note: while B is paused it can't be read via the Management API (fine — merge
  is done + audited).

### How the cutover was done (historical detail)
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
2. **Expose `passport` schema** in A's API — DONE (2026-07-22, user). Verified:
   `GET /rest/v1/profiles` with anon key + `Accept-Profile: passport` → 200,
   all 469 profiles (leaderboard) readable; sameweb `public` unaffected. A auth
   `uri_allow_list` already covers `https://samo.md.kku.ac.th/**` (passport
   login works on the VM), Google enabled, confirm-email off.
3. **Passport repo — PREPPED, NOT deployed (2026-07-22).** Branch
   `merge/point-at-project-a` (pushed): `js/app.js` createClient →
   `{ db: { schema: 'passport' } }` + hardcoded fallbacks repointed A (so a
   missing build env can't split-brain to B). Build verified: bundle references
   A only (0 B refs), `schema:"passport"` baked in. No `@kkumail` app gate
   exists (never enforced — @gmail users already on leaderboard), so nothing to
   move. Local `.env` (gitignored) also set to A. NOT merged to main / deployed.
4. **Kill split-brain** — largely already handled: passport pages.dev serves the
   moved-splash + redirects to the VM (the only live passport frontend), so
   flipping the VM to A leaves nothing writing to B. Confirm at flip.
5. **THE FLIP (needs a low-activity window for zero-loss):** at a quiet moment —
   (a) fresh recopy B→A: `truncate passport.profiles, passport.scans,
   passport.season_results;` then re-run `scratchpad/copy.mjs` (captures scans
   since the 2026-07-22 snapshot; trigger-disable already handled), verify counts
   A==B; (b) merge `merge/point-at-project-a`→main, push; (c) VM: pull + rebuild
   passport + set VM `~/samo-projects/samomdkkupassport/.env` to A (or confirm
   the A fallback wins) + rsync to `/var/www/passport`; (d) verify live: load VM
   passport, leaderboard reads, sign in as a real student → 0060 re-keys → km
   correct. Reversible: point VM back at B + redeploy.
6. Keep B paused as backup weeks, then delete.

**Why a window:** B is still live taking scans. Flipping mid-activity risks a
scan landing in B in the truncate→deploy gap (or a reconciliation overwrite).
A quiet window (season break / dead hour) makes the delta zero. This is the ONE
remaining data-safety gate — everything else is done + verified.

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

> **DUE NOW (2026-07-23): this file is ~900 lines.** Prune deliberately (NOT rushed) — archive
> the DONE+DEPLOYED sections below the PASSPORT block (SHOP source/0058/0057, hosting migration,
> Passport→samoweb merge Phase 1 [~226 lines], CI-green, Vital Sound, professor, announcement
> pinning, migrations-through-0054) to `docs/state-archive/2026-07-23.md`. KEEP: the PASSPORT
> section (current), Branches, Automation credentials, Open follow-ups, Supabase/GAS config
> notes, Where to look next. Left undone this session on purpose: a botched 700-line prune right
> before a `/clear` is worse than the bloat.

If a future session balloons this file past ~200 lines, prune:

- Past session narratives → `docs/state-archive/YYYY-MM-DD.md` then
  rewrite STATE.md fresh.
- Big architecture write-ups → `docs/CONTEXT.md`.
- Reusable workflows → `skills/*.md`.
- New bug classes → `.claude/rules/mistakes.md`.
- Cross-conversation user facts → auto-memory under
  `/Users/xeno/.claude/projects/.../memory/`.

This file answers "what is true right now". Nothing else.
