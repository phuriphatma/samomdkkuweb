# Mistakes — The permission / seat / scope channel (ทีม SAMO grants)

One narrative: `managed_permissions` grew beside the old role list, and every gate that still asked "what ROLE are you?" became a silent block. Read before adding an access channel, a scope dimension, or a seat.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## Adding a permission-based access channel leaves every ROLE-ONLY gate as a latent block — a role:'user' account with real granted perms gets bounced

**Symptom**: After 0081 made the SAMO Team tree grant real perms, a person
(`phuriphat.ma@kkumail.com`) whose tree membership gave them `pr` (+more) logged
into `/admin/` and got stuck at the sign-in gate — even though the DB row was
correct (`role='user'`, `managed_permissions=['creator','pr','projects','samoshop',
'team','vs']`, verified live). The PR tab never even rendered.
**Cause**: The admin ENTRY gate was role-only:
`const isStaff = STAFF_ROLES.includes(role); if (!isStaff) showAuthGate()`.
`STAFF_ROLES` is the fixed list of staff roles; a Google login is `role='user'`,
which isn't in it — so the gate bounced the account before `userCanAccess()` (which
IS permission-aware) ever ran. The per-section sidebar gating at
`userCanAccess(feature)` was already correct; the bug was the COARSE "are you allowed
in the building at all" check one level up, which still asked "is your ROLE staff?"
not "do you have ANY admin capability?". Same shape lurked in the `authReady.then()`
settle-check (`!STAFF_ROLES.includes(u.role)`) and the `?scan=` subscriber.
**Fix**: `canUseAdmin(user) = STAFF_ROLES.includes(role) || ADMIN_FEATURES.some(f =>
userCanAccess(f, user))` where `ADMIN_FEATURES = ['pr','vs','samoshop','projects',
'creator','team']`. Gate BOTH the onAuthChange handler and the authReady settle-check
on `canUseAdmin`, not the role list. Non-staff admin users get a 'ทีม SAMO' sidebar
label fallback.
**Where**: `src/js/admin-main.js` (`canUseAdmin`/`ADMIN_FEATURES`, the onAuthChange
gate, the authReady `.then`). **Rule**: when you introduce a permission channel that
can grant access to accounts OUTSIDE the existing role set (here: `managed_permissions`
on `role='user'` kkumail logins), grep for EVERY `ROLE.includes(role)` / `role === 'x'`
gate — each is a role-only chokepoint that silently ignores the new channel. Route the
coarse "can this account use the app at all" check through the same
permission-aware predicate the fine-grained gates use, never a hardcoded role list.

---

---

## A narrowing "scope" dimension added ALONGSIDE an unconditional full-access permission is DEAD — RLS ORs the branches, so the broad grant always wins

