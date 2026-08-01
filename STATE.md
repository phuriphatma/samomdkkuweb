# STATE — current task & latest known state

Last updated: 2026-07-31. Slim by design — "what is true right now". Shipped
detail pruned out of here most recently:
`docs/state-archive/2026-07-31-team-0104-detail.md` and
`docs/state-archive/2026-07-30-pre-clear.md`; earlier narrative:
`docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: `.claude/rules/mistakes.md`.

## SHIPPED 2026-07-31 (earlier) — pruned to the archive

VitalSound `vs_transfer_dept` (0107) + two-directional เรื่องซ้ำ, and ทีม SAMO
portraits + ปีการศึกษา (0104–0106). All applied, deployed, verified. Full text:
`docs/state-archive/2026-07-31-vs-and-team.md`. Post-mortems are the newest
entries in `.claude/rules/mistakes.md`.

## IN THE WORKING TREE, NOT COMMITTED (2026-08-01) — ทีม SAMO photo crop + modal stacking

Frontend only; no migration, no deploy. `npm run build` + `npm test` (203) green.

- **จุดโฟกัสของรูป is gone from the UI.** Picking a photo now opens a pan/zoom
  crop dialog (`src/js/image-crop.js` + `src/css/image-crop.css`, imported by
  BOTH `main.css` and `admin.css` because the public self-service profile below
  will need it) and what uploads is already 3:4. `photo_focus` stays in the DB
  and in `org-chart.js` — legacy and archived rows still carry `top`/`bottom`
  and must keep rendering right; new uploads write `center`, which makes lh3's
  `-c` crop exact and halves the per-card bytes. Geometry is a pure exported
  `cropGeometry()` with 8 tests.
- **Stacked modals now stack.** `src/js/modal-stack.js`, wired into both
  entries. Bootstrap gives every modal z-index 1055, so DOM order decided
  painting order and `#teamPickerModal` (declared line ~149) rendered BEHIND
  `#teamMemberModal` (line ~372) — the reported "ตำแหน่ง picker shows behind
  the member editor". One delegated `show.bs.modal` listener lifts each stacked
  modal + its backdrop.
- **Two bugs found off a screenshot**: `.team-photo-field/-preview/-controls/
  -empty` were in `tab-team.html` with NO CSS anywhere, so the preview `<img>`
  rendered at natural size and burst out of the modal; and
  `convertDriveUrl(url, 320)` returns an already-lh3 URL **untouched**, so its
  size argument is silently ignored for exactly the rows this app writes. Both
  preview call sites now use `portraitSrc()`, which rebuilds the option string.
- `decode()` in `image-resize.js` now passes `imageOrientation: 'from-image'`
  so createImageBitmap agrees with the `<img>` fallback on EXIF-rotated phone
  photos.

## 0108 APPLIED — team_people (store each person once). EXPAND STEP.

**Applied to the live DB 2026-08-01.** `tools/team0108-people.mjs` is the proof:
it runs the real migration file against the real data inside a transaction that
ROLLS BACK, then asserts. 12/12 both before and after applying — the second run
is also the idempotency check, since re-running the whole migration produces the
same 303 people rather than a second set. `team0089-manage` 5/5,
`team0104-terms` 40/40, `proj0086-seats` 24/24, `vs0083-scope` 16/16,
`security-sweeps` clean afterwards.

**403 team_members rows → 303 people.** Higher than the ~285 humans actually in
the roster, and that is the rule refusing to guess: ambiguous rows stay split
until someone resolves them in ตรวจสอบข้อมูล.

**Nothing reads `team_people` yet.** Ten resolvers (`effective_team_*_for_email`,
`node_effective_*`, `sync_my_team_permissions`) still join on
`team_members.kkumail`, every policy is unchanged, and the proof asserts zero
accounts whose `managed_permissions` would resolve differently. The contract
step — switching writes to the person, then dropping the duplicated columns — is
a later migration. **Do not repoint a resolver without moving all ten.**

Three things in it worth not undoing:
- **The mirror is ONE-directional (person → its placements).** A two-way mirror
  between a table and its own denormalised copy is the "two implementations of
  one rule drift" entry wearing a trigger. While the UI still writes to
  `team_members` a person row simply goes stale, which is harmless because
  nothing reads it. The proof asserts the upward direction does NOT happen.
