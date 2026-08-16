# Live proofs — the per-proof narrative (archived 2026-08-16)

`STATE.md` carries one line per proof and a pointer here. This is what each one
cost to get right, why its subject is shaped the way it is, and the traps in
reading its output. Read the entry for the proof you are about to touch.

**Run them with `npm run proofs` (or `npm run proofs <substring>`).** Do NOT
check them with an ad-hoc parser — they emit four different output shapes and
doing it by hand produced two false alarms in a row. `tools/run-proofs.mjs`
normalises them and reports UNKNOWN as a FAILURE. Read
`skills/write-a-guard.md` before writing or trusting any of them.

**`tools/team0153-tier-parity.mjs` is NOT in the registry, on purpose** — it
compares the tree against a snapshot pinned to 2026-08-15, so it will
legitimately go red once the tree is edited. One-shot, kept re-runnable:
`node tools/team0153-tier-parity.mjs tools/fixtures/team-tree-before-0153.json`.

---

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
- `claude0161-rail-guard-parity.sql` (10/10) — **the rail and the trigger must
  derive the SAME 5-hour window.** A DIFFERENTIAL over every quarter-hour of the
  week, not a list of expected numbers: `claude_free_now(t)->session->free_pct`
  must equal `pool − max(claude_window_loads load at t)`. §C is the control (a
  non-empty, non-constant grid — "0 mismatches" is also what 0 comparisons
  prints). FALSIFIED by restoring the pre-0161 body inside the transaction: it
  reddens exactly A2, A3, B1. ⚠️ Its first draft asserted "the whole pool" at
  `booking_start − 5h` and got 93, because a real window was open carrying 7% —
  the assertion's SUBJECT was polluted by live state. That case belongs in
  claude0157 §C2, which injects a sample of its own; it was deleted here rather
  than weakened.
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

---

## The one that went stale silently

They were 14/15 once while `STATE.md` had been claiming 15/15 for three days.
`house0144-delete-impact.sql` was ERRORING (42501): its subject picker matched
only `has_permission('house')`, and zero accounts held it in either permission
column while twelve held the `vp_admin`/`dev` role the function ALSO accepts —
so it selected nobody and the RPC correctly refused. Fixed by making the picker
mirror the gate. **A proof's subject selector is part of the gate; re-derive it
from the function's own `if`.** `docs/mistakes/tooling-proofs.md`.
**An errored proof is silence.**
