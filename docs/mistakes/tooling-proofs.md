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

