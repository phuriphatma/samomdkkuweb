# STATE archive — 2026-07-25 (ทีม SAMO grant model build-out)

Pruned from `STATE.md` to keep it under the context budget. These sections
describe migrations 0081–0088 in full narrative form. `STATE.md` keeps the
compact version; `git log --oneline` is the chronology; `docs/CONTEXT.md` has
the architecture; `.claude/rules/mistakes.md` has the post-mortems.

---

## SAMO TEAM tree now DRIVES login permissions (0081 APPLIED + frontend DEPLOYED to VM)

The ทีม SAMO org tree (`team_nodes.permissions`/`inherit_permissions`, +NEW
per-person `team_members.permissions`/`inherit_permissions`) now grants REAL access.
Previously the tree was cosmetic — nothing linked it to a gate.

- **Channel**: `public.users.managed_permissions text[]` (tree-derived, server-managed)
  is kept SEPARATE from `permissions` (manual grants). Both gates read the UNION —
  `current_user_has_permission()` (RLS) and `userCanAccess()` (UI). Additive: the tree
  can revoke its own grants without wiping manual ones.
- **Auto + live**: `sync_my_team_permissions()` (definer, granted authenticated, keyed
  off `auth.uid()`'s own `users.email` = the person's kkumail for Google logins) is
  called in `auth.js buildCurrentUser` at every login → provisions on first login.
  A statement-level trigger on the tree (`{team_nodes,team_members}_recompute_perms`)
  rewrites managed_perms for every already-logged-in matching account on any perm/
  structure edit → live update, no re-login.
- **Resolver**: `effective_team_permissions_for_email(email)` = union over the person's
  member rows of `member.permissions ∪ (member.inherit ? node_effective_permissions(node))`.
  Verified live: parent node `pr` + member own `samoshop` → `pr,samoshop`.
- **Guard**: `managed_permissions` added to `users_self_update_guard`; client PATCH
  blocked, server writers pass via txn-local GUC `app.team_sync='1'`.
- **UI**: team member modal now has a per-person permission grid + "รับสิทธิ์จากตำแหน่ง"
  toggle + effective preview; member rows show a shield "N สิทธิ์" tag.
- **Decisions locked**: auto-grant on any matching kkumail (NO confirm gate); additive
  coexistence with manual perms. Started with `pr`; all PERM_CATALOG keys work the same.
