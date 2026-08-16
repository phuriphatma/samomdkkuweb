# 2026-08-16 — จองโควตา Claude, front to back

Built, deployed and wired to a live measurement in one session: migration 0154,
an admin pane, a Discord notice, a systemd reporter on the VM. This file is the
reasoning; `git log` is the chronology and `docs/CONTEXT.md` is the reference.

## The problem, and the one design decision

SAMO has ONE Claude Pro subscription. Pro meters two windows: a 5-hour SESSION
worth 100%, and a 7-day WEEKLY window. The owner's conversion — 1% weekly = 7%
session — makes the week worth **700 session-percent, i.e. seven full sessions**.
That is the unit stored everywhere; nothing converts at read time.

**A session is DERIVED, not a slot on a grid.** This was the decision the whole
build turned on. Claude opens the 5-hour window at the FIRST message, so a grid
anchored to the clock is a fiction that reports "both bookings fine" right up
until the account caps out. Instead: the earliest booking in an area opens a
session, it runs five hours from THAT booking's start, and anyone landing inside
shares its 100%. This is simultaneously true to the rolling window and an exact
match for the owner's own example (30% over 3 hours leaves 70% over the next 2).

The owner initially asked for a calendar, then said "or think the best UI/UX
that's not calendar". Two prototypes were built and published side by side (a
status board and a week calendar) and they chose the calendar. Keep that: the
choice was made with both in front of them.

## What is enforced, and where

All four rules live in the DATABASE, none in the form:

| Rule | Mechanism |
|---|---|
| ≤5h per block | `claude_bookings_span_max` check |
| no overlapping blocks | `claude_bookings_no_overlap` **exclusion constraint** |
| session ≤100%, week ≤700%, no straddling a session edge or the weekly reset | `claude_booking_guard()` trigger **on the table** |

The exclusion constraint is load-bearing and not decoration: two people pressing
ยืนยัน in the same second both pass a client-side "is it free?" read.

Reads go through ONE gated RPC, `get_claude_board()`, which returns the sessions
it derived with the SAME `claude_sessions()` the trigger enforces with — so the
rule has one home. `claude_sessions()` and `claude_week_start()` are SECURITY
DEFINER over the whole table and are **revoked from `authenticated`**; granting
them (as the first draft did) would have handed the board to any signed-in
account with no `claude` grant in the path. Caught in review, guarded by
`claude0154-quota-guard.sql` §B4.

## Three bugs found by the owner, each a documented class

1. **The pane rendered completely unstyled.** `claude.css` was imported into
   `src/main.css` while the pane lives in `admin/index.html`, which loads
   `src/admin.css`. Two entries, one import, silent failure — build clean, tests
   green, deploy verified, and the page had never been opened. Guard:
   `src/css-entry.test.js`. Write-up in `docs/mistakes/frontend-ui.md`.
   **The lesson is the older one: render the view you changed.**
2. **A booking at 19 ส.ค. 02:00 saved and vanished.** The quota week spans EIGHT
   calendar dates (Wed 16:00 → Wed 16:00) and the grid drew a hardcoded seven,
   wrong at BOTH ends: it drew 19 Aug 00:00–16:00 (previous week — bookable then
   filtered out) and omitted 26 Aug 00:00–16:00 entirely (sixteen hours of THIS
   week with no column). Geometry moved to the pure `claude/week.js`; the count
   is derived. `week.test.js` asserts coverage over every hour of every weekday.
3. **The board froze at page-load.** Data landed every 15 minutes; the page read
   it once. Now polls every 60s, skipping when the pane is hidden, the tab is
   backgrounded, or **the modal is open** — repainting under someone's typing is
   its own class — and preserving scroll.

## The measurement, and the two dead ends

`GET https://api.anthropic.com/api/oauth/usage` with `Authorization: Bearer` +
`anthropic-beta: oauth-2025-04-20`. **Validated against `/usage` in the TUI**,
read minutes apart: session 77%/75%, week 36%/36%, reset instants identical, and
`claude_week_start()` computes the same boundary to within a quarter-second.
Three sources, one answer.

