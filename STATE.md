# STATE — current task & latest known state

Last updated: **2026-08-16**. This is "what is true RIGHT NOW" and nothing else;
`git log --oneline` is the chronology and `docs/state-archive/` holds the
reasoning. **Target is ~200 lines** — when it bloats, move narrative to the
archive rather than trimming the invariants.

⚠️ **It is 485 and has been over target for several sessions.** Two prunes were
done on 2026-08-16 (the 0154–0158 narrative went to the archive; the duplicated
"What is owed" / "How this repo wants you to work" blocks were deleted) and it
still grew, because 0159 + 0160 added rules that genuinely belong here. **The
next structural pass should move the "Live proofs" per-proof narrative to
`docs/state-archive/` and leave one line per proof** — that section is ~100 of
the 485 and is reference, not state.

**Read the `## NEXT-SESSION PROMPT` at the bottom first.** Then CURRENT DEPLOY.

Reasoning lives in `docs/state-archive/` — newest first:
`2026-08-16-claude-quota-booking.md` (**read before touching `/admin#claude`**) ·
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
- ✅ **DEPLOYED = `0946ae5` (2026-08-16)** — working tree clean, local == origin == VM.
  Verified from the SERVED artifacts, found via the bundle name in
  `curl -s https://samo.md.kku.ac.th/admin/` (**not** `ls` on the VM — old
  chunks are kept on purpose, so several `admin-*.js` sit in that directory):
  `2026-08-16.4`, `open_window`, `rpc/claude_booking_limits`, `showPicker`,
  `ช่วงนี้จองไม่ได้ — รอบนี้เริ่มไปแล้ว`, `claude-bk-head`, `is-free-seg` in the
  admin JS; `claude-terms-math`, `700%`, `7 รอบเต็ม`,
  `รอบที่เริ่มไปแล้ว จองไม่ได้` in the admin HTML. **0** in the served
  `public-*.js` (the pane is admin-only — that is the control), and **0** for the
  REMOVED strings `ลบการจอง` / `อ่านครั้งเดียวจบ` / `ซึ่งใช้ร่วมกัน` — a
  present-only check cannot see a rename. The notify service was restarted and
  carries the new `_discord.js`; `/notify` answers.
  ⚠️ **Greps that legitimately return 0**, all documented traps: a module-scope
  `const` is renamed by the minifier (`MAX_GAP_MS` reads 0, the string literal
  `แถบขวาของแต่ละวันคือรอบ` reads 1), anything in `functions/` is the notify
  SERVICE and never reaches a bundle, and `::before` minifies to `:before`.
  Check rather than trust — EMPTY means prod is current:

  ```bash
  git diff --stat 0946ae5..HEAD -- src/ supabase/ appscript/ server/ functions/ ':!src/**/*.test.js'
  ```

  The `:!…*.test.js` exclusion is load-bearing, not tidiness: without it a
  guard-test edit sends the next reader on a pointless 90-second deploy.
  **Migrations applied through 0160.** **1093 tests green.**
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

**The registry is now 18** — `claude0155`, `claude0157` and `claude0159` were
added to `tools/run-proofs.mjs` on 2026-08-16; they were being run by hand and
were therefore invisible to `npm run proofs`.

⚠️ **ONLY THE FOUR CLAUDE PROOFS WERE RUN ON 2026-08-16** (0154 20/20 · 0155
22/22 · 0157 10/10 · 0159 32/32, all re-run after 0160 landed). **The other
fourteen were last run in full on 2026-08-15** — run `npm run proofs` FIRST next
session; a proof here went stale silently for three days once, and the entry
below is what that cost.

One command runs every live proof and prints one verdict each;
`npm run proofs <substring>` runs a subset.

**`tools/team0153-tier-parity.mjs` is NOT in that 15, on purpose** — it compares
the tree against a snapshot pinned to 2026-08-15, so it will legitimately go red
once the tree is edited. One-shot, kept re-runnable:
`node tools/team0153-tier-parity.mjs tools/fixtures/team-tree-before-0153.json`.

⚠️ **They were 14/15 when this session checked, and STATE.md had been claiming
15/15 for three days.** `house0144-delete-impact.sql` was ERRORING (42501): its
subject picker matched only `has_permission('house')`, and zero accounts held it
in either permission column while twelve held the `vp_admin`/`dev` role the
function ALSO accepts — so it selected nobody and the RPC correctly refused.
Fixed by making the picker mirror the gate. **A proof's subject selector is part
of the gate; re-derive it from the function's own `if`.**
`docs/mistakes/tooling-proofs.md`. **Do not carry this claim forward without
re-running — it went stale silently, and an errored proof is silence.**