- **Per-person UI**: จัดการสิทธิ์ (perms) mode now lists each node's PEOPLE with
  effective chips + a shield → focused `teamMemberPermModal` (สิทธิ์รายบุคคล). Per-person
  perm editing lives ONLY here now (removed from the identity/team-mode member modal, so
  an identity edit can't wipe grants). `renderMember` has a perms-mode variant.
- **Admin-gate fix (f97c70e)**: the admin entry gate was role-only and bounced a
  `role='user'` account that the tree granted perms to. Now `canUseAdmin()` = staff role
  OR any `ADMIN_FEATURES` grant (via `userCanAccess`, which unions managed perms). See
  mistakes.md "role-only gate leaves a latent block".
- **Verified live**: resolver, guard (both directions), live-update trigger, AND the real
  account `phuriphat.ma@kkumail.com` (role='user', managed=[creator,pr,projects,samoshop,
  team,vs] from tree inheritance) — DB row confirmed correct; the only bug was the gate.
- **Bug-scan follow-ups (1855539, deployed)**: (a) a per-ฝ่าย scoped VS user now defaults
  to their own dept in the VS kanban + picker hidden when they have one dept (was falling
  to "ทุกฝ่าย" with the full picker — RLS still limited data, but misleading UX). (b) Team
  JSON export/import now carries `vs_dept` + member `permissions`/`inherit_permissions`
  (round-trip was silently dropping them).
- **Per-ฝ่าย VitalSound (0082, APPLIED + DEPLOYED)**: bind a team node to a
  VS department (`team_nodes.vs_dept`, picker in the node perm modal) → people under it
  get VS access SCOPED to that dept via `users.managed_vs_depts[]` (synced like
  managed_permissions; server-managed + guarded). `vs_tickets` READ/UPDATE RLS now honor
  full-vs (`has_permission('vs')` — was MISSING from read/update before, only delete) AND
  `target_dept = any(current_user_vs_depts())`. `sync_my_team_permissions()` now returns
  jsonb `{permissions, vs_depts}`. Verified live (rolled-back): scoped user sees 1/1 own +
  0/64 other-dept, resolver inherits, anon reads 0, 0072 isolation 23/23.
- **Scoped VS ≠ full VS (0083, APPLIED to live DB)**: the reported bug — a tree-scoped
  person saw ALL depts — was the `vs` permission and the `vs_dept` binding coexisting on
  one row: `has_permission('vs')` is an unconditional OR-branch in every VS policy and
  swallowed the dept check. Now a row carries EITHER `vs` (ทุกแผนก) OR a `vs_dept` (that
  dept only); the perm modal shows the dept picker ONLY after VitalSound is ticked and
  drops `vs` when a specific dept is chosen. 0083 also: `team_members.vs_dept`
  (per-PERSON scope, in the สิทธิ์รายบุคคล modal), normalises legacy both-set rows,
  adds `current_user_vs_scope()` (NULL=all / `{}`=none / depts), and gives a scoped
  handler the rest of the dept-scoped workflow (vs_tags read+own-dept write, search /
  find_similar / merge / unmerge / soft_delete / hide_public_comment). Verified live:
  `tools/vs0083-scope.mjs` 10/10 on the real account (`phuriphat.ma@kkumail.com` →
  `managed_permissions={pr}`, `managed_vs_depts={อุปนายกฝ่ายวิชาการ}`).
- **Board parity + the default-option trap (0084 + 0085, APPLIED)**: a tree-scoped
  handler is now เจ้าหน้าที่ on the public Problem board — their comments stamp
  `is_staff` (badge instead of the นศ.XXXX pseudonym) and they read students'
  "ส่งถึงเจ้าหน้าที่เท่านั้น" comments **on their own dept's problems only** (the badge
  is global, the confidential READ is dept-scoped via `current_user_vs_scope()`, so
  0083's bug can't recur one layer up). 0085 makes `current_user_is_vs_handler()`
  fail closed — `current_user_is_staff()` returns NULL (not false) with no
  `public.users` row, and `vs_public_comments.is_staff` is NOT NULL, so the NULL
  would have broken posting entirely for such an account (latent since 0072).
  UI: the scope select's index-0 was "ทุกแผนก" — ticking VitalSound and saving
  without touching it silently granted FULL VS (this happened twice on the live
  tree). Index 0 is now `— เลือกขอบเขต —` (blocks the save), and ทุกแผนก needs an
  explicit confirm. `tools/vs0083-scope.mjs` is now self-provisioning (grants a
  synthetic scope inside a rolled-back txn) — 16/16, independent of live config.
- **TODO**: user to re-test the actual browser login. For per-ฝ่าย VS: จัดการสิทธิ์ → tick
  VitalSound on a node (or on a person) → choose "เฉพาะ <แผนก>" → they log in → VS tab
  shows only that dept's tickets, with the dept picker hidden.


---

## SAMO Passport admin permission in ทีม SAMO (0087, APPLIED — identity only)

- **Grant**: จัดการสิทธิ์ → ☑ SAMO Passport → ขอบเขต = ทุกฝ่าย | ฝ่าย | ฝ่าย+แผนกย่อย, on a
  node or one person. Passport has 10 departments and 4 sub-departments (only
  กิจการภายใน → โครงการ/ชุมนุม and กิจการมหาวิทยาลัย → จิตอาสา/7 คณะ have children), and
  `activities`/`scans` both carry `department_id` + `sub_department_id`, so the scope
  is two-level — richer than VitalSound's flat dept.
