# STATE — current task & latest known state

Last updated: **2026-08-18**. This is "what is true RIGHT NOW" and nothing else;
`git log --oneline` is the chronology and `docs/state-archive/` holds the
reasoning. **Target is ~200 lines** — when it bloats, move narrative to the
archive rather than trimming the invariants.

⚠️ **It is ~820 and still over target.** Five prunes have been done: the
0154–0158 narrative, the "Live proofs" PER-PROOF NARRATIVE, the duplicated
"What is owed" blocks, the 211-line "จองโควตา Claude — READ THIS BEFORE
TOUCHING" walk-through → `2026-08-18-claude-quota-deep-dive.md` (leaving its ⛔
rules, 44 lines), and on 2026-08-18 the three dated 2026-08-17 sections →
`2026-08-17-scrutinize-master-purge.md`, leaving a 20-line summary of the parts
that are still LIVE rules. It keeps growing because each session adds rules
that genuinely belong here.
**The next structural pass is the NEXT-SESSION PROMPT itself**, which is now
440 of these 820 lines. Most of it IS durable (the invariants, the settled
decisions, the traps) — the prunable part is the per-session "what the
2026-08-1x session was" narrative, which `git log` and the archive already
hold. Take the OLDEST such block each time, never the invariants.

**Read the `## NEXT-SESSION PROMPT` at the bottom first.** Then CURRENT DEPLOY.

Reasoning lives in `docs/state-archive/` — newest first:
`2026-08-18-daytime.md` (ปีงบ default + the sastaff/saprof purge) ·
`2026-08-18-claude-quota-deep-dive.md` + `2026-08-16-claude-quota-booking.md`
(**read one before touching `/admin#claude`**) ·
`2026-08-17-scrutinize-master-purge.md` (the 15-account purge, master ≠ dev,
the 0164 scrutinize pass — ⚠️ its "sastaff/saprof were KEPT" line is now FALSE,
see the header it carries) ·
`2026-08-15-late-org-chart-reporting.md` (the two parentages, ระดับ, colour;
**read before touching `/team`**) · `2026-08-15-org-chart-views.md` (the d3
views, the library survey, three portrait bugs) ·
`2026-08-12-signin-shop-guards.md` · `2026-08-10-late-security-and-identity.md`
· `2026-08-10-chan-pi.md` · and nine older files back to `2026-07-24-full.md`.
Architecture/RLS: `docs/CONTEXT.md`. Bugs: `docs/mistakes/*.md`, indexed by
`.claude/rules/mistakes.md`. Backlog: `docs/NEXT.md`.

## CURRENT DEPLOY

- Prod = KKU VM `samo.md.kku.ac.th`. Deploy = commit → push `main` →
  `skills/deploy-vm.md`. **Needs VPN. Pushing does NOT deploy.**
- ✅ **DEPLOYED = `68d08ea` (2026-08-20)** — the เกี่ยวกับเรา two-view rework,
  the `[hidden]` fix, and the solo-rail removal. VM HEAD confirmed over ssh; the served-artifact greps
  are in the NEXT-SESSION PROMPT at the bottom, which is the authority.
- Previous deploy `7dbc153` (2026-08-19), VM HEAD confirmed over ssh.
  Verified from the served `/admin/` HTML: the new hint `ควรใช้งานและ` = 1 and
  the REMOVED `ไม่ได้เลือกให้อัตโนมัติ` = **0**; `userSet` and `masterAuto` both
  present in `assets/admin-*.js` and **0** in `analytics-*.js`.
  ⚠️ **THE `master` + SEAT RULE, AS IT NOW STANDS — this reversed twice in two
  days, so read it before changing it again:**
  **BOTH editors (บุคคล and ตำแหน่ง) auto-fill ผู้ส่งหนังสือ when Master goes
  on, and the value is STORED.** A master holder therefore gets the ผู้ส่งหนังสือ
  screen AND the notifications — identical to a real ผู้ส่งหนังสือ. That is the
  point: `master` is what the dev team holds to TEST every workflow, and one who
  silently misses the notification half cannot.
  📌 **What the stored seat buys differs BY SEAT — do not describe it loosely.**
  `listProjectSeatUsers('vpa'|'staff'|'prof')` is referenced in `notify.js` and
  NOWHERE else: it is the notification list, and no UI renders those people as a
  chooser. The only pick-a-person-by-name control is `listProjectProfs()` →
  `renderProfPicker()` in `sign.js` ("ส่งให้อาจารย์คนไหนลงนาม"). So `prof` =
  notifications + that dropdown; `vpa`/`staff` = notifications only.
  ❌ **The "57 people would be signed up for notifications" argument that
  justified NOT auto-filling on a ตำแหน่ง was WRONG, and the mistake was
  measuring the wrong channel.** Traced in `projects/notify.js`:
  `notifyVpAdmin` fires ONE `queueDiscord` call to ONE webhook **outside** the
  recipient loop, and email goes to `settings.uni_staff_email` / `prof_email`,
  fixed addresses. Extra recipients add **zero** Discord messages and **zero**
  email. They add background `project_notifications` rows and a bell badge, on a
  path that is fire-and-forget so no user waits. Owner's challenge — "discord
  wouldnt ping for it bc i only have discord implement to one single channel" —
  was correct on both halves. **Before quoting a fan-out cost again, open the
  fan-out code and check WHICH channel actually loops.**
  Clearing works: any human touch on the seat select (including choosing
  "— เลือกบทบาท —") sets `dataset.userSet`, which blocks the refill. Without it
  the condition is `on && !sel.value` and the empty option is unselectable —
  shipped that way in `af36088` for a few hours.
  - `af36088` — the ตำแหน่ง Master hint (its only note had been the fan-out
    head-count, which hides at 0); `seatFanoutCount` stopped counting members
    with no อีเมล (31 of 447); the four vocabulary maps became
    `Object.create(null)` because every reader is `MAP[key] || key` and a
    permission key of `constructor` returned an inherited FUNCTION.
  Previous deploy `033d041` (2026-08-18, late), for the record — two commits — the `master` / หนังสือโครงการ-seat fix and the
  /scrutinize pass over it:
  - `033d041` — the modal's "สิทธิ์รวม" preview was a THIRD hand-rolled chip
    builder that never learned the master rule; VS แผนก chips suppressed under
    master (a scope master already widens); `permChipsHtml` gained `flat` mode
    and defaults. There is now exactly ONE line in `team/index.js` that writes a
    `team-perm-chip` span, and `master-seat.test.js` asserts it.
  - `7debbe9` — `projectSeatRole()` folds master; `readPermInputs` keeps
    `project_seat` under master; บุคคล editor pre-fills ผู้ส่งหนังสือ; ตำแหน่ง
    shows a fan-out head-count instead.
  **Verified from the SERVED artifacts** (not the local files) — and note WHICH
  artifact, because it is the OPPOSITE of the projects-module trap below: the
  ทีม SAMO editor lands in the **ADMIN entry**, not the shared `analytics` chunk.
  - `assets/admin-CPiyOZWb.js` → `บทบาทที่เลือกตรงนี้` = **1**, `masterAuto` =
    **2** (both **0** in `analytics-Bw7hwBIp.js`; grepping that one reports 0 and
    looks exactly like a failed deploy).
  - served `/admin/` HTML → `VitalSound ดูแลได้ทุกแผนก` = **2** (both modals),
    `บทบาทของบุคคลนี้` = **1**. Markup lives in the partial, in no bundle at all.
  - served admin CSS → `team-perm-chip.is-master` = 1, `team-seat-fanout` = 1.
  - `permChipsHtml` / `projectSeatRole` / `seatFanoutCount` grep **0** by
    construction — module-scope names the minifier renames. Pick a STRING
    LITERAL or a CSS class as the marker, never a function name.
- ✅ **DEPLOYED = `161310e` (2026-08-18)**, VM HEAD confirmed over ssh. Three
  commits shipped that day, newest first:
  - `161310e` — `canManageComment()` + the 0166-class sweep + the `claude0161`
    C1 threshold. ⚠️ **`canManageComment` greps 0 in the served bundle** — it
    is a module-scope function name and the minifier renames it. The evidence
    is the bundle HASH changing (`analytics-DZcPLnhL` → `analytics-C_2oekEU`)
    plus the VM's HEAD. **Pick a STRING LITERAL or a CSS class as a marker.**
  - `e8f3fc0` — migration 0166 (the timelines) + the three-desk audit. DB-only;
    no served string of its own.
  - `e5a8524` — the ปีงบ chip on every กล่องจดหมาย row (grid card + list row,
    one `fyChipHtml()`), the list-row width floor + mobile `flex-wrap`, and the
    plain-Thai ปีงบ-default dialog. Verified from the SERVED `analytics-*.js`:
    `projects-fy-mini` = 1, `ปีงบเริ่มต้นของหน้านี้` = 1,
    `เปิดหน้านี้ทุกครั้ง` = 1, `ย้ายเอง` = 2, and the REMOVED
    `ค่าเริ่มต้นของปีงบประมาณ` = **0**; `projects-fy-mini` = 2 in the admin CSS
    and `ตั้งปีงบเริ่มต้นของหน้านี้` = 1 in the served `/admin/` HTML.