**Do not check them with an ad-hoc parser** — they emit four different output
shapes and doing it by hand produced two false alarms in a row.
`tools/run-proofs.mjs` normalises them and reports UNKNOWN as a FAILURE.

Run the one covering what you touch. All are both-directional.
**Read `skills/write-a-guard.md` before writing or trusting any of them.**

- `authz-sweep-identity.sql` (23/23) — run after ANY policy change on
  `users`/`people`/`students`/`team_members`.
- **The claude pane's colour system, since the owner asked for it:** clay
  (`--claude-clay`, Claude's own) = MEASURED, what Claude reports it spent ·
  green = free/available · ฝ่าย colours = booked by a person · amber
  (`--claude-part`) = partly booked · red = none left. The capacity ramp's
  middle was `--brand-orange` and had to move to amber, because orange sits one
  hue-step from clay and "partly booked" started looking like "actually used".
- ⚠️ **The claude pane has TWO TIME SCOPES and they are not interchangeable.**
  The hero (`ใช้ได้เลยตอนนี้`) is about NOW; the week card is about the week the
  arrows landed on. 0156 exists because the card was reading `right_now` — it
  agreed on the current week and was wrong on every other. A future week
  measures **NULL, not 0**: a zero draws an empty bar and reads as a reading.
- ⚠️ **`get_claude_board()` grows superlinearly with bookings** — measured
  2026-08-16: ~25 ms at 7 bookings in a week, ~37 at 19, ~65 at 24, ~100 at 30.
  `claude_free_windows()` calls `claude_free_now()` once per boundary and the
  boundaries grow with the bookings, so it is O(bookings²)-ish, and the board
  polls every 60 s per open admin tab. Fine at this feature's real scale (a
  handful a week) — recorded so nobody rediscovers it in production. If a week
  ever carries ~50 bookings, hoist the settings/sample reads out of
  `claude_free_now()` or compute the bands in one pass.
- `claude0157-rail-segments.sql` (8/8) — the calendar's capacity rail. Asserts
  the PROPERTY ("the answer does not change inside a band") rather than a list
  of boundaries, **because the bug WAS a wrong list**: 0155's header named four
  instants where the answer can change and the code's `union` had three. A
  guard restating that list would have passed. Falsified against both original
  bugs. ⚠️ Its §B taught the other half — the first draft asserted that every
  band's END still earns that band's number and three bands failed; the
  ASSERTION was wrong. Only `booking_start − 5h` carries "you may still start
  AT this instant"; at a window reset or a booking's start/end the later value
  already applies.
- `claude0159-window-share.sql` (32/32) — **the booking guard's window rule**,
  and since 0160 the open-window rule too. **§C3 went RED the moment 0160
  landed**, because it still asserted the old clamp ("40% is accepted"). That is
  the right way round: the guard noticed the behaviour change before the author
  did.
  A→B are the owner's two cases (100% blocks everything after `start − 5h`;
  50% leaves 50% for whoever starts after it), C is the live-window anchor with
  its no-sample CONTROL, D is nothing-else-moved, E is the privileges.
  FALSIFIED by restoring the 0154 guard verbatim inside the transaction: it
  reddens exactly A3–A6, B2, B4, C2 and nothing else.
  ⚠️ Its first draft was CUMULATIVE and an earlier allowed row made a later case
  deny for the WRONG reason; §C's sample injection also poisoned §D until §C was
  moved last. Both were green. Isolation is the assertion.
- `claude0155-free-now.sql` (21/21) — "how much may I use right now, until
  when". Its §A is the owner's three worked examples verbatim; §B1 holds the
  branch they never reach (an ALREADY-OPEN 5-hour window comes from the
  MEASUREMENT, not the clock) and §B2 is the unconstrained control. FALSIFIED
  2026-08-16 by injecting two bugs — dropping the weekly term reddens A3 only,
  anchoring the window to the clock reddens B1/B1b only.
- `claude0154-quota-guard.sql` (20/20) — the จองโควตา Claude caps. Written and
  FALSIFIED on 2026-08-16: with the trigger disabled and the exclusion
  constraint dropped, D1/D2/D4/D5 flip red and D3 stays green (it is the CHECK
  constraint, a different mechanism), which is what says each case is held by
  the thing it names.
