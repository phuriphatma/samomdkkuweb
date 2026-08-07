# Mistakes — Migrations, DDL, triggers & constraints

What Postgres refuses to do in place, and which guards fire in contexts you did not write them for.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## Postgres has no `create or replace policy` — partial-replay migrations 42710 out

**Symptom**: User runs an RLS-adding migration once. Later runs the
same file again (re-applying after a tweak elsewhere, or the SQL editor
double-fires). Postgres errors:
`ERROR: 42710: policy "policy_name" for table "x" already exists`
and the script aborts BEFORE any grants / data fixes below it.
**Cause**: `create policy` has no `or replace` variant in Postgres
(through at least 16). `create table if not exists` and `create index
if not exists` ARE idempotent and lull migration authors into a false
sense of safety.
**Fix**: Wrap every `create policy` with `drop policy if exists`:
```sql
drop policy if exists "policy_name" on schema.table;
create policy "policy_name" on schema.table for select using (...);
```
Apply to every RLS policy in every new migration. The drop is a no-op
on first run; it makes the re-run case clean.
**Where**: First seen in
`supabase/migrations/0031_project_doc_views.sql`. Pattern to use in
any future migration that adds RLS policies. (Migrations 0001, 0013,
0014, etc. predate this rule — leave them; they're applied and not
re-run.)

---

---

## A self-update column guard silently bricks EVERY new signup when it blocks a column another trigger legitimately writes

**Symptom**: Brand-new Google sign-in fails. The Supabase OAuth callback
(`/auth/v1/callback?...`) 302-redirects back to the app with
`error_code=unexpected_failure` +
`error_description=Database+error+saving+new+user`. Existing users log
in fine; only first-time signups fail. The same failure bricks the
profile-modal "set password" flow. Looks like an OAuth/redirect-config
problem; it isn't.
**Cause**: Two triggers fire on user creation and they fight:
- 0027 `handle_auth_user_password_sync` (AFTER INSERT / AFTER UPDATE OF
  `encrypted_password` on `auth.users`) UPDATEs `public.users.has_password`
  to mirror "does this auth user have a password".
- 0028 `users_self_update_guard` (BEFORE UPDATE on `public.users`) RAISES
  if a non-staff caller changes a privileged column — including
  `has_password` ("server-managed").
During a GoTrue signup the sync trigger's UPDATE runs with
`auth.uid() = NULL`, so `current_user_is_staff()` is false, so the guard
takes its `has_password` branch and aborts the whole signup transaction.
The guard cannot distinguish the legitimate server-side sync trigger from
a malicious client PATCH — both execute in a non-staff context.
**How it was confirmed**: `POST /auth/v1/admin/users` (with the service
role, with OR without a password) reproduces it exactly:
`P0001 users_self_update_guard: has_password is server-managed`, HTTP 500,
no row created. The admin API fires the same triggers as a real OAuth
signup, so it's a faithful, reversible repro (delete the test user after,
or nothing is created when it fails).
**Fix**: 0041 redefines the guard so the `has_password` change is allowed
when it AGREES with the authoritative `auth.users.encrypted_password`
state (sync trigger always writes the correct mirror value → passes; a
client trying to set a contradicting value → still blocked; setting the
already-correct value → harmless no-op). All other guarded columns
(id/role/permissions/method/username-once) unchanged.
**Where**: `supabase/migrations/0041_fix_has_password_guard_blocks_signup.sql`.
**Pattern to never repeat**: before adding a `raise`-on-change column guard
keyed on `current_user_is_staff()` / `auth.uid()`, list EVERY other trigger
that writes that column. Any server-managed column written by another
trigger will be writing under a NULL `auth.uid()` during signup and will
trip the guard, taking the whole transaction down. Guard against the
*client write path*, not the *value* — gate on agreement with the source
of truth (or a transaction-local bypass flag set by the server writer),
never on the staff context alone.

---

---

## Service-role seed can't UPDATE `role`/`permissions` — `users_self_update_guard` fires for the service role too (auth.uid()=null → not staff)

