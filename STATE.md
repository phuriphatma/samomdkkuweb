# STATE — current task & latest known state

Last updated: 2026-08-07. Read on every cold start, so it is "what is true
RIGHT NOW" and nothing else — `git log --oneline` is the chronology. Keep it
under ~200 lines; when it bloats, move SHIPPED narratives to
`docs/state-archive/YYYY-MM-DD.md` and leave a two-line pointer.

**Start here:** the section immediately below (what just shipped), then CURRENT DEPLOY.

Shipped detail pruned out of here most recently:
`docs/state-archive/2026-08-05-late-13-requests.md` (the 13-request session,
ทีม SAMO view/edit + master, 0110–0113),
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

## SHIPPED 2026-08-07 — every DELETE now reports a block (no migration)

Reported as "can't delete j@kkumail.com in ทีม SAMO". **Not an RLS problem** —
simulating the DELETE as the signed-in account (`phuriphat.ma@kkumail.com`,
holds `master`) inside `begin; … rollback;` returned `deleted_rows: 1`. Cause is
client-side and threefold, all silent: `onDeleteMember`'s `if (!m) return`, a
native `confirm()` the browser can permanently suppress ("Prevent this page from
creating additional dialogs" → every later `confirm()` returns false with no
UI), and `deleteMember()` checking only `error` when PostgREST answers a blocked
DELETE with 204 + zero rows.

- Guards added to all 5 deletes in `team/api.js` + 3 in `shop/api.js`
  (`prefer: 'return=representation'` + `data.length` check), matching what
  projects/vs/announcements already did.
- Both silent early-returns in `team/index.js` now alert + `reload()`.
- `src/js/delete-guard.test.js` sweeps every `method: 'DELETE'` in `src/js` and
  asserts both halves. Verified to FAIL when a guard is removed.
- **OPEN**: the suppressed-`confirm()` diagnosis is the leading cause of the
  reported symptom but is UNCONFIRMED — user to hard-reload and retry. If
  confirmed, replace the 8 native `confirm()` calls in `team/index.js` with an
  app-owned Bootstrap modal. Write-up in `docs/mistakes/frontend-ui.md`.

## SHIPPED 2026-08-07 — ระบบบ้าน (House) + student directory (0116–0118)

**Migrations 0116, 0117, 0118 are APPLIED to the live DB.** Proof:
`node tools/db-query.mjs tools/house0116-authz.sql` (anon DENIED 42501 ·
no-grant 0 rows · master 2 rows · roster leaks no PII · self-edit allow-list
holds). Design: `docs/HOUSE-SYSTEM.md`. Handover spec for the Data Analytics
dept: `docs/house-data-spec-th.md` + `docs/templates/house-import-template.csv`.

- **house = last digit of สายรหัส.** สายรหัส is **3 digits `001`–`100`**,
  assigned at random by the university's mentor system and **NOT derivable from
  รหัสนักศึกษา** — nothing may compute or "repair" one. `sais.house_id` is a
  GENERATED STORED column so the rule has exactly one implementation; JS reads
  it and only recomputes it for the import preview.
- Tables: `houses` (10 seeded, UPDATE-only — INSERT/DELETE revoked), `sais`
  (100 seeded), `advisors` + `sai_advisors`, `students`, `student_change_requests`,
  `student_import_batches`, `house_settings`.
- New permission key **`house`**, threaded through PERM_CATALOG, ADMIN_FEATURES,
  PERM_SECTION, SECTION_META, SIDE_FEATURE, the sidebar and RLS on all 8 tables.
- **NOTHING is gated on a date.** สายรหัส self-edit is an admin switch
  (`sai_self_edit_open`, default ON, one change per student, `sai_locked`
  overrides). No reveal flag either — an unnamed house IS the un-revealed state
  and renders as "บ้าน N".
- ปีที่เข้า is derived from รหัสนักศึกษา (`cohort_from_student_id`), so the CSV
  asks for **7 columns only** — no ชั้นปี, no ปีที่เข้า, no สถานะ.
- Import refuses (does not warn) on mixed สาย widths — the Excel leading-zero
  failure that would put ~180 students in wrong houses invisibly. Never deletes
  rows absent from the file; stamps `missing_since`.
- Runs with **zero data**: admin ภาพรวม says so, students get no card.

