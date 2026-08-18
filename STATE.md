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
  master holder IS a project actor and sees every หนังสือโครงการ. The team
  editor stores `master` alone and nulls the explicit project_seat on purpose.
  **This is not a bug — do not "fix" it by forcing a seat under master.**
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

## NEXT-SESSION PROMPT (paste this after a /clear — updated 2026-08-18)

> **Read this file, then `skills/write-a-guard.md`.** Nothing is blocking.
> Local == origin; **VM built from `161310e`** — confirm with
> `git diff --stat 161310e..HEAD -- src/ ':!src/**/*.test.js'`, empty = the
> served bundle is current. (Ask about `src/` ALONE here: adding `supabase/`
> lists the 0166 migration, whose header comment was corrected after it was
> already applied, and an applied migration cannot make a bundle stale.) Migrations through **0166**; **1170 tests green**; **21 of 22 proofs
> green** — the one red is `claude0157` B4 and it is ENVIRONMENTAL (see below),
> not a regression. All shipped work verified from the served artifacts.
>
> ### What the LATEST session (2026-08-18, evening) was — FOUR things
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
> ### What the 2026-08-18 DAYTIME session was — THREE things, all deployed
>
> 1. **The LAST two shared logins are gone.** `sastaff` (role `uni_staff`) and
>    `saprof` (role `sa_prof`) were deleted by
>    `tools/purge-shared-project-accounts.mjs` after 161 + 65 rows were
>    reassigned to the named เจ้าหน้าที่คณะ (`woratho@kku.ac.th`, `staff` seat)
>    and อาจารย์ (`prakasa@kku.ac.th`, `prof` seat) who already held the seat.
>    Both had signed in with Google before, so nothing was staged for them.
>    **`public.users` now holds NO `uni_staff` and NO `sa_prof` row** — the role
>    branches survive only as the pre-seat path in the helpers. The only shared
>    password account left is `samomdkkudev`.
>    ⚠️ **`email like '%@samomdkku.app'` is NOT an audit for shared accounts** —
>    it returns **48**, and 46 of them are ordinary students who registered with
>    a username (that domain is the synthetic email every password signup gets).
>    Counting it looks alarming and means nothing. Audit by GRANT instead: add
>    `and (role <> 'user' or permissions <> '{}' or managed_permissions <> '{}'
>    or managed_project_seats <> '{}' …)` — which returns exactly two,
>    `samomdkkudev` (dev) and `claude-reporter` (holds `claude`, machine
>    account). Verified 2026-08-18.
>    ⚠️ **The role LITERALS are still all over `src/js/projects/*`** (~28
>    `role === 'dev'` / `'uni_staff'` / `'sa_prof'` branches). They still work,
>    because `projectSeatRole()` maps a seat to the role STRING before anything
>    branches. Do not "clean them up" without re-reading that function.
> 2. **ปีงบประมาณ is now a fact you can correct** (`projects.fiscal_year_be`,
>    0165). NULL = derive from `created_at`; a number = a human moved it. The
>    ONE implementation is `src/js/projects/fiscal-year.js`, and
>    `fiscal-year.test.js` §4 is a RATCHET that greps every projects module for
>    a second one. ⚠️ It asserts the พ.ศ. offset **paired with a month
>    comparison** — a bare `/543/` flags `fmtDate`, which is correct code.
>    Who may move it is NOT a new gate: `projects_update` is already
>    `current_user_is_project_actor()` = ผู้ส่งหนังสือ + เจ้าหน้าที่คณะ.
> 3. **Each person picks the ปีงบ their inbox opens on** (`project_user_prefs`,
>    0165): `'all' | 'current' | '<year>'`, own-row-only RLS both directions.
>    `'current'` resolves at OPEN time, so it rolls over on 1 ต.ค. by itself.
>    An ABSENT row means `'all'` — nobody's behaviour changed until they opt in.
>
> **A /scrutinize pass on the same session's work found four defects (`2f35068`)
> — worth reading, because three are shapes that recur here:**
> - **The auto-move lost the viewer's filter.** The move handler follows the ปีงบ
>   filter so a project does not vanish; it followed only when a NUMBER was
>   written, and clearing an override writes NULL. Fixed by asking
>   `projectFiscalYear({ ...p, fiscal_year_be: next })` — the SAME function the
>   grid filter uses. **A "where does it end up" question answered locally will
>   drift from the filter that answers it for real.**
> - **A half-done reset.** `applyDefaultFiscalYear` reset `defaultFYPref` on a
>   uid change but returned early for `'all'`, leaving `filterFY` on the previous
>   account's year. Unreachable only because `admin-main.js` hard-reloads on an
>   account switch. **A guard that depends on an unrelated module's reload is
>   not a guard.**
> - **The purge script audited 10 of 23 FK columns**, and the 13 it missed
>   included three `ON DELETE CASCADE` ones. The run lost nothing (verified) but
>   could not have said so. Now read from the catalog — which immediately caught
>   `project_user_prefs.user_id`, added by 0165 the same day.
> - Two proof assertions asserted the WRONG PROPERTY. `B5` counted overrides
>   equal to their derived year (vacuous today, red the first time someone pins
>   a project to the year its date implies, and its SQL rule used UTC months
>   where the app uses ICT). `B6` ("no trigger exists") found two that do —
>   `projects_public_flag_guard` is the column guard keeping `is_public`
>   sender-only even though `projects_update` has **no WITH CHECK**. Worth
>   knowing: a `staff`-seat actor can therefore write any other column on
>   `projects`; only `is_public` is separately guarded.
>
> **Two guard lessons paid for in this session, both worth remembering:**
> - `proj0165`'s first draft could not tell a working policy from no policy:
>   `projects_read_public` is `using(is_public)` and 27 of 28 projects are
>   public, so "the staff seat reads every project" was ALSO true of a user with
>   no grant. It now CREATES a hidden project inside its own transaction as the
>   discriminator. **When a probe's ALLOW and its DENY would give the same
>   answer, the subject is wrong.**
> - `prof0095` diffed the seat against the shared `saprof` account. Deleting
>   that account would NOT have reddened it — `sub` resolves to null, both reads
>   return 0, and `0 == 0` scores as parity. It now diffs against ground truth
>   computed as superuser. **A comparison against a deleted subject fails
>   silently in the PASS direction.**
>
> ### What the 2026-08-17 session was — FOUR things, all deployed
>
> Detail is in `docs/state-archive/2026-08-17-scrutinize-master-purge.md`; only
> the still-live rules were kept at the top of this file. In order of
> consequence:
>
> 1. **SECURITY: 15 shared password accounts DELETED** (archived). Their
>    `samo69*`/`1234` passwords were in the PUBLIC repo and opened
>    live dev/vp_admin sessions. Data was reassigned to real people FIRST
>    (พรู/พู่กัน/สายป่าน/เอ๋ย/ปัน), then the accounts deleted. Repo creds scrubbed.
>    **`samomdkkudev` password was rotated + all its sessions revoked.** KEPT:
>    samomdkkudev, sastaff, saprof, claude-reporter. **sastaff + saprof were
>    then DELETED too on 2026-08-18 — see "What the 2026-08-18 DAYTIME session
>    was" above.**
> 2. **master ≠ dev role — two frontend gates fixed** (archived).
>    A master holder is `role='user'`, so `role === 'dev'` gates skipped them.
>    Fixed the PR/VS skip-notify toggle + `isVsSuper()` to honour `holdsMaster()`.
>    Owner's decision: the ~28 `role === 'dev'` gates in `src/js/projects/*` are
>    LEFT as-is (driven by the seat picker). ⚠️ If more "master lost X" reports
>    come in, the fix is `holdsMaster()` next to the `role === 'dev'` check — but
>    NOT in projects.
> 3. **จองโควตา Claude /scrutinize** (archived): migration 0164
>    (a PAST week is never "still running"), the silent-toggle staleness fix, and
>    TWO ข้อตกลง usage tips (Sonnet/Haiku for light work; /clear before a break).
> 4. **ร้านค้า "0 รายการ" is NOT a bug** — 3 test products, all hidden by a human
>    on 08-16. No product was ever deleted; the purge cannot delete products.
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