- **The backfill disables `touch_team_members_updated_at`.** Stamping
  `person_id` is bookkeeping, but `team_term_status` (0105) derives
  "ผังสดเปลี่ยนแล้ว · ควรเผยแพร่ซ้ำ" from `max(updated_at)` — leaving it on
  flagged every published ปีการศึกษา as stale for a change no human made. The
  proof caught this: it snapshots the columns BEFORE the migration and diffs,
  rather than inferring from `updated_at`, which is itself one of the things
  that must not move.
- **`revoke all … from anon` is explicit**, not left to "RLS returns no rows
  anyway". Supabase's default privileges hand `anon` a SELECT grant on new
  public tables.

## NEXT — self-service member profile (design DECIDED 2026-08-01, nothing built)

**The model**: kkumail is AUTHENTICATION (any KKU student has one), a
`team_members` row is AUTHORIZATION, and the tree — nodes, hierarchy, ตำแหน่ง,
สิทธิ์ — stays admin-only. A member edits FIELDS ON their row, never WHERE the
row sits. That is what keeps an open door from turning into a messy org chart,
and what stops a random kkumail student getting anything.

**Decisions the user made** (don't re-litigate):
1. Not on the roster → a REQUEST FORM into an admin approval queue. Two request
   kinds, one queue: `claim` ("this existing row is me" — links kkumail to a row
   an admin already typed) and `join` ("I'm not listed, here's my info"). The
   person does the data entry; the admin does only the placement, which is the
   part that needs judgement. Graduated seniors / Discord outsiders are simply
   never approved — their record already lives in the published year archive.
2. Self-uploaded photos go LIVE immediately, no flag, no moderation queue.
3. A signed-in roster member MAY see other members' details — the user's call,
   stated as "it's not that sensitive data". The directory projection still
   omits `permissions` / `inherit_permissions` / `vs_dept` / `project_seat` /
   `passport_dept_id` / `user_id`: who holds which grant is a targeting map and
   costs nothing to leave out.

**Non-negotiables, each one a scar in this repo:**
- Self-edit goes through a SECURITY DEFINER RPC with an explicit column
  allow-list — NOT `for update using (user_id = auth.uid())`. That class has
  already bitten `users` (0028), `vs_tickets` (0096) and `shop_orders` (0100);
  here it would let a member self-grant `permissions` / `project_seat` /
  `vs_dept` / `passport_dept_id` or move their own `node_id`.
- Reads go through a projection RPC too. `team_members` has NO public SELECT
  policy today and must never get one — a row carries every student's kkumail,
  รหัสนักศึกษา and สิทธิ์ (0086 wrote this down; `using (true)` can never be
  narrowed later because policies are OR'd).
- Approving a `claim` CAN CONFER PERMISSIONS: kkumail feeds
  `effective_team_permissions_for_email`, so approving someone onto หัวหน้าฝ่าย IT
  hands them that ฝ่าย's grants. The approval dialog must name the grants it is
  about to give — the privilege-escalating direction gets the strong confirm.
- Discord is NOT an identity source (a bot + OAuth buys no authorization we
  don't have). It is the announcement channel that points people at the page.

The crop dialog is already public-entry-ready: `image-crop.css` is imported by
`main.css` as well as `admin.css` precisely so the member-facing photo upload
can reuse it.

**IDENTITY RULE, decided 2026-08-01 — kkumail is the identity, รหัสนักศึกษา is a
field.** Reasons: the permission engine already resolves by email
(`effective_team_permissions_for_email`), the email is PROVEN by the Google
login while a student id is typed and never checked, and the live data settles
it — `673070332-6` is one mistyped id shared by two humans whose emails are
correct and distinct, so a student-id merge would fuse two people. Resolution on
any new row (import, admin add, self-edit): group by valid kkumail; else by
รหัสนักศึกษา; else alone. **Never on name.** Nothing non-empty is silently
overwritten, and two keys that disagree REFUSE rather than guess. Mark an email
ยืนยันแล้ว once that person has actually signed in with it — that makes the
historical mess self-cleaning and isolates the typos. Year to year: the PERSON
persists (so a returning member keeps their photo/ชื่อเล่น), the PLACEMENT does
not — last year's is already frozen in the 0104 archive.

**No approval queue, no per-department delegation** (user's call, echoing the
0094 shop-scope revert — a boundary that isolates nothing is worse than none).
`team` permission manages everything, unchanged. Every member action is either
INSTANT or REFUSED, never pending. The single rule behind the refusals: *the
ตำแหน่ง you end up in must not carry สิทธิ์* — which also closes the non-obvious
route, since `inherit_permissions` defaults true and a new ตำแหน่ง created
BENEATH a สิทธิ์-bearing one would inherit it. Joining the roster at all stays
admin-only; the user explicitly rejected letting any kkumail self-add.

`tools/team-identity-dryrun.mjs` — READ-ONLY, re-runnable, prints exactly what
would merge. Current output: **403 rows → 303 people, 100 folded, all 81
multi-placement people matched by kkumail (zero needed the student-id
fallback)**. Needs human eyes: 10 keyless rows (2 are test rows under the "hi"
node), 1 kkumail literally `-`, `673070332-6` shared by two people, and 3 names
split across two groups because a key is missing.

### ตรวจสอบข้อมูล — the standing resolution workflow (new mode, 2026-08-01)

`src/js/team/health.js` + `#teamHealthPane` — a fourth mode beside จัดการทีม /
จัดการสิทธิ์ / ปีการศึกษา, with a count badge on the button so it advertises
itself. Findings are computed LIVE from the members already in memory (no query,
no script to remember), so the next CSV import that reintroduces an
inconsistency simply appears. Five kinds, ordered mechanical-first:
`invalid_email` · `sid_clash` · `sid_drift` · `drift` · `no_key`.

Design points that are load-bearing, not decoration:
- **A name match is a SUGGESTION with a confirm, never an auto-merge.** Linking
  an email also hands over whatever สิทธิ์ that person's ตำแหน่ง carry.
- **Picking a drift value writes it to EVERY row of that person** — the drift
  exists precisely because the rows are separate copies.
- **Writes are SERIALISED, not dropped** (`chain = chain.then(...)`). An
  `if (busy) return` would silently discard the second of two quick clicks, and
  every click here carries a different decision.
- **`render()` deliberately does not repaint this pane** — it is the realtime
  re-render target and would destroy half-typed emails, same as the terms pane.
- 25 tests in `health.test.js`, written from the live cases (`673070332-6`, the
  `-` email, ปรายฟ้า/ปลายฟ้า) — plus two structural ones worth keeping:
  every action button must carry a `data-h*` attribute the click handler
  actually branches on (a dead control fails closed and silently), and every
  class the module uses must have a CSS rule.

**NOT VISUALLY VERIFIED.** The Chrome extension was not connected this session,
so the crop dialog and this pane have never been rendered — only built, unit
tested and reasoned about. Look at both before trusting the layout.

**The durable answer is still the member's own profile page** — an admin cannot
know whether the ชื่อเล่น is ปรายฟ้า or ปลายฟ้า, and วรวลัญช์ can answer in one
click. This pane is the half that works today and the half that will always be
needed for rows belonging to people who never sign in.

### Bugs found in the same scan

- **Team photos were never deleted from Drive — FIXED AND DEPLOYED.** Shop and
  Projects have had a delete path on both sides for a long time; Team had none,
  so every replaced / cleared / deleted portrait, and every upload abandoned
  before บันทึก, left a file in Drive shared "anyone with the link" forever.
  Unbounded, and a privacy problem more than a storage one. Added
  `deleteTeamFile` to `appscript/prform.gs` (guarded by the existing
  `fileLivesUnderTop_(file, 'Team')`; adds no new Google service, so the OAuth
  scopes are unchanged and no re-consent was needed) + `deleteTeamFile` in
  `uploads.js` + `deleteTeamPhotoIfUnused` in `team/api.js`.
  **GAS version 10 deployed; /exec URL unchanged.** Verified live BOTH ways by
  `tools/gas-team-delete-probe.mjs` (7/7): a real file uploaded into `Team` is
  trashed, a real file in `Shop` is refused with "file is not inside Team",
  a missing fileUrl is refused, and an unknown id reports `alreadyGone` so a
  cleanup cannot loop. Every probe file it creates it deletes again.
  **The non-obvious half**: `publish_team_term` copies `photo_url` into
  `team_archive_members`, so a live portrait and an archived year's card are the
  SAME Drive file. A naive delete would blank a published year months later. The
  delete is therefore a REFCOUNT over both tables, called only AFTER the row is
  gone/repointed (never on the นำรูปออก click, which would destroy a photo the DB
  still uses if the admin then cancels). Full write-up in mistakes.md.
- FIXED in this tree: the Drive filename prefix used
  `membersOf(nodeId).length` for an existing member, filing the first of five
  people as `05-`.
- Verified NOT bugs: `render()` only replaces `#teamTree`, so a realtime edit by
  another admin cannot destroy an open member editor or the crop dialog;
  `data-perm-only` appears only in a public-only partial, so the admin entry
  having no handler for it is not a gap. `security-sweeps` clean,
  `team0089-manage` 5/5, `team0104-terms` 40/40.

## ประกาศ article cover — no longer cropped (2026-07-31)

`.article-hero` used to be a fixed 16:9 box with `object-fit: cover`, which
center-cropped every cover. Covers are often PORTRAIT newsletter pages, so most
of the page was cut away. The hero image is now rule-for-rule identical to
`.article-body img` (`width:100%; height:auto`) inside the same 720px column.

Three things were tried and removed; `src/css/article.css` records each with the
defect it caused, and none should be reintroduced:
`aspect-ratio` (crops), a `background` colour (grey letterbox bars beside a
portrait cover), and a vh-based `max-height` (made the cover NARROWER than the
body pages once zoomed, because the height clamped and the width followed).

**The board cards keep their 3:4 crop** (`.news-card-media`) — a grid needs
uniform tiles; a detail page needs the real image. Don't "unify" those.

## APPS SCRIPT + DRIVE — all DONE 2026-07-31 (full detail in the archive)

Detail: `docs/state-archive/2026-07-31-gas-drive-migration.md`. Durable facts are
also in the memory dir (`gas-apps-script-topology`, `gas-is-an-unauthenticated-api`).

**THREE separate Apps Script projects — the names mislead.** `samoweb`
(standalone, `1lENmMdT…`, deployment `AKfycbwomKii…`) serves samoweb;
`samopassport` serves passport badges/certs; `prformweb_backup_candelete` is the
retired Sheet-bound predecessor, still deployed only so bundles cached before
the switch keep working. Deploying one cannot affect another.

- **Both repos have `npm run deploy:gas`.** Diffs the remote, then
  create-version + update-deployment on the SAME id, then verifies over HTTP.
  **Never `clasp deploy`** — new URL, reads as "uploads silently stopped".
  samoweb reads the endpoint from `src/js/config.js`, passport from
  `VITE_GAS_UPLOAD_URL`; each repo needs its own `GAS_SCRIPT_ID` in `.env.local`.
- **Why samoweb was migrated**: a bound script lives INSIDE its container, so
  trashing the unused `prformweb` Sheet would have taken the script and every
  deployment with it. The replacement is standalone.
- **Drive is now `My Drive/IT Database/`** — `_Scripts/`, `PR/` (was
  PR_Submissions), `Projects/`, `Shop/` (was SAMO_Shop), `Team/` (was SAMO_Team),
  `Passport/{badges,certificates}`. Every folder kept its original id through
  move+rename, so no stored URL changed. `TOP_FOLDER_CANON` accepts legacy
  spellings; don't drop a legacy key while any deployed bundle can send it.
  New top-level folders go through `getOrCreateTopFolder_`, never
  `DriveApp.getRootFolder()`.
- **Security review — three holes found and CLOSED**, all years old, none caused
  by the migration: an unguarded delete-any-file, an open email relay, and an
  unconstrained upload folder. Uploads stay open because guests submit PR
  tickets without an account. **A session gate on the deletes was built,
  deployed and REVERTED** — it needed `UrlFetchApp`, which widened the derived
  OAuth scopes, and a web app running as its owner throws until that owner
  re-consents; it broke every delete for ~1h. Deletes are folder-scoped only,
  as before. Re-enable ONLY in this order: owner re-consents first, then
  restore the gate (the frontend already sends `accessToken`). Proofs and the
  full post-mortem are in `.claude/rules/mistakes.md`.
- **ONLY REMAINING**: delete `prformweb_backup_candelete` + its old deployment
  once the old endpoint is quiet. HTML is `no-cache`, so the drain window is
  open tabs only — hours, not weeks. Deleting early costs at most one failed
  upload on a stale tab; Drive trash is recoverable 30 days.


## READ THIS FIRST AFTER A /clear (2026-07-31 end of session)

Everything below is DONE and verified live unless it says otherwise. Two things
need a human, both small, neither breaking anything today:

1. **Delete `prformweb_backup_candelete`** (the retired Sheet + its deployment
   `AKfycbw1iHE4…`) whenever you like. It now runs the SAME patched code as the
   live script, so it is no longer a liability — it exists only so tabs opened
   before today's deploy keep working. HTML is `no-cache`, so that window is
   open tabs only.
2. **Re-enable the delete session gate** — OWNER RE-CONSENTS FIRST, then restore
   the gate and redeploy. Doing it the other way round breaks every delete (it
   already did once today). Detail in the "GAS security review" section and in
   `.claude/rules/mistakes.md`.

The VM may sit a few commits behind HEAD — that is normal and does NOT mean a
deploy is pending. Check `git diff --name-only <vm>..HEAD` for anything under
`src/` or `public/` first; docs/tools/appscript-only commits need no VM deploy.

## NEXT — hardening `notifyProjectEmail` beyond the allow-list

The recipient allow-list closes the broad case. What it does NOT constrain is
the **content**: `subject` and `htmlBody` still come from the caller, so the
endpoint can still be made to send an arbitrary-looking message to an allowed
address, and repeated calls still consume the MailApp daily quota that the real
notifications depend on. Ranked options, best first:

1. **Template the content server-side** (recommended, cheapest). Stop accepting
   `subject`/`htmlBody`; accept structured fields (doc id, action, actor) and
   render them into a fixed template in `prform.gs`, escaping the values. The
   caller then chooses only *what the notification is about*, never its wording.
   No new OAuth scope, no re-consent, no infrastructure. Touches
   `src/js/projects/notify.js` and the GAS handler together.
2. **Move email off GAS entirely**, to the `samo-notify` service on the VM —
   the same move already made for Discord, and for the same reasons. A Node
   service can hold a real secret and verify a Supabase JWT cheaply, which GAS
   cannot do without widening its scopes. Leaves GAS doing only Drive.
3. **Add the caller-identity gate** (`requireSupabaseUser_`, already written and
   reverted — see the GAS section). Requires the owner to re-consent FIRST.
4. **Rate-limit per hour** via `CacheService` in GAS. Protects the quota only;
   does nothing about content. Cheap, but do not add it untested at the end of a
   session — a wrong threshold silently drops real notifications.

1 + 3 together would leave very little: a fixed recipient set, templated
wording, and a signed-in caller.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- **samoweb**: `3f5f6b2`, **deployed 2026-07-31**, `buildId 6316d8ec7a95`. Latest
  change: the VitalSound work in the two sections above (0107 + the
  two-directional merge). Verified in the SERVED bundles: `vs_transfer_dept` and
  `เลือกเป็นเรื่องหลัก` in `/assets/admin-*.js`, `vsMergeDirPull` in
  `/admin/index.html`, `.vs-merge-pullbar` in `/assets/admin-*.css`,
  `กรุณาร้องเรียนทีละปัญหา` + `id="vsPublicConsent" … checked` in `/index.html`.
  `/`, `/admin/` 200; `/notify` → `{"ok":true,...}`. VM HEAD == local HEAD.
  (BOTH apps' assets are served from `/assets/`, NOT `/admin/assets/` — a grep
  against the latter 404s and silently "finds nothing", which reads exactly like
  a failed deploy. **And the admin entry is split across TWO chunks**: `admin-*.js`
  plus a shared `analytics-*.js` that carries `auth.js`, `uploads.js` and
  `image-resize.js` — grepping only `admin-*.js` for `Team` / `image/webp`
  reports a false MISSING.)
  A VM/STATE mismatch of a few `docs(state):` commits is normal and does NOT mean a
  deploy is pending — check `git diff --name-only <vm>..HEAD` for anything outside
  `STATE.md` / `.claude/` / `docs/` / `tools/` first.
- **passport** (separate repo): code `b57eb1e` **deployed 2026-07-30** (pulled
  + built by `deploy.sh` alongside samoweb). Served bundles
  verified by grep: `stamp_scan` in the scan chunk, `leaderboard_names` in
  dashboard, `admin_leaderboard` + the shared-admin email in admin,
  `sb-passport-legacy-admin` in the shared chunk, and no `from('scans').insert`.
- Migrations: samoweb `public` 0081–**0107**; passport `db/0010` + `db/0011` + `db/0012`
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
