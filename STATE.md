# STATE — current task & latest known state

Last updated: **2026-08-26**. This is "what is true RIGHT NOW" and nothing else;
`git log --oneline` is the chronology and `docs/state-archive/` holds the
reasoning. **Target is ~200 lines** — when it bloats, move narrative to the
archive rather than trimming the invariants.

⚠️ **It is still several times over target — `wc -l STATE.md` says how far, and
do not write that number here; a header that carries a count is a header that
goes stale, which this file has now done twice.** Seven prunes have been done so
far; each one took the OLDEST per-session narrative block, verified its full
write-up existed in `docs/mistakes/` or `docs/state-archive/`, and left behind
only the rules that are still LIVE plus a pointer. **Take the OLDEST such block
each time, never the invariants, and never a block whose write-up you have not
opened.** It keeps growing because each session adds rules that genuinely belong
here — the structural fix is the split designed in `docs/TEAM-WORKFLOW.md` §6.5
(status here, invariants to `docs/INVARIANTS.md`, per-person session notes to
`docs/state/<handle>.md`), which is planned and not built.

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
- ✅ **DEPLOYED = `2993dd1` (2026-08-26)** — the ประกาศ refusal text (0168 and
  the proof repairs are DB/tooling only and needed no bundle). VM HEAD confirmed
  over ssh = local HEAD, `DEPLOY_EXIT=0`.
  **Verified from the SERVED artifacts — and note WHICH one, because this is the
  trap that has cost two false "the deploy did not take" readings:
  `announcements.js` lands in the SHARED `analytics-*.js` chunk, which BOTH
  entries load. It is 0 in `public-*.js` and 0 in `admin-*.js`.**
  Served `analytics-B2rPVvmB.js`: `อัปเดตไม่สำเร็จ — ไม่พบประกาศนี้` = 1,
  `ลบไม่สำเร็จ — ไม่พบประกาศนี้` = 1, `ไม่มีสิทธิ์ “เขียนประกาศ”` = 3 (all three
  refusals), and the REMOVED `ต้องเป็น pr_staff` = **0 in all three bundles**.
  ⚠️ **`pr_staff` still greps 1–2 per bundle and that is CORRECT — check WHAT
  matched.** Every remaining hit is a role→LABEL map (`pr_staff:"PR Staff"`),
  `STAFF_ROLES`, or `userCanAccess`'s `roleDefaults`. None is inside a sentence,
  which is exactly what `ui-copy-roles.test.js` allows.
- Previous deploy = `e42ce80` (2026-08-26) — the boot watchdog and its
  extension diagnostic. **Verified 2026-08-26 from the SERVED HTML on BOTH
  entries** (`/` and `/admin/`): `data-samo="boot"` ✓ `data-samo="redirect"` ✓
  `ส่วนขยาย (extension)` ✓ `not ours:` ✓. Everything after it is docs-only.
  ⚠️ **This line said `543a025` for a day while prod was two deploys ahead.**
  The deploy happened; recording it did not. Grep the served artifact before
  believing this line in either direction — a stale sha here reads exactly like
  "there is a deploy owed" and costs somebody 90 s and a VPN session.
- Previous deploy = `543a025` (2026-08-25) — the Claude measurement switch
  (0167), the restored ผังสายงาน view, the proof repairs and the timer fix.
  VM HEAD confirmed over ssh, `DEPLOY_EXIT=0`, deployed twice that day.
  Verified from the SERVED artifacts, and note WHICH ones: the org chart is in
  the **public** entry, the Claude board in the **admin** entry.
  Served `admin-DrTH7Aud.js`: `claudeMonitor` ✓ `หยุดติดตามการใช้งานจริงชั่วคราว`
  ✓ `sample_stale_minutes` ✓ `หยุดไปแล้ว` ✓, and the REMOVED hardcoded
  `35 * 60 * 1000` = **0**. Served `public-BtnDkbwE.js`: `ผังสายงาน` ✓
  `org-station-dot` ✓ `data-org-view="lines"` ✓, REMOVED `org-tree-wrap` = **0**.
  Served public CSS: `org-lines` ✓ `org-station-btn` ✓ `orgc-seat` ✓ (both
  views styled). `samo-notify` restarted, so the @here removal is LIVE — its one
  remaining `@here` in `_discord.js` is inside the explanatory comment, checked.
  **`git diff --stat 543a025..HEAD -- src/ ':!src/**/*.test.js'` is EMPTY.**
- ✅ **ALL 23 LIVE PROOFS GREEN** (re-run 2026-08-26, after `claude0167`'s
  instrument was fixed — see below). **1318 tests. Migrations through 0168.**