- Previous deploy `2f35068` (2026-08-18) — ปีงบ move + per-person default
  filter + the `sastaff`/`saprof` purge (`8359026`), plus the /scrutinize fixes
  on top. Verified from the SERVED artifacts:
  `ย้ายปีงบประมาณ`, `ปีงบปัจจุบัน (อัตโนมัติ)`,
  `project_user_prefs`, `fiscal_year_be`, `ย้ายเอง` all = 1–2, and the REMOVED
  `seed บัญชี saprof` = **0**.
  ⚠️ **They are NOT in `admin-*.js`** — every one of those greps reads 0 there.
  The whole projects module lives in the shared chunk that Vite names
  **`analytics-*.js`** (the name is a lie; both entries import it). Find it with
  `curl -s https://samo.md.kku.ac.th/admin/ | grep -oE 'assets/[A-Za-z0-9_.-]+\.js'`
  and grep THAT — grepping only the admin entry reports 0 and looks exactly like
  a failed deploy. The toolbar markup (`projectsFyDefaultBtn`,
  `projects-fy-group`) is in the served `/admin/` HTML, and
  `projects-fy-default-btn` / `projects-fy-pill` / `is-moved` in the admin CSS.
- 🔎 **The 0166 class does NOT exist anywhere else — swept 2026-08-18.** Every
  `jsonb`/`json` column in `public.*` was scanned for uuid-shaped strings that
  no account resolves: only the two project timelines ever held any, and both
  are clean (`_timeline_backup_0166` still holds the 298 old ones, which is what
  proves the scanner works — the first version of that sweep reported 0 orphans
  everywhere because `where u.id = id` bound `id` to `users.id` instead of the
  outer alias, a shadowed correlated subquery that cannot fail). Every uuid
  column WITHOUT a foreign key was swept too: the only dangling person
  reference left in the database is `analytics_events.user_id` (1316 of 8408,
  historic telemetry from deleted accounts — append-only, nothing reads it by
  identity).
- ✅ **0166 APPLIED (2026-08-18) — the purge SKIPPED the JSONB timelines on
  purpose, and the owner reversed that call.** Every uid COLUMN was reassigned
  when the shared logins went; the 298 uids inside
  `project_documents.timeline[].by` / `project_sign_requests.timeline[].by` were
  deliberately left (`tools/purge-shared-project-accounts.mjs` header: rewriting
  history is worse than "the two people no longer being able to edit an old
  shared-account comment"). **The cost had never been counted: it was 42 of the
  43 comments in the system, uneditable by every account**, because
  `isMineComment` is `c.by === myId`. Shown the number, the owner chose the
  remap — to the people the columns already named (vpa→jinjutha, staff→woratho,
  prof→prakasa). Verified after: 308 events, **0** unresolvable, 43/43 comments
  owned by a live account. Snapshot kept in `public._timeline_backup_0166`
  (60 rows) with the rollback in the migration — **drop that table once the
  owner has confirmed the comments look right.**
  Guard: `proj0165` §D7/§D8 (37/37 green, D7 falsified). §D4/§D5 were widened
  from `is null` to "does the uid RESOLVE" — the narrow form is why this was
  green for a day.
  ⚠️ The migration's FILENAME still reads `…missed_the_timelines`; it was
  already applied so it was left alone, and its header carries the correction.
  **`tools/proj-handover.mjs` now has a `--timelines` step**, and it PRINTS the
  comment count on every dry run whether or not you pass the flag — so this
  cost can never be invisible again.
  ✅ **Nothing role-based ever broke** — the blue อัปเดต badge, ใหม่ / ตีกลับ,
  ของฉัน and รอลงนาม all key off the timeline entry's `role` string, which the
  successors still resolve to through their seat.
- ⚠️ **The เจ้าหน้าที่คณะ successor account sees NO file "ใหม่" highlight, and
  that is the BASELINE rule, not a bug.** Measured 2026-08-18 on the live DB:
  `woratho@kku.ac.th` (created that morning) has 43 `project_doc_views` rows all
  stamped at first open, so **0 of 91 files** qualify for a pill; the owner's own
  account scores 40. Its `project_notifications` WERE reassigned (77 unread), so
  the bell and the per-document highlights now answer "what have you seen"
  differently for the same person. Write-up in `docs/mistakes/app-state.md`.
- Previous deploy `a2596c3` (2026-08-16), for the record. Verified then from the
  SERVED artifacts, found via the bundle name in `curl -s
  https://samo.md.kku.ac.th/admin/` (**not** `ls` on the VM — old chunks are
  kept on purpose): `is-low`, `claudeSilentWrap`, `claude.ai/settings/usage`,
  `claude-hist-reset`, `รวม ` in the admin JS; `100dvh`, `.claude-free.is-low`,
  `claude-req` in the admin CSS; and **6 stars + `ต้องกรอกทุกช่อง` +
  `จองแบบเงียบ` in the served `/admin/` HTML** — those live in the partial, not
  the bundle, so grepping only the JS reports 0 and looks like a failed deploy.
  **0** for the REMOVED `ยิ่งแถบกว้าง` / `MAX_GAP_MS` / `max-height:620px`.
  ⚠️ `--f` greps 1 in the served CSS and it is `--form-shadow` from another
  component, not the rail's deleted width variable — check WHAT matched.
  Live RPC confirmed: 5 runs / 4 windows / 2 exact starts.
  ⚠️ **Greps that legitimately return 0**, all documented traps: a module-scope
  `const` is renamed by the minifier (`MAX_GAP_MS` reads 0, the string literal
  `แถบขวาของแต่ละวันคือรอบ` reads 1), anything in `functions/` is the notify
  SERVICE and never reaches a bundle, and `::before` minifies to `:before`.
  Check rather than trust — EMPTY means prod is current:

  ```bash
  git diff --stat 161310e..HEAD -- src/ supabase/ appscript/ server/ functions/ ':!src/**/*.test.js'
  ```

  The `:!…*.test.js` exclusion is load-bearing, not tidiness: without it a
  guard-test edit sends the next reader on a pointless 90-second deploy.
  ⚠️ **RIGHT NOW that command is NOT empty and prod IS current.** The one file
  it lists is `supabase/migrations/0166…sql`, whose HEADER COMMENT was corrected
  after it had already been applied — nothing a build could carry. **Narrow it
  to `-- src/ ':!src/**/*.test.js'` to answer "is the served bundle current";
  that IS empty.** A migration already applied to the live DB can never make the
  bundle stale, so read WHICH file the diff names before deploying.
  **Migrations applied through 0166.** **1170 tests green. 21 of 22 proofs
  green** — the one red is `claude0157` B4 and it is ENVIRONMENTAL (see below).
  ⚠️ `claude0161` C1 was ALSO red on 2026-08-18 and is now FIXED: its control
  asserted `count(grid) > 100` while the grid is the REMAINDER of the quota
  week, so 21 h before the Wed 16:00 reset only 86 points were left. Threshold
  is now `> 20` (one 5-hour window) with the reason in the file
  (`docs/mistakes/tooling-proofs.md`). **`claude0157`'s sample search has the
  same shape** — `date_trunc('hour', now()) + 7h` → `week_start + 7d − 11h`,
  down to 5 candidate slots at that instant — so if B4 is still red early in a
  fresh quota week, that is the REAL failure and not this rot.
  ⚠️ **0161 IS APPLIED TO THE LIVE DB AND ITS FRONTEND IS NOT DEPLOYED YET** at
  the moment this line was written — that order is correct (the RPC keeps its
  shape, so the served bundle reads the new numbers immediately), but the
  calendar's dashed box and the booking card's time range only appear after the
  VM build. Verify from the SERVED artifact: `claude-gap`, `is-micro`,
  `2026-08-16.5` in the admin JS, `กล่องเส้นประ` in the admin HTML, and **0** for
  the REMOVED `claude-session-tag` / `claude-bk-t2`.
- ✅ **จองโควตา Claude (0154 + 0155) is LIVE END TO END** — booking, the board,
  the Discord notice, the MEASURED usage strip, **"ใช้ได้เลยตอนนี้"**, the
  per-segment capacity rail on the calendar, and the measured LOG. Verified
  2026-08-16: the VM's systemd timer fires every 15 minutes and writes as
  `claude-reporter@samomdkku.app` under RLS.
  **One thing still owed: grant the `claude` permission** in ทีม SAMO to whoever
  should book. (~13 ฝ่าย IT accounts already hold `master`, which answers yes to
  every key.)
- **0155's one idea: the board answers "may I use it NOW", not only "is this
  slot free".** `claude_free_now(p_at)` = `min(what is left in the live 5-hour
  window, what the week has left after everyone's reservations)`, and
  `claude_free_windows()` walks it over the whole week for the calendar rail.
  Read `docs/state-archive/2026-08-16-claude-quota-booking.md` §"0155" before
  touching any of it — especially **why the answer changes at
  `booking_start − 5h`**, an instant nothing on a calendar marks.
  Proof: `tools/claude0155-free-now.sql` (21/21), built from the owner's own
  three worked examples and falsified against two injected bugs.
- ⛔ **`claude setup-token` CANNOT be used for the usage reporter. Measured:**
  `oauth/usage` → **403 "OAuth token does not meet scope requirement
  user:profile"**, while a `claude login` token → 200. The one-year token
  carries `user:inference` but not `user:profile`, so it can SPEND the
  subscription and cannot READ it. It was recommended here for its lifetime and
  that was wrong; do not re-suggest it. The reporter's credential comes from
  `claude login` ON THE VM, and the script refreshes and re-saves it (access
  ~2h, refresh ~12d and rotating), so a 15-minute timer renews it ~96×/day.
- ⚠️ **A `setup-token` (valid to 2027-08) was pasted in chat and is STILL LIVE**
  — confirmed HTTP 200 on `/v1/messages`. It was removed from the VM but only
  the owner can revoke it: claude.ai → Settings → Connectors/Tokens, or
  `claude auth logout` on the machine that minted it. It can burn quota; it
  cannot spend money (see the security note below).
- ⚠️ **The 700% weekly pool may be wrong from 19 Aug 16:00.** `/usage` on the
  owner's machine shows *"+50% weekly limits promo through Aug 19"*. The pool
  is derived from their ratio 1% weekly = 7% session; if the weekly cap is
  currently inflated 50% and the session cap is not, that ratio is not stable
  across the promo boundary — and the boundary IS the next weekly reset. Nobody
  has measured which side the 1:7 was taken on, so this is a question for the
  owner, not a number to guess. Fix is one statement, no migration:
  `update public.claude_settings set week_pool_pct = <n>;` — the value was made
  a SETTING for exactly this.
  It is also DERIVABLE once samples accumulate: each `claude_usage_samples` row
  carries both `five_hour_pct` and `seven_day_pct`, so the weekly delta across
  one full session window is the ratio, measured rather than assumed.
- ⚠️ **Verify from the chunk the served HTML actually loads.** Code often lands
  in the SHARED `analytics-*.js` that BOTH entries import (the shop checkout
  strings did), and minified builds rename module-scope `let`s — grep a STRING
  LITERAL or a CSS class.
  ⚠️ **`askConfirm` is admin-only by import graph**, so its strings are absent
  from the PUBLIC bundle BY DESIGN.
- **Apps Script: both projects deployed** — samoweb v11, passport v10. ⚠️ A
  missing `GAS_SCRIPT_ID` makes `npm run deploy:gas` a SILENT NO-OP.
- ⚠️ **Rotate the VM sudo password** and the **KKU SSO client secret** — both
  were exposed in chat transcripts (2026-08-07 / 08-08).

## Live proofs — `npm run proofs`

**The registry is now 20**, and **all 20 were run green on 2026-08-16** after
0161 landed. `claude0161-rail-guard-parity.sql` is the newest. `npm run proofs`
runs every one; `npm run proofs <substring>` runs a subset. Run the one covering
what you touch — all are both-directional.

⚠️ **Do not check them with an ad-hoc parser** — they emit four different output
shapes and doing it by hand produced two false alarms in a row.
`tools/run-proofs.mjs` normalises them and reports UNKNOWN as a FAILURE.
**An ERRORED proof is silence, not a failure** — that is how one went stale for
three days while this file claimed it was green.
**Read `skills/write-a-guard.md` before writing or trusting any of them.**

**Full per-proof narrative — what each cost, how its subject is chosen, and the
traps in reading it — is in `docs/state-archive/2026-08-16-live-proofs.md`. Read
the entry for the proof you are about to touch.** One line each here:

- `authz-sweep-identity.sql` (23/23) — the identity boundary. Run after ANY
  policy change on `users`/`people`/`students`/`team_members`.
- `claude0154-quota-guard.sql` (20/20) — the จองโควตา Claude caps.
- `claude0155-free-now.sql` (22/22) — "how much may I use now, until when".
- `claude0157-rail-segments.sql` (10/10) — the rail's bands are CONSTANT and its
  edges are deadlines. Asserts the property, not a list of boundaries.
- `claude0159-window-share.sql` (32/32) — the window rule, and since 0160 the
  open-window rule.
- `claude0161-rail-guard-parity.sql` (10/10) — **the rail and the trigger derive
  the SAME window.** A DIFFERENTIAL over every quarter-hour of the week.
- `claude0162-usage-runs.sql` (23/23) — **ใช้จริง says WHEN Claude was used.**
  §A is the owner's worked example sample-for-sample; the rest are the states
  the live table cannot be made to contain on demand (a window first polled
  ABOVE where the previous ended, a reporter outage, the ±1s `resets_at`
  wobble). Uses SYNTHETIC samples in a future quota week for exactly that
  reason. Falsified by deleting the clamp.
- `pr0149-delete-permission.sql` (12/12) · `shop0150-buyer-contact.sql` (10/10) ·
  `house0116-authz.sql` · `house0144-delete-impact.sql` (18/18) ·
  `house0145-duplicate-person.sql` · `house0146-crest-refcount.sql` ·
  `team0145-one-chan-pi.sql` · `team0145-save-as-the-member.sql` ·
  `house0132-registry.mjs` · `proj0092-seat-parity.mjs` ·
  `team0135-name-split.mjs` · `team0137-search.mjs` · `grant0093-reads.mjs` ·
  `team0143-photo-refcount.mjs`

⚠️ **Two subjects that are not what they look like**, both paid for:
`shop0150`'s is MANUFACTURED (every real order belongs to a shop ADMIN, for whom
the guard early-returns, so a proof picking a real order reports that a buyer may
set a total to ฿1), and `house0144`'s picker must mirror the function's own `if`
or it selects nobody and ERRORS — which is silence, not a failure.

