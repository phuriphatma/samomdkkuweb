# Mistakes — Proof scripts & verification discipline

How the `tools/*.mjs` proofs lie to you. A probe that can only report "denied" cannot tell a working guard from a broken one.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## Two implementations of one rule drift silently — diff them, don't eyeball them

**Symptom**: none. The 0096 visibility ladder is implemented twice —
`public.vs_remark_vis()` as the server boundary and `remarkVis()` in `utils.js`
for rendering — and STATE.md dutifully said "mirrors, keep them in step". That
sentence is not a mechanism.
**Cause**: a differential test over 26 input shapes found 3 disagreements. The
SQL accepts `'t'`, `'1'` and numeric `1` as truthy for the legacy `internal`
flag (`lower(e->>'internal') in ('true','t','1')`; jsonb `->>` stringifies, so
`1` arrives as `'1'`); the JS accepted only `true` and `'true'`.
**Severity**: fails SAFE — the server strips the entry as staff-only and the
client never sees it. The reverse direction (JS believing an entry is
staff-only while the server ships it) would have rendered a staff note to a
submitter. No live row uses those shapes; the app writes `internal: true`.
**Fix**: JS now matches the SQL truthy set exactly, pinned in
`utils.test.js`, and the differential test is permanent:
`tools/vs-remark-vis-mirror.mjs` runs every legal + malformed shape through
BOTH and diffs.
**Rule**: when one rule is implemented on both sides of the wire, write the
differential test the same commit. And when reviewing one, state which
direction of disagreement is the dangerous one — here "JS stricter than SQL" is
safe and "SQL stricter than JS" is a leak, and only the test can tell you which
you have.

---

---

## Debugging note: `tools/db-query.mjs` COMMITS — a probe with `limit 1` and no `ORDER BY` will mutate a real row

**Symptom**: while reproducing the RLS bug above, a probe that did
`update vs_tickets set target_dept='SE' where id = (select id … limit 1)` under
a widened policy reported `rows=1` — and moved a **real production ticket** into
SE. Caught only by diffing `select target_dept, count(*)` against a snapshot
taken before the session.
**Cause**: `db-query.mjs` posts to the Management API `database/query` endpoint,
which runs the string as ONE implicit transaction and **commits**. Its header
says "READ-ONLY" as a statement of intent, not an enforced mode. A plpgsql
`begin … exception when others` block only rolls back the failing *sub*
transaction; every probe that SUCCEEDED persisted.
**Fix / how to probe safely**:
- Every proof script in `tools/` ends its Management-API call with `rollback;`
  for exactly this reason. Do the same for ad-hoc investigation — it is one word.
- Snapshot the shape you are about to disturb (`select <col>, count(*) … group
  by 1`) BEFORE the first write probe, and diff it after. That snapshot is what
  turned "everything looks restored" into "one ticket is in the wrong dept".
- `where id = (… limit 1)` with no `ORDER BY` picks a DIFFERENT row per call, so
  verifying "the ticket I touched" by id proves nothing about the one an earlier
  probe touched.
**Restoring**: the ticket's own timeline said which dept it belonged to. Reverted
with `touch_vs_tickets_updated_at` disabled so the restore did not stamp a third
bogus `updated_at`, and set `updated_at` back to the last genuine event.

---

---

## RLS does not RAISE on UPDATE/DELETE — a proof that asks "did it throw?" scores a fully-blocked write as permitted

**Symptom**: the first run of a new authorization proof reported
`anon cannot update scans -> ALLOWED`, `anon cannot set anyone total_km ->
ALLOWED`, and `CAN still rename self -> ALLOWED` — the last one a pass, the first
two apparently catastrophic. The policies were in fact correct; the *test* was
wrong, in the direction that matters: it would equally have reported ALLOWED for a
genuinely open policy, so it could not tell a closed system from an open one.
**Cause**: RLS filters rows; it does not reject statements. For UPDATE and DELETE a
row the policy hides is simply **not visible**, so the statement succeeds having
touched nothing and no exception is raised. Wrapping it in
`begin … exception when others then 'blocked'` therefore records ALLOWED for both
the permitted case and the fully-denied case. INSERT is the exception that misleads
you into the pattern: a `WITH CHECK` failure IS a real error (42501), so
INSERT probes written this way work, and you generalize from them.
**Fix**: for UPDATE/DELETE assert `ROW_COUNT`, not the absence of an exception:
```sql
update … ; get diagnostics v_rc = ROW_COUNT;
insert into out values('k','rows='||v_rc);
```
then treat `blocked:*` OR `rows=0` as denied, and `rows=N>0` as permitted. The
distinction also makes the assertion honest in the other direction — "the student
CAN still rename themselves" now means one row actually changed, not merely that
nothing exploded.
**Where**: `tools/pass-hardening.mjs` `TRY` (INSERT / RPC probes) vs `TRYN`
(UPDATE / DELETE probes); the 53 checks split along exactly that line.
**Rule**: in any RLS proof, classify each probe by statement type first. Only
INSERT and an explicit `raise` in a definer function fail loudly; SELECT, UPDATE
and DELETE fail *quietly and by row count*. Two more traps from the same script:
the Management API returns **201**, not 200, so a `status !== 200` guard discards a
successful run; and once you `set_config('role', 'anon')` inside a transaction you
must `reset role` at top level before impersonating the next principal, or every
later phase silently runs as anon and "passes".