- **Prod runtime state**: Claude measurement is **ON again since 2026-08-25
  17:18 UTC**, switched on from `/admin#claude` by Phuriphat (the trigger
  stamped them, so the board shows a name this time). Samples resumed 17:20 and
  have run every 15 min since. **Do not quote a sample count from this file —
  ask the database** (`select monitoring_enabled from public.claude_settings`,
  and `select max(sampled_at), count(*) from public.claude_usage_samples where
  sampled_at > now() - interval '24 hours'`). Re-verified 2026-08-26 late: ON,
  newest sample 13 minutes old, 90 in the last 24 h — the steady rate for a
  15-minute timer, and the "40" this line used to carry was a mid-day reading
  that read like a half-broken reporter. The subscription question is settled; `claude login` on
  the VM evidently held.
  ⚠️ **`monitoring_note` still carries the OLD pause reason** ("ยังไม่ได้
  ต่ออายุ Claude…"). Harmless — `paintMeasured` renders the note only inside
  `if (!mon.enabled)`, so nobody sees it while measurement is on, and the
  monitor-on Discord notice uses it as "why it HAD been paused", which reads
  correctly. Checked, not assumed. Do not "fix" it into a blank.
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
  ⚠️ **The example above is a 2026-08-19 SNAPSHOT, kept for the lesson and not
  as a status.** It read: that command is NOT empty yet prod IS current, because
  the only file listed was a migration whose HEADER COMMENT had been corrected
  after it was already applied. **The lesson is the durable half — narrow the
  diff to `-- src/ ':!src/**/*.test.js'` to answer "is the served bundle
  current", and read WHICH file it names before spending 90 s on a deploy. An
  already-applied migration can never make a bundle stale.**
  ⛔ **Do NOT read counts out of this paragraph.** It carried "migrations through
  0166, 1170 tests, 21 of 22 proofs green, the red is `claude0157` B4" for a
  week after every one of those stopped being true — a third home of three facts
  the top of the file had already corrected. **The live numbers live in exactly
  one place, the NEXT-SESSION PROMPT header, and `state-handoff.test.js` now
  fails if a second home disagrees with it.**
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
  ✅ **The `claude` permission is GRANTED — this said "still owed" for eight days
  after it was done, while the NEXT-SESSION PROMPT recorded it as granted. Two
  homes, one corrected.** Measured 2026-08-26: 153 accounts hold the key through
  `permissions` / `managed_permissions`, plus 42 `master` holders who answer yes
  to every key. Re-run before quoting — the owner edits the tree.
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
- ✅ **`claude0157` B4 is GREEN and self-contained — the follow-up this bullet
  used to ask for was DONE on 2026-08-25.** It plants a second synthetic booking
  and MOVES the quota week rather than searching live geometry for a slot. It was
  not tuned to pass: the new scenario found a real thing (where a window reset
  and a deadline coincide the instant is worth MORE than both neighbouring bands,
  so B1 became `>=` and B1b pins the coincident case).
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

## ⚠️ STATE.md IS 1,126 LINES AND THE RULE IS ~200

CLAUDE.md's end-of-turn loop says: *"Keep STATE.md under ~200 lines; if it
bloats, prune past-session sections to `docs/state-archive/YYYY-MM-DD.md` and
trust `git log --oneline` for the chronology."* This file is five times that and
2026-08-20 made it worse, not better. **Whoever has budget next: prune before
adding.** Everything above `## NEXT-SESSION PROMPT` older than the current
deploy is archive material — the `## 2026-08-17 — archived` block and the
per-deploy verification logs for anything before `68d08ea` are the obvious
first cuts. The NEXT-SESSION PROMPT itself is the part that must survive.

## NEXT-SESSION PROMPT (paste this after a /clear — updated 2026-08-26)

> ✅ **NOTHING IS OWED TO A PERSON. DEPLOYED = `36ac1d5` (2026-08-26 late)**,
> VM HEAD confirmed over ssh, `DEPLOY_EXIT=0`. (The previous deploy was
> `2993dd1`, the ประกาศ refusal copy, verified from the served
> `analytics-*.js`.) `36ac1d5` carried one copy change: `src/js/db.js`'s missing-env-var
> `console.error` used to send the reader to the retired **Cloudflare Pages
> dashboard** — the first message a new developer sees when their `.env.local`
> is wrong, with five of them joining. It now names `.env.example`.
>
> ⚠️ **DO NOT try to verify that one by grepping the served bundle — it is not
> there, and that is correct.** The message sits behind
> `if (!import.meta.env.VITE_SUPABASE_URL)`, Vite substitutes the value at build
> time, and the whole branch is compiled out of every build that HAS the vars.
> Proved both ways: 0 of 27 served bundles, and 1 occurrence in a build made
> with the vars blanked. Write-up in `docs/mistakes/deploy-hosting.md`; the
> class-7 line in `.claude/rules/mistakes.md` now names it. **A control
> (`อัปเดตไม่สำเร็จ`, 8 chunks) confirmed the grep itself was working.**
>
> ⚠️ **Otherwise `main` being AHEAD of the deployed sha is the NORMAL state
> here** — most commits are docs, `docs/mistakes/` and tests, none of which
> reaches a bundle. Do NOT read "HEAD ≠ deployed sha" as a deploy owed. Re-check
> with (EMPTY = current), asking about `src/` plus the two entry HTMLs ALONE:
>
> ```bash
> git diff --stat <DEPLOYED-SHA>..HEAD -- src/ ':!src/**/*.test.js' index.html admin/index.html
> ```
>
> **Read this file, then `skills/write-a-guard.md`.** Nothing is owed on `/team`
> — the ⛳ third org-chart view shipped. Migrations through **0168** (applied
> 2026-08-26). **1318 tests green. ALL 23 LIVE PROOFS GREEN.**
>
> ⛔ **BEFORE YOU EDIT THIS FILE — the rule it cost six stale claims to learn.**
> **When you correct a fact here, grep the WHOLE file for its other homes.** On
> 2026-08-26 an audit found a proof called red in THREE places that had been
> green for a day, three different test counts, a budget warning contradicted
> 400 lines above it, and "still owed" above a section recording it as done.
> Each correction had been made properly — in the one place the author was
> reading. `state-handoff.test.js` now pins what is mechanically checkable
> (paths resolve · migration high-water mark · proof count · one test count, all
> spellings agreeing); it cannot judge whether a SENTENCE is true, which is why
> the grep is a habit and not a test. **Give a decaying fact ONE home; in an old
> block keep the LESSON, never the counts.**
>
> ### 🆕 2026-08-26 — A TEAM WORKFLOW WAS DESIGNED. NOTHING WAS BUILT.
>
> The owner is bringing in **~5 more developers**. A full design for that —
> dev environment, preview deploys, credentials, migration flow, review flow,
> the Claude protocol, a docs site — is in **`docs/TEAM-WORKFLOW.md`**, which is
> the AUTHORITATIVE record. An Artifact rendering exists for humans and may be
> stale; the file wins.
>
> ⛔ **The dev environment does not exist yet.** No dev Supabase project, no
> preview URL, no refresh script, no `schema_migrations` table.
> ⚠️ **`CONTRIBUTING.md` still correctly describes TODAY — that contributors
> test against production — and that part must NOT be "corrected" to match the
> plan until the matching phase ships (see §9 of the plan).** Its stale *test
> count* was fixed on 2026-08-26; the workflow description was deliberately left
> alone.
> ✅ **What DID ship 2026-08-26, and needs nothing built**: the document itself ·
> `.github/CODEOWNERS` (advisory — it REQUESTS the owner's review on the
> load-bearing paths; it only BLOCKS once `require_code_owner_reviews` is
> enabled) · `.github/pull_request_template.md` and two issue templates · two
> shared subagent definitions in `.claude/agents/` (`mistake-finder` searches
> the bug write-ups and returns only what applies; `db-inspector` runs read-only
> SQL and returns the answer, not the dump), with `.gitignore` opened for that
> directory. ⚠️ **Neither agent has ever been invoked** — a malformed frontmatter
> header fails silently by the agent simply not appearing in the list. Check
> that before relying on one.
> 📌 **Measured, not assumed: the PR workflow already exists** — five `write`
> collaborators plus the owner, 16 PRs, 9 merged, newest 2026-07-11. Branch
> protection is ON (1 approval, no force-push) but **CI is NOT a required check**,
> so a PR with failing tests can merge today. That is the 20-minute fix in §8a.
>
> 📌 **Read its §0 before proposing anything about dev/staging.** Seven design
> points were argued and then DECIDED BY THE OWNER, several reversing an earlier
> draft: no data masking, no gate on the preview URL, `master` in the real tree
> is fine for the team, a mail TRAP not mail-off, and NO environment-dependent
> branch in the app (the VitalSound form is unmodified on dev). §7 holds the
> unknowns; **§7.1 — there is no `pg_dump` credential in `.env.local` — blocks
> every other phase.**

> ### ⏸ ONE DECISION PARKED WITH THE OWNER — "i'll decide later"
>
> Do NOT build it unprompted; it was offered and explicitly deferred
> on 2026-08-26.
>
> 1. **The boot bar's first-failure branch** (the Stay finding below). One
>    contained change, ~15 min with a falsified test. This is the ONLY code
>    change currently on the table, and it was explicitly deferred.
>
> ### WHAT PROD IS DOING RIGHT NOW
>
> - **Claude usage measurement is ON.** The owner switched it back on from
>   `/admin#claude` on 2026-08-25 17:18 UTC; the timer wrote its first sample at
>   17:20 and has run every 15 minutes since. ⚠️ **The previous version of this
>   block said measurement was switched OFF, with a whole procedure for turning
>   it back on. It had already been done.** Ask the DATABASE what the switch says
>   before repeating a runtime claim out of this file — `select
>   monitoring_enabled, monitoring_changed_at from public.claude_settings`.
> - `monitoring_note` still holds the old pause reason. Not shown while
>   measurement is on (checked in `paintMeasured`), and used correctly by the
>   monitor-on Discord notice as "why it had been paused". Leave it.
> - **`claude_bookings` is still EMPTY** — deployed, widely granted, and unused.
>   (Head-counts rot here; the numbers and the query live under "What is owed".)
>
> ### 2026-08-26 — the PR desk rule, and a proof that was reading the weather
>
> **ASKED**: *"who has PR permission, including the master in the admin teamsamo
> should be able to do anything add edit delete etc of the pr"*.
>
> - ✅ **It already worked, and that was MEASURED, not read off the code.** A
>   real `master` holder with no `pr` key and no staff role was walked through
>   add / see-others' / edit / delete / the ลบ RPC against a live ticket inside a
>   rolled-back transaction — all five allowed. Same five for a permission-only
>   holder. The front end has exactly ONE PR gate and `pr-staff.js` contains no
>   role check at all. **Answer a "can X do Y" question by making X try Y.**
> - **0168 — the rule is now ONE predicate**, `current_user_can_manage_pr()`.
>   `docs/NEXT.md` §0d asked for the delete PAIR; `pg_policy` said FOUR —
>   `pr_tickets_read`'s third branch, `_update_staff`, `_delete_staff` and the
>   RPC. **Read the catalog before believing a note's count.** Naming it after
>   DELETE would have left three copies under a name that lied.
> - **A latent divergence closed on the way past**: the RPC's `if v_role is null
>   or not (...)` REFUSED a null-role caller the policy ALLOWED. Unreachable
>   (`users.role` is NOT NULL, 0 null rows, and no users row also means no
>   permission — all three measured), so it is settled in the POLICY's direction
>   with a `coalesce`, making fail-closed a property of the predicate instead of
>   a branch each caller has to remember.
> - ⚠️ **THE CLEANUP NEARLY COST A GUARD ITS EYESIGHT — this is the transferable
>   part.** Moving the decision into a shared predicate moved it out of the body
>   `definer-authz.test.js` reads, so that sweep would have skipped
>   `soft_delete_pr_ticket` at "it decides some other way": green, and blind. It
>   now follows one level of helper calls, with a control measuring raw vs
>   expanded so the expansion cannot silently stop. **When you extract a
>   predicate, check what was WATCHING the thing you extracted.**
> - `tools/pr0149-delete-permission.sql` went 13 cases → **25**. §A/§B/§C cover
>   read and update too; §D is STRUCTURAL, because behaviour alone cannot see a
>   fourth copy — four identical copies agree perfectly right up until one is
>   edited. §D failed 5/5 against the pre-0168 database. D3–D5 report `MISSING`
>   rather than raising: "the predicate was deleted" is the regression §D exists
>   for, so it must be a loud FAIL and not a stack trace.
> - 🔴 **`claude0167` went red 15 minutes after the app started working again,
>   and the INSTRUMENT was wrong, not the code.** `week_left()` deleted `where
>   raw->>'proof' = 'claude0167'` — its own rows — while its comment claimed it
>   cleared the real ones "by construction rather than by hoping".
>   `claude_latest_sample()` takes the newest row and THEN tests its age, so once
>   real samples resumed, a 12-minute-old real one answered instead of the
>   deliberately 600-minute-old probe row. **It was green only because the
>   reporter was PAUSED.** Fixed by clearing every sample inside the proof's own
>   rolled-back transaction (no triggers on that table, checked; 585 real rows
>   counted again after), plus §A0 asserting the premise.
>   📌 **A scenario can depend on an ABSENCE as silently as on a presence — and
>   that one is worse, because the proof is green while the system is broken and
>   goes red when it recovers.** Ask what a proof assumes the environment will
>   NOT do. **"By construction" in a COMMENT is the tell; the construction can
>   assert it.** Write-up in `docs/mistakes/tooling-proofs.md`.
> - §A0 needed a second pass: written as one statement it read the table BEFORE
>   its own volatile function's delete. A control that measures the wrong instant
>   is not a control.
>
> ### NOTHING IS OWED TO A HUMAN — corrected 2026-08-26
>
> Two sessions, this one included, carried a 🔴 "TELL TWO PEOPLE THEIR LOGIN
> CHANGED". **That was wrong, and the owner corrected it: the shared `sastaff` /
> `saprof` accounts were removed exactly as intended, and Worapong
> (`woratho@kku.ac.th`, seat `staff`) and Prakasit (`prakasa@kku.ac.th`, seat
> `prof`) already sign in with their own kkumail — they hold the desk through
> their ทีม SAMO permission.**
>
> 📌 **The mistake was reasoning about the CREDENTIAL THAT WAS REMOVED instead
> of the CHANNEL THAT GRANTS ACCESS.** Deleting a shared password locks nobody
> out when the access comes from the SEAT — which is what this app has been
> built around since the purge. Before writing that somebody is locked out, ask
> which channel actually grants them access today, not which one disappeared.
>
> ### 2026-08-26 — ประกาศ refusals named a role that had stopped being the rule
>
> **ASKED**: *"whoever got the เขียนประกาศ permission in admin teamsamo or master
> can use it"* — then: fix the wording.
>
> - ✅ **The permission works, MEASURED not read.** A `creator` holder (no
>   master, no staff role) and a `master` holder (no creator key, no staff role)
>   can each INSERT / UPDATE / DELETE an announcement; an account with neither is
>   refused all three. 11/11 in a rolled-back transaction.
>   ⚠️ **The first run reported `ERROR 23502` on both INSERT cases and that was
>   the PROBE's fault** — `announcements` has three NOT NULL columns with no
>   default (`title`, `content`, `department`) and it supplied two. An ERROR is
>   not a failure; check your own instrument before reporting a red.
> - **Three strings said "ต้องเป็น pr_staff หรือ dev".** True when written, false
>   since 0014 taught `announcements_write` the `creator` permission — which a
>   ทีม SAMO node grants as เขียนประกาศ and `master` answers yes to. They now
>   name the permission the way the admin UI names it.
>   📌 **WHY IT SURVIVED 154 MIGRATIONS: a refusal message is only ever shown to
>   somebody who has already failed, and a person who is refused rarely reports
>   the WORDING of the refusal.** Copy that restates an authorization rule drifts
>   with no symptom at all. Treat every such sentence as a second implementation.
> - **The security comment above `renderArticleView` justified rendering Quill
>   content raw with "only pr_staff / dev can publish".** That sentence describes
>   who may inject raw HTML into a PUBLIC page, so it is worth being right: the
>   set is larger than two roles and grows with every เขียนประกาศ grant. Still a
>   GRANTED set, never self-service — probed.
> - **New ratchet `src/js/ui-copy-roles.test.js`**: a string literal containing
>   Thai may not contain a raw role identifier (`pr_staff`, `vs_staff`,
>   `shop_admin`, `vp_admin`, `uni_staff`, `sa_prof`). Falsified by restoring the
>   old wording. It carries its own controls — it must FIND a planted violation,
>   must NOT be satisfied by the same sentence in a comment, and must still see
>   300+ Thai strings, so a broken literal pattern cannot make it pass by finding
>   nothing. Comments stripped with `strip-comments.js`, never a fresh regex.
>
> ### 2026-08-26 — the iPad/Stay investigation, CLOSED as not-our-bug
>
> Scrutinized on request. **Conclusion: there is nothing in this repo to fix,
> and the culprit is probably one of the OWNER'S OWN userscripts.**
>
> - **Stay is a userscript MANAGER** (Tampermonkey/Violentmonkey-compatible,
>   `github.com/shenruisi/Stay`), not a content blocker. It runs scripts the
>   owner installed. So the five injected scripts are Stay's runtime plus
>   userscripts, and the one with the syntax error is most likely a userscript
>   matching every site. **The fix is to find that one script in Stay's list —
>   not to abandon the extension.** Told to the owner; they will decide.
> - **Re-verified this session, so nobody re-does it:** `foreignScripts()` reads
>   **0** on BOTH served pages (`/` = 5 scripts, `/admin/` = 7) — no false
>   positive waiting to happen. **No CSP header is sent**, so "our own header
>   blocked it" is dead. `script failed:` fires only from the module element's
>   own error event, so our module really did fail — it is not a misattributed
>   window error.
>   ⚠️ **Count the page's scripts with an HTML PARSER, never a regex.** Mine
>   matched a `<script>` inside an HTML COMMENT and reported a false positive —
>   the same trap the write-up already records, walked into again one day later.
> - ❌ **WHY our module died is NOT established and probably cannot be.** Two
>   readings fit the evidence equally (the broken script prevented the load / both
>   are symptoms of the extension's own startup aborting), and WebKit masks
>   extension code at `webkit-masked-url://hidden/` on purpose. **Three
>   over-confident diagnoses were already given on this bug. Do not add a
>   fourth** — say "not established" and stop.
> - 📌 **THE ONE REAL FINDING IN OUR CODE, offered and PARKED**: on the FIRST
>   failure the bar offers only โหลดใหม่, and the extension message appears only
>   once `_r=` is in the URL. But `foreignScripts()` is computable on the first
>   pass, and a reload cannot help when an extension re-injects on every
>   navigation — so the person who most needs the answer gets it last. Fix is to
>   ADD the extension line beside the retry button on the first failure, **not
>   replace it**: a legitimate ad blocker plus flaky wifi is a real combination
>   and must not be blamed on the extension.
> - **Not a problem, checked**: the watchdog is 202 lines duplicated VERBATIM in
>   both entry HTMLs, but `boot-watchdog.test.js` runs every assertion over both
>   files, so they cannot silently diverge.
>
> ### 2026-08-25 → 08-26 — the dead-and-animated page, CLOSED (not our bug)
>
> *(Same incident as the "2026-08-26 — the iPad/Stay investigation" block above:
> that one is the diagnosis, this one is the bug and the watchdog it produced.)*
>
> **Pruned 2026-08-26** — full write-up in `docs/mistakes/frontend-ui.md`, the
> class in `.claude/rules/mistakes.md`, guard `boot-watchdog.test.js`.
> **Resolution: a Safari extension ("Stay"), NOT this repo.** The bundle was
> current and 200; three confident diagnoses were wrong before that one. The
> live rules that survive:
>
> - ⛔ The retry re-navigates with `?_r=<now>`, **never `location.reload()`** —
>   on iOS a reload can re-serve the very HTML that named the missing bundle.
> - ⚠️ It decides failure on the script `error` event or window `load`, with
>   25 s only as a backstop, and the poll keeps running so a late boot
>   DISMISSES the bar. A warning that fires on the healthy case, and cannot be
>   withdrawn, is worse than no warning. Test the slow-but-fine case.
> - The watchdog is duplicated VERBATIM in both entry HTMLs; the test runs every
>   assertion over both, so they cannot silently diverge.
> - ⚠️ Count a page's scripts with an HTML PARSER, never a regex — a `<script>`
>   inside an HTML COMMENT produced a false positive one day after the same trap
>   was written up.
> ### 2026-08-25 — จองโควตา Claude can be switched OFF, and a stale reading expires
>
> **REPORTED**: *"claude keep sending this to discord, because claude.ai hasn't
> been renewed subscription… stop it properly, stop having it check the claude
> credit also"*, then: a switch, a status on the board, a reason, and a decent
> Discord notice.
>
> - **The switch is `claude_settings.monitoring_enabled` (0167)** and the
>   reporter reads it BEFORE it touches Anthropic, so a pause costs their API
>   zero calls. **The read FAILS CLOSED** — a network error, an HTTP 500 or an
>   RLS-refused read (which returns zero rows, not an error) all mean "do not
>   poll". Only literal `true` is a yes.
> - **A pause REQUIRES a reason, enforced by a CHECK.** It is the only thing on
>   a paused board that tells a booker whether the site broke or somebody
>   decided this. WHO paused it is stamped by a TRIGGER, not claimed by the
>   client.
> - **BOOKING IS UNAFFECTED while paused, by design.** The gauges are HIDDEN,
>   not greyed — a frozen meter reads as a live reading, and this board has
>   refused to print an unmeasured number since 0154.
> - ⚠️ **A PAUSE LONGER THAN ~12 DAYS COSTS ONE `claude login` ON THE VM.** The
>   OAuth refresh token rotates on use and a paused reporter deliberately does
>   not rotate it. Said in the paused dialog, the Discord notice and the
>   script header. The board warns at 10 days.
> - 🔴 **THE HALF THAT WOULD HAVE SHIPPED A WRONG NUMBER**: `claude_free_now()`
>   read the newest sample with **no bound at all**, so the weekly remainder
>   froze at the last successful poll and would have survived the Wed 16:00
>   reset for ever. 0156 fixed exactly this for the week CARD and left the HERO
>   alone. **Pausing does not create that bug — a dead timer does the same with
>   nobody deciding anything.** Fixed as a FRESHNESS BOUND on the read, in one
>   function, `claude_latest_sample()`: no row when measurement is off, and no
>   row once the sample is older than `claude_settings.sample_stale_minutes`
>   (45). All four "as of now" readers go through it. Callers land in the
>   `v_wk_left := null` branch that has shipped since 0155.
> - **`sample_stale_minutes` is published in `board.settings`** and the JS reads
>   it — it used to carry its own hardcoded 35 minutes while the SQL believed
>   the newest sample for ever.
> - **Proof `tools/claude0167-monitoring-switch.sql`, 18/18**, registered in
>   `npm run proofs`. §A tests the AGE rule with the switch ON, deliberately, so
>   the fix cannot degenerate into a special case for the switch.
> - **Two bugs found auditing the @here removal**: the 403 alert told a human to
>   run `claude setup-token`, which is what CAUSES a 403, in the same embed
>   whose วิธีแก้ said `claude login`; and the @here removal left the rule in
>   four string literals with two branches untested. **Every payload now goes
>   out with `allowed_mentions: {parse: []}`** — a property of the transport,
>   which also covers a mention arriving through interpolated user text.
> - ⚠️ **THE TIMER ON THE VM IS `disabled` AND MUST BE RE-ENABLED** for any of
>   this to run — see "What is owed" below.
>
> ### `.claude/rules/mistakes.md` was restructured (2026-08-25)
>
> It was at **29,923 of 30,000 bytes** and could not take another write-up. The
> per-entry index — 18.5k, bigger than the classes, growing with every bug
> fixed — moved to **`docs/mistakes/INDEX.md`**, leaving a nine-line directory
> that does not grow. **12,860 bytes now.** `npm run mistakes:index` writes
> both; `tools/memory-system.test.js` asserts the full list is NOT in the
> always-loaded file. **Do not move it back** — two earlier sessions tried to
> buy room by shaving the classes, which is the only part that generalises.
>
> ### ✅ 2026-08-25 — THE OWED THIRD VIEW SHIPPED. Nothing is owed on /team now.
>
> ผังสายงาน — the old connector chart — is BACK, beside แผนผัง and ผังรวม.
> Copied out of `befd30e` as an ADDITION; the panel view was not touched
> (measured identical: 3,989px at 1440 and 8,110px at 390, the exact numbers
> this file recorded before the restore).
>
> **The names, chosen by the owner — do not rename these without asking:**
> `lines` = **ผังสายงาน** (the connector tree) · `chart` = **แผนผัง** (the
> panels) · `all` = **ผังรวม** (the d3 canvas).
>
> ⚠️ **`'chart'` STILL MEANS THE PANEL VIEW.** The restored tree took the NEW
> key `'lines'`, deliberately: it historically owned `'chart'`, and giving it
> back would have silently sent every reader whose saved preference is
> `'chart'` to a different picture. `RETIRED_VIEWS` is unchanged. Guarded by
> `org-lines.test.js` §C.
>
> **What changed from `befd30e`, and it is only three things:**
> 1. **It honours ระดับ** — routed through `orderChildren()`, the same call the
>    other two make. That was half the original bug report. ⚠️ ORDER, NOT
>    GEOMETRY: it keeps CONTAINMENT parentage. `chartParentage` here is the
>    52,000px staircase, now paid for twice.
> 2. **It opens COLLAPSED**, sharing the one `expanded` set (`OPEN_TO_DEPTH =
>    0`). **Measured: 24,101 → 4,674px at 1440, 55,273 → 4,707px at 390**, and
>    `pageScrollsSideways` is FALSE at 1440 / 820 / 390 / 320. This also
>    dissolves "many leftover space" at its structural cause — a connector row
>    is `align-items: flex-start`, so collapsed there is no tall sibling to
>    leave a dead column beside.
> 3. **No viewport breakout.** `width: 100vw; margin-inline: calc(50% - 50vw)`
>    measured 395/390 and gave the PAGE a horizontal scrollbar. Each section
>    scrolls inside the reading column instead.
>
> The ordering differential in `org-rung.test.js` was EXTENDED to the third
> view, not duplicated. `org-lines.test.js` is new (11 assertions, falsified
> four ways).
>
> ⚠️ **`docs/demos/about-3d/tools/org-local.mjs` now takes `lines` as a view**
> and its `--open` knows both disclosure markups. **`overflowing` in its output
> is `scrollWidth > clientWidth`, so every `.org-lines` scroller ALWAYS
> reports** — that is the feature, not a defect. The number that means
> something is `pageScrollsSideways`.
>
> 🔴 **ONE BUG WAS MADE AND FIXED DOING THIS, and it is the reason to read
> `org-lines.test.js` before touching that stylesheet.** The CSS was lifted out
> of the deleted commit BY LINE NUMBER, one slice began mid-comment, and the
> unclosed `/*` silently swallowed `.org-station-btn`, `.org-station-dot` and
> one more. The page rendered plausibly — names centred, dot 0×0 — and nothing
> errored. Write-up in `docs/mistakes/frontend-ui.md`. Never slice source by
> line number.
>
> **STILL UNFIXED, unrelated, and still not worth a session on its own**:
> `#about-mission` / `#about-policy` overflow their own box by 8–12px at 390px
> (Bootstrap `.row`'s negative gutters absorbed by `.container` padding).
> Nothing is clipped and the page does not scroll. Reproduce:
> `node docs/demos/about-3d/tools/org-local.mjs 390` and read `overflowing`.
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
> ### 2026-08-20 — `hidden` was borrowed, not owned (scrutinize pass)
>
> **Pruned 2026-08-26** — write-up in `docs/mistakes/frontend-ui.md`, guard
> `hidden-attribute.test.js`. The live rules:
>
> - `[hidden] { display: none !important; }` sits at the top of
>   `src/css/base.css`, and **the `!important` is load-bearing**: `[hidden]` and
>   `.orgc-unit-body` are both specificity (0,1,0) and base.css is imported
>   FIRST, so source order alone would hand the win to org-chart.css. Before it,
>   the rule was being supplied by Bootstrap's CDN reboot — measured with that
>   one `<link>` blocked, #orgBody went 3,463px → 22,474px.
> - ⚠️ `:has()` is LOAD-BEARING on `/team` and does NOT degrade gracefully. If it
>   ever has to go, move the open state to an attribute the renderer and
>   `toggleNode` both write — do not add a silent fallback.
> - `RETIRED_VIEWS` is `Object.create(null)` — it is read as `MAP[localStorage
>   value]`.
> - `org-chart-metrics.test.js` pins `TREE_SHAPE` in `org-face.js` to
>   `.orgc-person > .org-face { width: 3.25rem }`.
> ### Older — pruned 2026-08-26, and one line of it was actively WRONG
>
> A 54-line block sat here carrying: the `7dbc153` deploy, "migrations through
> 0166", "1217 tests", the `claude0157` / `claude0161` diagnosis (fixed
> 2026-08-25, written up in `docs/mistakes/tooling-proofs.md`), and the same
> diagnosis a second time in a garbled HISTORICAL paragraph.
>
> 🔴 **It also said `.claude/rules/mistakes.md` is at 29999 / 30000 bytes and
> "the next entry CANNOT be added without compressing first". That has been
> false since the 2026-08-25 restructure moved the index out — it is 16,712 of
> 30,000 (56%).** A warning that has stopped being true costs a session real
> time before it is disbelieved, and this one was written to be believed. When
> a block here becomes history, DELETE it; `git log` and `docs/mistakes/` are
> the archive, and a stale number is worse than no number.

> ### 2026-08-18 → 08-19 — `master` and the หนังสือโครงการ seat
>
> **Pruned 2026-08-26.** It was 65 lines and said in its own first line that the
> full write-up is in `docs/mistakes/authz-grants.md`; the LIVE rule is also
> stated at length under CURRENT DEPLOY. Three copies of one thread is what this
> file keeps growing on. What survives, because neither is written down
> elsewhere as a rule:
>
> - ⛔ **Do NOT "simplify" `readPermInputs` back into one rule.** It treats the
>   three หนังสือโครงการ sub-controls differently ON PURPOSE — VS แผนก and
>   Passport ฝ่าย are SCOPES whose widest value master IS, so master correctly
>   nulls them; `vpa`/`staff`/`prof` are three DESKS, and "all three" is not a
>   desk, so nulling meant NOBODY. `master-seat.test.js` goes red if you do.
> - **`src/js/master-mirrors.test.js` is a REGISTRY, not a pattern**: it
>   enumerates every SQL function that special-cases `'master'` (exactly two,
>   reconciled against the live DB) and pins each to where JS says the same
>   thing. A THIRD name is not automatically a bug — it is an unanswered
>   question. It exists because the 2026-08-17 gate sweep grepped `role === 'x'`
>   and `projectSeatRole` has no role literal: it PRODUCES the role, upstream of
>   all 28 gates.
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
> ✅ **(HISTORICAL — `claude0157` is GREEN since 2026-08-25.)** It read: RED
> because there are 0 active bookings, its B4 control needs a stepping deadline
> and correctly refuses to pass vacuously, and it "goes green on its own once
> real bookings exist". **The last part was the wrong instinct** — waiting on
> real usage to make a proof pass is waiting on the environment. It was fixed by
> CREATING the geometry instead (move the week, plant two bookings). Kept because
> the diagnosis was right and the wrong instinct is the reusable lesson.
>
> ⚠️ **`claude0161` C1 went red on 2026-08-18 for a COMPLETELY CORRECT reason
> and is now fixed.** Its grid is the REMAINDER of the quota week, so it shrinks
> to nothing as the Wed 16:00 reset approaches; the control asserted
> `count > 100` and only 86 quarter-hours were left. Threshold is now `> 20`
> (one 5-hour window); C2 is what really stops vacuity. **`claude0157`'s sample
> search has the same shape** (`now() + 7h` → `week_start + 7d − 11h`, 5 slots
> left at that instant) — so if B4 is red EARLY in a fresh quota week, that is
> the real failure, not this rot. **Both have since been made self-contained and
> neither searches live geometry any more (2026-08-25).**
> Write-up in `docs/mistakes/tooling-proofs.md`.
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
> day.** Re-verified against the LIVE database on 2026-08-18; **only #2 is still
> open**, and it is low priority. Compressed 2026-08-26: the three closed ones
> kept their record and their one transferable lesson, not their full reasoning —
> a finding that is fixed is findable through the migration that fixed it.
>
> **STILL OPEN — the only one that needs anything:**
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
> **CLOSED — 1, 3 and 4, one line each:**
>
> 1. `open_ended` was wrong for every historical week — fixed in **0164**
>    (`p_to > now()`). ⚠️ The lesson that outlived it: **the probe returned 0 for
>    last week and that was VACUOUS, not a pass** — there were no samples that
>    far back to test with. Ask what a zero means before believing it.
> 3. The silent-booking toggle went stale on an in-place account switch — fixed;
>    `paintSilentToggle()` exists in `src/js/claude/index.js`.
> 4. "No index on `claude_usage_samples.sampled_at`" was never real —
>    `claude_usage_samples_at_idx` exists.
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
> - ✅ **MEASUREMENT IS ON AND NOTHING IS OWED HERE — 2026-08-25 17:18 UTC.**
>   The owner flipped it on from `/admin#claude`; the trigger stamped them, the
>   timer wrote its first sample two minutes later, and it has run every 15 min
>   since — re-verified 2026-08-26 late at the steady 15-minute rate. The
>   `claude login` this file warned would be needed evidently held. **Ask the
>   database for the count; this file must not carry one.**
>   ⚠️ **The latent timer bug found on 2026-08-25 is still only fixed BY HAND on
>   the VM** (`OnActiveSec=1min` added in `/etc/systemd/system/`, which
>   `server/deploy.sh` does not touch). A rebuilt VM takes it from
>   `server/setup.sh`. Without it, `systemctl enable --now` after a multi-day
>   `disable` reports `enabled` + `active` and schedules **infinity**. Read `NEXT`
>   from `list-timers`, never the `enabled` word. Write-up in
>   `docs/mistakes/deploy-hosting.md`.
> - ✅ **NOT OWED — the two named people were never locked out.** `sastaff` /
>   `saprof` were deleted 2026-08-18 as intended. **Worapong
>   (`woratho@kku.ac.th`, seat `staff`) and Prakasit (`prakasa@kku.ac.th`, seat
>   `prof`) sign in with their own kkumail and hold the desk through their
>   ทีม SAMO permission.** Corrected by the owner 2026-08-26, after two sessions
>   repeated the claim. **Reason about the LIVE channel (the seat), not the
>   credential that was removed.**
> - ✅ **The `claude` permission is GRANTED — no longer owed.** Measured
>   2026-08-26: **~154** accounts carry the `claude` key in `permissions` /
>   `managed_permissions`, plus **42** `master` holders who answer yes to every
>   key. ⚠️ **These were 146 and 41 eight days earlier, and the `claude` count
>   moved 153 → 154 within a single day — the owner edits the tree, so treat
>   every head-count here as a METHOD, not a fact.** The method:
>   `select count(*) from public.users where 'claude' = any(permissions) or
>   'claude' = any(managed_permissions);`
>   What is still true is that **`claude_bookings` is EMPTY** — the feature is
>   deployed, granted and unused. ⚠️ **This bullet used to add "that is also why
>   `claude0157` B4 is red". It is NOT red** — 0157 was made self-contained on
>   2026-08-25 (it MOVES the quota week and plants two synthetic bookings rather
>   than hoping the live calendar cooperates), and all 23 proofs are green.
>   A proof that depends on real usage existing is the thing that was FIXED; do
>   not re-derive the old excuse from this file.
> - ✅ **The ประกาศ deploy is DONE** (2026-08-26, `2993dd1`, verified served).
> - ⏸ **The boot bar's first-failure branch — OFFERED, owner will decide.** See
>   the Stay block above. Do not build it unprompted.
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
> - `docs/NEXT.md` carries the rest. **§0d is DONE (0168, 2026-08-26)** and is
>   kept there only as a PATTERN worth copying. What is genuinely un-started:
>   §0c (two latent role-only policies, deliberately not swept — nothing in
>   `src/js` takes those paths), §0a (ทีม SAMO admin model, PARKED by the owner),
>   §0b2 and §1 (the browser pass), §0 (`photo_reference_count()` cannot see
>   `houses.icon_url`).
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
> - ✅ **THE CONTEXT BUDGET IS FINE — this bullet used to say the opposite and
>   it was the second copy of a warning already deleted higher up.** It claimed
>   `.claude/rules/mistakes.md` was at 29,725 of 30,000 with 275 bytes of
>   headroom, so "the next write-up may turn `npm test` red before you have done
>   anything wrong". **Measured 2026-08-26: 16,712 of 30,000 (56%); the whole
>   auto-loaded set is 55%.** The 2026-08-25 restructure moved the per-entry
>   index to `docs/mistakes/INDEX.md` and that is what bought the room.
>   📌 **Two copies of one warning, and only ONE of them was corrected when it
>   stopped being true — for a whole session this file asserted a fact in one
>   place and called it false in another.** Exactly the drift class the repo
>   documents, in the handoff itself. Grep the WHOLE file before believing any
>   number in it, and when you correct a claim, grep for its second home.
>   What is still true, and is a RULE rather than a number: if the budget is ever
>   breached, **RESTRUCTURE, do not trim** — micro-trimming prose was tried twice
>   and buys ~100 bytes an hour; `check-context-budget.mjs` measures BYTES and
>   Thai costs 3 per character; and a byte cap on the index was tried and
>   **REVERTED** because it truncated Thai symptom lines mid-word, which are the
>   lead lines the index exists for. Run `npm run check:context` — never quote a
>   remembered number.
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
