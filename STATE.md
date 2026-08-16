# STATE — current task & latest known state

Last updated: **2026-08-16**. This is "what is true RIGHT NOW" and nothing else;
`git log --oneline` is the chronology and `docs/state-archive/` holds the
reasoning. **Target is ~200 lines** — when it bloats, move narrative to the
archive rather than trimming the invariants.

⚠️ **It is ~500 and has been over target for several sessions.** Three prunes
have been done: the 0154–0158 narrative and the "Live proofs" PER-PROOF
NARRATIVE both went to `docs/state-archive/` (the latter on 2026-08-16, leaving
one line per proof here), and the duplicated "What is owed" blocks were deleted.
It keeps growing because each session adds rules that genuinely belong here.
**The next structural pass should take the "จองโควตา Claude — READ THIS BEFORE
TOUCHING" section to the archive and leave its ⛔ rules only** — it is ~120 lines
and most of it is now reasoning, not state.

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
  **Migrations applied through 0162.** **1110 tests green. All 21 proofs green.**
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

### 0162 — ใช้จริง draws WHEN it was used, not what the gauge said

The overlay drew one bar per 15-minute sample, width = the CUMULATIVE five-hour
reading: the integral. It now draws the DERIVATIVE — the stretches where the
reading ROSE, each labelled with what went in during it, blank where nobody used
it.

**THE ONE THING TO KEEP: `five_hour.resets_at` minus 5h is the instant the
window OPENED — the first message.** It is not a sample, so it is not bounded by
the polling rate. A rise between two polls is attributed to `(prev, cur]`
**clamped to that instant**, which is what turns "10:00–10:15" into
"10:07–10:15". `claude_usage_runs()` (0162) is the only implementation.

Three drawn states, because the picture must not claim precision the polling
does not have: **exact** left edge (solid cap) · **inferred** (feathered) ·
**unknown**, the reporter was down (hatched, labelled as missing — NOT blank,
which reads as "nobody used it").

⚠️ **`resets_at` wobbles ±1s between polls** (the API returns
`now + seconds_remaining`), so it identifies a window only when ROUNDED TO THE
MINUTE. Clamping to the raw value drew a run starting at `14:59:59`.
⚠️ **Windows are keyed on `resets_at`, not on "the reading dropped"** — a window
first polled ABOVE where the previous one ended produces no drop and the two
were silently merged.

**POLLING, since it was asked:** the timer is `OnUnitActiveSec=15min`, i.e.
RELATIVE, so it drifts (+1s/run, harmless). **It cannot be "aligned" to the
5-hour reset** — the reset is set by whoever sends the first message, so it is
arbitrary against any fixed period. The clamp is what recovers the accuracy
instead, and it is free. What remains unmeasured is the TAIL of a closing
window: measured 4 and 9 minutes on the two real windows of 2026-08-16. Closing
that would need a one-shot poll at `reset − 30s` on the VM (~2–3 extra calls a
day). **Not built — offered to the owner, who has not chosen.**

### 0161 — the RAIL is a fourth reader of the window rule, not a second author

Reported: *"i book 16.00-19.00 for 75% … it shouldnt show the rail as 100% in
that 25%"*. `claude_free_now()` derived its 5-hour window from the CLOCK while
the trigger's `claude_window_loads()` derived it from the BOOKING CHAIN, so in
the tail of any window a booking had opened the rail offered a fresh 100% and
the trigger refused anything over the real remainder. **0154 claimed "the
arithmetic has exactly one home and it is the database" — and then the database
grew a second copy. "One home" has to mean one FUNCTION, not one tier.**
`claude_free_now()` now asks `claude_window_loads()`, exactly as the guard does.

Two things that follow:

- **The rail gained a boundary**: `booking_start + 5h`. Added to
  `claude_free_windows()`' union as a deliberate SUPERSET; the client merges
  adjacent equal bands (`mergeBands()` in `claude/week.js`).
- ⛔ **The rewrite REVERTED 0158** — it was built from the 0155 migration text
  instead of the live function body, and `least(p_at, v_now)` went back to
  `p_at`. `claude0155 §C3` caught it within a minute. **`create or replace` over
  a function several migrations have edited undoes all of them at once.**