**Open**: waiting on the ~1,800-row file from Data Analytics (20-row sample
first). อาจารย์-per-สาย file comes later; that CRUD is already built.

## SHIPPED 2026-08-07 — หนังสือโครงการ publish control (0114) + settings leak closed (0115)

Migrations **0114 and 0115 are APPLIED to the live DB** (proof
`node tools/proj0114-visibility.mjs` → 29/29).

- `projects.is_public` + `project_documents.is_public`, `not null default true`
  (chosen with the user: the mirror was already total, so opt-out).
- The three `*_read_public` policies now read the flags; hiding a โครงการ
  cascades to every หนังสือ + file under it. Actors, and the prof on his own
  documents, are unaffected. Full shape in `docs/CONTEXT.md`.
- Only the sender side may flip it — new
  `current_user_can_publish_project()` (now also the single authority behind
  projects/documents insert + delete), enforced per-COLUMN by the
  `project_public_flag_guard` triggers, because a row-level UPDATE policy
  grants every column (mistakes class 1). `is_public` also added to
  `project_documents_prof_guard`'s immutable list.
- UI: ซ่อน/แสดง buttons on the project header and in each หนังสือ's action row,
  ซ่อน pills on the grid/list/doc rows, and a note on a hidden project's header.
  A หนังสือ whose own flag says "show" inside a hidden โครงการ says
  "ไม่แสดง (ทั้งโครงการถูกซ่อน)" rather than looking live.
- Tests: `src/js/projects/public-visibility.test.js` binds the JS reading of a
  missing flag to the SQL default, and asserts the policies + fail-closed
  helpers + the prof guard entry are actually in the migration.
- `PENDING` in `src/data/changelog.js` carries two notes for the next release.

**0115 — found by the bug scan, not reported.** Sweeping every anon-reachable
read path of หนังสือโครงการ turned up `project_settings_read_public` (0032)
serving the receiving officer's real `@kku.ac.th` address to any visitor. It
had been opened for two display labels that nothing consumed: the only reader,
`ownerLabel()`, had zero call sites and read `uni_label`/`vp_label`, which are
not columns on that row. 0115 drops the anon policy (actors + prof keep
`project_settings_read`), `mountCustomerProjects()` stops fetching the row, and
the dead `ownerLabel()` is deleted. Verified both directions: anon reads 0
settings rows while still reading 24 published projects; vp_admin and sa_prof
read 1 each. Write-up in `docs/mistakes/authz-rls.md`.

Also swept and clean: no VIEW over the project tables; the only anon-executable
SECURITY DEFINER functions touching them are `prof_can_see_*` (booleans, prof-
gated), the two new `project_*_is_public` helpers (booleans) and `public_stats()`
(counts only — it deliberately still counts hidden projects).

## Earlier sessions — pruned

The 13-request session (2026-08-05, late), the ทีม SAMO view/edit + master work
(0110/0111) and the ตำแหน่งของฉัน card are archived in full at
`docs/state-archive/2026-08-05-late-13-requests.md`. All shipped, all live,
nothing owed. Migrations through 0113 are covered there; 0114–0115 are at the
top of this file.


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
- **samoweb**: deployed commit `97c5e3b`, **2026-08-07** (anything after it
  on `main` is docs-only — no bundle change),
  `buildId c9e7bc8f3fb7`, still **v4.5.0** (no version cut — `PENDING` now holds
  the two หนังสือโครงการ publish-control notes for the next release). Verified on
  the SERVED artifacts: `/var/www/samo-web/assets` carries
  `data-projects-toggle-public`, `projects-hidden-pill`, `ซ่อนจากเว็บสาธารณะ` and
  `ไม่แสดง (ทั้งโครงการถูกซ่อน)`, and NO `ownerLabel`; and against the LIVE
  PostgREST with the real anon key, `project_settings` returns `[]` (0115) while
  `projects` returns 24 rows, all `is_public` true. Hiding was proven
  transactionally against real role identities (`tools/proj0114-visibility.mjs`
  29/29) rather than by flipping a live project.
