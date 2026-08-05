# STATE — current task & latest known state

Last updated: 2026-08-05. Read on every cold start, so it is "what is true
RIGHT NOW" and nothing else — `git log --oneline` is the chronology. Keep it
under ~200 lines; when it bloats, move SHIPPED narratives to
`docs/state-archive/YYYY-MM-DD.md` and leave a two-line pointer.

**Start here:** the section immediately below (what just shipped), then CURRENT DEPLOY.

Shipped detail pruned out of here most recently:
`docs/state-archive/2026-08-05-shipped.md` (the org-chart accordion, the first
ตำแหน่งของฉัน card, `/updates` + the version system),
`docs/state-archive/2026-08-04-shipped.md` (the GAS/Drive migration, the
article-cover fix and the earlier shipped list),
`docs/state-archive/2026-07-31-team-0104-detail.md` and
`docs/state-archive/2026-07-30-pre-clear.md`; earlier narrative:
`docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: **`docs/mistakes/*.md`** (indexed by `.claude/rules/mistakes.md`
— see Housekeeping at the bottom; the corpus moved out of `.claude/rules/` on
2026-08-05 and the archive file is gone).

## ทีม SAMO view/edit + master + the full ตำแหน่งของฉัน card — LIVE

**SHIPPED 2026-08-05.** KKU VM deployed, **`buildId bb074fa12f41`**;
migrations **0110 + 0111 + 0112 applied**. Verified against
the SERVED bundle, not the local build.

What landed: `team` (ดู) / `team_edit` (แก้ไข) split with view granted implicitly
to everyone holding a posting · `master`, one grant carrying every permission ·
the ตำแหน่งของฉัน card showing the whole record with an inline self-edit · one
tabbed แก้ไข…/แก้ไขสิทธิ์ editor reachable from both ทีม modes · a read-only tree
for view-only members.

**Four bugs were found AFTER the first deploy and are fixed in this one** —
worth knowing because three of them only appear on the second interaction, which
is exactly what a single manual pass misses:
1. the permission grid carried the PREVIOUS row's state into the next one (would
   have SAVED wrong permissions — data corruption, not cosmetic);
2. the แก้ไขสมาชิก modal could not scroll (the tab refactor broke Bootstrap's
   `modal-dialog-scrollable` flex chain);
3. KKU Mail broke mid-address on the card;
4. the card jumped when opening the edit form (trigger at the bottom, form in
   the middle).
Write-ups: `docs/mistakes/frontend-ui.md`.

**Verification gotcha — read before concluding a deploy failed:** the
ตำแหน่งของฉัน card is code-split into the shared **`analytics-*.js`** chunk, NOT
`public-*.js`. Grepping only `public-*.js` reported every marker MISSING on a
perfectly good deploy. Fetch every `/assets/*.js` the entry links.

**A design call that was reversed, worth knowing about:** `sid_clash` shipped as
a documented "the card cannot compute this" gap — a clash is a fact about TWO
people and the payload carries one. The user pushed back: it is the person's OWN
รหัส and they should see it when they log in. Migration **0112** returns one
extra fact (`student_id_shared_with`, a COUNT, never a name) and the card now
reports it. The rule engine was NOT re-implemented in SQL. If another finding
turns out to be uncomputable client-side, copy that shape.

**A proof script went red for a CORRECT reason and was re-pointed:**
`team0110-view-edit.mjs` asserted "4 nodes + 2 members hold `team_edit`" — a
snapshot of live data. Someone edited a ตำแหน่ง's permissions in the admin UI
and it failed. It now asserts the invariant that matters ("somebody still holds
`team_edit`, so the tree is still manageable"). **This repo keeps re-learning
this**: never assert a count of live rows; assert the property.

**Known, NOT fixed — needs your call:**
- **`ฝ่ายเอิงtest` test data is live**, on the public org chart AND now inside
  real people's ตำแหน่งของฉัน card (it renders a second posting called `hi`
  under `ฝ่ายเอิงtest › เอิงnew › เอิงsubtest`). Deleting it is a data change,
  so it has been left alone — but it is now visible to the person it belongs to.
- **No human has reviewed the Thai copy** on the card, the Master confirm
  dialog, the read-only notice, or the eight staged release notes. I cannot
  judge natural Thai.
- `team_person_mirror_down()` (0108) writes guarded columns without setting the
  `app.team_sync` flag. Unreachable by a non-editor today; give it the flag if
  `team_people` ever gets a self-service surface.

## `master` grant + greeting fix (0111)

Migration **0111 applied**. Proof `tools/master0111-grant.mjs` → **30/30**.

- **`master`** is a ทีม SAMO permission that answers YES to every permission
  question. Built by teaching `current_user_has_permission()` — the one
  predicate every gate already calls — rather than OR-ing a new helper into ~40
  policies. `current_user_project_seats()` was the only helper needing separate
  treatment (it reads `managed_project_seats` directly); it returns all three
  seats for a master.
- **It is NOT `role='dev'`, on purpose.** `current_user_is_staff()` is
  untouched, because `users_self_update_guard` trusts it — widening it would let
  a master self-promote to `role='dev'`, a permanent escalation the tree could
  no longer revoke. Asserted in the proof. Three role-only surfaces stay closed
  and this is correct: `users_update_staff` (role assignment),
  `notify_log_select_staff`, `reserved_staff_usernames_read_staff`. **If you
  want one of those, grant a real staff role — do not widen
  `current_user_is_staff()`.**
- UI: last in the grid, `danger: true`, a `confirm()` on the way in, the other
  keys shown ticked-and-locked while it is on, and stored as `['master']` alone.
- **Home greeting no longer says "ยังไม่ได้ระบุฝ่าย".** For a ทีม SAMO member it
  was simply wrong — their ฝ่าย lives in the org tree, not `users.department` —
  and for everyone else it nagged about a field they cannot set there. The line
  is hidden when empty; the ตำแหน่งของฉัน card carries the real answer. The card
  also said the person's name TWICE (header + beside the portrait); it now says
  it once, with the prefix and ชื่อเล่น.

### ทีม SAMO view/edit split + the full ตำแหน่งของฉัน card (0110)

Proof `tools/team0110-view-edit.mjs` → **41/41**; tabbed modals driven in
headless Chrome (9/9).

- **`team` = ดู, `team_edit` = แก้ไข.** Everyone with a posting in the tree gets
  `team` implicitly — injected once in `effective_team_permissions_for_email()`
  rather than as a new access channel, so RLS, `userCanAccess()` and
  `ADMIN_FEATURES` all honour it with no new plumbing. Today's 4 nodes + 2
  members that held `team` were rewritten to `team_edit`.
  **⚠️ Privacy, explicitly chosen by the user when shown the consequence:** all
  ~285 people in the tree can now read all ~404 member rows, including other
  people's รหัสนักศึกษา and kkumail. The PUBLIC org chart is unchanged (still the
  `get_public_team_chart()` projection; `team_members` still has no anon policy —
  asserted over real HTTPS in the proof).
- **A member can fix their own row** — `team_members_update_self` + a
  deny-by-default column guard. Only name/nickname/รหัส/ชั้นปี/สาขา/photo;
  `permissions`, `vs_dept`, `project_seat`, `node_id` and `kkumail` are all
  refused (9 escalation probes).
- **ตำแหน่งของฉัน now shows the whole record** — portrait, ชื่อเล่น, รหัส, ชั้นปี,
  สาขา, kkumail — plus that person's own ตรวจสอบข้อมูล findings and an inline fix.
  The findings come from the SAME engine as the admin pane: the pure rules moved
  out of `team/health.js` into **`src/js/team/identity.js`** (health.js re-exports
  them, so every existing importer is untouched). `sid_clash` is the one finding
  the card cannot compute — it needs other people's rows, which the payload
  deliberately does not carry — and it is also the one a person cannot fix alone.
- **One editor, two tabs.** `teamPermModal` / `teamMemberPermModal` are gone;
  `teamNodeModal` and `teamMemberModal` now each carry แก้ไข… / แก้ไขสิทธิ์ tabs,
  reachable from BOTH จัดการทีม and จัดการสิทธิ์ — the mode only picks which tab
  leads. Both `<form>`s and their submit handlers are unchanged; the single
  footer button `requestSubmit()`s whichever pane is active.
- **View-only members see a read-only tree** — `canEdit()` gates every write
  affordance at RENDER time (no drag handles, no add/edit/delete buttons, no
  bulk select, modal inputs disabled), so nobody gets a live-looking button that
  42501s.

**Known gaps / next:**
- **Not rendered in a browser as a signed-in member.** The tab mechanism was
  driven headless against a harness; the read-only tree, the enriched card and
  the self-edit round trip have NOT been seen with real data. Worth one pass.
- `sid_clash` is invisible on the card (see above) — deliberate, but if members
  start asking "why does ตรวจสอบข้อมูล say I have a problem I can't see", that is
  why.
- `team_person_mirror_down()` (0108) writes guarded columns without setting the
  `app.team_sync` flag. Unreachable by a non-editor today; if `team_people` ever
  gets a self-service surface, give it the flag.

## Shipped & stable (2026-08-04 → 08-05) — detail archived

The public org chart accordion + the first `ตำแหน่งของฉัน` card, and the
`/updates` release notes + the `MAJOR.MINOR.PATCH` version system + the
เบื้องหลังการพัฒนา panel. Both live and verified against the served bundle.
Full write-ups: `docs/state-archive/2026-08-05-shipped.md`.

## ทีม SAMO — shipped 2026-08-01, still true

Crop-on-upload, stacked modals, real Drive photo deletes (a REFCOUNT — an
archived year shares the live photo's file id), and the ตรวจสอบข้อมูล pane
(24 findings, flags WHO on each member row and rolls counts up the tree).
Migration **0108 `team_people`** is applied but EXPAND-ONLY: nothing reads it,
all ten resolvers still join `team_members.kkumail`.

**The rule that governs it: kkumail is the identity, รหัสนักศึกษา is a field.**
Never merge on name — `673070332-6` is one mistyped รหัส shared by two humans.

**0108's contract step is still owed, and its first job is the INSERT gap:**
`createMember` and the CSV import write `person_id = null`, so rows added since
0108 are already unlinked. Fix with a BEFORE INSERT trigger or re-run the
(idempotent) backfill. Full reasoning: `docs/state-archive/2026-08-01-team-identity.md`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- **samoweb**: `main` head, **deployed 2026-08-05**, `buildId bb074fa12f41`.
  Latest: ทีม SAMO view/edit split + `master` (migrations 0110/0111), the full
  ตำแหน่งของฉัน card with self-edit, the tabbed member/ตำแหน่ง editor, and the
  post-deploy fixes above. **Grep the `analytics-*.js` chunk, not just
  `public-*.js`** — the card lives there.
  Superseded: `f401da0ea2f2`, `c380fc060101` (same day), `9f65ec53b172` (08-04).
  Latest change: public release notes at `/updates`, the `MAJOR.MINOR.PATCH`
  version system (**v4.4.0**, tag pushed), and the เบื้องหลังการพัฒนา panel on
  the landing page. Verified against the SERVED artifacts: `/build.json` returns
  `{"buildId":"9f65ec53b172","version":"4.4.0"}`, `/updates` → 200 carrying
  `id="clList"` / `id="devActivity"` / `cl-hero-aurora`, and `IT SAMO` appears
  twice in `/assets/public-*.js`. The 2026-08-01 ทีม SAMO deploy (`28c757c`,
  `buildId e74de393eebd`) is included in this one.
- **passport** (separate repo): code `b57eb1e` **deployed 2026-07-30** (pulled
  + built by `deploy.sh` alongside samoweb). Served bundles
  verified by grep: `stamp_scan` in the scan chunk, `leaderboard_names` in
  dashboard, `admin_leaderboard` + the shared-admin email in admin,
  `sb-passport-legacy-admin` in the shared chunk, and no `from('scans').insert`.
- Migrations: samoweb `public` 0081–**0112**; passport `db/0010` + `db/0011` + `db/0012`
  ALL applied — passport authorization is now enforced server-side (NEXT #3).
- Verify any deploy by grepping the served bundle for feature strings — NOT by
  hash (Mac vs VM hashes differ). For samoweb the shared `analytics-*.js` chunk
  carries auth.js.
- Deploy method: `ssh samo-vm` → `cd ~/samo-projects/samomdkkuweb` →
  `./server/deploy.sh` (pull → `npm ci` → build → `sudo rsync dist/` →
  `/var/www/samo-web` → chown → restart notify → `nginx -t` + reload; also builds
  passport with `PASSPORT_BASE=/passport/`). `deploy.sh` uses BARE `sudo`, which
  needs a tty. **The `ssh -tt` + `sudo -S -v` priming recipe previously recorded
  here does NOT work** — the cred cache does not carry into deploy.sh's own sudo
  calls and it still dies "A terminal is required to authenticate", AFTER both
  vite builds have run. Use an askpass helper instead (no tty needed, verified
  2026-07-31, PW = `.env.local` `SAMO_VM_SUDO_PASSWORD`):
  ```sh
  PW=$(grep '^SAMO_VM_SUDO_PASSWORD=' .env.local | cut -d= -f2- | tr -d '"'"'"'"')
  printf '%s\n' "$PW" | ssh samo-vm 'read -r PW;
    printf "#!/bin/sh\nprintf %%s \"\$SAMO_PW\"\n" > /tmp/askpass.sh; chmod +x /tmp/askpass.sh
    cd ~/samo-projects/samomdkkuweb && git pull --ff-only &&
    SAMO_PW="$PW" SUDO_ASKPASS=/tmp/askpass.sh bash -c "
      sudo() { command sudo -A \"\$@\"; }; export -f sudo; bash server/deploy.sh"
    rm -f /tmp/askpass.sh'
  ```
  Pull manually first (as above) — deploy.sh re-execs itself after its own pull,
  and the manual pull keeps that transition honest. Bundle content-hashes differ Mac vs VM
  (dep/Node deltas) — verify a deploy by grepping the served bundle for feature
  strings, not by hash-matching.
- One Supabase project `fheueuowbchsnsvbcgil` (web `public` + passport in `passport`
  schema). Migrations applied through `tools/apply-migration.mjs` (Management-API PAT).
  **To INVESTIGATE the DB, use `tools/db-query.mjs <file.sql>`, not
  apply-migration** — the latter truncates its echoed result at 2000 chars
  without saying so, which turns any introspection query (policy dumps,
  `pg_get_functiondef` sweeps, column lists) into a confidently wrong answer.
  **`db-query.mjs` COMMITS** — "READ-ONLY" in its header is intent, not an
  enforced mode. Any write probe you run through it lands in production, and a
  plpgsql `exception when others` block only rolls back the FAILING sub
  transaction, so the probes that SUCCEED persist. End every investigative file
  with `rollback;`, and snapshot what you are about to disturb
  (`select <col>, count(*) … group by 1`) before the first write probe — that
  diff is what caught a real ticket being moved on 2026-07-31. Details in
  `.claude/rules/mistakes.md`.
  Both run as the Postgres SUPERUSER: `auth.uid()` is null and RLS is bypassed,
  so to see what a REAL user sees you must `set_config('role', …)` +
  `set_config('request.jwt.claims', …)` inside `begin; … rollback;` — every
  `tools/*` proof script is built that way and is the template to copy.

## NEXT — un-started work → `docs/NEXT.md`

The backlog (with the reasoning behind each item, including the
`notifyProjectEmail` content-hardening options) lives in **`docs/NEXT.md`**; the roles/permissions + member-photo design is a separate,
fuller document at **`docs/TEAM-ROLES-AND-PHOTOS.md`** (written 2026-08-04,
nothing built, and it ends with five decisions the user has to make).

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

## Housekeeping — the memory system (2026-08-05, RESTRUCTURED)

**The old prune-and-archive loop is retired. Do not re-create
`.claude/rules/mistakes-archive.md`.**

Everything in `.claude/rules/` plus `CLAUDE.md` is injected into EVERY agent
session. That had reached **251k chars ≈ 63k tokens — a quarter of the context
window, spent before the user types anything** — because 118 full write-ups
lived there. The archive file did not help: it is in the same auto-loaded
directory, so it loaded too. It had been split along a *budget* axis
("stable/niche") rather than a *topic* axis, which also made it useless for
retrieval.

Now **26k chars ≈ 6.5k tokens** (a 90% cut), split by what each layer is for:

| | where | loaded |
|---|---|---|
| recurring **classes** (now seven) + a 1-line index of all 117 entries | `.claude/rules/mistakes.md` | every session |
| the 117 **write-ups**, nine files by area | `docs/mistakes/*.md` | on demand |

- **The index is GENERATED** — `npm run mistakes:index` rebuilds it from the
  `## ` headings in `docs/mistakes/`. Never hand-edit it; if a line reads badly,
  fix the heading. The previous hand-written "what's in the archive" blurb had
  already rotted, which is why this one is mechanical.
- **The budget is ENFORCED** — `npm run check:context` fails when an
  auto-loaded file exceeds its cap or a new undeclared `.md` appears in
  `.claude/rules/`. `npm test` runs it (`tools/memory-system.test.js`, 10
  tests: budget, index freshness, no duplicate entry across the nine files, no
  write-up shape back in the hot file). All three guards were verified to FAIL
  when deliberately broken, per class 7.
- **When a file breaches its budget, move detail into `docs/`. Never raise the
  cap.** That is the lever the old loop reached for and it is what got us here.
- `AGENTS.md` was a stale copy of `CLAUDE.md` naming a `.Codex/rules/`
  directory that has never existed (and pages.dev as prod). Collapsed to a
  pointer — one router, no mirror.
- **Release notes are now staged as the work ships.** `PENDING` in
  `src/data/changelog.js` collects user-visible changes in the commit that
  ships them (end-of-turn loop step 3); `npm run release` folds it into the new
  version and clears it. It is NOT rendered on `/updates` — an unreleased list
  on a public page is a promise, and this project has a standing rule against
  promising cadence. `changelog.test.js` holds staged notes to the same
  no-identifiers standard as released ones (it caught a bad `area` immediately).

- **STATE.md is ~350 lines against CLAUDE.md's ~200 budget.** Prune by moving
  COMPLETED items to `docs/state-archive/`, and leave `NEXT` as only what is
  genuinely un-started. `NEXT` is the actual handover — prune it as items are
  completed, not to hit the number.

- `.env.local` holds the Supabase PAT, VM sudo pw, project-B DB creds — never commit.
- CI = Node 22 (supabase-js WebSocket). `npm run build && npm test` before every
  commit — 140 tests green at session end; isolation proof 23/23.
