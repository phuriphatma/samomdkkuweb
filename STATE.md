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

## SHIPPED 2026-08-07 — ระบบบ้าน (House) + the DELETE guard

Migrations **0116–0121 APPLIED**. Full reasoning, the five scan-found bugs and
every live proof: **`docs/state-archive/2026-08-07-house-system.md`**. Headlines:

- **ระบบบ้าน is live and works with zero data.** `house = last digit of สายรหัส`;
  สายรหัส is 3 digits, **any `001`–`999`**, random, NOT derived from
  รหัสนักศึกษา. `sais.house_id` is GENERATED (one implementation of the rule);
  `sais` itself is DERIVED from the import, never seeded. Nothing is gated on a
  date and there is no reveal flag — an unnamed house renders as "บ้าน N".
  New permission key **`house`**.
- **Every DELETE now reports an RLS block** (5 in `team/api.js`, 3 in
  `shop/api.js`), swept by `src/js/delete-guard.test.js`.
- **Example data no longer uses a real student's identity** — `659999999-9` and
  Thai textbook names replace the owner's real รหัส/name/email, which had reached
  two live form placeholders in a PUBLIC repo.

## SHIPPED 2026-08-07 — หนังสือโครงการ publish control (0114 + 0115)

Applied and live. `projects.is_public` + `project_documents.is_public` (opt-out,
default shown); only the sender side may flip it, enforced per-COLUMN by trigger
because a row-level UPDATE policy grants every column. 0115 closed an
anon-readable `project_settings` row that was serving a staff member's real
email. Proof `node tools/proj0114-visibility.mjs` → 29/29. Detail:
`docs/state-archive/2026-08-07-house-system.md` is the HOUSE archive; this one's
detail is in `git log` + `docs/CONTEXT.md`.

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
  Deploy = commit → push `main` → `skills/deploy-vm.md`. **Needs VPN.**
- **samoweb**: `main` = `d62a374`, deployed and verified on the SERVED artifacts
  (not the local files). Still **v4.5.0** — no version cut; `PENDING` in
  `src/data/changelog.js` holds notes for หนังสือโครงการ, the DELETE fix and
  ระบบบ้าน, so the next release is a **minor** bump (`npm run release`).
- **Migrations applied through 0121.** Live proofs, both directions:
  `node tools/db-query.mjs tools/house0116-authz.sql` (house authz) and
  `node tools/proj0114-visibility.mjs` (29/29, projects visibility).
- ⚠️ **Rotate the VM sudo password.** A malformed ssh call echoed it into a
  session transcript on 2026-08-07. Change it on the VM and update
  `SAMO_VM_SUDO_PASSWORD` in `.env.local`.

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

## Housekeeping — the memory system

Restructured 2026-08-05 and stable since. **Do not re-create
`.claude/rules/mistakes-archive.md`** — it lived in the auto-loaded directory, so
archiving into it saved nothing.

| | where | loaded |
|---|---|---|
| recurring **classes** + a 1-line index of every entry | `.claude/rules/mistakes.md` | every session |
| the **write-ups**, nine files by area | `docs/mistakes/*.md` | on demand |

- **The index is GENERATED** — `npm run mistakes:index`. Never hand-edit it; if a
  line reads badly, fix the heading it came from.
- **The budget is ENFORCED** — `npm run check:context` (run by `npm test`) fails
  when an auto-loaded file exceeds its cap. **When it breaches, move detail into
  `docs/`. Never raise the cap** — reaching for the cap is what caused the 63k-token
  problem this replaced.
- **Release notes are staged as the work ships** — `PENDING` in
  `src/data/changelog.js`, folded in by `npm run release`. Not rendered on
  `/updates`: an unreleased list on a public page is a promise.
- **STATE.md**: keep COMPLETED work in `docs/state-archive/`; leave only what is
  true right now. `git log --oneline` is the chronology.
- `.env.local` holds the Supabase PAT, VM sudo pw, project-B DB creds — never commit.
- CI = Node 22. `npm run build && npm test` before every commit.

## NEXT-SESSION PROMPT (paste this after a /clear — written 2026-08-07)

> Read STATE.md first: the SHIPPED block at the top, then CURRENT DEPLOY.
> **Everything is shipped and live.** `main` = `d62a374` on
> `samo.md.kku.ac.th`, migrations applied through **0121**, 470 tests green.
> Nothing is in flight.
>
> What landed last: **ระบบบ้าน (House)** — every student in the faculty gets a
> record they see by signing in with kkumail, plus a house derived from their
> สายรหัส. Design `docs/HOUSE-SYSTEM.md`; the session's full reasoning and every
> live proof is `docs/state-archive/2026-08-07-house-system.md`. Also: every
> DELETE in the app now reports an RLS block instead of silently succeeding.
>
> **The one thing actually waiting: the student data has not arrived.** The
> handover spec to send the Data Analytics dept is `docs/house-data-spec-th.md`
> (forward it as-is; template `docs/templates/house-import-template.csv`). They
> send **20 rows first**, then the full ~1,800. Import at
> `/admin/` → ระบบบ้าน → นำเข้าข้อมูล: it previews, and writes nothing until
> confirmed. Until then every pane renders an honest empty state — that is
> designed, not broken.
>
> Open, none blocking:
> 1. **The ทีม SAMO delete diagnosis is UNCONFIRMED.** "Nothing happens" on the
>    trash button is almost certainly Chrome's "Prevent this page from creating
>    additional dialogs" making `confirm()` return false silently. A hard reload
>    settles it. If confirmed, replace the 8 native `confirm()` calls in
>    `team/index.js` with an app-owned Bootstrap modal.
> 2. **Real student identities are in the public repo.**
>    `supabase/migrations/0047_seed_team_data.sql` seeds ~285 real members
>    (names, kkumail, รหัส) and several `docs/mistakes/*.md` write-ups quote real
>    students. Deliberately NOT rewritten — 0047 is applied history and the
>    write-ups describe real incidents. Removing them from the working tree does
>    not remove them from git history, which is already public. Needs the user's
>    decision: accept, rewrite history, or make the repo private.
> 3. **Rotate the VM sudo password** (see CURRENT DEPLOY).
> 4. Older, still true: **0108's contract step is owed** (`createMember` and the
>    CSV import still write `person_id = null`); the team photo SAVE path is
>    unverified by hand.
>
> **Decided — do not re-raise:**
> - **สายรหัส is NOT derived from รหัสนักศึกษา.** It is the university's random
>   mentor assignment; nothing may compute, infer or "repair" one. Any `001`–`999`
>   is legal and **no maximum may be hardcoded** — that bug has been made twice.
> - **house = last digit of สายรหัส**, and `sais.house_id` (GENERATED) is the only
>   implementation. JS reads it; `houseOf()` exists solely for the import preview.
> - **ชื่อ and นามสกุล stay separate** in `students` (joined by a generated
>   `full_name`). Separate→combined is lossless; combined→separate is a guess that
>   breaks on `ณ อยุธยา`. ทีม SAMO keeps its single field — do not migrate it.
> - **Nothing is gated on a date**, and there is **no reveal flag** — an unnamed
>   house is the un-revealed state.
> - **Public visibility of หนังสือโครงการ defaults to SHOWN** (opt-out).
> - **`ฝ่ายเอิงtest` and the second `ภู` row on `หัวหน้าฝ่าย IT` stay** — the
>   user's own test rows, knowingly kept.
>
> Backlog: `docs/NEXT.md`. Roles/photos design with five open decisions:
> `docs/TEAM-ROLES-AND-PHOTOS.md`.