- **Storage**: `users.managed_passport_scopes text[]` = tokens `d:<id>` / `s:<id>`
  (a sub binding replaces the dept token). Scoped drops the blanket `passport` perm
  (the 0083 rule). Guarded + synced by the same login RPC / recompute trigger.
- **Consumed by**: `public.passport_admin_context()` → `{is_admin, all_departments,
  departments[], sub_departments[]}`. The passport app should call this instead of
  building its own admin table (SECURITY-HARDENING-PLAN.md §2 can now drop its
  `passport.admins` design and read this). Picker data via
  `public.list_passport_departments()` (passport.departments has RLS on, no policy).
- **Verified**: `tools/pass0087-scope.mjs` 10/10; PERM_CATALOG + both modals checked
  in the browser (the dept dropdown fills only for a signed-in user — the RPC is
  authenticated-only).
- **⚠️ ENFORCES NOTHING YET.** passport schema RLS is still 0056's `using(true)` for
  anon. Proven live (rolled back): anon inserts an activity, updates ALL 845 scans to
  999999 km, reads all 593 profiles (name+email). Passport-side enforcement =
  `passport/SECURITY-HARDENING-PLAN.md`, still awaiting its 4 answers (admin list /
  bulk-scan path / profiles.email PII / cutover window). Until then, per-department
  filtering in the passport UI is cosmetic.


---

## หนังสือโครงการ seats via ทีม SAMO + public org-chart contract (0086, APPLIED)

- **Seat, not a flat permission**: หนังสือโครงการ is three workflows and the module
  branches on `users.role`, so ticking only `projects` in จัดการสิทธิ์ opened the tab
  with NO controls and no write rights. A node/member now carries
  `project_seat ∈ (vpa|staff|prof)` = ผู้ส่ง / เจ้าหน้าที่คณะ / อาจารย์(ลงนาม) →
  `users.managed_project_seats[]` → `current_user_project_seats()`. The two role-only
  helpers were widened at their single definition each, so every existing policy picks
  seats up: `current_user_is_project_actor()` (+vpa/staff) and `current_user_is_prof()`
  (+prof). **prof is deliberately NOT an actor** (0050's rule). Frontend resolves the
  seat to a role once in `projectSeatRole()`, so the module's ~40 `role === '…'`
  branches are untouched. The UI refuses to save a `projects` grant with no seat.
- **Signing recipients**: `list_project_profs()` (id + display name only, actor-gated)
  replaces `listUsersByRole('sa_prof')[0]`, which could never see a tree-granted
  อาจารย์ and assumed exactly one existed. The sign modal shows a picker when >1.
- **Public org chart**: `team_nodes.is_public` (default true) — อาจารย์ and
  เจ้าหน้าที่คณะแพทย์ set to false (they hold seats but aren't in the student org).
  **The flag is NOT the privacy boundary**: the only sanctioned publisher is
  `get_public_org_chart()`, a definer projection returning name/nickname/structure
  over a recursive CTE (hiding a parent hides its subtree). Never add a public SELECT
  policy to `team_members` — RLS is row-level, so it would publish kkumail (students
  AND @kku.ac.th staff), student_id, year, major, permissions, seat, user_id. anon
  currently reads 0 rows from team_members and that must stay true.
- **@kku.ac.th needs nothing special**: no domain gate on the main app's Google
  sign-in, and the resolver matches `team_members.kkumail` against `users.email`
  case-insensitively and domain-agnostically.
- **Verified**: `tools/proj0086-seats.mjs` 18/18 (seat→capability matrix incl. the
  prof-is-not-an-actor negative, signer list, chart projection leaks nothing, parent
  hiding cascades, anon blocked on team_members, rollback leaves nothing) +
  `src/js/projects/seat.test.js` for the resolver. The chart RENDERER is not built —
  only its safe contract.

