# จองโควตา Claude — the 0154→0163 deep dive

Moved out of `STATE.md` on 2026-08-18. STATE.md had been ~4× its ~200-line
target for several sessions and it named this section as the next thing to
archive: most of it is REASONING (why each number meant something other than
what it said), not state.

**What stayed in STATE.md is the ⛔ rule list** — the things that change what a
session DOES. Everything below is why those rules exist. Read it before
touching `/admin#claude`, and read
`docs/state-archive/2026-08-16-claude-quota-booking.md` alongside it.

---

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

### 0163 — a window is identified by PROXIMITY, never by a rounded key

0162 keyed a window on `date_trunc('minute', resets_at + 30s)`. The API returns
`now + seconds_remaining`, so the value wobbles ±1s — and that key is stable
only while the true reset is not near the :30 boundary. A window resetting at
17:04:29.8 comes back either side of it, flipping `v_new_win` MID-window, and
the new-window branch is `v_delta := r.pct` — the whole CUMULATIVE reading.
**Falsified: restoring the key splits one window into FOUR runs reading
`20+40+90+90` and inflates the week from 150 to 300.** Reported as *"the ใช้จริง
shows like all 90% up in short period of time"*. Now compared as raw instants
with a 2-minute tolerance — **no boundary to land on. Never re-introduce a
rounding key here.**

⚠️ **The rendering half of that report was different and also real**: a window
with ONE run has run-total == window-total, so the same number printed twice,
and where a window reset as the next opened the two landed on the same minute
with different denominators ("96" over "ใช้ 55%"). Run labels are `+N%` (a
rise), the window total is `รวม N%`, and a total that merely repeats its single
run is suppressed.

### The calendar rail — colour ONLY, by the owner's decision

Four steps (`is-full` ≥90% · `is-part` ≥40% · `is-low` · `is-none`), validated
with `dataviz/validate_palette.js`, **full width**. A proportional-width fill
was built and PULLED — *"i just want the color full, you seperate color like
that is enough"*. Do not re-add it.

⚠️ **This surface has been too loud three times.** Solid saturated read as a
column DIVIDER; a saturated 2px edge became a hard gold rule once every band sat
on its minimum width; a column-wide track drew an empty gauge down days with no
reading. It is now four tinted full-width bands and nothing else.
⚠️ **NEVER put `overflow` clipping on `.claude-free`** — `.claude-free-tag` is a
child at `left: calc(100% + 3px)`, deliberately OUTSIDE the band, so clipping
deletes every percentage on the rail. Cost one report; guarded now.
⚠️ Two colours the validator REFUSED: a burnt orange for the low step is ΔE 10.4
from the clay "measured" colour, and `#a67c00` is 14.0 from the amber.

### The calendar height

`min(1100px, 100dvh - 230px)`, and `100dvh - 170px` under 768px — measured at
74–80% of the viewport, up from a fixed 620/480px (~57% / ~51%). **`dvh`, not
`vh`** (the iOS entry in `docs/mistakes/frontend-ui.md`). ⚠️ `applyFit()` READS
this value as the cap it divides by 24, so it must stay a real computed
max-height.

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