**Symptom**: A person granted VitalSound through the SAMO Team tree with a
per-ฝ่าย binding (0082 `team_nodes.vs_dept` → `users.managed_vs_depts`) logged
in with their kkumail and saw + managed EVERY department's tickets — not the
one dept they were bound to, unlike a real VP account (`samomdkkuvpa`). The
tree row, the resolver, `managed_vs_depts`, and the new RLS branch were all
verifiably correct, which is what makes this one hard to see.
**Cause**: 0082 added the dept scope as an ADDITIVE dimension parallel to the
`vs` permission, and the perm modal offered the two independently — a checkbox
grid ("VitalSound") plus an always-visible dept `<select>`. The admin did the
natural thing: ticked VitalSound (to grant VS at all) AND picked a dept. But
`vs` means FULL VS — `current_user_has_permission('vs')` is an unconditional
`true` branch in every VS policy, and permissive RLS policies are OR'd, so it
swallowed the narrower `target_dept = any(current_user_vs_depts())` branch.
Live proof: node `หัวหน้าฝ่าย IT` had `permissions={vs}` AND
`vs_dept='อุปนายกฝ่ายวิชาการ'` → `managed_permissions={pr,vs}` → full access.
Same family as "a per-recipient SELECT RLS is DEAD when a `using(true)` policy
already exists" — a broad OR-branch cannot be narrowed by adding a second one.
**Fix**: make the scope a PROPERTY OF THE GRANT, not a sibling of it. A row now
carries EITHER `vs` (all depts) OR a `vs_dept` (that dept only), never both:
the dept picker appears only after VitalSound is ticked (progressive
disclosure), and choosing a specific dept drops `vs` from `permissions[]` on
save (`readPermInputs()`). Migration 0083 normalises the rows written under the
old model (`array_remove(permissions,'vs') where vs_dept is not null`) and adds
`current_user_vs_scope()` — NULL = all depts, `{}` = no access, else the
allowed depts — so every VS surface asks ONE fail-closed predicate instead of
re-deriving `role in (...) or has_permission or vp_admin-dept` five ways.
**Where**: `supabase/migrations/0083_vs_scope_is_not_full.sql`,
`src/js/team/index.js` (`readPermInputs` / `syncVsScopeVisibility`),
`src/js/vs-staff.js` (`isVsSuper` / `vsScopeDepts`),
`tools/vs0083-scope.mjs` (10-check proof, run it after any VS RLS change).
**Rules**: (1) before adding a narrowing dimension to an authorization model,
grep the policies for an existing unconditional branch (`has_permission('x')`,
`using(true)`, a role list) — if one exists, your new branch is decorative
until the broad grant is made mutually exclusive with it. (2) A UI that lets an
admin select both a broad grant and a narrow scope INDEPENDENTLY will be used
that way; encode the exclusivity in the form, not in a doc comment.
(3) The second half of this fix is the boring half: a scoped principal needs
the SAME dept-scoped abilities everywhere the existing narrow role has them
(tags, dedup search/merge/unmerge, soft-delete, moderation) or every button
throws "not authorized" — grep for each `= current_user_dept()` site.

---

---

## The privilege-ESCALATING option must never be a select's default — "ทุกแผนก" at index 0 silently granted full VitalSound on every save

**Symptom**: minutes after the 0083 UI shipped, the same team node kept coming
back as `permissions={vs}, vs_dept=null` (full VS) even though the admin's
stated intent was a per-ฝ่าย scope. Looked like the fix had not deployed, or
like a string-encoding mismatch stopping the `<select>` from preselecting the
stored dept. It was neither — a byte-compare of all 12 dept values against
`vs_tickets.target_dept` matched exactly, and the deployed bundle was correct.
**Cause**: the new scope select was built as
`<option value="">ทุกแผนก</option>` + one option per dept. The empty value —
i.e. the browser's default selection for a fresh grant — WAS the widest
possible grant. So ticking "VitalSound" and pressing บันทึก without ever
touching the scope picker handed over every department's confidential tickets.
The one interaction an admin is most likely to perform (tick the box, save)
produced the most dangerous outcome, silently.
**Fix**: split "nothing chosen" from "all departments". `""` is now
`— เลือกขอบเขต —` and saving with it blocks with a Thai message;
`__all__` (`VS_SCOPE_ALL`) is the explicit full grant and additionally
requires a `confirm()` naming the consequence. A node/member that already
carries `vs` preselects `__all__`, so editing an existing full grant is
unchanged. Same principle as the vs_categories confidential-toggle entry
above: guard the direction that REMOVES protection, not the safe one.
**Where**: `src/js/team/index.js` (`VS_SCOPE_ALL`, `fillVsScopeSelect`,
`readPermInputs` returning null, `readPermInputsOrWarn`).
**Rule**: in any picker where one option is broader/more destructive than the
others, index 0 must be a non-choice ("— เลือก… —") and the broad option must
be selected deliberately. Never let "the user didn't touch this control" and
"the user asked for maximum privilege" be the same input value. Corollary for
debugging: when live data keeps reverting to a wide setting, suspect the
form's default before suspecting the write path.

---

---

## A capability key is not a ROLE — granting flat `projects` produced a tab with no controls, because the app branches on `user.role`, not on the permission