**Symptom**: A provisioning script (e.g. `tools/vp-accounts.mjs`,
`tools/president-account.mjs`) creates the auth user fine, then
`supabase.from('users').update({ role: 'dev', ... }).eq('id', uid)` with the
**service_role** key fails:
`users_self_update_guard: role can only be changed by staff`.
**Cause**: RLS is bypassed for `service_role`, but **triggers still fire**.
`users_self_update_guard` (0028/0041, BEFORE UPDATE on `public.users`) lets
only staff change privileged columns (`role`, `permissions`, `method`,
`has_password`, locked `username`). "Staff" = `current_user_is_staff()` →
`current_user_role()` → row for `auth.uid()`. The service-role JWT has no
`sub`, so `auth.uid()` is null → no row → not staff → guard raises. (Same
shape as the 0041 signup-brick bug: server contexts run with null
`auth.uid()`.)
**Fix**: The guard is **BEFORE UPDATE only — there is no INSERT guard** on
`public.users`. Re-seed the row instead of updating it: `select *` the
existing row, `delete` it, `insert` it back with `role`/`department` changed.
Service role bypasses RLS for both delete and insert; the auto-created row is
safe to replace for a brand-new account (nothing FK-references it yet). Done
in `tools/president-account.mjs seed`. **`vp-accounts.mjs` still does a plain
`.update({role})` and will hit this same block if re-run today** — port the
select→delete→insert fallback there if you re-provision VPs. (Alternatives if
the row already has dependents: a SECURITY DEFINER RPC granted to
service_role, or set the role in the Supabase SQL editor — both need SQL
access this repo's `.env.local` doesn't carry.)
**Where**: `tools/president-account.mjs`; guard in
`supabase/migrations/0028` + `0041`.
**Best method for an EXISTING row with FK dependents** (e.g. granting an
already-provisioned staff account a new `permissions[]` value — done
2026-07-22 to add `'samoshop'` to `samomdkkumdi`): do NOT delete+insert —
that row is FK-referenced (created content, actions, etc.) and the delete
either cascades data away or fails on RESTRICT. Instead disable the guard
for one atomic UPDATE via `tools/apply-migration.mjs` (runs as Postgres
superuser over the Management API `database/query` endpoint):
```sql
alter table public.users disable trigger users_self_update_guard;
update public.users set permissions = array_append(coalesce(permissions,'{}'),'samoshop')
 where username = 'samomdkkumdi' and not ('samoshop' = any(coalesce(permissions,'{}')));
alter table public.users enable trigger users_self_update_guard;
```
Safe because: the endpoint runs a multi-statement string as ONE implicit
transaction (simple-query protocol), so a failing UPDATE rolls back the
DISABLE too (trigger stays enabled); and `ALTER TABLE … DISABLE TRIGGER`
takes a transaction-scoped ACCESS EXCLUSIVE lock, so no other session ever
observes the guard disabled. Verify `tgenabled='O'` (enabled) on
`pg_trigger` afterward. Prefer this over delete+insert for any established
`public.users` row.

---

---

## `create or replace function` CANNOT change the return type — drop it first

**Symptom**: A migration that evolves an existing RPC's return type (e.g. 0082
changing `sync_my_team_permissions()` from `returns text[]` to `returns jsonb`)
fails on apply with `42P13: cannot change return type of existing function` /
`HINT: Use DROP FUNCTION ... first`. The whole file rolls back (Management-API
runs it as one txn), so nothing lands — safe, but confusing if you expected the
columns above it to persist.
**Cause**: `create or replace function` may change the body but NOT the
signature's return type (nor arg types). Postgres refuses in-place.
**Fix**: `drop function if exists public.fn(argtypes);` immediately before the
`create`. Re-`grant` after (the drop takes the grants with it). Watch for
callers depending on the old return shape during the deploy window — 0082's
frontend handles BOTH `text[]` (pre) and `{permissions,vs_depts}` (post) so an
old bundle against the new RPC still works. If other DB objects depend on the
function, `drop` will fail unless you recreate them too (or the return change is
what forces a coordinated migration).
**Where**: `supabase/migrations/0082_team_vs_dept_scope.sql`. Same family as the
"no create or replace policy" entry — some objects can't be replaced in place.

