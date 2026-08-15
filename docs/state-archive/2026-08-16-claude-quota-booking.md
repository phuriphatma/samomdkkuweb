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