**Symptom**: the obvious way to let a person use หนังสือโครงการ via the SAMO
Team tree — tick "หนังสือโครงการ" in จัดการสิทธิ์ — opens the tab for them and
then does nothing useful. No ส่งหนังสือ button, no รับเรื่อง controls, no role
hint, and every write is refused. Looks like the grant didn't apply; the grant
is fine.
**Cause**: `projects` is one permission key but THREE workflows
(`vp_admin` = ส่งหนังสือ, `uni_staff` = รับเรื่อง/อัปเดต, `sa_prof` = ลงนาม).
`src/js/projects/index.js` does `currentRole = user.role` and every control,
hint, scope filter and notification branch keys off that string; a tree
grantee is `role='user'`, which matches no branch. Server-side the same shape:
`current_user_is_project_actor()` was the hardcoded list
`role in ('vp_admin','uni_staff','dev')`. So the permission opened the door to
a room with no furniture. Two further role-only chokepoints hid behind it:
`current_user_is_prof()` (`role = 'sa_prof'`) gated every professor policy, and
`sign.js` addressed the signature request with
`listUsersByRole('sa_prof')[0]` — a role query that can never see a tree-granted
อาจารย์ AND silently assumed exactly one professor exists.
**Fix**: give the grant a SEAT — `team_nodes/team_members.project_seat ∈
(vpa|staff|prof)` → `users.managed_project_seats[]` →
`current_user_project_seats()` (0086), mirroring how `vs_dept` scoped
VitalSound. Widen the two role-only helpers at their single definition each so
every policy that calls them picks seats up for free, and resolve the seat to a
role ONCE in the frontend (`projectSeatRole()`) so the ~40 `role === '…'`
branches keep working untouched. The seat picker is required whenever the perm
is ticked — a `projects` grant with no seat is refused at save time rather than
shipped as a dead tab. `prof` is deliberately NOT an actor (a professor who
became one would see every project instead of only what was sent to them).
**Where**: `supabase/migrations/0086_team_project_seats.sql`,
`src/js/projects/index.js` (`projectSeatRole`), `src/js/projects/api.js`
(`listProjectProfs`), `src/js/projects/sign.js`, `src/js/team/index.js`.
Proof: `tools/proj0086-seats.mjs` (18 checks incl. the prof-is-not-an-actor
negative).
**Rule**: before exposing a feature through a flat permission key, grep the
module for `user.role` / `role === `. If the UI or RLS branches on role rather
than on the permission, the permission alone is NOT a working grant — either
add the missing dimension (a seat/scope) or the grant is decorative. Same
family as the VS "scope added next to an unconditional permission" entry: a new
access channel must be threaded through EVERY gate the old channel used, not
just the one you were looking at.

---

---

## When a SCOPED grant deliberately drops its blanket permission key, every reader of that key must learn the second signal — or re-opening the editor wipes the grant

**Symptom** (caught in a bug scan, before it reached a user): a person or node
granted SAMO Passport **scoped to one department** shows the "SAMO Passport"
checkbox UNTICKED when the จัดการสิทธิ์ modal is re-opened, with the scope block
hidden. Nothing looks broken — until the admin saves that modal for any
unrelated reason (adding `pr`, flipping inherit), at which point
`passport_dept_id` is written back as `null` and the grant is **silently
destroyed**. The row still exists, so nothing errors.
**Cause**: 0083/0087 make scoped and full mutually exclusive — a scoped grant
stores the binding (`vs_dept` / `passport_dept_id`) and NO blanket key in
`permissions[]`, because the blanket key is an unconditional OR-branch in RLS
that would swallow the narrower check. That is correct. But the modal restored
its checkboxes from `permissions[]` alone, with a hand-written special case for
exactly one key:
```js
cb.checked = cb.value === 'vs' ? vsOn : own.has(cb.value);   // ← 'passport' missing
```
The `vs` case had been patched when VS gained its scope; adding a SECOND scoped
permission re-introduced the same bug for the new key. The read path and the
write path disagreed about what "granted" means.
**Fix**: one predicate both modals share — `permTicked(key, own, row)` — that
knows every key whose grant can be expressed as a binding instead of a
permission. New scoped permissions extend that function rather than adding
another ternary. Regression-tested in `src/js/team/perm-ticked.test.js`,
including `passport_dept_id: 0` (a real id must not read as falsy).
**Where**: `src/js/team/index.js` `permTicked` + both `open*PermModal`.
**Rule**: any time you make a grant's storage POLYMORPHIC — "either this key or
that binding" — grep for every place that answers "is this granted?" and route
them all through one shared predicate the same commit. A read that knows only
the old representation does not fail loudly; it reports "not granted", and the
next write makes that true.