---

---

## A `NOT NULL` column with `ON DELETE SET NULL` is a latent contradiction — the FK cleanup fails at delete time and BLOCKS the parent delete

**Symptom**: A brand-new child table applies clean, all tests + isolation
checks pass, feature ships. The bug is invisible because nothing in normal
use / tests ever deletes a referenced PARENT row. Then one day deleting a
`public.users` row (or whatever the FK points at) errors with a NOT NULL
violation on a child table you weren't even thinking about — and the parent
delete is blocked entirely.
**Cause**: a column declared BOTH `not null` AND `references parent(id) on
delete set null`. The clauses contradict: when the parent is deleted Postgres
tries to SET the child FK column to NULL, but the column is NOT NULL → the
whole DELETE aborts. Seen in 0072: `vs_public_comments.author_user_id uuid
not null references public.users(id) on delete set null`. `create table if
not exists` will NOT fix it on a re-apply (the table already exists), so the
contradiction persists silently.
**Fix**: make the delete action consistent with the null-ability —
`on delete cascade` if the child can't exist without its parent (chosen here,
matches `vs_followers`), OR drop `not null` if you genuinely want
orphan-but-keep (`set null`). For a table already created by an earlier run,
re-point it idempotently:
`alter table X drop constraint if exists X_<col>_fkey;
 alter table X add constraint X_<col>_fkey foreign key (<col>) references
 parent(id) on delete cascade;` — then verify `pg_constraint.confdeltype='c'`
(c=cascade, n=set null, a=no action).
**Where**: `supabase/migrations/0072_vs_public_board.sql`. **Rule**: grep every
new migration for a column that is both `not null` and `on delete set null`
(or `set default` with no default) on the same FK — that pair is always a bug.

---

---

## Recreating a function from the migration that FIRST defined it silently reverts every later one

**Symptom**: `tools/vs0083-scope.mjs` went 15/16 immediately after applying an
unrelated feature migration — "board: reads staff-only comment on OWN dept"
failed with `is_handler=true, reads_own=false`. Nothing in the new migration
mentioned scopes or handlers.
**Cause**: 0096 needed to add an `updates` key to `get_public_vs_problem`, so it
was written by copying that function's body out of `0078_vs_staff_only_comments.sql`
and editing it. But the function had been redefined AGAIN in
`0084_vs_board_scoped_handler_is_staff.sql`, which added `v_scope
text[] := current_user_vs_scope()` and two comment-visibility branches. Copying
0078's body and `create or replace`-ing it dropped 0084's work — a clean apply,
no error, and the only signal was a proof script from three migrations ago.
`create or replace function` has no "are you sure you're editing the latest
version" check; the file you read is not necessarily the definition that is live.
**Fix**: before re-creating ANY existing function, diff against the LIVE body:
```sql
select pg_get_functiondef(p.oid) from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname='<fn>';
```
and/or `grep -ln "function public.<fn>" supabase/migrations/*.sql` to find every
file that defines it — the LAST one is the base to edit. 0096 also touched
`get_public_vs_board` (last defined 0078 ✔) and `get_vs_ticket_by_id` (last
defined 0080 ✔); only the one with a THIRD definition bit.
**Where**: `supabase/migrations/0096_vs_remark_visibility.sql` §5 (now carries a
"BASED ON 0084's BODY" note naming the trap).
**Rule**: the migrations directory is an append-only log, not a source tree —
the newest definition wins and older files are actively misleading. Re-run the
proof scripts for the FEATURE AREA after any function rewrite, not just for the
thing you were changing; that is the only thing that caught this.

---

---

## Hard-deleting a row referenced by an `ON DELETE RESTRICT` FK fails 23503 — degrade to archive, don't surface the raw error

