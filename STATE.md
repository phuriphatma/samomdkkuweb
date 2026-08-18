# STATE — current task & latest known state

Last updated: **2026-08-18**. This is "what is true RIGHT NOW" and nothing else;
`git log --oneline` is the chronology and `docs/state-archive/` holds the
reasoning. **Target is ~200 lines** — when it bloats, move narrative to the
archive rather than trimming the invariants.

⚠️ **It is ~670 and still over target.** Four prunes have been done: the
0154–0158 narrative, the "Live proofs" PER-PROOF NARRATIVE, the duplicated
"What is owed" blocks, and on 2026-08-18 the 211-line "จองโควตา Claude — READ
THIS BEFORE TOUCHING" walk-through → `2026-08-18-claude-quota-deep-dive.md`,
leaving its ⛔ rules (44 lines). It keeps growing because each session adds
rules that genuinely belong here.
**The next structural pass should take the three dated 2026-08-17 sections**
("/scrutinize pass", "master ≠ dev role", "shared-account purge") **to the
archive** — they are ~80 lines of finished narrative that the NEXT-SESSION
PROMPT already summarises.

**Read the `## NEXT-SESSION PROMPT` at the bottom first.** Then CURRENT DEPLOY.

Reasoning lives in `docs/state-archive/` — newest first:
`2026-08-18-claude-quota-deep-dive.md` + `2026-08-16-claude-quota-booking.md`
(**read one before touching `/admin#claude`**) ·
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
- ✅ **DEPLOYED = `2f35068` (2026-08-18)** — ปีงบ move + per-person default
  filter + the `sastaff`/`saprof` purge (`8359026`), plus the /scrutinize fixes
  on top. Verified from the SERVED artifacts:
  `ค่าเริ่มต้นของปีงบประมาณ`, `ย้ายปีงบประมาณ`, `ปีงบปัจจุบัน (อัตโนมัติ)`,
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
  git diff --stat 2f35068..HEAD -- src/ supabase/ appscript/ server/ functions/ ':!src/**/*.test.js'
  ```

  The `:!…*.test.js` exclusion is load-bearing, not tidiness: without it a
  guard-test edit sends the next reader on a pointless 90-second deploy.
  **Migrations applied through 0165.** **1153 tests green. 21 of 22 proofs
  green** — the one red is `claude0157` B4 and it is ENVIRONMENTAL (see below).
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

## จองโควตา Claude — /scrutinize pass (2026-08-17), migrations through 0164

Deployed bundle `admin-DDDRehOn.js` (verified from served `/admin/`).
- ✅ **Finding 1 FIXED (migration 0164 applied live):** `claude_usage_runs`
  marked a PAST week's final run `open_ended=true` (v_last_at is scoped to the
  requested range, not now) → historical weeks said "อาจยังใช้อยู่". Now guarded
  by `+ and p_to > now()`; new §G past-week case in
  `tools/claude0162-usage-runs.sql` (falsified 0→1).
- ✅ **Finding 3 FIXED:** the master-only "จองแบบเงียบ" toggle read
  `holdsMaster()` once at `wire()`, stale on an in-place account switch. Now
  re-decided per entry in `paintSilentToggle()`; listener still wired once.
- ⛔ **Finding 4 was STALE** — `claude_usage_samples_at_idx` already exists. No
  change made.
- ⏳ **Finding 2 (0161 cost claim) still open** — unbenchmarked; low priority.
- ➕ **ข้อตกลง gained two usage tips** (Sonnet/Haiku for light work; don't work a
  chat left open >30–60 min — context reload burns quota, /clear before a
  break). `TERMS_VERSION` bumped to `2026-08-17` so everyone re-sees it.

⚠️ **`claude0157-rail-segments.sql` is currently RED on control B4** — NOT a
regression from this work. There are **0 active bookings** right now, so the
rail has no stepping deadline and B4 (a control that refuses to pass vacuously)
goes red exactly as designed. The scenario is not fully self-contained: its
step-down depends on live booking geometry. **Fix (follow-up): add a second
synthetic booking that guarantees a stepping deadline independent of live data**
— but do NOT tune it to merely pass; verify B1/B2/B5 stay meaningful. The other
5 claude proofs + all 1122 tests are green.

## master ≠ dev role — frontend gates fixed (2026-08-17, deployed)

Reported: a `master` holder (phuriphat.ma, ทุกระบบ from ฝ่าย IT) found features
missing vs the shared `samomdkkudev` (role=dev). Cause: `master` is honored by
PERMISSION gates + RLS but a master holder is `role='user'`, so `role === 'dev'`
/ role-literal gates skipped them. Fixed the two reported sites:
- `main.js` `.dev-only-feature` (the PR/VS "ไม่ส่งแจ้งเตือน Discord" toggle) →
  `role !== 'dev' && !holdsMaster(user)`. **Verified in served bundle.**
- `vs-staff.js` `isVsSuper()` → `|| holdsMaster(u)`, matching the DB (which
  already made master VS-super).
- Guard: `src/js/master-role-gates.test.js` (falsified). Write-up in
  `docs/mistakes/authz-grants.md`, class 5.
- **Left as-is per owner**: the ~28 `role === 'dev'` gates in `src/js/projects/*`
  (หนังสือ send flow) — driven by the project-seat picker, not master.

Also confirmed same day: **ร้านค้า "0 รายการ" is NOT a bug** — 3 products exist,
all `is_active=false` (test items), hidden by a human on 2026-08-16 (saved one at
a time). No product was ever deleted; the account purge cannot delete products
(`shop_products.created_by` is SET NULL). Storefront shows active-only.

## Security — shared-account purge (2026-08-17)

**15 shared password accounts DELETED PERMANENTLY** (auth + public.users), after
their data was reassigned to real people first: the 10 VP accounts,
`samomdkkupr`, `samomdkkudigital`, `samomdkkupresident` (was role=dev),
`samomdkkuvssound`, `samomdkkushop`, and `passportadmin`. Reason: their
`samo69*` / `1234` passwords were published in the PUBLIC repo and verified to
open live dev/vp_admin sessions.

**KEPT** (owner's decision): `samomdkkudev` (owner will rotate its pw),
`sastaff`, `saprof` (both still have the weak `1234` pw — flagged, not rotated),
and `claude-reporter` (machine account).

**Attribution transferred BEFORE delete** (so nothing orphaned; every SET-NULL
column verified 0 before deletion):
- samomdkkuvpa → **พรู** (jinjutha.t): created_by on 27 projects/42 docs/47 files
  + its 43 read/unread rows (via `tools/proj-handover.mjs`). พรู holds `master`,
  which grants all project seats at the RLS level, so she sees them all; she was
  also given the explicit `vpa` seat.
- pr_tickets: samomdkkupr + samomdkkudigital → **พู่กัน** (putita.s);
  samomdkkupresident → **สายป่าน** (worapat.c); samomdkkuquality → **เอ๋ย** (naphat.pr).
- samomdkkuvssound → **ปัน** (nattapong.chi): 9 vs_tickets + 1 public comment.

⚠️ **`current_user_project_seats()` folds `master` → {vpa,staff,prof}** — a master
holder IS a project actor and sees ALL หนังสือโครงการ. The team editor stores
`master` alone and nulls the explicit project_seat on purpose (master already
covers it). This is NOT a bug; do not "fix" it by forcing a seat under master.

**Repo scrubbed**: `samo69*` literals removed from `tools/vp-accounts.mjs`,
`tools/president-account.mjs` (both now read a `*_SEED_PASSWORD` env var and
REFUSE to reseed without it) and from `docs/`. `tools/saprof-account.mjs` still
carries `1234` — saprof is a KEPT account, left per owner. No src/ change → **no
deploy needed**; the DB changes are already live.

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
> Local == origin; **VM built from `2f35068`** (confirm with
> `git diff --stat 2f35068..HEAD -- src/ supabase/ ':!src/**/*.test.js'`, empty =
> current). Migrations through **0165**; **1157 tests green**; **21 of 22 proofs
> green** — the one red is `claude0157` and it is ENVIRONMENTAL (see below), not
> a regression. All shipped work verified from the served artifacts.
>
> ### What the 2026-08-18 session was — THREE things, all deployed
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
> Read the four dated sections at the TOP of this file first; they have the
> detail. In order of consequence:
>
> 1. **SECURITY: 15 shared password accounts DELETED** (see "shared-account
>    purge"). Their `samo69*`/`1234` passwords were in the PUBLIC repo and opened
>    live dev/vp_admin sessions. Data was reassigned to real people FIRST
>    (พรู/พู่กัน/สายป่าน/เอ๋ย/ปัน), then the accounts deleted. Repo creds scrubbed.
>    **`samomdkkudev` password was rotated + all its sessions revoked.** KEPT:
>    samomdkkudev, sastaff, saprof, claude-reporter. **sastaff + saprof were
>    then DELETED too on 2026-08-18 — see the section above.**
> 2. **master ≠ dev role — two frontend gates fixed** (see "master ≠ dev role").
>    A master holder is `role='user'`, so `role === 'dev'` gates skipped them.
>    Fixed the PR/VS skip-notify toggle + `isVsSuper()` to honour `holdsMaster()`.
>    Owner's decision: the ~28 `role === 'dev'` gates in `src/js/projects/*` are
>    LEFT as-is (driven by the seat picker). ⚠️ If more "master lost X" reports
>    come in, the fix is `holdsMaster()` next to the `role === 'dev'` check — but
>    NOT in projects.
> 3. **จองโควตา Claude /scrutinize** (see "/scrutinize pass"): migration 0164
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
> ### ⚠️ FOUR FINDINGS FROM A SELF-REVIEW OF 0161–0163 — NOT YET FIXED
>
> A `/scrutinize` pass over my own work found these AFTER it was deployed. All
> four are live on prod right now. Ordered by consequence.
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
> - **Grant the `claude` permission** in ทีม SAMO to whoever should book.
>   Exactly ONE account holds it today. The feature is otherwise finished,
>   deployed and verified end to end — this is the last thing between it and use.
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
> ### ⚠️ Three traps this session walked into
>
> - **`.claude/rules/mistakes.md` sits at ~29.9 KB of a 30 KB cap** and the index
>   only grows. Micro-trimming prose was tried TWICE and buys ~100 bytes an hour.
>   **The next session that breaches it should RESTRUCTURE, not trim**: the index
>   is ~21 KB of the 30 and its per-entry value declines, while
>   `grep -rin "<symptom>" docs/mistakes/` already does the finding.
>   `check-context-budget.mjs` measures BYTES and Thai costs 3 per character.
>   A byte cap on the index was tried and **REVERTED** — it truncated Thai
>   symptom lines mid-word, and those lead lines are what the index is for.
> - **A browser harness inlines `src/html/*.html` at generation time.** Edit the
>   partial, re-run the probe, and it reads the STALE copy and reports the old
>   text as if it shipped. Regenerate the harness after every partial edit.
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