- `pr0149-delete-permission.sql` (12/12) · `shop0150-buyer-contact.sql` (10/10) ·
  `house0116-authz.sql` · `house0144-delete-impact.sql` (18/18) ·
  `house0145-duplicate-person.sql` · `house0146-crest-refcount.sql` ·
  `team0145-one-chan-pi.sql` · `team0145-save-as-the-member.sql` ·
  `house0132-registry.mjs` · `proj0092-seat-parity.mjs` ·
  `team0135-name-split.mjs` · `team0137-search.mjs` · `grant0093-reads.mjs` ·
  `team0143-photo-refcount.mjs`
- ⚠️ **`shop0150`'s subject is MANUFACTURED** — all six real orders belong to
  shop ADMINS and the guard early-returns for one, so a proof that picks a real
  order reports that a buyer may set the total to ฿1.

## จองโควตา Claude — security posture

Verified 2026-08-16 and unchanged since; the detail moved to
`docs/state-archive/2026-08-16-claude-quota-booking.md`. The three facts that
matter: **nothing leaked to git** (the token appears in 0 commits), the
credential on the VM can burn QUOTA but **cannot spend money**
(`extra_usage.is_enabled=false`, `can_purchase_credits=false` — keep it that
way, that setting is doing real work), and `claude-reporter@samomdkku.app`
holds only `claude`. ⚠️ A `setup-token` pasted in chat is STILL LIVE; only the
owner can revoke it.

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

Six migrations (0154 → 0159) and **every single fix came from the owner testing
live**. The pattern is worth more than the code: each bug was a number that was
ARITHMETICALLY RIGHT and MEANT something else.

### 0159 — THE RULE THAT NOW GOVERNS. Do not re-derive it anywhere.

> For every 5-hour window opened in the chain, the bookings whose time overlaps
> `[open, open + 5h)` may not claim more than 100% together.

It is a property of the SET of bookings, so it cannot depend on insert order —
which is exactly what 0154 got wrong: its guard checked the incoming row against
sessions derived from the OTHER rows, and that derivation is greedy in
`starts_at`, so an earlier-starting insert re-derived everyone and nothing
re-checked them. `08:00–13:00 @100%` standing, a booking at `06:00` was
ACCEPTED; and `06:00@50 + 08:00@50` was REFUSED in one typing order and legal in
the other.

Three things that follow, and each cost something to learn:

1. **The openers are a CHAIN.** A booking that starts inside an earlier
   booking's window JOINS it. Treating every start as an opener is the obvious
   fix and it is too strict — `claude0154 §A4` went red, and `§D5` went red only
   as a consequence.
2. **THE STRADDLE RULE IS GONE.** A block may cross a window boundary. Do not
   put it back in SQL *or* in `limitsFor()`; it is what made a legal pair
   bookable in only one order.
3. **The window the MEASUREMENT says is open is an anchor**, carrying
   `five_hour_pct` as its base load. That is the whole answer to *"i'm using at
   16.00… then suddenly someone book so i have to stop my work?"* — no, the
   later booking may only take what the open window has left. Nobody declares a
   session. Limit: the sample is ≤15 min old.

**ONE implementation, three readers**: `claude_window_loads()` → the trigger
refuses · `claude_booking_limits()` caps the FORM's slider (called on a RANGE
change, never on the slider) · `get_claude_board()` draws each window's
remainder. **Do not add a fourth in JavaScript** — `probeSession()` was exactly
that and is deleted.

⚠️ **THE PANE HAD ONLY EVER BEEN OPENED ON A LAPTOP.** Six bugs in this feature
were phone-only and every one was invisible in the stylesheet: a tag positioned
where the block always covers it · an absolute percentage colliding with a
wrapping time · a session frame with the same visual weight as a booking card ·
an overlay lane taken OUT of the block instead of ADDED to the grid · a
"พอดีจอ" toggle measuring the container its own output sizes · a date picker
that only opens on touch (desktop needs `showPicker()`).
**Render at 390 / 834 / 1440 before claiming a layout change works**, and assert
`scrollWidth - clientWidth === 0` per element rather than reading the CSS.
Also measured: the END time cannot be drawn as text at ANY width (77px + 34px
against a 96px head), and a ONE-pixel shortfall renders as `0…`, not as a tight
line — "fits" has to mean "with headroom".

