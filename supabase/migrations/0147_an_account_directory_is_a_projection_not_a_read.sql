-- ============================================================================
-- 0147 — `public.users` stops being a directory every signed-in account can dump.
--
-- SYMPTOM (found by a live authz sweep, not by a user report). Any authenticated
-- session — an ordinary first-year with no grants at all, no ทีม SAMO posting, no
-- permission key — could `select * from public.users` and get the whole table.
-- Measured live, impersonating a real account picked on BOTH grant columns
-- (`permissions` AND `managed_permissions` empty, `role = 'user'`), inside a
-- rolled-back transaction:
--
--     rows_visible 531 · with_email 531 · with_phone 7 · distinct roles 8
--     accounts carrying permissions 4 · other accounts' emails readable 530
--
-- TWO HARMS, and the second is the worse one. (a) It is a dump of every account's
-- email address and the phone numbers that are set. (b) `role` and `permissions`
-- sit in the SAME ROW, so the dump is also a reconnaissance map: it names which
-- accounts hold `master`, `dev`, `vp_admin`. An attacker who wants a privileged
-- account no longer has to guess which one to go after.
--
-- CAUSE. 0001 wrote:
--
--     create policy "users_read_all" on public.users
--       for select using (auth.role() = 'authenticated');
--
-- with the comment "needed for staff dashboards to show submitter info". That
-- justification stopped being true a long time ago and nobody re-read the policy.
-- Staff dashboards do not join `users` at all: a PR/VS ticket DENORMALISES its
-- submitter onto its own row at submit time (`vs-form.js` writes `display_name` /
-- the submitter label from `authGetUser()`, i.e. the caller's OWN identity). The
-- policy was load-bearing for a design that no longer exists.
--
-- This is the repo's own rule, applied to the one table that predates it:
-- *"Publishing a table-backed directory must be a PROJECTION, never a public
-- SELECT policy"* — docs/mistakes/authz-rls.md.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS SAFE TO TIGHTEN — the two things that were checked FIRST, live.
-- ---------------------------------------------------------------------------
-- The danger with narrowing a SELECT policy is never the table itself. It is
-- 0138's shape: some OTHER policy inline-subqueries this table, that subquery is
-- evaluated with the CALLER's rights, and tightening here silently empties it —
-- turning a working guard into a vacuous one, or a working feature into a denial,
-- with no error anywhere. 0110's own comment predicted this in writing:
--
--   "An inline `(select email from public.users where id = auth.uid())` inside a
--    policy is evaluated under the CALLER's rights, so it works today only
--    because `users_read_all` happens to be `auth.role() = 'authenticated'`.
--    Anyone tightening that policy later would silently empty this one."
--
-- So both halves were verified against the LIVE catalog, with a control proving
-- the instrument could actually find things (a sweep that returns nothing is not
-- evidence of nothing — mistakes.md class 7):
--
--   * 109 policies exist in `public`. 5 of them contain an inline subquery, and
--     the probe PRINTED all five (project_files, shop_order_items ×2,
--     shop_pickup_records, vs_tickets) — that is the control. ZERO of the 109
--     name `users`. Every cross-table lookup in a predicate already goes through
--     a `current_user_*` SECURITY DEFINER helper, exactly as 0110 prescribed.
--   * ZERO SECURITY INVOKER functions read `public.users`; the 23 that do are all
--     DEFINER (again, count printed as the control). Zero views exist in `public`
--     at all, so there is no `security_invoker` view hazard either.
--
-- So nothing else in the schema resolves an identity by reading this table with
-- the caller's rights. Narrowing it cannot fail-CLOSE anything.
--
-- ---------------------------------------------------------------------------
-- THE CLIENT SIDE — one path, and it was already legacy.
-- ---------------------------------------------------------------------------
-- Exactly ONE place in the app read across users: `listUsersByRole()` in
-- `src/js/projects/api.js`. Every other read is `/users?id=eq.<self>` (the auth
-- profile fetch and four self-PATCHes). And `listUsersByRole` was already dead
-- weight — a FALLBACK behind two SECURITY DEFINER RPCs that superseded it:
--
--   * `list_project_profs()`      (0086) — id + display_name, no email
--   * `list_project_seat_users()` (0092) — id + display_name, no email
--
-- Both were written *precisely because* a role-only table read "can never see a
-- tree-granted อาจารย์" and because "a professor's address is not the sender's to
-- read" (their own comments). The fallback existed only to survive the deploy
-- window in which the RPCs did not yet exist. That window closed in 2026-07.
-- It is deleted in this same commit — a fallback that reads the table we are
-- closing is not a fallback, it is the hole with a longer name.
--
-- NOTE ON `return=representation`. The four self-PATCHes in `auth.js` all use it,
-- and PostgREST re-applies the SELECT policy to the returned row. They keep
-- working: the row they update is the caller's own, which the new policy still
-- shows. Each already checks `data.length === 0` and reports "(RLS)", so if this
-- were ever wrong it would say so out loud rather than drift.
--
-- NO STAFF BRANCH IS ADDED. It would be the "scoped is not full" class in
-- reverse: an `or current_user_is_staff()` arm would restore the full-table read
-- for eight roles to serve zero call sites. If an admin screen ever needs a
-- directory, it gets a projection RPC — like the two above.
--
-- PROOF: `tools/authz-sweep-identity.sql`, landed with this migration and now a
-- regression guard. Both directions: every DENY is paired with an ALLOW over the
-- same rows, and it distinguishes "denied by RLS (0 rows)" from "denied by a
-- missing GRANT (42501)", because a GRANT-less table denies everyone and reads
-- exactly like the policy working (0138).
-- ============================================================================

-- Postgres has no `create or replace policy` (mistakes.md — partial replays
-- 42710 out), so drop-then-create, guarded.
drop policy if exists "users_read_all" on public.users;
drop policy if exists "users_read_self" on public.users;

create policy "users_read_self" on public.users
  for select using (id = auth.uid());

comment on table public.users is
  'Account rows. SELECT is SELF-ONLY (0147). Anything that needs to resolve '
  'OTHER people must go through a SECURITY DEFINER projection that returns only '
  'the columns that audience may see — list_project_profs(), '
  'list_project_seat_users(), search_people(). Never re-open this to a role list: '
  'role and permissions live in the same row, so a full read is a map of which '
  'accounts hold master/dev/vp_admin.';