**Symptom**: Admin SAMO Shop → ลบสินค้า on a product that has been ordered
→ "ลบไม่สำเร็จ: {"code":"23503", ... "shop_order_items_product_id_fkey" ...}".
The raw PostgREST error JSON is dumped into the toast.
**Cause**: `shop_order_items.product_id references shop_products(id) ON DELETE
RESTRICT` (0003 schema) — deliberately protects order history. Any product
that appears in even one order can never be hard-deleted; PostgREST returns
Postgres error 23503 (the FK guard makes the DELETE a clean no-op, so nothing
is half-deleted). `deleteProduct` rethrew `error.message` raw (which, via
`dbRest`, is the whole PostgREST JSON body string — that's why the toast
showed JSON).
**Fix**: `shop_products` already has `is_active` + a read policy
`using (is_active OR current_user_is_shop_admin())`, so archiving (set
`is_active = false`) hides a product from the shop while keeping it visible to
admin and preserving every order FK. Same write RLS as DELETE
(`shop_products_write_admin` `for all`), so no auth change and no soft-delete-
RLS trap. `deleteProduct` now detects 23503 / the FK name and throws a typed
`PRODUCT_HAS_ORDERS` error; the admin click-handler offers a confirm to
`archiveProduct()` instead.
**Where**: `src/js/shop/api.js` (`deleteProduct` typed error +
`archiveProduct`), `src/js/shop/admin.js` (delete handler fallback). **Latent
parallel**: `project_documents.type_id references project_doc_types(id) ON
DELETE RESTRICT` (0005) is the same class — no UI deletes doc types today, but
if one is added, apply the same detect-23503-then-archive/block pattern.

---

---

## Check constraint must be dropped BEFORE updating to a new enum value

**Symptom**: Running a migration that renames enum values fails with
`ERROR: new row for relation "X" violates check constraint "X_col_check"`
on the `UPDATE` statement itself — even though that UPDATE's whole job
is to move the values to the new set.
**Cause**: PostgreSQL evaluates check constraints on every row mutation.
If the migration UPDATEs to a value that's outside the OLD check, the
update fails before the new ALTER … ADD CHECK runs.
**Fix**: Always `ALTER TABLE … DROP CONSTRAINT IF EXISTS X_check` **before**
`UPDATE … SET col = new_value`, then `ALTER TABLE … ADD CONSTRAINT X_check
CHECK (col IN (new_set))` afterwards. Also broaden the UPDATE to
`WHERE col NOT IN (new_set)` so a re-run / unexpected legacy value
doesn't get left in an invalid state.
**Where**: `supabase/migrations/0007_shop_refactor.sql` for the shop
`source` enum (md/rt/mdi/sittikao). Apply this pattern to any future
enum-rename migration.

---

---

## (Passport) An `AFTER INSERT`-on-`auth.users` re-key trigger only fires for accounts that have NEVER logged into the project — pre-existing accounts silently don't get their carried data

**Symptom**: A gmail→kkumail migration test on `pmphuriphat→phuriphat.ma`
showed the receiving kkumail account with **no points/activities/stamps**,
even though the migration "moved" the data.
**Cause**: The merge relies on `passport_link_user_by_email()`, wired as
`on_auth_user_created_passport_link` **AFTER INSERT on auth.users** (0060/0063).
It re-keys a carried profile (matched by email) to the new auth uuid — but only
on the **INSERT** of the auth user, i.e. the account's **first-ever login** to
the project. `phuriphat.ma` already had an auth user (logged in months earlier),
so the trigger had already fired (finding nothing then) and will NOT fire again;
`ensureProfile()` matches by **uuid only** (not email), so it just creates an
empty profile. Data stranded on the old-uuid profile. **The real 5 are fine** —
verified none of their kkumail addresses had a pre-existing `auth.users` row, so
their first kkumail login WILL fire the re-key. The trap is only for a target
account that already exists.
**Fix / how to test such a case faithfully**: don't rely on the login trigger
for an already-existing target — do the re-key manually (move
`scans.user_id`/`season_results.user_id`/`profiles.id` old→new uuid), which is
exactly what the trigger would have done. Before any future re-key migration,
check `auth.users` for a pre-existing target row; if present, the trigger won't
fire and the profile must be merged/re-keyed explicitly.
**Where**: trigger in `0060`/`0063`; `ensureProfile` in passport `js/auth.js`;
verification + tracker queries recorded in STATE.md passport section.