---

---

## The permission that manages the grant engine was the one the grant engine didn't honour — and a helper test is not a permission test

**Symptom** (reported live): the ทีม SAMO permission was granted to
`phuriphat.ma@kkumail.com` through the tree. Signed in as that account, EVERY
tree edit failed with "บันทึกไม่สำเร็จ (สิทธิ์ไม่พอ)" — which also made granting
เขียนประกาศ to someone fail, so it read as two separate bugs. It was one: the
account could not write the tree at all, so no grant could be issued from it.
**Cause**: 0046 gated `team_nodes` / `team_members` on ROLE only —
`current_user_role() = any(array['vp_admin','dev'])` — with no
`current_user_has_permission('team')` branch. When 0081 introduced
`managed_permissions`, every OTHER feature's policy was updated (announcements
honours `creator`, `pr_agents` and `pr_tickets` honour `pr`,
`current_user_is_shop_admin()` honours `samoshop`) — the team tables were
missed. The UI honoured it (`userCanAccess('team')`, `ADMIN_FEATURES`), so the
section rendered and only writes died. Third instance of the same class this
cycle.
**A second one fell out of the same sweep**: `projects_insert` /
`projects_delete` / `project_documents_insert` / `project_documents_delete`
never called `current_user_is_project_actor()` and stayed role-only, so the
0086 `vpa` seat could UPDATE a project but not CREATE one — the single thing
ผู้ส่งหนังสือ exists to do. `proj0086-seats.mjs` missed it because it asserted
`current_user_is_project_actor()` returned true rather than performing a real
INSERT. **A predicate test is not a permission test**: the helper can be right
while the policy that was supposed to call it never does. The script now does
the INSERT (allowed for `vpa`, refused for `prof` and for no seat).
**Fix**: 0089 adds the `team` permission branch to both team-table policies;
0090 adds the `vpa` seat to the four project write policies — deliberately
alongside the existing role list rather than switching to the actor helper,
because that helper also admits `uni_staff`, who must not create projects.
**Where**: `supabase/migrations/0089_*`, `0090_*`; proofs
`tools/team0089-manage.mjs` (5) and the extended `tools/proj0086-seats.mjs` (21).
**Rules**: (1) after adding an access channel, enumerate EVERY table the
feature writes and check each policy names the channel — a UI gate that honours
it will hide the gap until someone tries to save. (2) Test the OPERATION, not
the predicate. (3) Watch for the recursive case: the permission governing the
permission system is the easiest one to forget, because you are usually holding
a role that already works.
**Third layer, same sweep (0091)**: the notify fan-out resolved every audience
by role — `listUsersByRole('uni_staff'|'vp_admin'|'sa_prof')` — so a seat holder
could be sent a หนังสือ, act on it, and never get a single in-app notification.
This is the quietest failure of the three: the workflow works, the bell is just
empty, and nobody reports a notification they never knew to expect. Replaced by
`list_project_seat_users(seat)` (role OR seat, id + display name only). So the
enumeration rule covers **writes AND audience lookups** — anywhere the feature
asks "who is the X?", not just "may this user write?".
**Harness note (cost me 20 minutes)**: seeding a grant by poking
`users.managed_permissions` directly then writing to `team_nodes` does NOT work
— the write fires the statement-level recompute trigger, which rebuilds
managed_permissions from the tree and wipes a grant with no binding behind it.
Seed the real node+member binding and call `sync_my_team_permissions()`.

