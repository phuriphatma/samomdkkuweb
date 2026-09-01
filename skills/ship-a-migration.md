# Shipping a schema change on this repo

The loop below was run seven times in one session (0128–0134). Doing it out of
order took production down for ~20 minutes.

## The order, and it is not negotiable

1. **Read the LIVE function body first**, never the migration that defined it:
   `pg_get_functiondef` via `node tools/db-query.mjs`. A later migration has
   almost always changed it, and rebuilding from the original silently reverts
   everything since.
2. **Write the migration** in `supabase/migrations/NNNN_*.sql`, header first:
   what was reported, what the cause was, why THIS shape.
3. **Apply**: `node tools/apply-migration.mjs supabase/migrations/NNNN_*.sql`.
4. **Prove it live, BOTH directions** — a new `tools/*.mjs` in the shape of
   `house0132-registry.mjs`: a transaction that ROLLS BACK, an ALLOW half and a
   DENY half. A probe that can only print "denied" cannot tell a working guard
   from a broken connection.
5. **`npm run build && npm test`**, then commit, push `main`.
6. **Deploy**: `skills/deploy-vm.md` (which holds the measured duration — do
   not restate it here). **Batch commits — do not deploy
   per commit.**
7. **Verify from the SERVED artifact**, never the local file:
   `curl https://samo.md.kku.ac.th/assets/<bundle>.js | grep -c <marker>`.
   The VM builds its own hashes, so find the name from the served HTML.

## ADD is safe in either order. DROP is not.

Old code does not ask for a column you just added — but it IS still asking for
one you just dropped, and **PostgREST 400s the whole query on an unknown
column**. So:

- **adding** → apply, then deploy.
- **dropping** → deploy the code that stopped reading it, CONFIRM it is the
  version being served, and only then drop.

That is the ordering 0129 got backwards.

## Traps this loop exists to avoid

- **A write and the check that reads it back must be SEPARATE statements**, or
  the subquery sees a pre-write snapshot and the proof reports a false failure.
- **Pick the probe subject on BOTH grant columns.** `current_user_has_permission()`
  reads `permissions` ∪ `managed_permissions` (0081); an account with empty
  `permissions` may hold `master` through the ทีม SAMO tree and will look exactly
  like a fail-open policy.
- **`tools/db-query.mjs` COMMITS.** Wrap anything mutating in
  `begin; … rollback;`.
- **A proof that fails for the wrong reason gets explained away**, and then it
  protects nothing. Fix the probe, do not lower the bar.