- Previous: `2bbb88ae7a3a` (v4.5.0, 08-06, tag pushed) and `eac07e594ba9`
  (implicit-permission lock fix). **Verified
  by DRIVING the served bundle**, not by grep — signed into
  `https://samo.md.kku.ac.th/admin/#team` in headless Chrome and exercised the
  แก้ไขสิทธิ์ grid: ทีม SAMO (ดู) stays `{checked:true, disabled:true}` on open,
  after a click, and across master ON→OFF, while `pr` still locks with master
  and comes back unchecked; จัดการรายการสาขา opens on prod with its live counts.
  Before that: migration **0113** — คำนำหน้า dropped, the
  `team_majors` vocabulary + CRUD, ชั้นปี/สาขา choosers, the canonical
  รหัสนักศึกษา form, photo upload moved to the SAVE path, the ADMIN_FEATURES
  link gate, the ข้อมูลของฉัน pane, and the navigateTo() scroll fix. See
  "THIS SESSION" at the top for all 13 items and what is still owed.
  **Grep the `analytics-*.js` chunk, not just `public-*.js`** — the ตำแหน่งของฉัน
  card lives there. Verified on the SERVED artifacts at deploy time:
  `/build.json` → `{"buildId":"4198ffa0e667","version":"4.4.0"}`;
  `analytics-*.js` carries `myseat-crumb`, `653070317-0`, `team_majors`,
  `myseat-photo-btn`, `term_year` and `แจ้งอุปนายกฝ่ายของท่าน`; `/admin/` carries
  `teamMajorsModal`, `data-team-mode="me"`, `จัดการรายการสาขา` and NO
  `teamMemberPrefix`.
  Superseded: `61f2f6281e25`, `4198ffa0e667`, `bb074fa12f41`, `f401da0ea2f2`, `c380fc060101` (08-05),
  `9f65ec53b172` (08-04).
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
- Migrations: samoweb `public` 0081–**0113**; passport `db/0010` + `db/0011` + `db/0012`
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

## NEXT-SESSION PROMPT (paste this after a /clear — written 2026-08-07)

> Read STATE.md first — the "SHIPPED 2026-08-07" block at the top, then CURRENT
> DEPLOY. **Everything is shipped and live**: `main` = `97c5e3b`, prod buildId
> `c9e7bc8f3fb7` on `samo.md.kku.ac.th`, migrations applied through **0115**.
> Nothing is in flight and nothing is owed from the last session.
>
> What landed last: หนังสือโครงการ can now be published or hidden from the public
> mirror per โครงการ and per หนังสือ (0114), and `project_settings` stopped being
> anon-readable (0115 — it was serving the officer's real email). Version was NOT
> cut; `PENDING` in `src/data/changelog.js` holds two notes, so the next release
> should be a **minor** bump (`npm run release`).
>
> Three things are open, none blocking:
> 1. **Nobody has hidden a real โครงการ yet.** The enforcement is proven
>    transactionally (`node tools/proj0114-visibility.mjs` → 29/29) and the UI was
>    driven in headless Chrome against fake data, but no live row has been flipped.
>    If the user reports the button "not working", check the RLS denial message
>    first — only vp_admin/dev or the `vpa` seat may flip `is_public`.
> 2. **No human has reviewed the Thai copy** in the ซ่อน/แสดง buttons, the confirm
>    dialog, or the two `PENDING` release notes.
> 3. The older ones still stand: **0108's contract step is owed** (`createMember`
>    and the CSV import still write `person_id = null`, so rows added since 0108
>    are unlinked — fix with a BEFORE INSERT trigger or re-run the idempotent
>    backfill); the team photo SAVE path is unverified by hand; and
>    `team_person_mirror_down()` wants the `app.team_sync` flag if `team_people`
>    ever gets a self-service surface (not reachable today).
>
> **Decided — do not re-raise:**
> - **Public visibility defaults to SHOWN** (opt-out). Asked and answered: the
>   mirror was already total, so defaulting to hidden would have emptied the
>   public page on deploy day. This is deliberately the opposite of the safe
>   default for a NEW public projection.
> - **`public_stats()` still counts hidden โครงการ / หนังสือ** in its anon-visible
>   totals. Counts only, never a title, and the work really happened.
> - **`ฝ่ายเอิงtest` test data stays live**, and **the second `ภู` row on
>   `หัวหน้าฝ่าย IT` stays** — both are the user's own test rows, knowingly kept.
>   The `ภู` pair is the only duplicate kkumail-on-one-node in the tree, so a
>   duplicate check that fires on it is finding the known one.
>
> Otherwise the backlog is `docs/NEXT.md`, and the roles/photos design with its
> five open decisions is `docs/TEAM-ROLES-AND-PHOTOS.md`.