---

---

## A proof script that fails for a CORRECT reason gets ignored — then it protects nothing

**Two instances in one bug-scan pass, both in tools/:**
1. `prof0095-seat-parity.mjs` asserted "an account with no seat reads **no**
   sign requests". `project_sign_requests_read` has a deliberate
   `prof_id = auth.uid()` branch — a named recipient reads their own request,
   seat or not — and since the script was written, two real requests were
   addressed to the probe account. The policy is right; the assertion aged out.
   Now: `where prof_id is distinct from auth.uid()`, i.e. assert what the policy
   actually promises — *nothing beyond your own name*.
2. `seat0109-my-seat.mjs` asserted "the payload contains no other person's
   kkumail" with a bare `position(kkumail in blob)`. One live `team_members` row
   carries the placeholder `kkumail = '-'`, and a hyphen appears in every uuid
   in the payload → a reported leak that did not exist. Now the candidate must
   look like an address (`like '%@%.%'`, length ≥ 6).
**Rule**: when a proof fails, find out WHICH branch produced the number before
touching any policy — and prefer assertions worded as the invariant ("nothing
beyond X") over incidental counts ("zero rows"), because a count encodes a
snapshot of the data and the data moves. A probe whose candidate set can contain
placeholder / single-character values needs a shape filter, or it cries wolf.


## `pg_get_functiondef` over every function 42809s on aggregates — and the whole introspection query fails, reporting nothing

**Symptom**: the enumeration recipe recorded in migration 0110's own comments —
`select proname from pg_proc p join pg_namespace n … where pg_get_functiondef(p.oid) ~ 'has_permission\(''team''\)'` —
returns `ERROR: 42809: "array_agg" is an aggregate function` through the
Management API. Run casually (or with the error swallowed) it looks like a clean
sweep: no function names, nothing to fix.
**Cause**: two independent traps in one query. (1) `pg_get_functiondef` RAISES on
an aggregate or window function, and `pg_proc` contains those, so the predicate
blows up on a row that has nothing to do with the search — fix with
`p.prokind = 'f'`. (2) The pattern itself never matches: `pg_policies.qual` and
function bodies render the literal as `current_user_has_permission('team'::text)`,
so `has_permission\('team'\)` finds zero of the twelve live hits. The policy
version of the same recipe therefore reported "no policy uses the view key" while
every read policy did.
**Fix**: `prokind='f'`, and match `'team'::text` (or just `has_permission\(''team'`
as a prefix). Verified by re-running: the corrected query found exactly the three
functions that named `prefix` before 0113 dropped it, and 12 policies naming the
team keys.
**Rule**: an introspection query that returns NOTHING is not evidence of nothing.
Before trusting a sweep, make it find something you already know is there — the
allow-direction of class 7, applied to your own tooling. And never write a
verification recipe into a comment without running it first; a wrong one is worse
than none, because the next person reads it as already checked.

---

## A proof failed for a CORRECT reason because its subject was hardcoded — the org chart moved underneath it

**Symptom**: `tools/proj0092-seat-parity.mjs` printed
`FAIL baseline: the member inherits a seat from their ตำแหน่ง []` while every
other check in the file passed, including the one immediately after it that
exercises the SAME function. Discovered incidentally while verifying that
migration 0147 had not broken seat resolution — i.e. it had been failing for an
unknown length of time and nobody had looked.

**Cause**: the script hardcoded `TREE_USER = 'phuriphat.ma@kkumail.com'` as the
person who inherits a `project_seat` from their ตำแหน่ง. The org chart was
reorganised since; that account now sits under *Ungrole* and *หัวหน้าฝ่าย IT*,
and neither node carries a `project_seat` (only *อุปนายกฝ่ายบริหารองค์กร* does).
So `effective_team_project_seats_for_email()` correctly returned `{}` and the
proof correctly reported that its own FIXTURE was gone. Nothing was broken except
the assumption.

This is the failure mode that matters: a proof that cries wolf gets ignored, and
an ignored proof guards nothing. A permanently-red check is worse than no check,
because it also trains you to skim past the greens next to it.

**Fix**: resolve the subject FROM THE TREE instead of naming them —
`select tm.kkumail from team_members tm join team_nodes tn on tn.id = tm.node_id
where tn.project_seat is not null and tm.project_seat is null limit 1` — and
assert first that such a person exists, so a genuinely empty tree still fails
loudly and for the right reason. Sections B–D keep the hardcoded account because
they STAGE an explicit seat and so do not depend on where anyone sits. 13 → 14
checks, 14/14.

**Where it lives now**: `tools/proj0092-seat-parity.mjs` section A.

**Rules**: (1) A proof's SUBJECT should be derived from the property under test,
not named. Anything named is a fixture, and fixtures rot at the speed of the
data. (2) When a proof fails, decide "stale fixture" vs "real regression" BEFORE
touching anything else — and if it is the fixture, fix the proof rather than
noting it, because the note is what the next person will not read. (3) The tell
here was a FAIL sitting next to a PASS that used the same function: when one
assertion about a function fails and another succeeds, suspect the data.

---


### Second instance, 2026-08-15: the subject SELECTOR was narrower than the gate

`house0144-delete-impact.sql` picked whoever could run the RPC with

```sql
where 'house' = any(managed_permissions) or 'house' = any(permissions)
```

but `student_delete_impact` (0144) admits **two** channels:

```sql
current_user_role() in ('vp_admin','dev')  OR  has_permission('house')
```

On 2026-08-15 the permission half selected **nobody** — zero accounts held
`house` in either column, while **twelve** held the role — so `admin_uid` was
empty, `sub` was null, and the RPC correctly raised 42501. The proof did not go
red with a useful message: it **ERRORED**, which `run-proofs.mjs` reports as
UNKNOWN, and `STATE.md` had been asserting "15/15 green" for three days.

Nothing was wrong with the function or the policy. The proof had simply lost its
subject, because a grant channel moved while the picker watched only one of them.

**Fix**: the picker now mirrors the gate — both channels, permission-holders
ranked first so that half keeps being exercised whenever anyone holds it.

**Rule**: **a proof's SUBJECT SELECTOR is part of the gate it is testing, and has
to be as wide as the gate.** If the function accepts role OR permission, a picker
that matches only permission is one org-chart edit away from testing nothing —
and it fails by ERRORING, which is silence rather than a red line. Re-derive the
selector from the function's own `if`, never from the channel that happened to be
populated the day it was written.

## Four guards were reading a MANGLED file — `'image/*'` opened a "comment" that ate 13,839 characters of main.js

**Symptom**: A new assertion in `signin-screen.test.js` — "these handlers are
defined exactly once" — passed with a duplicate handler sitting in `main.js` on
a line the test had just been shown. Reintroducing the bug did not turn it red.
**Cause**: Every guard that reads JS source carried its own
`.replace(/\/\*[\s\S]*?\*\//g, '')` to strip block comments. That regex cannot
tell a comment opener from the two characters `/*` inside a STRING, and
`main.js` contains `input.accept = 'image/*';`. The "comment" opened there and
ran to the next close-marker anywhere in the file: **13,839 characters of real
source blanked before a single assertion ran**. The same literal is in
`admin-main.js` (2,321 chars) and `my-seat.js` (~6,000 across seven spots).
Measured total: ~24,000 characters invisible to the guards — and one of the
blinded readers was `native-dialog.test.js`, whose entire job is to find native
dialogs in exactly those modules.
**Fix**: one shared `src/js/strip-comments.js` — a character scanner with a mode
stack that knows strings, template literals and regex literals, and replaces
comments with equivalent whitespace so line numbers still match. All four guards
read through it.
**The fix's own first draft was wrong in the same family**, which is the part
worth keeping: it skipped from a backtick to the next backtick, ignoring that
`${…}` holds real code. A multi-line template in `house/my-house.js` put it out
of phase for the rest of the file, leaving a `/** … */` block unstripped — and
`native-dialog.test.js` then reported that block's PROSE as a call site. A false
positive is how that got noticed at all; had it failed the other way it would
have been silent.
**Where**: `src/js/strip-comments.js` + `strip-comments.test.js`, used by
`signin-screen` · `native-dialog` · `confirm-modal` · `definer-authz`.
The stripper's own test asserts the property a phase error violates: with
strings and regex literals blanked, NO comment marker may survive in ANY module
— and it walks subdirectories, because the top-level-only first version never
saw the file that broke it.
**Rule**: a guard's INSTRUMENT needs a guard. Comment-stripping, minified-bundle
grepping and "read the source and match a pattern" all silently change what the
test can see, and when the instrument is wrong the test does not fail — it
PASSES, because the hazard is no longer in the text it was handed. Never
hand-roll a lexer per test file: one shared instrument, with its own test, whose
control asserts it still finds the hazard it was built for.

---

## A proof whose subject was a SHOP ADMIN reported that a buyer could set an order total to ฿1

**Symptom**: A new both-directional proof for the buyer self-update whitelist
printed `D1. buyer may NOT change the total — expected refused, got allowed`,
and `D4. the total is untouched — expected 5, got 1`. Read literally, anyone
could rewrite the price of their own order.
**Cause**: The proof resolved its subject as "an order in a buyer-editable
status", `order by id limit 1`. Every one of the six orders in this database was
placed by a shop ADMIN (they are test orders), and
`shop_orders_self_update_guard` opens with
`if public.current_user_is_shop_admin() then return new; end if;` — so the guard
never engaged. Every case, ALLOW and DENY alike, was measuring an admin's
permissions. The ALLOW half had been "passing" for the same reason.
**Fix**: the subject is MANUFACTURED — clone a real order onto a real non-admin
account inside the transaction that is rolled back anyway — and the exclusion is
asserted rather than assumed (`S2. the subject is NOT a shop admin`, read from
`current_user_is_shop_admin()` under the subject's own claims). Note the
exclusion needs the permission columns, not just the role: that helper is true
for `samoshop` OR `master` through either `permissions` or `managed_permissions`.
**Where**: `tools/shop0150-buyer-contact.sql`.
**Rule**: **an authorization proof measures whoever it impersonates, and a
privileged subject makes both halves vacuous at once** — the ALLOW half passes
for the wrong reason and the DENY half fails for the wrong reason. When the
guard under test has an early-return for a role, the subject MUST be excluded
from that role, and the exclusion must be an assertion in the output. If real
data cannot supply such a subject, manufacture one inside the rollback rather
than settling for the subject that exists. Corollary: a DENY case that fails
loudly is worth more than an ALLOW case that passes quietly — here the deny half
was the only thing that revealed the probe was measuring the wrong person.

---

## Checking the proofs by hand produced TWO false alarms in a row — they emit four different output shapes

**Symptom**: An end-of-session sweep ran every live proof through an ad-hoc
parser and reported `authz-sweep-identity 0/23 FAIL`. The proof was fully green.
The corrected parser then reported four more as `N-1/N FAIL`. Those were green
too.
**Cause**: The parser looked for a `result` column. The proofs do not agree on
one — `authz-sweep-identity` and `pr0149` use `verdict`, `house0144` and
`shop0150` use `result`, the `house0145` / `house0146` / `team0145` family uses
`status` **and ends with an `ALL PASS` SCORE row**, `house0116` returns a single
JSON blob with no per-case column at all, and six more are `.mjs` scripts
printing plain text. The first parser could not see `verdict`; the second
counted each file's own summary row as a failing case.
**Fix**: `tools/run-proofs.mjs` (`npm run proofs`) runs all fifteen and prints
one normalised verdict each. It knows the four shapes, treats a trailing
`ALL PASS` row as a summary rather than a case, and reports a proof that ERRORS
as a failure — with the property that matters: **output it cannot interpret is
UNKNOWN and exits non-zero**, never a pass.
**Where**: `tools/run-proofs.mjs`; `STATE.md` now says to use it and why.
Verified by reintroduction, both ways: a SQL syntax error surfaces as
`✗ FAIL errored: …`, and a flipped expectation as `✗ FAIL 1 failed — B3. RPC
denies the ungranted user`.
**Rule**: **the thing that READS a guard's output is part of the guard.** A
verification step that cries wolf gets switched off, and this repo has written
that down twice already — so the parser is not an incidental script, it is the
instrument, and it needs the same reintroduce-and-watch-it-fail treatment as the
assertion. When several guards report in different formats, normalise them once
in a checked-in tool instead of re-deriving the format at each call site.

---

## A proof that ERRORS is not a proof that fails — it is a proof that is ABSENT, and `house0116-authz.sql` had been absent for 23 migrations

**Symptom**: `node tools/db-query.mjs tools/house0116-authz.sql` returned
`HTTP 400 … ERROR: 42883: function public.get_house_roster(smallint) does not
exist`. Not one assertion printed. Found only because 0147 prompted a re-run of
the whole proof suite; nothing had run this file since **0124**.

**Cause**: three separate rots, each individually reasonable, and one of them
fatal in a way the other two are not.

1. `get_house_roster()` was DROPPED on purpose by 0124 (ระบบบ้าน publishes
   อาจารย์, never students). The script still called it — inside the `DO` block,
   so the whole block aborted at that line and **every assertion, including the
   ones before it, produced nothing**.
2. It still asserted `students.status` and `students.sai_locked`, columns 0120
   dropped.
3. Its signed-in subject was the hardcoded `manee.j@kkumail.com`, which has
   **never existed in `public.users`** — so `auth.uid()` was NULL and the ALLOW
   half could not have worked even before (1) killed the file outright.

The distinction that matters: a proof that FAILS is loud and shows you which
assertion. A proof that ERRORS produces no assertions at all, and a file that
exists, is named after the migration it guards, and is listed in `STATE.md` looks
exactly like coverage. It is worse than having no proof, because it occupies the
slot where a real one would go.

**Fix**: subjects resolved from the grant model instead of named (an account
holding `house`/`master` for the allow half; an ungranted account with no
`students` row for the ordinary half, so the fixture row can be inserted without
colliding with `students_kkumail_key`). The allow assertion compares against the
REAL row count rather than a hardcoded `2`. The self-edit probe now smuggles
`sai_code` — a column that still exists and still must not be self-writable —
beside the legal `nickname_self`, and asserts the STORED value afterwards,
because the RPC builds an explicit column list and so IGNORES an unknown key
rather than raising. And the roster probe is **inverted**: it now asserts
`get_house_roster` does NOT exist, turning 0124's privacy decision into a guard
that fails if anyone re-adds a student-roster reader. 8/8.

**Where it lives now**: `tools/house0116-authz.sql`.

**Rules**: (1) **When a migration drops a function or a column, grep `tools/` for
it in the SAME commit.** 0120 and 0124 each dropped something this file named,
and neither noticed. (2) Distinguish "the proof failed" from "the proof did not
run" — a suite runner that only looks for the word FAIL scores an aborted script
as silence. (3) Invert a deletion into an assertion: if dropping something was a
DECISION, guard its absence, or the next person re-adds it and every proof still
passes.

## A browser probe measured its coordinates before the page scrolled

**Symptom.** A CDP touch-gesture run against the Claude booking calendar
reported four of five cases green on its first run. The one red case was the one
asserting that a long press DOES open the modal.

**Cause.** The touch point was computed as `column.getBoundingClientRect().top +
120`. `buildGrid()` scrolls the calendar to 08:00, so the column's own rect
starts several hundred pixels ABOVE the scroll viewport and that expression
landed on the hero panel. Every "a tap opens no modal" result was true because
nothing was being tapped. The single failing case was the only one that could
not pass vacuously — which is the entire reason to write an ALLOW beside every
DENY.

The same run then produced a second instance of the same mistake: the week
arrow's coordinates were read BEFORE a `scrollIntoView()` moved the toolbar,
because the app sets `scroll-behavior: smooth`, so `scrollIntoView()` returns
before the scroll has happened. The arrow tap landed on empty page and "tapping
the arrow opens no modal" passed for the wrong reason.

**Fix.** Every synthetic-input probe now carries a CONTROL that names what is
under the point before touching it:

```js
const hit = document.elementFromPoint(x, y);
results.push(`${hit?.closest('.claude-daycol') ? 'PASS' : 'FAIL'}  CONTROL: …`);
```

and coordinates are re-measured at the moment of use, after an instant scroll
plus a wait.

**Where it lives now.** The driver pattern in `skills/drive-the-browser.md`.

**The general rule.** *A synthetic click, tap or drag must prove it hit
something before it proves anything else.* Input coordinates are computed from a
layout that the previous step may have moved, and the failure mode is silent and
green: a tap on nothing produces exactly the same "no side effect" the passing
case asserts. Related and equally silent: `scrollIntoView()` under
`scroll-behavior: smooth` returns before the scroll, so any coordinate read on
the next line is stale.

## A comment listed four boundaries and the code had three

**Symptom.** The Claude capacity rail drew one band "ว่าง 48%" from 11:00 to
03:00 the next day, straight through 14:39 — the moment the open 5-hour window
resets and a fresh 100% becomes available.

**Cause.** `claude_free_windows()` builds its segments by evaluating
`claude_free_now()` at every instant where the answer can change. The migration
header lists four such instants and names the fourth as "the open window's own
reset". The `union` had three. The three that were there all came from the
bookings table and were easy to enumerate; the missing one came from a
MEASUREMENT, which is exactly why it was the one left out.

**Fix.** The reset is in the boundary set — and, more usefully, the guard no
longer asserts a list of boundaries at all. It asserts the PROPERTY:

> the answer does not change inside a band.

Three interior samples per band, compared to the number the band is labelled
with. Any missing boundary — that one, or one nobody has thought of — makes some
band non-constant and turns it red without anyone predicting it. Falsified by
reintroducing both original bugs: the general case catches both.

**Where it lives now.** `tools/claude0157-rail-segments.sql` §A1.

**The general rule.** *Do not write a guard from the same list the code was
written from.* If the list is what is wrong, a guard that restates it passes.
Assert the property the list was supposed to produce.

A second lesson from the same file: the first draft of §B asserted that every
band's end instant still earns that band's number, and three bands failed —
**the assertion was wrong, not the code.** Only one boundary kind
(`booking_start − 5h`) carries "you may still start AT this moment"; at a
window reset or a booking's start or end the later value already applies. A
guard that generalises one boundary's behaviour to all of them turns a true
statement into a false one, and it costs a debugging session to find out which
end was wrong.

---

## A control threshold that assumed the proof runs early in the quota week

**Symptom.** `claude0161-rail-guard-parity.sql` went red on
**C1. control — the grid is not empty**, with every real assertion green. The
suite had been 21/22 the day before and was now 20/22, which reads as a
regression in the rail↔guard parity.

**Cause.** The grid the differential walks is the REMAINDER of the Claude quota
week, at 15-minute steps:

```sql
generate_series(greatest(now(), claude_week_start(now())) + interval '1 minute',
                claude_week_start(now()) + interval '7 days' - interval '1 minute',
                interval '15 minutes')
```

so it has ~672 points just after the Wednesday 16:00 reset and shrinks to zero
as the next one approaches. The control asserted `count(*) > 100` — a constant
that silently means "this proof is run with at least 25 hours left in the week".
Measured on 2026-08-18 at 18:39 ICT, ~21 h before the reset: **86 points**. The
guard was correct, the code was correct, and the proof was red.

**Fix.** `> 20` — five hours, one full Claude window, the shortest span over
which the differential says anything — with the reason written next to it. The
vacuity that C1 exists to catch is really covered by **C2** ("the answer
actually VARIES across the week"): a constant pair of functions fails C2 no
matter how many points the grid has.

**Where it lives now.** `tools/claude0161-rail-guard-parity.sql` §C.
Sibling hazard, noted but not hit: `claude0157`'s sample-booking search runs
`date_trunc('hour', now()) + 7h` → `week_start + 7d − 11h` and collapses the
same way (5 candidate slots left at that same instant).

**The general rule.** **A control whose threshold is a constant encodes WHEN
the proof is allowed to run.** Any subject derived from `now()` against a
period boundary shrinks to nothing at the end of that period — so either
derive the threshold from the span actually available, or set it to the
smallest span over which the assertion still means something, and say which in
the file. A proof that fails for a correct reason is a proof that gets ignored,
and the next reader pays for it by re-deriving a green result.

## Two proofs ERRORED for six days because their scenario needed a week with room left in it

**Symptom.** `claude0157` and `claude0161` both died on
`HTTP 400 … 23502: null value in column "starts_at"` — not a failing assertion,
an aborted script producing zero probe rows. `STATE.md` carried the right
diagnosis on 2026-08-19 and the owed fix went unwritten, so the two reds sat in
every subsequent handoff as known-bad noise. That is the whole cost: a proof
that errors is indistinguishable from a proof nobody reads, and both of these
guard the rail arithmetic a later session then changed.

**Cause, and it is a rot with a clock on it.** Both scenarios find their slot in

```sql
generate_series(date_trunc('hour', now()) + interval '7 hours',
                public.claude_week_start(now()) + interval '7 days' - interval '11 hours',
                interval '1 hour')
```

— the remainder of the LIVE quota week. Run late enough in that week and the
range is empty, `sc.b_start` is NULL, and the booking insert six statements
later violates NOT NULL. Measured 2026-08-25 23:05 ICT: the week ended in
5h55m; zero rows. The slot was already resolved from the data rather than
hardcoded (the lesson from `proj0092`), which is why this reads as safe — but
"derived from live data" and "always derivable" are different properties, and
only the second keeps a proof runnable.

**Fix.** Three things, and only the first is about the error.

1. **The proof owns its week.** `claude_free_windows()` reads `now()` itself and
   only ever draws the CURRENT week — there is no `p_at` to move — so the
   scenario genuinely needs a week with room in it. What decides where that week
   starts is `claude_settings.week_reset_dow` / `week_reset_time`, a SETTING,
   and the whole proof runs inside a transaction that rolls back. It now states
   the geometry it needs: *the current quota week began two hours ago*. Every
   `claude_week_start()` call — in the search, in the function, in the trigger —
   reads that same moved boundary.
2. **The empty search FAILS instead of aborting.** A00 asserts a slot was found
   and the insert is `where … is not null`, so a genuinely full week produces a
   red assertion rather than silence.
3. **`claude0157` B4 got the second booking it always needed.** B4 asserts at
   least one deadline is a real STEP DOWN — that waiting can COST you quota,
   which is the rail's entire claim. One booking produced `48 → 48 → 50 → 50 →
   100`, monotonically non-decreasing: the heaviest window was the EARLIEST one,
   so every edge stepped up and B4 correctly refused to pass vacuously. A heavy
   block after the free stretch supplies the phenomenon. A01 controls that the
   row was actually written — a B4 red because the SCENARIO failed reads exactly
   like a B4 red because the RULE broke.

**What the new scenario then found, which is why this entry is worth reading.**
B1 asserted that at a deadline the instant itself EQUALS the earlier band.
Measured where a window RESET and a DEADLINE coincide:

```
04:00 − 1s    50    the first booking's window, still running
04:00        100    a session begun exactly here ends exactly as the next
                    booking opens, and the previous window has just reset
04:00 + 1s    20    inside the next booking's window, 80 loaded
```

100 is correct, and larger than BOTH neighbours. The promise a deadline makes is
*"act at this instant and you do not lose the larger number"*, not "you get
exactly the earlier band" — identical at an ordinary deadline, different when
two boundary kinds land on one instant. B1 is now `>=`, falsified with a
one-second-late oracle (B1 and the new B1b go red; A1 and B2 stay green, which
is what shows the weakening did not blind it).

**It also means the RAIL under-reports at that instant**, and that is recorded
rather than hidden: bands are drawn from one second INSIDE, so no band carries
the 100. Accepted — an isolated instant that beats both open intervals around it
has no width to be drawn with, and the error is in the safe direction: the rail
shows less than is available, never more.

**Where it lives now.** `tools/claude0157-rail-segments.sql` §A00/§A01/§B1/§B1b
and `tools/claude0161-rail-guard-parity.sql`. All 23 proofs green 2026-08-25.

**The general rule.** *A scenario built from live geometry is only as runnable
as that geometry — if the thing it needs can run out, the proof must CREATE it,
not search for it.* Move the SETTING that defines the geometry rather than
relaxing what the scenario asks for; relaxing it is tuning the guard to pass.
And when a control refuses to pass vacuously, supply the phenomenon it is asking
about AND add a control that the supply worked — otherwise the next red is
unreadable.

## `open(p, "w")` truncates before the `read()` you passed to it

**Symptom.** A one-liner meant to append a write-up —
`open(p,'w').write(open(p).read() + entry)` — left `docs/mistakes/tooling-proofs.md`
holding only the new entry. 12 write-ups gone. Caught within seconds, but only
because `npm run mistakes:index` printed **207 entries** where the previous run
had printed 219, and that number was on screen to compare against.

**Cause.** Python evaluates the CALL's arguments before the call, so
`open(p,'w')` runs first and truncates the file to zero; the inner
`open(p).read()` then reads the empty file. The expression looks like
"read, then write" and executes as "truncate, then read".

**Fix.** Read into a variable first, assert it looks whole, then open for
writing:

```python
prev = open(p, encoding='utf-8').read()
assert len(prev) > 10000, 'refusing to append to a file that looks truncated'
open(p, 'w', encoding='utf-8').write(prev + entry)
```

**Where it lives now.** Recovered with `git checkout` — the only reason the loss
was cheap is that the file was committed.

**The general rule.** *A destructive open is not an argument, it is a
statement.* Any expression that both opens a file for writing and reads that
same file is a truncation, whatever the order looks like on the page. And the
generated COUNT that caught it is the real lesson: a tool that prints "219
entries" every run turns a silent deletion into a number that visibly moved —
which is worth more than the tool's actual job.

## A proof went red fifteen minutes after the app started working again

**Symptom.** `npm run proofs` reported `claude0167-monitoring-switch.sql ✗ FAIL
— 2 failed — A2 · stale sample (600 min) → NO weekly remainder is claimed`. It
had been green the day before, and nothing in the commit under test came within
a mile of the Claude module — the session had touched `pr_tickets` policies and
nothing else.

**Cause.** Not the code, and not the assertion. The INSTRUMENT.

`pg_temp.week_left(p_age)` puts one sample in the table at a chosen age and asks
`claude_free_now()` what the week has left. Its whole premise is that the row it
inserts is the newest one `claude_latest_sample()` can see — that function takes
the newest row in the table and *then* tests its age, so anything fresher
answers the question instead. The comment above it said exactly that, and said
it in the confident voice: *"the sample is deleted first, so the probe's row is
the newest by construction rather than by hoping — the real table holds four
days of rows whose sampled_at would otherwise be compared against."*

The delete was `where raw->>'proof' = 'claude0167'`. Its own rows. The real ones
were never touched.

That was invisible for exactly as long as the reporter was PAUSED. With no real
sample newer than about eleven hours, a deliberately 600-minute-old probe row
genuinely was the newest, and the proof measured the age rule it meant to
measure. The owner switched measurement back on at 17:18 UTC; the timer wrote a
fresh sample at 17:20 and every fifteen minutes after that. From then on the
newest row was a real one twelve minutes old, `claude_free_now()` believed it —
correctly — and A2 read `560.0` where it wanted `NULL`.

**Fix.** Clear every sample inside the proof's own transaction, which is rolled
back like every other write in the file (`claude_usage_samples` carries no
triggers — checked before the change, and the 585 real rows were counted again
after). Then A0, which asserts the premise instead of asserting it in prose:
after a probe call there is exactly one sample in the table and it is the
probe's.

**A0 needed a second pass, and that is its own lesson.** Written as one
statement — `... from (select pg_temp.week_left(5)) warm` — it reported `585
rows, probe=none`. A volatile function's writes are not visible to the rest of
the statement that called it, so the count saw the table as it stood *before*
the delete. A control that measures the wrong instant is not a control. The
warm-up call is now its own statement.

Falsified by restoring the scoped delete: A0, A2 and A4 all go red together.

**Where it lives now.** `tools/claude0167-monitoring-switch.sql` — the delete,
the ⚠️ paragraph on the instrument, and §A0.

**The general rule.** This file already carries *"its SCENARIO needs live
geometry that RAN OUT"* — two rail proofs that searched the remainder of the
quota week for a slot and errored once the week was nearly over. This is the
same class from the other side: **a scenario can depend on the ABSENCE of
something just as silently as on the presence of it**, and absence is the harder
one to notice, because the proof is green while the system is broken and goes
red when the system recovers. Ask of every proof: *what is this quietly assuming
the environment will not do?* Here the answer was "write a row", which is the
one thing the feature exists to do.

And the tell was in the comment all along. **A comment that says a thing is true
"by construction rather than by hoping" is a claim, and a claim in a comment is
the shape this repo keeps paying for.** If it is by construction, the
construction can assert it — that is what A0 is.

## STATE.md said a proof was red that had been green for a day — in three places

**Symptom.** Asked to "check the handoff until you find no error", an audit of
`STATE.md` turned up **six** stale claims in a file whose entire value is being
true. Five shared one shape, and it is the shape that matters:

> the same fact lived in TWO OR MORE places, and only ONE was corrected.

| claim | where it was still wrong | reality |
|---|---|---|
| context budget "29,725 / 30,000, 275 bytes of headroom — the next write-up may turn `npm test` red" | one paragraph, ~400 lines below a paragraph saying that exact claim was false and had been deleted | 16,712 / 30,000 (56%) |
| "`claude0157` B4 is red" | three separate places | green since 2026-08-25 |
| test count | 1309 · 1170 · 1312, three homes | 1312 |
| "still owed: grant the `claude` permission" | top of the file | granted; the bottom of the same file said so |
| deployed sha | `543a025` | prod was two deploys ahead |
| head-counts (146 accounts / 41 masters) | two homes, one updated | 153 / 42 |

**Cause.** Not carelessness in any single edit. Each correction was made
*correctly* — in the place the author happened to be reading. `STATE.md` is
~1,350 lines, and a fact acquired a second home the moment a session summarised
it in its own block while an older block still stated it. Nothing connected the
two, so a correction landed in one and the other went on asserting the opposite.

**Why it costs more than being silent.** A file that contradicts itself cannot
be partially trusted: the reader has no way to tell which half is current, so
they re-derive the work anyway — which is the single thing the handoff exists to
prevent. The `543a025` line is the sharpest case. A stale deployed sha reads
*exactly* like "there is a deploy owed", and disproving it costs a VPN session
and 90 seconds. It is not a missing fact; it is a fact pointing the wrong way.

**Fix.** `src/js/state-handoff.test.js`, five assertions, each falsified:

- every repo-relative path `STATE.md` names resolves (or is exempted with a
  written reason — served bundle hashes and filename PATTERNS are named as
  evidence, not as files, and are excluded by requiring a `/`);
- "Migrations through NNNN" matches the highest migration on disk;
- the claimed live-proof count matches what `run-proofs.mjs` registers
  (minus `db-query.mjs`, which is the runner, not a proof);
- **every** spelling of each of those must agree — the check runs over all
  matches, not the first;
- the file may state exactly one test count.

It found a third home of the test count on its first run, in a paragraph that
had also been carrying "migrations through 0166" and "21 of 22 proofs green"
for a week.

**Where it lives now.** `src/js/state-handoff.test.js`; `STATE.md`'s example
paragraph now carries ⛔ *do not read counts out of this paragraph*, and says
the live numbers live in exactly one place.

**The general rule.** This is the repo's class 6 — *two implementations of one
rule drift* — with prose as the implementation, and it is easier to walk into
than the code version, because a document has no compiler and every sentence
looks equally authoritative. Two habits, in order of value:

1. ⛔ **When you correct a claim, grep the whole file for its other homes before
   you commit.** Every one of the five was a single grep away.
2. **Give a decaying fact exactly one home, and make the other places point at
   it rather than repeat it.** A number in a narrative block is a copy that will
   never be updated, because nobody re-reads a session summary to check its
   arithmetic. The durable half of an old block is the LESSON; the counts in it
   are already wrong.

And the reason a test is the third fix here: this had been paid for at least
three times before — "this line said `543a025` for a day", "two sessions
repeated the locked-out claim", "it said measurement was OFF after it had been
turned back on" — each time diagnosed correctly, written down, and repeated
anyway.

## `which pg_dump` said it was not installed, and it had been installed all along

**Symptom (as recorded in the plan).** *"`pg_dump`, `psql` and the `supabase`
CLI are **all absent** from this machine — `which` finds none of them."* On the
strength of that line, three phases of `docs/TEAM-WORKFLOW.md` were marked
blocked on "install a PostgreSQL 17 client", and a note was written telling the
next session to `brew install libpq` before planning around it.

**Cause.** `which` searches `PATH`. **Homebrew's `libpq` is keg-only** — it is
installed under `/opt/homebrew/opt/libpq/bin` and deliberately NOT linked into
`PATH`, because its binaries collide with the ones a full `postgresql` formula
would install. So `which` was answering a question about `PATH` and the answer
was read as a statement about the disk. Measured 2026-08-27:
`brew list --versions libpq` → `libpq 18.4`, and
`/opt/homebrew/opt/libpq/bin/pg_dump --version` → `pg_dump (PostgreSQL) 18.4`.
It had been there the whole time.

There was a second, smaller error stacked on the first: the plan reasoned that a
client older than the 17.6 server would refuse, and concluded "install 17". The
refusal is one-directional — `pg_dump` refuses to dump a server *newer* than
itself, and a newer client dumping an older server is the supported case. 18.4
against 17.6 was always fine.

**Fix.** Use the full path, or `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`.
`docs/TEAM-WORKFLOW.md` §7.1 now records the correction, and phase 1 is blocked
on the database password alone.

**Where it lives now.** `docs/TEAM-WORKFLOW.md` §7.1.

**The general rule.** *Class 7 — check that the INSTRUMENT can see the thing.*
A negative result is a statement about what the instrument searched, never about
what exists. `which` searches `PATH`; `grep` searches the file you gave it (not
the shared chunk the code actually landed in); a minified bundle has no
module-scope names to find. **Before believing a zero, ask what the tool looked
at, and check it against a subject you KNOW is there** — here, one
`brew list --versions` would have cost five seconds and saved a day of the plan
being wrong about its own blockers.
