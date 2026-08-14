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