---

---

## A PL/pgSQL `RETURNS TABLE(... col ...)` function silently ignores `ORDER BY col` — the OUT-param name shadows the query column, so it sorts by the NULL variable

**Symptom**: `find_similar_vs_tickets` (migration 0068) returned the right rows
but in the wrong order — "most similar" was NOT first. No error; the migration
applied clean (the bug only executes at call time, which needs a real staff JWT,
so it never showed during `apply-migration`).
**Cause**: the function is `returns table (... sim real)` and the body did
`return query select …, similarity(…) order by sim desc`. In PL/pgSQL every
`RETURNS TABLE` column is also an OUT **variable**. The final SELECT column is the
*expression* `similarity(…)` — it has no output name `sim` — so `order by sim`
does NOT bind to the query column; it binds to the OUT variable `sim`, which is
unset (NULL) at that point → `order by NULL` → no effective sort. Postgres does
not raise; it just doesn't sort.
**Fix**: order by the **explicit expression**, never the OUT-param name:
`order by …, similarity(regexp_replace(…), v_problem) desc`. (Alternatives:
rename the OUT column so it can't shadow, or `order by <position>`.)
**Where**: `supabase/migrations/0068_vs_dedup.sql` `find_similar_vs_tickets`.
Rule: in any `RETURNS TABLE` PL/pgSQL function, never `ORDER BY`/`WHERE` on an
OUT-param name that isn't an actual output alias of the query — use the
expression or a column position. Verify sort-dependent RPCs by executing them
(not just applying), since the shadowing is silent.

---

---

## A self-update column guard must exempt the definer FUNCTION that writes on login — `auth.uid() is null` only catches the TRIGGER shape

**Symptom**: 0110 added `team_members_self_update_guard` so a member may correct
their own ชื่อเล่น / รหัส / ชั้นปี / สาขา but never their own `permissions`. It
applied cleanly. The proof script then reported nine "PASS"es for the escalation
probes and nine EMPTY results everywhere else — and the empty results were the
real signal. The actual error:
```
P0001: team_members_self_update_guard: you may only edit your own name, …
CONTEXT: SQL statement "update public.team_members set user_id = v_uid
                         where lower(kkumail) = lower(v_email) …"
         PL/pgSQL function sync_my_team_permissions() line 27
```
`sync_my_team_permissions()` runs on EVERY login. The guard would have locked
every member without `team_edit` out of the app — precisely the people the
feature exists for.
**Cause**: this is the 0041 class ("a self-update column guard bricks signup when
it blocks a column another trigger legitimately writes") wearing a second shape,
and the test 0041 taught does not catch it. 0041's offending writer was a
TRIGGER firing during signup, where `auth.uid()` is null — so `if auth.uid() is
null then return new` exempted it. Here the writer is a SECURITY DEFINER
**function**, called BY the member, so `auth.uid()` is their own real uid and the
guard sees an ordinary self-update of a guarded column (`user_id`). Enumerating
"which triggers write this column?" — which I did — misses it completely; the
question is "which SERVER CODE writes this column, under whose identity?".
**Fix**: exempt on the signal the server writer sets about ITSELF, which 0081 had
already established for the recompute trigger:
```sql
if coalesce(current_setting('app.team_sync', true), '') = '1' then return new; end if;
if auth.uid() is null then return new; end if;   -- migrations, tools/*.mjs
```
A client cannot forge it: PostgREST exposes no `set_config`, and the setting is
transaction-local. Find every writer mechanically rather than from memory:
```sql
select proname, prosecdef,
       (pg_get_functiondef(oid) ~* 'set_config\(''app\.team_sync') as sets_flag
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.prokind='f'
   and pg_get_functiondef(oid) ~* '(update|insert into|delete from)\s+public\.<table>';
```
That turned up two here — `sync_my_team_permissions` (fixed) and
`team_person_mirror_down` (0108, unreachable by a non-editor today; noted in the
migration rather than silently ignored).
**Where**: `supabase/migrations/0110_team_view_edit_split.sql` §4; regression
check `tools/team0110-view-edit.mjs` "LOGIN PATH", which runs FIRST because the
harness itself calls sync — if it fails, nothing below it means anything.
**Rules**: (1) before adding a `raise`-on-change column guard, run the query
above and read every hit, asking under WHOSE identity it executes — "server
context" is not the same as "null `auth.uid()`". (2) A definer function called
by an ordinary user is indistinguishable from that user unless it says so;
prefer an explicit transaction-local flag over inferring intent from `auth.uid()`.
(3) The nine false PASSes are the other lesson: probes that only assert "denied"
scored a completely broken transaction as a working guard. Always include one
probe that must SUCCEED — the login-path check is what exposed this.

---

## A UNIQUE EXPRESSION index cannot serve `ON CONFLICT (col)` — the upsert 42P10s, so the whole import is dead on arrival

**Symptom**: Found by scanning before any data existed, so it was never
reported: every chunk of the ระบบบ้าน student import would have failed with
`42P10 there is no unique or exclusion constraint matching the ON CONFLICT
specification`. The feature was complete, tested, deployed — and could not
import a single row.

**Cause**: The uniqueness rule was written as an expression index, because
`A@kku` and `a@kku` are one person:

```sql
create unique index students_kkumail_uniq on students (lower(btrim(kkumail)));
```

The write path expressed the SAME rule differently: the importer upserts through
PostgREST with `?on_conflict=kkumail`, which renders `ON CONFLICT (kkumail)`.
That can only bind to a unique index on the BARE column — an expression index
does not match, and Postgres refuses the statement outright rather than falling
back.

Both halves were individually reasonable, which is what made it invisible: the
index is the right rule, and `on_conflict=kkumail` is the obvious way to spell
an upsert. It is the "two implementations of one rule drift" class where the two
implementations are *a constraint and the statement that depends on it*.

**Fix**: Normalise at the boundary instead of matching at every reader. A
`BEFORE INSERT OR UPDATE` trigger lowercases and trims `kkumail`, which makes a
plain `unique (kkumail)` exactly equivalent to the expression index — and gives
`ON CONFLICT (kkumail)` something to bind to. Verified live: `Scan@KKUmail.COM`
and `scan@kkumail.com` collapse to one row, stored lowercased, and the second
insert UPDATES rather than duplicating. Same treatment applied to
`advisors.email`, which had the identical shape and no upsert yet.

**Where it lives now**: `supabase/migrations/0119_students_kkumail_upsertable.sql`
(`normalize_kkumail()` + `students_kkumail_key`; `normalize_advisor_email()` +
`advisors_email_key`). `src/js/house/api.js` `upsertStudents()`.

**Rules**: (1) If anything upserts a table, the conflict target must be a plain
unique constraint on the named columns — check `?on_conflict=` against
`pg_constraint`, not against "there is a unique index somewhere". (2) Prefer
normalising a key on WRITE over case-folding it in every index, policy and
comparison; `get_my_student_record()` and every RLS helper compare
`lower(btrim(...))` precisely because the stored value could not be trusted.
(3) A feature that is built, tested and deployed can still be 100% non-functional
on its first real use — exercise the actual write path against the real schema
before calling it done.

---

## Seeding an OBSERVED range as if it were reference data — the FK then rejects every real row outside the guess

**Symptom**: Caught before the first import, so nobody hit it: `students.sai_code`
references `sais(code)`, and the migration seeded exactly 100 rows, `'001'`–`'100'`,
on the belief that there were 100 สายรหัส. The real range is any 3-digit value —
สาย are the running number within a year cohort, so how high they go is simply how
many students a year has. Every student on a สาย above 100 would have failed the
foreign key with 23503, killing the import partway through.

**Cause**: The seed encoded a *guess about the world* as a *constraint on the
data*. `sais` looked like reference data (a fixed vocabulary we own, like
`team_majors`), but it is not — it is an OBSERVATION of what the university
assigned, and the only authority for it is the file being imported. Reference
data can be seeded; observations cannot, because the seed is a prediction and
predictions about enrolment go stale silently.

The tell was there in the migration: it shipped with a `DO $$ … raise exception
if the mapping is not 10×10 $$` block. An assertion that the data has exactly the
shape you assumed is not a safety check — it is the assumption restated, and it
passed precisely because the seed had produced it.

**Fix**: `sais` became derived. `ensure_sais(text[])` — SECURITY DEFINER, but
re-checking the `house` permission because it writes — upserts every distinct
code the file contains, and the importer calls it *before* writing students. The
arbitrary seed was deleted, but only rows nothing referenced. No maximum is
written down anywhere now; the column check is just `^[0-9]{3}$`.

**Where it lives now**: `supabase/migrations/0121_sais_are_not_a_fixed_range.sql`,
`src/js/house/api.js` `ensureSais()`, `src/js/house/index.js` `runImport()`.
`fields.test.js` asserts the house split stays within one สาย of even over 100,
287, 300, 320, 450 and 999 — a property that holds at any size, rather than the
old test's "exactly ten each", which was only true for the seeded range.

**Rules**: (1) Before seeding a lookup table, ask whether you OWN the set or are
OBSERVING it. Owned sets (roles, permission keys, houses-per-digit) can be
seeded; observed ones (คน, สาย, anything the outside world assigns) must be
derived from the data. (2) A foreign key onto a seeded observation converts every
unforeseen real value into a hard failure — prefer creating the parent on
demand. (3) An assertion that reproduces your own seeding step proves nothing;
make the test range-independent so it can fail.

---

## Applying "create the parent on demand" at ONE call site instead of on the table — the other three writers still 23503

**Symptom** (reported): setting a student's สาย to `200` in the admin form failed
with `23503 … violates foreign key constraint "students_sai_code_fkey" — Key is
not present in table "sais"`.

**Cause**: 0121 had already made `sais` a derived set and its write-up ended with
the rule *"prefer creating the parent on demand"*. That rule was then applied in
exactly one place — the CSV importer, which calls `ensure_sais()` before writing
students. Three other paths write `students.sai_code` and none of them did: the
admin สมาชิก form, สายรหัส change-request approval, and any future writer.

Same geometry as class 4/5 (per-PATH, not per-table), except the thing enforced
at one call site is an invariant rather than an authorization check. Writing the
rule down in the migration that discovered it did not make the next writer obey
it — which is the whole reason this repo prefers a mechanism over a note.

**Fix**: a `BEFORE INSERT OR UPDATE OF sai_code` trigger on `students` that
creates the `sais` row if absent. The FK stays, so integrity is still enforced,
but it can no longer reject a *valid* สาย. Every path is covered including hand
SQL. The importer's bulk `ensure_sais()` call is kept as an optimisation (one
statement vs ~1,800 trigger firings), not as the mechanism.

Verified live, four directions: admin creating on unseen สาย 200 → OK (house 0);
admin moving to unseen 753 → OK (house 3); malformed `20` → REFUSED by the
trigger; and a STUDENT self-editing to a non-existent 888 → still REFUSED, since
`update_my_student_record()` validates before the UPDATE and a student guessing a
สาย is a typo, not a discovery.

**Where it lives now**: `supabase/migrations/0122_students_create_sai_on_demand.sql`.

**Rule**: when a fix is "materialise X on demand", put it on the TABLE (trigger /
default / generated column), not in the one caller you happened to be looking at.
Count the writers first — `grep` the column name.