**Dead end 1 — `claude setup-token`.** Advertises a one-year token and was
recommended here for exactly that. It is **403 "OAuth token does not meet scope
requirement user:profile"**: `user:inference` without `user:profile`, so it can
SPEND the subscription and cannot READ it. Use `claude login`.

**Dead end 2 — local-log tools** (ccusage, phuryn/claude-usage, the local mode
of Maciek's monitor). They read `~/.claude` JSONL on ONE machine. `/usage` states
the ceiling itself: *"Approximate, based on local sessions on this machine — does
not include other devices or claude.ai"*. SAMO shares one account across several
laptops, so no machine's logs can see the account. The endpoint is
account-level, which is exactly why it can run on a VM where nobody codes.

Also assessed and rejected: the Admin API
(`/v1/organizations/usage_report/claude_code`) needs `sk-ant-admin-…` and a
Team/Enterprise org, and returns daily aggregates rather than live quotas. And
an `sk-ant-…` API key cannot substitute at all — it authenticates the
pay-per-token API, which has no 5-hour session and no weekly cap.

**A warning worth keeping**: advice from another assistant claimed a server would
be blocked by Cloudflare Turnstile, that IP-jumping would log everyone out, and
recommended Playwright relays / a Chrome extension / screenshot + vision-LLM.
All of it applies to scraping `claude.ai` with a **sessionKey cookie**, which is
not what this does. Tested from the VM: clean JSON 401, **zero** challenge
markers. It also named several 0★ repos as community standards and assumed a
Next.js/PostgreSQL stack this project does not have.

## Operational shape

- Reporter: `tools/claude-usage-report.mjs`, systemd `samo-claude-usage.timer`
  every 15 min, as `ubuntu`, credential from `claude login` on the VM. The
  script owns the refresh and writes the rotated pair back — skipping that
  write-back burns the refresh token and strands the account.
- A 429 is a **skipped tick, not an incident** (exit 0, no alert). The endpoint
  rate-limits hard, and an alert channel that fires on throttling gets muted,
  after which the real expiry goes unseen.
- The one failure needing a human — credential expiry — posts to Discord via
  `notifyClaudeAlert`, throttled to once per 6 hours.
- With no sample the board says so rather than showing a zero. **A zero reads as
  a reading.**


---

# 0155 — the same afternoon, four owner reports later

0154 shipped a calendar. Using it for a day produced four reports, and the
fourth one changed what the feature is FOR.

## The reports

1. *"on ipad, when touch, it mess up between scroll and adding the booking —
   what about having to long press"* — and, separately, *"when i click arrow
   next to สัปดาห์นี้ on my ipad it shows my profile"*. **One root cause**, in
   `docs/mistakes/frontend-ui.md`: `pointerdown` on a day column started a
   drag, which is every scroll's first event. A tap booked; and a scroll fired
   `pointercancel`, nothing listened, so the drag stayed armed and the next tap
   ANYWHERE — the week arrow — ran the drag-end handler. "My profile" was the
   booking modal's identity card.
2. *"when i book in the next week it shows Phuriphat Mahapromrak ยังไม่มีตำแหน่ง
   ในผังทีม"* — the id card resolved WHO YOU ARE from a booking of yours in the
   week on screen. Correct exactly when you had already booked there.
3. *"it should calculate how much claude token left … and log of the claude 5hr
   token, like what you get polling every 15 minutes, with what user booking,
   how many token used during that booking"* — the measured log.
4. *"i still has 660% i can use 100% token because it'll reset in 5 hr, but if
   it's 12.00 i'll can use only 30% from 12.00-16.00"* — **the one that
   mattered.**

## Why report 4 is the feature

Nobody books before opening Claude for ten minutes. A calendar answers "is this
slot free"; the question people actually arrive with is the opposite one —
*I want to use it NOW, how much may I take, and until when.*

The owner stated it as three worked examples and all three fall out of one
expression, `min(session_free, week_free)`. What makes it non-obvious is the
third boundary:

- 11:00, someone booked 16:00–19:00 for 70%, week has 660% → **100%**. A session
  opened at 11:00 runs to 16:00 and ENDS as theirs begins.
- 12:00, same board → **30% until 16:00**. The window now runs to 17:00 and
  their block is INSIDE it, so the two share one 100%.
- week has 100% left instead → **30%**, because their 70% is a claim on the week.

So the answer changes at **`booking_start − 5h`** — an instant nothing on a
calendar marks and no one would think to look at. `claude_free_windows()` puts
it in the boundary set, which is the only reason the calendar rail is right for
the five hours before every booking. `claude0155-free-now.sql` §C4 pins it.

## The design question the owner asked, and the answer

*"if there's people book at 03.00-06.45, if people book at 06.45, they should
can book to 13.00 because … it'll split their booking into 06.45-08.00 and
08.00-13.00. or … fixed people to book from 06.45 to 08.00 only … what do you
think is the best way, best practice"*

**Clamp, do not split.** The two halves draw from DIFFERENT pools — the first
from whatever the 03:00 session has left, the second from a fresh 100% — so one
`pct` cannot describe both and the system would have to invent the division.
Worse, the first half can be REFUSED (that session may have 10% left) while the
second succeeds, leaving half a booking nobody asked for. And the boundary is
real: it is how Claude meters, not a rule this app invented, so hiding it makes
"เหลือ X%" unreadable everywhere else.

What was built instead: `limitsFor()` stops the drag AND the time selects at the
first real wall (session edge, next booking, weekly reset), the selection box
says which wall, and the tail is offered as a second booking with the times
already filled in — announced BEFORE saving, so it is a promise kept rather than
a surprise. One press still makes one row.

## What is where

- `claude_person(uuid)` — the identity projection, extracted so the reader and
  every booking go through ONE piece of SQL. Fixes report 2.
- `claude_free_now(p_at)` / `claude_free_windows(p_at)` — reports 4 and the rail.
- `claude_usage_deltas` / `claude_usage_attribution` / `get_claude_usage_log` —
  report 3. Four rules, each learned from the live samples BEFORE writing it:
  a delta is only meaningful inside one window (decided on MONOTONICITY, because
  `resets_at` jitters ±1 min and an equality test marks half the intervals as a
  reset); a span is only partly booked, so the uncovered fraction stays
  unattributed; the log is not the total; a 5-hour window is OBSERVED, not
  configured.
- `src/js/claude/gesture.js` (pure) + `fmt.js` (shared formatters) +
  `usage.js` (the measured half's rendering). Report 1.

## Two things the verification taught

- **Falsifying the `pointercancel` fix did not go red.** With the hold gate in
  place a scroll never arms a drag, so that listener is unreachable by that
  path; the case that reaches it is a hold that ARMS and is then cancelled. A
  falsification that stays green may mean the guard is blind — or that the path
  is already closed. Only writing the reaching case tells you which.
- **The browser probe's own coordinates were wrong twice**, and both times the
  result was PASS. `docs/mistakes/tooling-proofs.md`. Every synthetic tap now
  carries an `elementFromPoint` control.


---

# Security posture (moved out of STATE.md, verified 2026-08-16)

Checked rather than assumed, because the owner asked directly.

- **Nothing leaked to git.** `sk-ant-oat01` appears in **0** commits; the only
  `discord.com/api/webhooks/...` strings ever committed are the `xxx/yyy`
  placeholders in `*.example`; `dist/` carries neither. `.env.local` is ignored.
- **What DID leak is the chat transcript** — the Discord webhook and the Claude
  token were both pasted there. That is the real exposure surface, not the repo.
- **Blast radius if the VM is compromised**: an attacker gets a credential that
  can make inference calls, i.e. burn the 5-hour/weekly QUOTA. Self-healing at
  the next reset, and revocable.
- **It cannot spend MONEY.** Read live from the account:
  `extra_usage.is_enabled=false`, `user_disabled=true`, `spend.enabled=false`,
  `can_purchase_credits=false`, `can_toggle=false`, `spend.used=0`. Billing and
  plan changes need a claude.ai WEB session (cookies), a different credential
  that never touches the VM. **Keep usage credits disabled — that setting is
  doing real work as a spend ceiling.**
- Both VM secret files are `-rw------- root root`:
  `/etc/samo-notify.env`, `/etc/samo-claude-usage.env`.
- `claude-reporter@samomdkku.app` is a DEDICATED account holding only
  `claude` — least privilege, so the credential in `/etc` can insert usage
  samples and read the board and nothing else. Password in `/etc` (600) only,
  never in git, never printed. Created by direct `auth.users` insert; that needs
  the GoTrue token columns set to `''` not NULL or every sign-in 500s with
  "Database error querying schema".


---

# What 0154–0158 learned (moved out of STATE.md, 2026-08-16)

**The two rules that produced four of the five bugs BEFORE 0159:**

1. **Two quantities in one subtraction must share an INSTANT.** 0156 (the week
   card read `right_now`, so browsing ahead showed today's usage) and 0158 (the
   weekly remainder subtracted a FUTURE reservation list from a PRESENT
   measurement, so finished bookings appeared to hand their quota back and
   `week_free` climbed 10 → 60 → 160 → 260 → 360). Both were invisible in
   review, because the present is the one instant where every scope agrees —
   and it is the instant you are looking at while you build.

2. **A readout is only correct where its question applies.** The rail's
   `claude_free_now()` really is 50 inside somebody's block — and the rail says
   "free to use without booking", so it was inviting the collision booking
   exists to prevent. Now carved out and drawn as a hatched "held" state.

**The three panels and their scopes — do not cross them:**

| Panel | Scope | Source |
|---|---|---|
| `ใช้ได้เลยตอนนี้` (hero) | this instant | `claude_free_now()` |
| the week card | the week ON SCREEN | `board.week.*` (0156) |
| the rail | per START TIME | `claude_free_windows()` |

**Colour carries meaning here:** clay = MEASURED (Claude's own number) · green =
free · ฝ่าย colours = booked by a person · amber = partly available · red = none
· hatch = held by someone. Amber was `--brand-orange` and had to move: it sat
one hue-step from clay and "partly booked" started looking like "actually used".

**The rail's semantics, exactly:** a band means "start anywhere in here and you
may take this much", and its END is the LATEST START that still earns it. That
is why `booking_start − 5h` is a boundary — a session begun exactly then ends as
their block opens and shares with nobody. Bands are evaluated one second INSIDE,
never at the edge (0157).

**Guards, and what they cost to get right:**
- `tools/claude0157-rail-segments.sql` (10/10) asserts the PROPERTY ("the answer
  does not change inside a band"), **not a list of boundaries — because the bug
  WAS a wrong list**: 0155's header named four instants and the code had three.
- Its §B first asserted every band's end earns that band's number; three bands
  failed and the ASSERTION was wrong, not the code.
- Its sample is DERIVED from the booked total: hardcoded, the live week capped
  every band and the controls B3/B4 correctly went red.
- `tools/claude0155-free-now.sql` (22/22) — C3 asserted the opposite of the
  truth and went red the moment 0158 landed. That is the right way round.
- `src/js/claude/gesture.test.js` (35) — the touch gesture, the lane, the
  identity. Three of its assertions were BLIND on first write (a regex that ran
  past the end of a function; `.match` without `/g` reading the wrong CSS rule;
  `toContain('carve(')` matching the definition).
- Browser probes live in the scratchpad, not the repo: a 13-case iPad touch run
  and a painted-box overlap check. **The touch run's ALLOW case is what caught
  a harness where the modal counter had been dropped** and every "opens no
  modal" case was passing vacuously.

⚠️ **`get_claude_board()` cost grows with bookings** — ~25 ms at 7/week, ~100 ms
at 30, polled every 60 s per open tab. Fine at real scale; see the note above.