⛔ **AN OPEN WINDOW IS NOT BOOKABLE AT ALL (0160).** Do not "improve" this back
into a clamp. 0159 let a latecomer book the REMAINDER of a running window; the
owner showed why that is wrong with live numbers — *"i'm currently working
ใช้ไป 82% · รีเซ็ต 20:00, current time 16:28, someone could just book 16.40-20.00
kick me out"*. 100% was refused, but **18% and 5% were accepted**, and a booking
is a CLAIM: the ข้อตกลง then said that stretch belonged to the latecomer.
The remainder is not a quantity anybody can promise — the person in the window
may spend it at any moment — so a booking for it is a reservation the system
cannot honour. Refusing it is honesty, not restriction, and the error names both
ways forward: book from the reset, or just use it now unbooked.
Known cost, accepted: 3% used at 15:05 blocks BOOKING until 20:00. Erring the
other way hands out reservations that cannot be kept.
An UPDATE may still shrink or cancel a claim already inside the window — the
test is `new.pct > v_prev`, on the CLAIM, not on the row.

**A BOOKED WINDOW BELONGS TO WHOEVER BOOKED IT.** The ข้อตกลง said "หนึ่งรอบ 5
ชั่วโมง มีโควตา 100% ซึ่งใช้ร่วมกัน" and the owner rejected it: sharing is
between BOOKERS, not with anyone who wanders in. Unbooked time is open to
anyone; booked time is not. Booking 100% is how you guarantee nobody joins you.
Nothing in the guard changed — this was the wording, and the wording was the
part people are held to.

**Everything 0154–0158 learned — the two mixed-instant bugs, the three panels
and their scopes, the colour system, the rail's exact semantics, and what each
guard cost to get right — moved to
`docs/state-archive/2026-08-16-claude-quota-booking.md` § "What 0154–0158
learned". Read it before touching the panels; the two lines you cannot skip:**

| Panel | Scope | Source |
|---|---|---|
| `ใช้ได้เลยตอนนี้` (hero) | this instant | `claude_free_now()` |
| the week card | the week ON SCREEN | `board.week.*` (0156) |
| the rail | per START TIME | `claude_free_windows()` |

⚠️ **`get_claude_board()` cost grows with bookings** — ~25 ms at 7/week, ~100 ms
at 30, polled every 60 s per open tab. Fine at real scale.

## NEXT-SESSION PROMPT (paste this after a /clear — updated 2026-08-16)

> **Read this file, then `skills/write-a-guard.md`.** Nothing is blocking.
> Local == origin == VM == `0946ae5`; migrations through **0160**; **1093 tests
> green**. ⚠️ **Run `npm run proofs` FIRST** — only the four claude proofs were
> run on 2026-08-16; the other fourteen date from 2026-08-15.
>
> ### What the last session was
>
> **จองโควตา Claude, second pass: one real bug, then ten owner reports in a
> burst — most of them from a PHONE.** Two migrations (0159, 0160), four
> deploys. **Read the "จองโควตา Claude" section above before touching
> `/admin#claude`.** The three things in it that cost real money to learn:
>
> 1. **The window rule (0159)** — for every 5-hour window opened in the chain,
>    the bookings overlapping it may not claim >100% together. It is a property
>    of the SET, so it cannot depend on insert order. **The straddle rule is
>    deleted; do not put it back**, in SQL or in `limitsFor()`.
> 2. **⛔ An OPEN window is not bookable AT ALL (0160)** — not even its
>    remainder. Do not "improve" this back into a clamp; the ⛔ block above has
>    the owner's own numbers and the reason.
> 3. **The pane had only ever been opened on a laptop**, and six bugs were
>    phone-only. **Render at 390 / 834 / 1440 before claiming a layout change
>    works**, and assert `scrollWidth - clientWidth === 0` per element rather
>    than reading the CSS.
>
> ### What is owed
>
> - **Grant the `claude` permission** in ทีม SAMO to whoever should book.
>   Exactly ONE account holds it today. The feature is otherwise finished,
>   deployed and verified end to end — this is the last thing between it and use.
> - **เกี่ยวกับเรา on mobile — WAITING ON THE OWNER'S PICK. Do not build yet.**
>   Read `docs/demos/about-3d/README.md`, not a bullet.
> - **The browser pass, continued — `skills/drive-the-browser.md`.** Still
>   undriven: VS staff modal, ประกาศ drafts, อาจารย์ signature queue, SHOP
>   CHECKOUT. `docs/NEXT.md` §1.
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
> - **`str.index("## NEXT-SESSION PROMPT")` finds the mention in the INTRO, not
>   the heading**, and a slice built on it truncates this file. It happened
>   twice. Use `rindex`, or an anchor that appears once.
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