**The claude pane's colour system, since the owner asked for it:** clay
(`--claude-clay`, Claude's own) = MEASURED · green = free/available · ฝ่าย
colours = booked by a person · amber (`--claude-part`) = partly booked · red =
none left. The ramp's middle moved off `--brand-orange` because orange sits one
hue-step from clay and "partly booked" started looking like "actually used".

⚠️ **The claude pane has TWO TIME SCOPES and they are not interchangeable.** The
hero (`ใช้ได้เลยตอนนี้`) is about NOW; the week card is about the week the arrows
landed on. A future week measures **NULL, not 0** — a zero draws an empty bar and
reads as a reading.

⚠️ **`get_claude_board()` grows superlinearly with bookings** — ~25 ms at 7/week,
~100 ms at 30, polled every 60 s per open tab. Fine at this feature's real scale;
recorded so nobody rediscovers it in production.

## จองโควตา Claude — security posture

Verified 2026-08-16 and unchanged since; the detail moved to
`docs/state-archive/2026-08-16-claude-quota-booking.md`. The three facts that
matter: **nothing leaked to git** (the token appears in 0 commits), the
credential on the VM can burn QUOTA but **cannot spend money**
(`extra_usage.is_enabled=false`, `can_purchase_credits=false` — keep it that
way, that setting is doing real work), and `claude-reporter@samomdkku.app`
holds only `claude`. ⚠️ A `setup-token` pasted in chat is STILL LIVE; only the
owner can revoke it.

## 2026-08-17 — archived (scrutinize pass · master ≠ dev · the purge)

Full text: `docs/state-archive/2026-08-17-scrutinize-master-purge.md`. Only the
parts that are still LIVE rules are kept here:

- ⚠️ **`current_user_project_seats()` folds `master` → {vpa,staff,prof}.** A
  master holder IS a project actor and sees every หนังสือโครงการ.
  ❌ **The rest of this bullet used to read "the editor nulls project_seat on
  purpose — do not fix it". THAT WAS WRONG and it is why the bug below survived
  a whole session.** Access is folded; IDENTITY is not. The seat decides which
  screen the person gets AND is what `list_project_seat_users()` reads to build
  the notify audience, so nulling it stranded 36 of 41 masters on a blank pane
  and took them off every notification. Fixed 2026-08-18 (`7debbe9`); see the
  session block in the NEXT-SESSION PROMPT and
  `docs/mistakes/authz-grants.md`. **Never compute project visibility from the
  stored column — simulate the session.**
- ⚠️ **`claude0157` B4 is red by design when live booking geometry has no
  stepping deadline.** The follow-up is to inject a SECOND synthetic booking
  that guarantees one — but do NOT tune it to merely pass; verify B1/B2/B5 stay
  meaningful afterwards.
- ⏳ **0161's cost claim (scrutinize finding 2) is still unbenchmarked.** Low
  priority, nothing depends on it.
- `master` needs `holdsMaster()` beside every `role === 'dev'` gate that grants
  power; the ~28 in `src/js/projects/*` are seat-driven and were left as-is per
  the owner.

## OTHER SYSTEMS — stable, nothing owed

PR · VitalSound · News · หนังสือโครงการ · Analytics: unchanged. Write-ups in
`docs/state-archive/`; architecture in `docs/CONTEXT.md`.

- **Passport** (repo `phuriphatma/samomdkkupassport`, same Supabase project,
  `passport` schema): kkumail-only gate live. Dev test still ACTIVE
  (pmphuriphat→phuriphat.ma) — revert SQL in `2026-07-24-full.md`. Old project
  `idwlabpbwiwgaoqwbozz` is a cold backup — rotate its DB password before deleting.
- **notify**: `/notify` Node service on the VM; `notify_log` (0055) recording.
- Retention jobs NOT scheduled (`prune_analytics`, `prune_notify_log`).

## Housekeeping

The memory layout is in `CLAUDE.md` § "Memory layout" — not repeated here,
because two copies of one rule is the class this repo pays for most.

- **Do not re-create `.claude/rules/mistakes-archive.md`** — it lived in the
  auto-loaded directory, so archiving into it saved nothing.
- **The design/plan docs were swept 2026-08-12 and now carry status banners.**
  **When a plan doc is finished, banner it the same day** — a stale plan with
  destructive steps (PASSPORT-MERGE still said "not started" while containing a
  `truncate passport.*`) is the most dangerous file in a repo.
- **Never hand-edit the mistakes index** — `npm run mistakes:index` generates it.
- **Never raise the context cap** when `npm run check:context` fails. Move detail
  into `docs/`.
- `.env.local` holds the Supabase PAT, the VM sudo pw, project-B DB creds.
- CI = Node 22. `npm run build && npm test` before every commit.

## จองโควตา Claude — READ THIS BEFORE TOUCHING `/admin#claude`

**The reasoning is archived: `docs/state-archive/2026-08-18-claude-quota-deep-dive.md`
(the 0154→0163 walk-through) and `2026-08-16-claude-quota-booking.md` (0154–0158).
Read one of them before changing anything here.** What stays below is only the
rules that change what you DO.

**THE RULE THAT GOVERNS (0159).** For every 5-hour window opened in the chain,
the bookings overlapping `[open, open + 5h)` may not claim more than 100%
together. A window is opened by the FIRST booking after a ≥5h gap, and the chain
is derived greedily in START order.

- ⛔ **"One home" means one FUNCTION, not one tier.** `claude_free_now()` asks
  `claude_window_loads()`; the rail asks the same. Do not re-derive a window
  from the clock anywhere (that was 0161).
- ⛔ **A window is identified by PROXIMITY to an instant, never by a rounded
  key** (0163). `date_trunc('minute', resets_at + 30s)` splits a window whenever
  the true reset lands near `:30`, and the split attributes the whole cumulative
  reading as a rise. Compare raw instants with a tolerance.
- ⛔ **Never `create or replace` one of these functions from its ORIGINAL
  migration text.** Several migrations have edited each. Take the body from
  `pg_get_functiondef` and diff. (Doing otherwise silently reverted 0158.)
- ⛔ **A guard re-derives state from the OTHER rows, so an earlier insert
  re-derives everyone** and nothing re-checks them. Tell: the same rows legal or
  illegal depending on TYPING ORDER. Re-derive WITH the candidate in it.
- ⛔ **Never put `overflow` clipping on `.claude-free`**, and **do not re-add the
  rail's width encoding** — it was built, reported, and pulled. The rail is
  **colour only**, by the owner's decision.
- ⛔ **Two quantities in one SUBTRACTION must share an INSTANT** (0156/0158).
- ⚠️ **This pane's bugs are PHONE bugs.** Six were phone-only and every one was
  invisible in the stylesheet. Open it at a phone width before calling it done.
- ⚠️ **`claude setup-token` CANNOT read usage** — it carries `user:inference`,
  not `user:profile`. The reporter's credential comes from `claude login` ON
  THE VM.

| Panel | Scope | Source |
|---|---|---|
| `ใช้ได้เลยตอนนี้` (hero) | this instant | `claude_free_now()` |
| the week card | the week ON SCREEN | `board.week.*` (0156) |
| the rail | per START TIME | `claude_free_windows()` |

⚠️ **`get_claude_board()` cost grows with bookings** — ~25 ms at 7/week, ~100 ms
at 30, polled every 60 s per open tab. Fine at real scale.

## NEXT-SESSION PROMPT (paste this after a /clear — updated 2026-08-20)

> **Read this file, then `skills/write-a-guard.md`.** ⛳ **ONE THING IS OWED and
> it is the first section below: restore the old connector-chart แผนผัง as a
> THIRD view.** No migration is pending. **Prod = `aae1852`.** Migrations
> through **0166** (none added since). **1229 tests green** (+7 this session:
> `hidden-attribute.test.js` ×3, `org-chart-metrics.test.js` ×4, the
> ordering differential ×5, minus none). **Proofs NOT re-run this session** —
> the two `claude0157`/`claude0161` reds below are still owed and were not
> touched.
>
> ### ⛳ OWED — ADD BACK THE OLD CONNECTOR CHART AS A THIRD, SEPARATE VIEW
>
> 🚫 **DO NOT `git revert 1f966f3`. DO NOT DELETE OR CHANGE THE CURRENT PANEL
> VIEW. THIS IS AN ADDITION.**
>
> The word "restore" below means **bring the old picture back BESIDE the new
> one**, as one more button in the view switch. It does NOT mean undo the
> rework. The owner said, in the same sentence, that they like the new one:
> *"you've implemented this design which i also like, so i would like to KEEP
> this and RESTORE the previous and improve it."* Both ship. Three buttons:
> the old connector chart, the current panel view, and ผังรวม.
>
> If you find yourself reverting a commit, reading the old CSS over the new
> file, or deleting `.orgc-unit` / `.orgc-seat` rules — **stop, you have
> misread this.** The old code is COPIED OUT of `befd30e` and added alongside;
> nothing currently on the page is removed.
>
> **REPORTED, right after the rework deployed**: "this orgchart แผนผัง that
> you've implemented has completely change the ui of my previous design … i just
> want to modify this more to improve it, not changing entire ui. but you've
> implemented this design which i also like, so i would like to KEEP this and
> RESTORE the previous and improve it."
>
> **So the answer is THREE views, not two, and it is a restore + a rename — not
> a redesign.** I removed a picture the owner valued. That was the error: the
> brief said "improve", and the ระดับ bug plus the dead space were both fixable
> inside the old geometry. Do NOT re-litigate this; the owner has said they like
> both.
>
> **WHAT THE OLD ONE IS — LOOK AT THE PICTURE FIRST:**
> **`docs/design-refs/2026-08-20-old-connector-chart.png`**, with
> `docs/design-refs/README.md` describing it in prose in case the file is gone
> (the images there are gitignored ON PURPOSE — this repo is public and they
> carry student faces; the README says why). The owner's original was
> `~/Desktop/IMG_8132.png`.
>
> It is the CSS connector tree: one section per root ฝ่าย; each node a white
> rounded box with a coloured TOP border, a dot, its name and a count pill; the
> ฝ่าย's อุปนายก as a centred portrait card with the name BELOW the photo; then a
> real elbow connector — vertical drop, horizontal bar, a tick into each child —
> fanning out to a ROW of sibling ฝ่าย boxes; below depth 1 it switches to a
> vertical spine; the section scrolls horizontally inside its own scroller.
> Read top to bottom, from SAMO's own recruitment poster.
>
> ⚠️ It is NOT ผังรวม (that is d3 on a pan/zoom canvas, still shipping) and NOT
> the new panel view. Three different pictures; the owner wants all three.
>
> **WHERE THE CODE IS.** It was deleted whole in `1f966f3`; the last good copy
> is its parent, **`befd30e`**. Recover with `git show befd30e:<path>`:
>
> | piece | at `befd30e` |
> |---|---|
> | renderer | `src/js/org-chart.js` `nodeBlock()` (line 327) + `rootBlock()` (448) |
> | markup hook | `<div class="org-tree-wrap" data-view="chart">` (546) |
> | styles | `src/css/org-chart.css`, the block headed `── แผนผัง: the horizontal org chart` (line 665) to the end of the `[data-view]` section |
>
> That CSS header carries THREE measured constraints — one section per ฝ่าย,
> branch sideways once, the spreading row must WRAP because `.org-tree` is
> `width: max-content` — **read it before changing any of them.** `git show
> befd30e:src/css/org-chart.css | sed -n '665,905p'`.
>
> **HOW TO LAND IT — the ordering, so nothing regresses:**
>
> 1. **Three buttons.** `VIEWS = ['chart', 'panel', 'all']` (or keep `chart` for
>    the connector tree and give the new panel view a new key — whichever, but
>    `RETIRED_VIEWS` must map every old value INCLUDING whatever key the panel
>    view ships under today, or every reader's saved preference breaks).
>    ⚠️ The panel view currently owns the key `'chart'`. Decide the key mapping
>    FIRST and write it down, or the migration silently sends people to the
>    wrong picture.
> 2. **Thai labels.** Two views both called "แผนผัง" is not shippable. Ask the
>    owner what to call them — do not invent names (see
>    `ui-copy-names-the-audience` in memory: never invent a feature's purpose).
> 3. **The restored view MUST honour ระดับ**, which the old one did not — that
>    was half the original bug report. It reads `byParent` (stored order);
>    route it through `orderChildren()` in `org-rung.js` the way `childrenHtml()`
>    already does, so all three views share ONE ordering.
>    ⚠️ Do NOT give it `chartParentage` — that is the 52,000px staircase, paid
>    for twice now. Order, not geometry. `org-rung.test.js` §"แผนผัง and ผังรวม
>    order one ฝ่าย identically" is the differential; EXTEND it to the third view
>    rather than writing a second one.
> 4. **Then improve it, which is what was actually asked.** The measured
>    complaints against the old geometry, all still true and all reproducible
>    with `docs/demos/about-3d/tools/org.mjs <width> <view>`:
>    - 24,101px at 1440 / 55,273px at 390 (the new panel view is 3,989 / 8,110).
>    - `align-items: flex-start` on a connector row means a one-person ตำแหน่ง
>      beside a forty-person ฝ่าย leaves a dead column the height of the tall
>      one. **This is the structural cause of "many leftover space" — spacing
>      tweaks cannot fix it.** Ideas not yet tried: collapse deeper by default
>      (the panel view's `OPEN_TO_DEPTH = 0` bought most of its win), the
>      horizontal person row (52px portrait, name BESIDE it) which the panel
>      view already uses, and per-ฝ่าย horizontal scroll instead of page growth.
>    - At 390px the page scrolled horizontally (395/390) because
>      `.org-tree-wrap[data-view="chart"]` breaks out with `width: 100vw;
>      margin-inline: calc(50% - 50vw)`. Re-check that at 320/390 after restore.
> 5. **Regression floor.** `npm test` must stay green — `hidden-attribute.test.js`
>    and `org-chart-metrics.test.js` both assert against the CURRENT class names
>    (`.orgc-unit-body`, `.orgc-person > .org-face`). If the restore renames or
>    removes either, the guards' CONTROL assertions fail LOUDLY and tell you to
>    re-derive the subject — that is by design, do not delete them.
>
> 6. **The changelog is already wrong about this.** `PENDING` in
>    `src/data/changelog.js` carries "หน้าโครงสร้างองค์กรเหลือ 2 มุมมอง…",
>    which the third view falsifies. It has a ⛳ comment on it. Revise it in the
>    SAME commit as the restore — a release note that contradicts the page is
>    worse than no note.
>
> **Fixed already, do not redo**: "there's a line that being draw solo i think i
> don't need that" (`~/T/…/Screenshot 2026-08-20 at 8.12.50 PM.png`) — the
> `border-left` rail on `.orgc-seat-sub`, redundant beside the bordered cards it
> contained. Removed in the commit that carries this note.
>
> ### 2026-08-20 — เกี่ยวกับเรา: two views, and แผนผัง rebuilt
>
> **REPORTED**: "remove รายการ and ผังองค์กร, left only แผนผัง and ผังรวม … แผนผัง
> doesn't show order like the ผังรวม … it doesn't care about ระดับ that i config
> in the admin teamsamo … many leftover space including the box ui ฝ่าย role."
> Write-up in `docs/mistakes/frontend-ui.md`
> ("it doesn't care about ระดับ …").
>
> - **TWO views now: แผนผัง and ผังรวม.** รายการ shared แผนผัง's markup;
>   ผังองค์กร shared ผังรวม's renderer. A stored preference of either is
>   MIGRATED, not reset (`RETIRED_VIEWS` in `org-chart.js`).
> - **แผนผัง is no longer a connector tree.** It is a page of ฝ่าย PANELS —
>   a title row you tap, then ONE wrapping band holding its ตำแหน่ง cards
>   (ระดับ order, leading rung tinted) followed by its sub-ฝ่าย as cards.
>   Measured section height: **24,101 → 3,989px at 1440, 55,273 → 8,110px at
>   390**, and the page no longer scrolls horizontally at 390.
> - ⚠️ **DO NOT "unify" the two views on `chartParentage`.** That was tried in
>   August 2026 and cost a 52,000px staircase. What IS shared is the ORDER:
>   both call `orderChildren()` in `org-rung.js`, and `org-rung.test.js`
>   §"แผนผัง and ผังรวม order one ฝ่าย identically" holds the differential
>   (falsified both ways before shipping).
> - ⚠️ **Only the ROOT ฝ่าย open by default** (`OPEN_TO_DEPTH = 0`). Everything
>   deeper is one tap, and ขยายทั้งหมด still opens all 90 panels (23,458px).
> - ⚠️ **`is-wide` and the nested basis are honoured through `:has(>
>   .orgc-unit-body:not([hidden]))`**, because `toggleNode` only flips `hidden`
>   — never add a second class for the open state, it will drift.
> - ⚠️ **Do NOT make `.orgc-people` a grid** to line its columns up across rows.
>   `repeat(auto-fill, …)` contributes ONE column to intrinsic sizing, so a
>   membership bucket stops asking for the line and renders as a one-per-row
>   tower. Measured; the comment in `org-chart.css` says so.
> - `TREE_SHAPE` in `org-face.js` dropped from [130,200,260,390] to [52,104,156]
>   with the portrait; it is ONE decision with `.orgc-person > .org-face`'s
>   `width: 3.25rem`.
> - `.claude/rules/mistakes.md` needed ~250 bytes of compression to fit the new
>   entry — class 6 now says "share the ORDER, not the GEOMETRY".
>
> ### 2026-08-20 (scrutinize pass on the above) — `hidden` was borrowed, not owned
>
> 🔴 **The blocker the review found, now fixed: NOTHING in `src/css/` made the
> `hidden` attribute work.** The UA rule has no `!important`, so any class that
> sets `display` beats it — and three elements on this page do (`.org-years`
> flex, `.org-expand-all` inline-flex, `.orgc-unit-body` flex), all toggled by
> `element.hidden =`. It worked only because Bootstrap's reboot, loaded from
> **cdn.jsdelivr.net in index.html**, ships `[hidden]{display:none!important}`.
> Measured with that one `<link>` blocked and nothing else changed:
> `.orgc-unit-body[hidden]` computed `display: flex` and #orgBody went
> **3,463px → 22,474px** — every ฝ่าย open, disclosure gone, 448 portraits live.
> Fix: `[hidden] { display: none !important; }` at the top of `src/css/base.css`
> (imported by BOTH entries). Re-measured with Bootstrap blocked: 3,318px. ✅
> Guard `hidden-attribute.test.js`, falsified three ways. Write-up in
> `docs/mistakes/frontend-ui.md`.
> **`!important` is load-bearing**: `[hidden]` and `.orgc-unit-body` are both
> specificity (0,1,0) and base.css is imported FIRST, so source order would hand
> the win to org-chart.css.
>
> Also from that pass:
> - `RETIRED_VIEWS` was a plain object read as `MAP[localStorage value]` — the
>   af36088 prototype bug one day later, benign here (`VIEWS.includes` rejects a
>   function) but now `Object.create(null)`.
> - `org-chart-metrics.test.js` (new) pins `TREE_SHAPE` in org-face.js to
>   `.orgc-person > .org-face { width: 3.25rem }` — 52px, widths at 1×/2×/3×,
>   `base` = the 2× candidate, ratio 3/4. Falsified three ways.
> - ⚠️ **`:has()` is LOAD-BEARING on this public page, and it does NOT degrade
>   gracefully.** Simulated by deleting the two `:has` rules: an open ฝ่าย keeps
>   the 12rem basis, is squeezed into a ~19rem column and becomes a tower with
>   ~700px of empty page beside it — the defect the rewrite removed. Accepted
>   (Baseline-widely-available; team.css already uses it; this page did too). If
>   it ever has to go, move the open state to an attribute the RENDERER and
>   `toggleNode` both write — do not add a silent fallback.
> - The `.hidden`-vs-`display` hazard is NOT org-chart-only. `.org-years` and
>   `.org-expand-all` were in the same shape; the base.css rule covers every
>   current and future case, which is why the fix went there and not on three
>   selectors.
>
> ✅ **DEPLOYED = `68d08ea` (2026-08-20)**, VM HEAD confirmed over ssh,
> `DEPLOY_EXIT=0`. Deployed TWICE that day; the second run also carried the
> solo-rail fix — verified in the served `public-DIvV34Fz.css`, where
> `.orgc-seat-sub{…}` has **no `border-left`**. Verified from the SERVED artifacts — and note WHICH ones:
> this code lands in the **public entry**, `assets/public-*.js` +
> `assets/public-*.css`, NOT in `analytics-*.js` and NOT in `admin-*.js`.
> Served `public-DUXCISQP.js`: `orgc-unit-btn` ✓, `ยังไม่มีสมาชิก` ✓, and the
> REMOVED `data-org-view="list"` = **0**. Served `public-DLaz7hrf.css`:
> `orgc-seat` ✓, `:has(` ✓, `[hidden]{display:none!important}` ✓, and the
> REMOVED `org-tree-wrap` = **0**.
> ⚠️ `bi-diagram-2` greps 1 in the served JS and it is **VitalSound's duplicate
> icon** (`vs-staff.js`), not the deleted ผังองค์กร button — check WHAT matched.
> `orderChildren` / `unitBlock` / `seatBlock` grep **0** by construction: the
> minifier renames module-scope names. Use a CSS class or a Thai literal.
>
> Re-check "is prod current" with — EMPTY means yes:
>
> ```bash
> git diff --stat 68d08ea..HEAD -- src/ ':!src/**/*.test.js'
> ```
>
> ⚠️ **RIGHT NOW that is NOT empty and prod IS current.** The one file it lists
> is `src/data/changelog.js`, and the diff is a **⛳ comment only** — 0
> non-comment lines added. Read WHICH file and WHAT changed before spending 90 s
> on a deploy; this is the same trap the 0166 migration set for the last reader.
>
> ### Older, still true
>
> (Previous deploy was `7dbc153`, 2026-08-19.) That entry read: confirm with
> `git diff --stat 7dbc153..HEAD -- src/ ':!src/**/*.test.js'`, empty = the
> served bundle is current, and it IS empty. (Ask about `src/` ALONE: adding
> `supabase/` lists the 0166 migration, whose header comment was corrected after
> it was already applied, and an applied migration cannot make a bundle stale.)
> Migrations through **0166** (none added since); **1217 tests green**.
>
> ⚠️ **20 of 22 proofs green, and the two reds are NOT what this file used to
> say.** It claimed one red (`claude0157` B4, environmental). Measured
> 2026-08-19 03:12 UTC: `claude0157` AND `claude0161` both **ERROR**, not fail —
> `HTTP 400 … 23502: null value in column "starts_at"`. Cause: each searches
> LIVE booking geometry for a 5-hour candidate slot, and the run happened
> 5h48m before the weekly reset (`claude_week_start()` = 08-12 09:00 UTC,
> week_end = **08-19 09:00 UTC**) with **0 active bookings**, so the search
> returned NULL and the insert hit a NOT NULL constraint. **They should go green
> on their own after the reset.** Nothing in this session touched SQL or the
> Claude module, so this is not a regression — but it IS the documented
> "a proof that ERRORS is not a proof that fails" class, now on TWO proofs.
> **The owed fix (still not done): make both scenarios self-contained with a
> synthetic booking instead of searching live geometry — and do NOT tune them
> to merely pass.**
>
> ⚠️ **`.claude/rules/mistakes.md` is at 29999 / 30000 and the budget counts
> UTF-8 BYTES.** The next entry CANNOT be added without compressing first. Thai
> is 3 bytes/char, so trimming English words frees far less than it looks — the
> 2026-08-18 pass shaved ~15 lines of prose to buy ~700 bytes. `tools/
> check-context-budget.mjs` now SAYS "bytes" (it said "chars" until that session
> misled itself for twenty minutes). The next pass should move a whole class's
> examples into `docs/mistakes/` rather than shaving words; several class
> sentences now merely restate an entry the index already carries.
>
> ### 2026-08-18 → 08-19 — `master` and the หนังสือโครงการ seat (ONE thread)
>
> **REPORTED**: "when i select permission as master, i cant select sub of the
> หนังสือโครงการ as ผู้ส่งหนังสือ … so my friend has to tick manually like 7
> tickcheckbox." Full write-up in `docs/mistakes/authz-grants.md`. Shipped over
> five commits and **reversed once**; this block is the CURRENT state.
>
> - **`master` erased the seat, and the seat is an IDENTITY, not a scope.**
>   VS แผนก and Passport ฝ่าย have a widest value and master IS it — correctly
>   nulled. `vpa`/`staff`/`prof` are three DESKS in one transaction; "all three"
>   is not a desk, so nulling meant NOBODY. **Do not "simplify" this back into
>   one rule** — `readPermInputs` treats the three sub-controls differently on
>   purpose, and `master-seat.test.js` will go red if you do.
> - **Measured before the fix: 41 masters, 36 with no seat and no role.** All 36
>   opened หนังสือโครงการ onto a blank pane; the 5 that worked had inherited
>   `vpa` from a parent ตำแหน่ง, which is why it looked intermittent.
> - ✅ **CURRENT: BOTH editors (บุคคล and ตำแหน่ง) auto-fill ผู้ส่งหนังสือ under
>   master and STORE it.** Clearing works — any human touch on the seat select,
>   including choosing "— เลือกบทบาท —", sets `dataset.userSet`, which blocks the
>   refill; `resetMasterState` clears it between rows.
> - ❌ **The one-day asymmetry (ตำแหน่ง did NOT auto-fill) was WRONG, and the
>   reason it was wrong is the lesson.** It rested on "57 people would be
>   notified". That number counted RECIPIENTS without checking what the recipient
>   list drives. `notifyVpAdmin` fires ONE `queueDiscord` to ONE webhook
>   **outside** the loop, and email goes to `settings.uni_staff_email` /
>   `prof_email`, fixed addresses — extra recipients add **zero** of either. The
>   loop only writes in-app rows, fire-and-forget. **Open the fan-out code and
>   check WHICH channel actually loops before quoting a fan-out cost.**
> - 📌 **What the stored seat buys differs BY SEAT.** `listProjectSeatUsers()` is
>   referenced in `notify.js` and NOWHERE else — it is the notification list, and
>   no UI renders those people as a chooser. The only pick-a-person-by-name
>   control is `listProjectProfs()` → `renderProfPicker()` in `sign.js`. So
>   `prof` = notifications + that dropdown; `vpa`/`staff` = notifications ONLY.
>   (Told the owner otherwise once and had to retract it.)
> - **The DB asymmetry the fix mirrors**: the CALLER-scoped
>   `current_user_project_seats()` folds master; the PUBLISHED
>   `managed_project_seats` column does not. Access is implied; a listing is
>   declared.
> - **New ratchet: `src/js/master-mirrors.test.js`.** Enumerates every SQL
>   function that special-cases `'master'` (exactly two, reconciled against the
>   live DB) and pins each to where JS says the same thing. A THIRD name is not
>   automatically a bug — it is an unanswered question. Its first version
>   over-reported `get_claude_board` by slicing "up to the next function" and
>   swallowing 0154's trailing `create policy`; it now reads the $$-quoted body.
> - **Why the 2026-08-17 sweep missed this**: it grepped `role === 'x'` gates,
>   and `projectSeatRole` has none — it PRODUCES the role, upstream of all 28 of
>   them. And `tools/master0111-grant.mjs` was green throughout, because it asks
>   the DATABASE. A DB proof cannot see the frontend half of a mirrored rule.
> - **A /scrutinize pass found three more, all shipped**: the modal's "สิทธิ์รวม"
>   preview was a THIRD hand-rolled chip builder that never learned the master
>   rule; VS แผนก chips understated under master; `seatFanoutCount` counted
>   members with no อีเมล (31 of 447 — no account, so no notification is
>   possible). There is now exactly ONE line in `team/index.js` that writes a
>   `team-perm-chip` span, asserted.
> - **Security/robustness**: the four vocabulary maps are `Object.create(null)`.
>   Every reader is `MAP[key] || key`, so a permission key of `constructor`
>   returned an inherited FUNCTION that won the `||`, and `PERM_ICON` fed it
>   unescaped into a `class` attribute. Not a privilege boundary (`permissions[]`
>   is written by `team_edit` holders) but free to close; `permChip` also
>   validates the icon shape at the one unescaped interpolation.
> - **Chips**: value-carrying first, master collapses to one chip,
>   `หนังสือโครงการ` suppressed when a seat chip already says it. Owner's
>   constraint, honoured: "i still like how current text display" — words kept,
>   icons added beside them. See [[keep-what-works-show-evidence]] in memory.
>
> ### What the earlier 2026-08-18 session was — FOUR things
>
> 1. **The ปีงบ is now on every กล่องจดหมาย row**, grid card and list row, from
>    ONE `fyChipHtml()` — quiet grey normally, orange `ย้ายเอง` when a human
>    moved it, and never `ย้ายเอง` on the public mirror (`enterCustomerView()`
>    renders the SAME rows). Guarded by `fiscal-year.test.js` §3e.
>    ⚠️ **The list row could not take another cell**: every other cell is
>    `flex: 0 0 auto` and the name cell had `min-width: 0`, so a Thai name
>    (`overflow-wrap: anywhere`) collapsed to ONE CHARACTER PER LINE — measured
>    0px wide / 702px tall at 390px. Now a `7.5rem` floor **plus** `flex-wrap`
>    under 576px; at 320px the name was already collapsing to 43px BEFORE any of
>    this. If you add a cell to that row, re-measure at 320px with a control.
> 2. **0166 — the purge SKIPPED the JSONB timelines deliberately, and that call
>    was reversed.** `tools/purge-shared-project-accounts.mjs` says so in its
>    header and gives a real reason (do not rewrite history). What it never
>    counted is what the skip COST: `isMineComment` is `c.by === myId`, so **42
>    of the 43 comments in the system had no แก้ไข/ลบ button for anyone**, not
>    the "two people" the note imagined. Shown that number the owner chose the
>    remap, to the people the columns already named.
>    Snapshot `public._timeline_backup_0166` (60 rows) + rollback in the
>    migration — **drop that table once the owner confirms the comments.**
>    Guard: `proj0165` §D7/§D8; §D4/§D5 were widened from `is null` to "does the
>    uid RESOLVE", which is why this was green for a day.
> 3. **`canManageComment()` is now exported and tested** (`comment-ownership.
>    test.js`, 7 cases, both branches falsified). It also implements the ROLE
>    fallback the surrounding comment had PROMISED for years without the code
>    having it — an entry with no `by` at all was stranded forever.
> 4. **`claude0161` C1 was red for a correct reason and is fixed** — see the
>    proofs note below.
>
> ⚠️ **The เจ้าหน้าที่คณะ successor sees NO file "ใหม่" pill and that is BY
> DESIGN** (the first-run BASELINE marks everything seen). Measured: 0 of 91
> files qualify for them, 40 for a long-lived account. Their bell still shows 77
> unread, so the two read-state systems disagree for the same person. Full
> write-up in `docs/mistakes/app-state.md`. **Before debugging a missing
> highlight, ask the DATABASE how many rows currently QUALIFY for it.**
>
> ### What the 2026-08-18 DAYTIME session was
>
> **Pruned 2026-08-19** — full narrative in
> `docs/state-archive/2026-08-18-daytime.md`. The three still-live consequences:
> the per-person ปีงบ default filter and the ย้ายปีงบ move (both deployed and
> described under CURRENT DEPLOY), the `sastaff`/`saprof` purge (the last two
> shared logins; both usernames stay RESERVED in `auth.js` so nobody can squat
> them — see `.claude/rules/security.md`), and the เจ้าหน้าที่คณะ successor
> seeing **no** file "ใหม่" highlight, which is the BASELINE rule and not a bug
> (write-up in `docs/mistakes/app-state.md`).
>
> ### What the 2026-08-17 session was
>
> **Pruned 2026-08-18** — the narrative is in full at
> `docs/state-archive/2026-08-17-scrutinize-master-purge.md`, and the still-live
> rules are in the `## 2026-08-17 — archived` section near the top of this file.
> One correction that outlived it: that session concluded the projects module
> did not need the master fold "because it is seat-driven". It was, and the
> seat was being erased — see the 2026-08-18 (late) block above.
>
> ⚠️ **The account purges ROTTED four proof subjects across two sessions.**
> 2026-08-17: `proj0092` named the deleted `samomdkkuvpa`; `team0135`'s
> unordered `limit 1` landed on a master holder. 2026-08-18: `proj0092` again
> (it named `sastaff` + `saprof`) and `prof0095` (its whole §A diffed against
> `saprof`). All four now resolve their subject live/deterministically, and
> `proj0092` resolves ALL THREE seats through one `seatHolder()` helper.
> **Lesson: any account delete or permission edit can rot a proof whose subject
> is hardcoded or unordered — run `npm run proofs` after touching accounts, and
> never write a new proof that names an account.**
>
> ⚠️ **`claude0157` is RED because there are 0 active bookings** — its B4 control
> needs a stepping deadline and correctly refuses to pass vacuously. Fix
> (follow-up, NOT done): make the scenario self-contained with a second synthetic
> booking that guarantees a step-down; do NOT tune it to merely pass. It goes
> green on its own once real bookings exist.
>
> ⚠️ **`claude0161` C1 went red on 2026-08-18 for a COMPLETELY CORRECT reason
> and is now fixed.** Its grid is the REMAINDER of the quota week, so it shrinks
> to nothing as the Wed 16:00 reset approaches; the control asserted
> `count > 100` and only 86 quarter-hours were left. Threshold is now `> 20`
> (one 5-hour window); C2 is what really stops vacuity. **`claude0157`'s sample
> search has the same shape** (`now() + 7h` → `week_start + 7d − 11h`, 5 slots
> left at that instant) — so if B4 is red EARLY in a fresh quota week, that is
> the real failure, not this rot. Write-up in `docs/mistakes/tooling-proofs.md`.
>
> ### The earlier (2026-08-16) จองโควตา Claude session — still current
>
> Migrations 0161/0162/0163 + a UI pass. The five things that cost real time:
>
> 1. **The rail was a SECOND author of the window rule** (0161).
>    `claude_free_now()` took its 5-hour window from the CLOCK; the trigger's
>    `claude_window_loads()` takes it from the booking chain. 0154 had claimed
>    the arithmetic lived in exactly one home and the database then grew two.
>    **"One home" means one FUNCTION, not one tier.**
> 2. **A field already in the payload beat polling harder** (0162).
>    `five_hour.resets_at − 5h` is the instant a window OPENED, so a rise
>    between two polls is clamped to it — "10:07–10:15", not "10:00–10:15" —
>    with no change to the 15-minute reporter. **Look for the field that pins an
>    edge before adding resolution.**
> 3. **A ROUNDING KEY has a boundary; an instant does not** (0163). Identifying
>    a window by `date_trunc('minute', resets_at + 30s)` splits it mid-window
>    whenever the true reset lands near :30, and the split attributes the whole
>    CUMULATIVE reading as a rise. Compare raw instants with a tolerance.
> 4. **Rewriting a function from its ORIGINAL migration reverted 0158.**
>    `claude0155 §C3` caught it in a minute. 0162 took its body from
>    `pg_get_functiondef` and diffed first. **Do that.**
> 5. **The rail's colour scale took three attempts** and every one was reported
>    back. Read the "calendar rail" block above before touching it — especially
>    ⛔ **never put `overflow` clipping on `.claude-free`**, and **do not re-add
>    the width encoding**, which was built and pulled.
>
> ⚠️ **Everything the 0159 + 0160 session learned is still above** — the window
> rule, "an open window is not bookable at all", and 390/834/1440. Not
> superseded.
>
> ### A SELF-REVIEW OF 0161–0163 FOUND FOUR THINGS — **ONE is still open**
>
> ⚠️ **This section used to say all four were unfixed, and that was stale for a
> day.** Re-verified against the LIVE database on 2026-08-18:
> **1 is FIXED** (`claude_usage_runs` now contains `p_to > now()` — migration
> 0164), **3 is FIXED** (`paintSilentToggle()` exists in
> `src/js/claude/index.js`), **4 was never real** (`claude_usage_samples_at_idx`
> exists). **Only 2 — the 0161 cost claim — is still open, and it is low
> priority.** The original text is kept below because the REASONING is what
> makes each one findable again; read the status line above it, not the heading
> it carries.
>
> 1. **`open_ended` is wrong for every historical week.** `0163:191` is
>    `open_ended := (v_to = v_last_at)` and `v_last_at` is scoped to the
>    REQUESTED RANGE (`0163:93-95`), not to now. So browsing any past week marks
>    its final run "may still be running" — the UI fades the bottom edge and the
>    tooltip says `อาจยังใช้อยู่` about a week that ended days ago.
>    **Fix: `open_ended := (v_to = v_last_at and p_to > now())`.**
>    ⚠️ The probe returned 0 for last week and that is VACUOUS, not a pass —
>    there are only ~84 samples, so the previous week has none. And
>    `claude0162 §D5` cannot catch it either: it only checks runs that ended
>    BEFORE the last poll, and this one IS the last poll. **Add the past-week
>    case to §D in the same commit.**
>
> 2. **The 0161 header's cost claim is UNVERIFIED and probably wrong.** It says
>    the change is "a constant factor, not an order". It is not obviously so:
>    0161 added a boundary per booking (`starts_at + 5h`, ~4n instead of ~3n)
>    AND made each boundary's `claude_free_now()` call `claude_window_loads()`,
>    which itself loops over bookings — so ~4n evaluations that are each O(n).
>    Measured: `claude_free_now()` 0.78 ms/call, `claude_free_windows()` 21 ms
>    at ONE booking. `STATE.md` recorded ~100 ms at 30 bookings BEFORE 0161, and
>    `get_claude_board()` is polled every 60 s per open admin tab.
>    **I could not complete the synthetic benchmark** — the 0160 open-window
>    guard and the real bookings refused the inserts three ways (start after
>    `claude_open_window().win_end`, and keep each probe booking's window clear
>    of the real ones). **Benchmark at 7/15/30, then correct or confirm the
>    header.** If real, hoist the settings/sample reads out of
>    `claude_free_now()`.
>
> 3. **The silent-booking control goes stale on an in-place account switch.**
>    `claude/index.js:413` evaluates `holdsMaster()` inside `wire()`, which the
>    one-shot `built` flag runs once per session; the account switcher does not
>    reload. COSMETIC, not a leak — the notify gate re-checks `holdsMaster()` at
>    SEND time, so a non-master's ticked box suppresses nothing; they just see a
>    checkbox that does nothing, which is its own class here.
>    **Fix: move the toggle from `wire()` into `enterClaudeWorkspace()`.**
>
> 4. **No index on `claude_usage_samples.sampled_at`.** `claude_usage_runs`
>    opens with `where sampled_at < p_from order by sampled_at desc limit 1`.
>    84 rows today, ~35k/year at 96/day.
>
> **Also unverified, and cheap to check:** `applyFit()` parses
> `getComputedStyle(scroller).maxHeight`, which is now
> `min(1100px, calc(100dvh - 230px))`. `getComputedStyle` resolves that to px so
> it SHOULD work, but the calendar height was measured with **"พอดีจอ" OFF** and
> never tested with it on. That toggle divides this value by 24.
>
> ### Owed, and offered but not chosen
>
> - **The reporter's polling was analysed and left at 15 minutes.** It is
>   `OnUnitActiveSec=15min` (relative, drifts ~1s/run, harmless) and it CANNOT
>   be aligned to the 5-hour reset — the reset is set by whoever sends the first
>   message. What stays unmeasured is the TAIL of a closing window (4 and 9
>   minutes on the two real windows of 2026-08-16); closing it needs a one-shot
>   poll at `reset − 30s` on the VM, ~2–3 extra calls a day. **Offered; the
>   owner has not answered.**
> - **`claude_open_window()` (0160) tests `pct > 0`, but a window can be open
>   with `resets_at` set and 0% spent** — measured at 09:50 on 2026-08-16. For
>   ~15 minutes after someone's first message the guard would let a latecomer
>   book straight through them. Widening that refusal is a decision about who
>   may book, so it was flagged and NOT changed. **Ask the owner.**
>
> ### What is owed
>
> - 🔴 **TELL TWO PEOPLE THEIR LOGIN CHANGED — nobody has.** `sastaff` and
>   `saprof` were deleted on 2026-08-18 and **their live sessions died with
>   them** (`sastaff` had signed in that morning at 05:22 ICT). Until they are
>   told, the เจ้าหน้าที่คณะ and อาจารย์ desks are simply locked out and will
>   read it as the site being broken:
>   - **เจ้าหน้าที่คณะ — Worapong, `woratho@kku.ac.th`** (seat `staff`)
>   - **อาจารย์ — Prakasit, `prakasa@kku.ac.th`** (seat `prof`)
>
>   The message is short: *the shared username/password is gone; sign in with
>   "เข้าสู่ระบบด้วย Google" using your own KKU address — everything you had is
>   still there.* Both HAVE signed in with Google before (Worapong that same
>   morning, Prakasit on 2026-07-23), so there is nothing to set up; verified
>   live that the seat opens the whole desk. **This is a message to a human, not
>   a code task — it cannot be closed from this repo.**
> - ✅ **The `claude` permission is GRANTED — no longer owed.** Measured
>   2026-08-18: **146** accounts carry the `claude` key in `permissions` /
>   `managed_permissions`, plus 41 `master` holders who answer yes to every key.
>   What is still true is that **`claude_bookings` is EMPTY** — the feature is
>   deployed, granted and unused. That is also why `claude0157` B4 is red: its
>   control needs a stepping deadline and refuses to pass vacuously. **The first
>   real booking turns it green.**
> - **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK. Do not build yet.**
>   Read `docs/demos/about-3d/README.md`, not a bullet.
> - **The browser pass, continued — `skills/drive-the-browser.md`.** Still
>   undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, SHOP
>   CHECKOUT. `docs/NEXT.md` §1.
>   ✅ **The auth blocker is solved — §4 of that skill now has the recipe.** The
>   two traps that made this hard, both paid for on 2026-08-18: you CANNOT
>   inject a session into `localStorage` (drive the sign-in form instead), and a
>   grant written straight into `public.users` is ERASED on the next login by
>   `sync_my_team_permissions` — a probe account needs a `team_members` row.
>   With that, a throwaway account can render any role-gated control.
> - **The org chart on a REAL iPad.** Verified on Playwright's WebKit only.
> - **ทีม SAMO restructure — DO NOT reparent a ฝ่าย without reading §1 below.**
> - `docs/NEXT.md` carries the rest (§0c two latent role-only policies, §0d make
>   the PR delete rule ONE predicate).
>
> ### Open question for the owner, asked and unanswered
>
> The usage reporter polls every 15 min on a systemd timer. Faster is possible,
> but the endpoint rate-limits hard (a 429 is already handled as a skipped tick)
> and every run rotates the OAuth refresh token — more runs is more chances to
> strand a credential only a human on the VM can restore. The **refresh button**
> added this session re-reads the DATABASE only, and says so; a true on-demand
> poll would need an authenticated endpoint on the VM that spawns the reporter,
> which is new attack surface on a service that is currently unauthenticated.
> **Recommendation given: leave it at 15 minutes.**
>
> ### ⚠️ Four traps these sessions walked into
>
> - 🔴 **`.claude/rules/mistakes.md` is at 29,725 of its 30,000-char cap — 275
>   chars of headroom, and `npm run check:context` runs inside `npm test`.**
>   That means **the next write-up may turn the standing `npm test` red before
>   you have done anything wrong.** This session added 744 chars (three entries
>   + a class site) and gave 78 back by compressing its own class site; that is
>   the whole lever prose gives you. Micro-trimming prose was tried TWICE in
>   earlier sessions and buys ~100 bytes an hour.
>   **The next session that breaches it should RESTRUCTURE, not trim**: the
>   `## Index` half is **18,533 of the 29,725** (measured 2026-08-18, 212 lines,
>   and it only grows), its per-entry value declines, and
>   `grep -rin "<symptom>" docs/mistakes/` already does the finding. The classes
>   above it are the part that generalises and must survive any cut.
>   `check-context-budget.mjs` measures BYTES and Thai costs 3 per character.
>   A byte cap on the index was tried and **REVERTED** — it truncated Thai
>   symptom lines mid-word, and those lead lines are what the index is for.
> - **A browser harness inlines `src/html/*.html` at generation time.** Edit the
>   partial, re-run the probe, and it reads the STALE copy and reports the old
>   text as if it shipped. Regenerate the harness after every partial edit.
> - **A correlated subquery can SHADOW the alias you meant.** An app-wide sweep
>   for orphaned uids wrote `not exists (select 1 from public.users u where
>   u.id = id)` over a CTE column also called `id` — Postgres bound the inner
>   `id` to `users.id`, so the predicate was `u.id = u.id` and every uid
>   "resolved". It reported the database clean, including a table that provably
>   held 298 orphans. **Name the extracted column something no table has
>   (`uid_txt`), and run the sweep against a subject you KNOW is dirty before
>   believing a zero.**
> - **Slicing this file on `"## NEXT-SESSION PROMPT"` fails in BOTH directions.**
>   `index()` finds the mention in the INTRO and truncates the file (twice).
>   `rindex()` finds the mention in THIS trap list, which sits after the
>   subsections you were trying to reach, and the slice then raises. Anchor on
>   `"## NEXT-SESSION PROMPT (paste"` — the only occurrence that appears once.
>
> ### How this repo wants you to work
>
> - **The owner tests live and reports in bursts**, often against code shipped
>   minutes earlier, and increasingly from a phone. Treat their message as the
>   test pass this repo does not have. Their reports are usually about MEANING:
>   "ซึ่งใช้ร่วมกัน" was arithmetically true and said the wrong thing about who
>   owns a session, and "อ่านครั้งเดียวจบ แล้วใช้ให้สนุก" was the wrong register
>   for a document people are held to.
> - **A fix on ONE path is not a fix** (class 4) and **prove it live in BOTH
>   directions** (class 7) — both in the auto-loaded `.claude/rules/mistakes.md`.
> - **When a hazard has been paid for twice, the third fix is a TEST.** Fifteen
>   ratchets now. **Falsify each assertion before committing it** — and when a
>   deliberate behaviour change reddens an old assertion, that is the guard
>   working (0160 reddened `claude0159 §C3`), not a test to silence.
> - **Batch commits before deploying** — each VM deploy is ~90 s. A `tools/`- or
>   `docs/`-only commit needs no deploy.
>
> ### The decisions already made — do not re-litigate
>
> Each was settled with the owner; the reasoning is in the archive file named.
>
> - **The `master` grants reaching สมาชิกฝ่าย IT are INTENTIONAL** — confirmed
>   twice (2026-08-14, 2026-08-15). That is the team that builds this app. Do
>   not "fix" it and do not raise it a third time.
> - **The ทีม SAMO admin-model rework is PARKED** at the owner's request.
>   `docs/NEXT.md` §0a has the diagnosis and plan. Display structure and
>   permission structure should NOT be separated — four `mode`s over ONE tree is
>   the right pattern. ⚠️ The tree has been edited since (272 → 296 nodes);
>   re-measure before acting on any count. Open question for them: **`house` is
>   granted by NO node**, so ระบบบ้าน admin is role-only. Intentional or lost?
> - **SAMO Shop stays open to BOTH login routes** — the checkout email is
>   editable even when Google prefills it, so restricting the login method buys
>   the LOOK of a verified contact and none of it.
> - **The sign-in modal's copy is settled after SIX reports.** Read the entry in
>   `docs/mistakes/frontend-ui.md` BEFORE touching it; guarded by
>   `signin-screen.test.js`. No email domain anywhere in the modal, ever.
> - **The org chart: the owner's asks are about ผังรวม**; they explicitly do not
>   want แผนผัง reworked.
>
> ### 1b. The public org chart (`/team`)
>
> **Fully archived — read `docs/state-archive/2026-08-15-late-org-chart-reporting.md`
> before touching any of the four views.** The two rules that get rediscovered
> the hard way: **FOUR views, TWO parentages** (รายการ+แผนผัง draw CONTAINMENT,
> ผังองค์กร+ผังรวม draw REPORTING — do NOT unify them, that is what made แผนผัง
> a 52,000px staircase), and **"แสดงถึง" is a KIND, not a depth**. Display rules
> live in `src/js/org-rung.js`, guarded by `org-rung.test.js`.
>
> ### 2. Invariants that will bite you
>
> - **`public.people` is the person registry.** `students.person_id` /
>   `team_members.person_id` are PLACEMENTS, both `ON DELETE SET NULL`. Both
>   mirrors are guarded by `is distinct from`, and **that guard is the
>   TERMINATION CONDITION**. A mirror is only bidirectional on the columns BOTH
>   directions NAME.
> - **Deleting a นักศึกษา is two different deletes** — `student_delete_impact()`
>   (0144) is the only correct way to tell them apart.
> - **`team_members` has NO unique key on kkumail, on purpose** — 82 people hold
>   2–4 ตำแหน่ง. `students.kkumail` IS unique. Do not "fix" the asymmetry.
> - **Nothing may re-add a role branch to `users_read_all`** — `role` and
>   `permissions` share the row, so a full read maps who holds `master`.
> - **ชั้นปี IS NOT STORED.** `src/js/study-year.js` computes it; never spread a
>   row and overwrite only `student_id` — call `yearBasis(stored, typed)`.
> - **A "fill only if empty" prefill is safe only while the IDENTITY behind it
>   cannot change.** The account switcher does not reload, so any such prefill
>   must remember WHOSE data it holds (`applyBuyerPrefill`, `prefillUid`).
> - **A client-side count over an RLS-gated table is a fail-open** — RLS returns
>   ZERO ROWS, not an error. Count server-side.
> - **Deploy first, drop second.** 0129 dropped columns the SERVED bundle still
>   named and took ระบบบ้าน's admin tab down for 20 minutes.
> - **A TRASHED Drive file is still served publicly** by `lh3`.
> - **`set_config(…, true)` is TRANSACTION-scoped** and `reset role` does not
>   clear it.
> - **A guard's INSTRUMENT needs a guard.** Comment stripping, bundle grepping
>   and result parsing all silently change what a test can SEE, and a wrong
>   instrument makes a test PASS. Use `src/js/strip-comments.js` and
>   `npm run proofs`, never a fresh regex.
> - **Grep the SHARED chunk, not just `public-*.js`.** `ใต้สังกัด` reads 0 in the
>   public bundle and 1 in `analytics-*.js`, which `/team` also loads. That cost
>   a false "the deploy did not take" on 2026-08-15.
>