**The calendar's three UI rules, since the owner asked for each by name:**
a booking card shows the **time RANGE** (not just the start), the name, and the
percentage — the REASON is in the modal and the tooltip only. Under it, a
**dashed box open at the top** covers exactly the time still fillable in that
5-hour window, green with "ว่าง N% · ถึง HH:MM", **red "เต็ม"** when the time is
free but the quota is not, and **absent entirely** when a booking fills its whole
window (nobody can fill anything, so the mark would be decoration). The capacity
rail is **no longer drawn inside a window at all** — the block and the box answer
it there, and a third mark saying the same number was what read as wrong.

⚠️ **THE PANE HAD ONLY EVER BEEN OPENED ON A LAPTOP.** Six bugs in this feature
were phone-only and every one was invisible in the stylesheet: a tag positioned
where the block always covers it · an absolute percentage colliding with a
wrapping time · a session frame with the same visual weight as a booking card ·
an overlay lane taken OUT of the block instead of ADDED to the grid · a
"พอดีจอ" toggle measuring the container its own output sizes · a date picker
that only opens on touch (desktop needs `showPicker()`).
**Render at 390 / 834 / 1440 before claiming a layout change works**, and assert
`scrollWidth - clientWidth === 0` per element rather than reading the CSS.
⚠️ **THE MEDIA QUERIES ON THE BOOKING CARD WERE ON THE WRONG NUMBER** and had
been since they were written: they said 767.98, but `.claude-cal-grid` has
`min-width: 940px` and the calendar SCROLLS sideways rather than squeezing, so
the card is ~81px at EVERY viewport below 940 — an iPad at 834 got the desktop
font in a phone-sized card. They are 939.98 now. **On this grid the breakpoint
belongs on the COLUMN, not the viewport.**
⚠️ **The browser harness must load `src/admin.css`, NOT `src/main.css`** —
`claude.css` is `@import`ed by the admin entry only. Pointed at the public one
the pane renders completely unstyled and the probe reports zero overflow, which
looks exactly like a pass. Assert the stylesheet applied (a computed
`--claude-lane`, a `dashed` border) as a CONTROL in every run.
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
> Migrations through **0162**; **1110 tests green**; **all 21 proofs green**.
>
> ### What the last session was
>
> **จองโควตา Claude — one bug and two UI asks, all from the owner testing
> live.** Migrations 0161 and 0162. **Read the "จองโควตา Claude" section above
> before touching `/admin#claude`**; its §0161 and §0162 have the four things
> that cost real time:
>
> 1. **The rail was a SECOND author of the window rule** (0161).
>    `claude_free_now()` took its 5-hour window from the CLOCK; the trigger's
>    `claude_window_loads()` takes it from the booking chain. 0154 had claimed
>    the arithmetic lived in exactly one home and the database then grew two.
>    **"One home" means one FUNCTION, not one tier.**
> 2. **A field already in the payload beat polling harder** (0162).
>    `five_hour.resets_at − 5h` is the instant a window OPENED, so a rise
>    between two polls can be clamped to it — "10:07–10:15", not
>    "10:00–10:15" — with no change to the 15-minute reporter. **Look for the
>    field that pins an edge before adding resolution.** It wobbles ±1s, so
>    round it to the minute or you render API noise as a time.
> 3. **Rewriting a function from its ORIGINAL migration reverted 0158.**
>    `claude0155 §C3` caught it in a minute. For 0162 the body was taken from
>    `pg_get_functiondef` instead and diffed first. **Do that.**
> 4. **The booking card's media queries were on the wrong number** — 767.98,
>    when `.claude-cal-grid` has `min-width: 940px` and SCROLLS sideways, so the
>    card is ~81px at every viewport below 940 and an iPad got a desktop font in
>    a phone-sized card. **On this grid the breakpoint belongs on the COLUMN,
>    not the viewport**; and the browser harness must load `src/admin.css` or
>    the pane renders unstyled and every overflow probe passes vacuously.
>
> ⚠️ **Everything the 0159 + 0160 session learned is still in the "จองโควตา
> Claude" section above** — the window rule, "an open window is not bookable at
> all", and the 390/834/1440 rule. None of it was superseded.
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
