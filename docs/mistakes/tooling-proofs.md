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