---

---

## A seat/scope dimension that is UNIONED with what it inherits is not a choice — the widest value wins and the explicit pick is decorative

**Symptom**: "I gave myself หนังสือโครงการ as **คณะ**, but it shows many new
notifications / many updates — it should look like samomdkkuvpa." The person had
picked เจ้าหน้าที่คณะ in จัดการสิทธิ์, yet got the VP-Admin inbox (every project,
nothing seen ⇒ everything badged "อัปเดต"). Looks like an unread-state bug; the
seen-state code is fine (per-user `project_doc_views` + user-scoped localStorage).
**Cause**: `effective_team_project_seats_for_email()` UNIONed the person's own
`project_seat` with every seat inherited from their ตำแหน่ง, and the frontend
`projectSeatRole()` then resolved the array with `SEAT_ORDER = ['vpa','staff','prof']`
— *widest first*. Their ตำแหน่ง (หัวหน้าฝ่าย IT) carries `vpa`, so picking `staff`
yields `{staff,vpa}` → `vp_admin`. Proven live by simulating the pick in a
rolled-back transaction. **The union is what makes the pick meaningless**: for an
additive grant (permissions, VS depts) union is right — you can hold PR *and*
inherit ประกาศ. A seat is a single role in one workflow; two seats is not a wider
grant, it is an ambiguous one, and any "pick the widest" tiebreak turns the
narrower explicit choice into a no-op.
**Fix (0092)**: nearest explicit binding wins. A person's own seat REPLACES
inheritance; `node_effective_project_seats` returns at the FIRST ancestor naming a
seat instead of collecting all of them. `SEAT_ORDER` survives only as a tiebreak
across two genuine postings. The three UI sites that painted "own + inherited"
chips now show one or the other, or the modal advertises a grant that doesn't
resolve.
**Where**: `supabase/migrations/0092_project_seat_parity.sql`;
`src/js/team/index.js` (`inheritedSeatsFor`, `nodeEffectiveSeats`,
`refreshMemberPermEff`, both chip renderers); `src/js/projects/index.js`
(`SEAT_ORDER` comment). Proof: `tools/proj0092-seat-parity.mjs`.
**Rule**: before making a dimension inheritable, decide whether it is ADDITIVE or
EXCLUSIVE. If two values cannot both be true of one person, inheritance must
OVERRIDE, never union — and never resolve the ambiguity with "widest wins", which
silently upgrades privilege. Same family as the 0083 VS entry ("a narrowing scope
added alongside an unconditional permission is DEAD") and the 0087 passport-scope
`permTicked` entry: whenever a grant's storage becomes polymorphic, every reader
must agree on which representation wins.

**Three more role-only gaps fell out of the same sweep** — the 0089/0090/0091 rule
("enumerate EVERY table the feature writes AND every audience lookup") had still
missed a table and a helper:
- `project_sign_requests` INSERT/UPDATE/DELETE were `role in ('uni_staff','dev')`,
  so a `staff` seat could act on a document but could not **ส่งให้อาจารย์ลงนาม** —
  the one thing เจ้าหน้าที่คณะ exists for. Now `current_user_is_project_uni_staff()`
  (role OR seat). Deliberately NOT `current_user_is_project_actor()`, which also
  admits `vpa` — the sender does not request signatures.
- `project_settings` write was `role in ('vp_admin','dev')` → the `vpa` seat opens
  การตั้งค่า and cannot save.
- **A regression 0091 shipped**, hitting the REAL `saprof` account in production:
  `list_project_seat_users()` guards on `current_user_is_project_actor()`, which is
  deliberately false for a professor (0086 — a prof must not see every project).
  But `notifySignDecision()` runs AS the professor and asks for the staff + vpa
  audiences, so both returned **zero rows** and the professor's sign/reject
  notified nobody. It returns an empty set rather than an error, so the role-only
  fallback in `api.js listProjectSeatUsers` never fired either. Measured: as
  saprof `staff=0 vpa=0`; as sastaff `staff=1 vpa=11`. Now a prof may READ an
  audience (still id + display_name only) — reading "who is the คณะ" is not the
  same capability as being an actor.
**Rule**: when you narrow a helper that an audience/notification lookup depends
on, check every ROLE that calls it, not just the ones it was written for — an
authorization predicate reused as a *directory* query fails silently and empty.

---

---

## A permission channel has TWO halves — writes AND reads. `current_user_is_staff()` is a role list, so every read gated on it silently excluded tree-granted accounts

**Symptom** (found by a sweep, before most of it was reported): a `creator`
grantee could WRITE an announcement and then not SEE it. `announcements_write`
honours `current_user_has_permission('creator')`; `announcements_read` was
`status = 'approved' OR current_user_is_staff()`. A tree-granted account is
`role='user'`, so drafts and pending posts vanished from เขียนประกาศ and
ลำดับการแสดงประกาศ — the writer's own unpublished work, invisible to them.
Write-only access is the nastiest shape of this bug: the save succeeds, so
nothing looks broken until you go looking for the row.
**The sweep that found it** (worth re-running after any RLS change):
```sql
select tablename, policyname, cmd, coalesce(qual,'')||' '||coalesce(with_check,'')
  from pg_policies where schemaname='public';
```
then flag every policy matching `current_user_role|current_user_is_staff` that
does NOT also match `has_permission|managed_|current_user_.*scope|_seats`. That
turned up 7, of which 3 were real: `announcements_read`, `vs_followers` /
`vs_public_comments` read (a VS dept-scoped handler could administer a ticket but
not read its followers or staff comment thread), and `analytics_events`
(สถิติการใช้งาน is offered to anyone who can use the admin app).
**The fix that would have been WRONG**: broadening `current_user_is_staff()`
itself. It is what `users_self_update_guard` (0028/0041) trusts to allow
privileged-column writes — widening it lets any tree-granted account
`update users set role='dev'` on itself. Each policy was repointed individually
instead: announcements → `+ has_permission('creator')`; VS →
`current_user_is_vs_handler()` (already "staff OR any VS scope");
analytics → a new `current_user_has_any_grant()`. 0093's proof asserts the
non-widening explicitly, with a real self-promotion attempt.
**Where**: `supabase/migrations/0093_shop_scope_and_grant_reads.sql`; proof
`tools/shop0093-scope.mjs` (18 checks).
**Rule**: when you add an access channel, the enumeration covers **writes,
audience lookups (0091), AND reads**. A read gated on a role list is invisible
until someone with the new channel goes looking for data they just created. And
never widen a predicate that a security trigger also consumes — check
`grep -rn "current_user_is_staff" supabase/migrations/` before touching it.
**FOURTH surface, found 2026-07-30 (0102)**: a **SECURITY DEFINER RPC's own
`raise` guard**. 0093 repointed the `analytics_events` TABLE read to
`current_user_has_any_grant()` but left `analytics_overview()` raising
`'analytics_overview: staff only'`. สถิติการใช้งาน is offered with NO permission
requirement (`SIDE_FEATURE.analytics = null`), so every ทีม SAMO grantee saw the
menu item and got `P0001 staff only` on open. The table and the function
disagreed about the same question. Fix: the SAME predicate in both, so they
cannot drift. So the enumeration is: **writes · reads · audience lookups ·
definer-RPC guards**. Sweep for the last one with
`select proname from pg_proc where pg_get_functiondef(oid) ~ 'current_user_is_staff'`.

---

---

## Deriving "which department is this admin" from a UI filter is not a permission — SAMO Shop had one grant and a localStorage preference

**Symptom / premise to correct**: "samoshop has two workflow permissions, for
samomdkkuvpa and samomdkkumdi". It did not. There is ONE `samoshop` permission
and both accounts simply held it; `current_user_is_shop_admin()` was
`role in ('shop_admin','dev') OR has_permission('samoshop')` and EVERY shop table
hung off that single predicate. What looked like two workflows was
`shop_products.source` (md/rt/mdi/sittikao, the 0058 ownership key) driving a
**localStorage** filter default — a UI preference the admin could clear, not a
boundary.
**Fix (0093)**: a real scope — `team_nodes/team_members.shop_source` →
`users.managed_shop_sources` → `current_user_shop_scope()` (NULL = every source,
`{}` = none, else the list), shaped like `current_user_vs_scope()` so no caller
can read "no access" as "all access". Product writes are confined by
`current_user_owns_shop_source(source)`.
**What was deliberately NOT scoped, and why it matters**: ORDERS. One order can
hold items from several sources — that is what a shared cart means — so "MDI's
orders" is not a property of a row, it is a property of *some of its items*.
A policy pretending otherwise would either hide orders that contain MDI items or
expose orders that contain everyone's. Splitting order access per source means
splitting the ORDER, which is a product decision. Orders stay admin-wide and the
UI keeps filtering them by `product_source`. **Shipping a policy that LOOKS like
it isolates departments but doesn't is worse than shipping none** — write down
the boundary you did not draw.
**Also**: a scoped admin's product LIST is filtered client-side to their sources.
Not for secrecy (the catalogue is public) but because rows they cannot write
would render with live-looking Edit/Delete buttons that every click 42501s on.
**REVERTED BY 0094 — and the reason is the lesson.** The user's answer was "SAMO
Shop is one role, I want it full, both": a product-only scope isolates nothing
anyone cares about, because ORDERS — the thing a department actually works out
of — cannot be scoped. Building the scopeable half of a boundary and leaving the
meaningful half shared produces a setting that looks like isolation and isn't.
**The right question was "what does a department need to NOT see?", not "which
column can I scope?"** — the answer would have been "orders", and that would have
surfaced the mixed-source problem before any code was written. All the shop
scoping is gone (helpers dropped, policy restored, picker removed); the
`shop_source` / `managed_shop_sources` columns remain inert and unread.
**Do not re-add a source scope without being asked.**
**Where**: `supabase/migrations/0093_*.sql` (added) and `0094_*.sql` (reverted).

---

---

## A seat that grants a SHARED role must not be modelled as a new individual — the อาจารย์ seat built a private desk instead of opening the existing one

**Symptom**: "on saprof there are 11 shown in ทั้งหมด, but on my kkumail granted
อาจารย์ in ทีม SAMO it shows 0." Both accounts resolve to `sa_prof`; the grant,
the seat resolver and the RLS all check out. Easy to answer "working as designed
— nothing has been sent to you yet", and that answer is *technically* right and
*practically* wrong.
**Cause**: every prof gate keyed on `sign_requests.prof_id = auth.uid()` —
`prof_can_see_document/_project/_file`, the sign-request read+update policies,
`scopeProjectsForRole()`, `docPendingSignForProf()`, and the file filter in
`loadFilesForDoc`. So the seat produced **a brand-new professor with an empty
desk**, when what the org wanted was **access to the professor's desk**. The
other two seats already behaved the second way (`staff` sees what sastaff sees,
`vpa` what samomdkkuvpa sees) because uni_staff and vp_admin are not per-person
filtered — prof was the only per-uid one, so the inconsistency was invisible
until someone held the seat.
**The signal I should have caught earlier**: this org runs SHARED department
accounts and the repo already records "don't design per-person assignee/roster
features". A per-uid recipient IS a per-person assignee. When a seat exists to
let a real person occupy a shared institutional role, "scoped to me" is the
wrong default — the role is the unit, not the individual.
**Fix (0095)**: the helpers now ask "am I อาจารย์, and was this sent for
signature at all?" `current_user_is_prof()` stays INSIDE each helper — the
policies OR them in, so a helper that ignored the caller would hand every
signature-requested document to any authenticated user. Frontend filters follow
the same rule.
**What deliberately did NOT change**: a professor is still not a project actor.
They see only หนังสือ carrying a signature request (11 of 26 live), never the
other 15, and inside a requested หนังสือ still only the requested + signed files,
never the private drafts. Making prof an actor exposes all 26 — rejected in 0086,
still rejected. Proof `tools/prof0095-seat-parity.mjs` asserts BOTH halves: same
desk as saprof, AND still cannot create a project or request a signature.
**Tradeoff written down**: every อาจารย์ now sees every signature request, so two
professors would see each other's. Correct for one shared role, wrong the day
per-professor privacy is wanted — and the fix then is the uid check PLUS a "which
professor am I" dimension, not a plain revert (which would empty the seat again).
**Rule**: when adding a seat/grant that lets an individual act as a shared role,
ask "should this person see what the shared account sees, or start empty?" for
EACH surface. If the answer is "the same", any `= auth.uid()` predicate on that
surface is a bug in waiting — and it will look like correct behaviour, because an
empty inbox is indistinguishable from a working one with nothing in it.

---

---

## WEAKENING the meaning of a permission key silently PROMOTES every gate that still treats it as the strong one

**Symptom**: 0110 split ทีม SAMO's `team` permission into `team` (view) and
`team_edit` (write), and granted `team` implicitly to all ~285 people with a
posting in the tree. `tools/team0110-view-edit.mjs` went 34/34. Then
`tools/team0104-terms.mjs` — a proof from a different feature, run only because
this repo's rule is to re-run the whole `tools/` suite after any RLS change —
went 37/40:
```
FAIL other permissions alone cannot write team_terms
FAIL publish_team_term refuses a caller without `team`
FAIL team_term_status refuses a caller without `team`
```
Every one of the 285 members could create/edit ปีการศึกษา, write the
`team_people` register, edit the published archive snapshots, and publish or
close an academic year.
**Cause**: the well-logged class here is *"a new access channel must be threaded
through EVERY gate the old one used"* (0089 → 0090 → 0091 → 0093 → 0102). This
is its mirror image, and it is easier to miss because nothing is being ADDED:
the key `team` kept its name and its spelling, so nothing looked like it needed
revisiting — but its MEANING moved from "may manage ทีม SAMO" to "may look at
it", while four tables (`team_terms`, `team_people`, `team_archive_nodes`,
`team_archive_members`) and two SECURITY DEFINER RPCs (`publish_team_term`,
`team_term_status`) still read it as write authority. Demoting a key promotes
every gate that still consumes it, in one step, silently.
**Fix**: 0110 §8 gives those four tables the same read/write pair as
`team_nodes`/`team_members` and repoints both RPC guards at `team_edit`. The
enumeration is mechanical, never from memory — and note it must cover **policies
AND definer-RPC guards**, the same four surfaces as the additive case:
```sql
select tablename, policyname from pg_policies
 where schemaname='public'
   and (coalesce(qual,'')||coalesce(with_check,'')) ~ 'has_permission\(''<key>''\)';
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and pg_get_functiondef(p.oid) ~ 'has_permission\(''<key>''\)';
```
Run it again after the fix and read what remains: here `get_my_team_seat()` still
names `team` and is CORRECT, because it is asking "may this person view?" — the
sweep tells you where to look, it does not tell you the answer.
**Where**: `supabase/migrations/0110_team_view_edit_split.sql` §8; proofs
`tools/team0110-view-edit.mjs` (now asserts read-yes/write-no on all four
tables) and `tools/team0104-terms.mjs`.
**Rules**: (1) changing what an existing permission key MEANS is the same size
of change as adding one — run the same enumeration, in both directions.
(2) Prefer a NEW key for the stronger meaning and leave the old key weak
(`team` stayed view, `team_edit` is new), so any gate you miss fails CLOSED for
the strong operation instead of open. Had it been done the other way round —
`team` keeps write, a new `team_view` is added — a missed gate would have been a
lockout, which someone reports in minutes; the way round it was actually done,
a missed gate is a silent privilege grant nobody notices. **This is why the
whole `tools/` suite gets re-run, not just the proof for the migration you
wrote**: 0110's own proof was 34/34 green while this was live.
