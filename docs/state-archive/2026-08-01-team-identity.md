# 2026-08-01 — ทีม SAMO: portrait crop, modal stacking, photo lifecycle, data health, and 0108 team_people

Pruned out of STATE.md to keep it inside the context budget. All of this is
SHIPPED and DEPLOYED (commits a04e796, 021db9d, 48d4f92 on main; GAS v10;
migration 0108 applied). Kept because the reasoning is not recoverable from the
diff — particularly the identity rule, why kkumail rather than รหัสนักศึกษา, and
the list of things that were verified live versus assumed.

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

**Three bugs found in a later self-scan of this same file, all fixed:**
(1) `status(okMsg)` ran BEFORE `renderHealth()`, which replaces `innerHTML` and
recreates `#teamHealthStatus` empty — so every SUCCESS was silently wiped while
every FAILURE showed, the exact inverse of what is useful. (2) The click handler
opened with `if (!t || busy) return`, dropping any click that landed mid-write —
the precise antipattern the `run()` comment above it warns against. The promise
chain already serialises and every handler reads its inputs synchronously, so
the guard is gone. (3) `renderHealth()` over an unloaded tree rendered
"ข้อมูลครบถ้วน" — an empty array is not an empty state; it now shows a loading
line, gated on `loaded` passed through `getData()`.

**NOT VISUALLY VERIFIED.** The Chrome extension was not connected this session,
so the crop dialog and this pane have never been rendered — only built, unit
tested and reasoned about. Look at both before trusting the layout. Everything
below the surface WAS verified live (see the scan list at the end of this file).

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

## SCAN LOG — what was verified LIVE on 2026-08-01, and what was not

Kept because a cold-start agent will otherwise re-do it. Each line is a check
that was actually executed, not reasoned about.

**Verified live, clean:**
- `deleteTeamPhotoIfUnused`'s refcount filter really matches. This fails in the
  DANGEROUS direction — "0 rows" means "trash the file" — so it was tested over
  real HTTPS against the one live photo: `photo_url=eq.<encodeURIComponent(url)>`
  returns the row (the `=w1200` inside the value survives encoding), an absent
  URL returns `[]`, and the archive table is queried the same way.
- 0108 did NOT widen the public projection. `get_public_team_chart` /
  `get_public_org_chart` are hand-built `jsonb_build_object` (no `select *`, no
  `returns setof`), and the live serialised chart carries exactly
  `name · nickname · node_id · photo_focus · photo_url · position` — no
  `person_id`, no kkumail, no รหัสนักศึกษา.
- Bundle boundaries: the crop dialog and health pane are in the ADMIN JS only
  (0 hits in `dist/assets/public-*.js`). `image-crop.css` is in both entries on
  purpose — the future member-facing profile page needs it.
- CSS custom properties resolve for the crop dialog even though it appends
  itself to `<body>` outside `.team-tab`: `--ink-*` / `--radius-*` are on
  `:root` in base.css.
- `team_members.year` is `text`, so the health pane writing a string is right.
- No circular import from `uploads.js → db.js` (added for `currentAccessToken`).
- Proof suites after 0108: `team0089-manage` 5/5, `team0104-terms` 40/40,
  `proj0086-seats` 24/24, `vs0083-scope` 16/16, `security-sweeps` clean,
  `team0108-people` 12/12.

**Known gaps, deliberately left (do NOT treat as bugs to be surprised by):**
- `createMember` and the CSV import write `team_members` rows with
  `person_id = null`, and `buildExportJson` does not carry `person_id`. Harmless
  today because nothing reads it; the CONTRACT step must either add an INSERT
  trigger that resolves/creates the person, or re-run the 0108 backfill (it is
  idempotent — it only considers unlinked rows).
- The crop dialog leaks nothing now, but re-opening it while it is already open
  would load the new image into the live dialog. Not reachable: the file input
  that triggers it sits behind a Bootstrap modal.
- Team photo upload still happens on PICK, so abandoning the member editor after
  a successful upload orphans one Drive file. Much narrower than before (the
  crop step is cancelled before any upload), and `deleteTeamPhotoIfUnused` does
  not cover it because no row ever referenced the file.

