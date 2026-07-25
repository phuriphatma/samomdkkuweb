# STATE — current task & latest known state

Last updated: 2026-07-25. Slim by design — "what is true right now". Full
per-deploy narrative of the prior session: `docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: `.claude/rules/mistakes.md`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- Live web = pushed `main` HEAD `1855539`, **deployed to the VM** (VM HEAD matches;
  working tree CLEAN). Migrations 0081–0085 applied to the live DB. Verify a deploy
  by grepping the served shared `analytics-*.js` chunk (auth.js lives there) + the
  admin bundle for feature strings — NOT by hash (Mac vs VM hashes differ).
- Deploy method: `ssh samo-vm` → `cd ~/samo-projects/samomdkkuweb` →
  `./server/deploy.sh` (pull → `npm ci` → build → `sudo rsync dist/` →
  `/var/www/samo-web` → chown → restart notify → `nginx -t` + reload; also builds
  passport with `PASSPORT_BASE=/passport/`). `deploy.sh` uses BARE `sudo`, which
  needs a tty — run over `ssh -tt`, and prime the cred cache first in the SAME
  session: `printf '%s\n' "$PW" | ssh -tt samo-vm 'read -rs PW; echo "$PW" | sudo -S
  -v && ./server/deploy.sh'` (PW = `.env.local` `SAMO_VM_SUDO_PASSWORD`; a lone
  `sudo -S -v` without `-tt` primes nothing — deploy.sh's next `sudo` still errors
  "A terminal is required to authenticate"). Bundle content-hashes differ Mac vs VM
  (dep/Node deltas) — verify a deploy by grepping the served bundle for feature
  strings, not by hash-matching.
- No live staff-login browser e2e run for the tag UI yet (optional; see NEXT).
- One Supabase project `fheueuowbchsnsvbcgil` (web `public` + passport in `passport`
  schema). Migrations applied through `tools/apply-migration.mjs` (Management-API PAT).

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

## PR — ฝ่าย list is now one source of truth (`src/js/pr-depts.js`)

- **นายกสโม added** to the PR submit form (ข้อมูลผู้ส่งงาน → ฝ่าย) and the admin staff
  dept filter. Decision: NO special-casing — it behaves exactly like any other ฝ่าย
  (all three ช่องทางการโพสต์ options, not project mode). Verified in a real browser
  against `npm run preview`.
- **Same pass**: fixed the long-standing typo `ฝ่ายคุณภาพขีวิต…` → `ชีวิต` and added the
  missing `ฝ่ายรังสีเทคนิค`. 8 live `pr_tickets` rows carry the old spelling; nothing
  rewrites the DB — `canonicalPrDept()` aliases it at the row → view-model boundary in
  `pr-staff.js` / `pr-tracking.js`, so those tickets stay findable under the corrected
  filter option and display the corrected name.
- **Why the module**: the list was hand-written twice (`tab-pr.html`, `tab-admin.html`)
  and had drifted — same typo in both, `ฝ่ายรังสีเทคนิค` in neither, `โครงการอื่นๆ` in only
  the admin one. Both selects are now filled from `PR_DEPARTMENTS` via
  `fillPrDeptSelect()` (which preserves the current filter across a refill).
  `docs/CONTEXT.md` "When you add a new department or role" rewritten to match.

## VITALSOUND — service-desk system (all DEPLOYED + migrations APPLIED through 0080)

VS = confidential service desk + curated public "Problem" board. 9 internal statuses
= source of truth; students see a 4-phase stepper. This session shipped migrations
**0073–0078** (all applied to live DB) + the UI slices:

- **0073 resolution-on-close**: closing (เสร็จสิ้น) requires a reason
  (fixed/forwarded/wont_do+note; `MANUAL_VS_RESOLUTIONS`); student sees a
  "ผลการดำเนินการ" outcome card. Shared vocab `src/js/vs-resolution.js`.
- **0074 duplicate = linked progress-mirror**: merge links B→A; trigger mirrors A's
  status (+resolution enum on close, never the note) onto open duplicates; submitter
  reads use `SUBMITTER_COLS` allow-list (NEVER `duplicate_of` — the id is a lookup
  capability; generated `is_duplicate` is the only exposed signal). "duplicate" is
  NOT a manual close reason — merge only.
- **0075 linked context**: `get_vs_linked_context(p_id)` — canonical PUBLIC → returns
  public_id+title (tracking view deep-links to board via `vsOpenBoardProblem`);
  confidential → only `{linked, related_count}`.
- **0076 publish consent**: report-form switch → `vs_tickets.public_consent`;
  explicit decline is server-enforced in `vs_set_public` (null = legacy, SE judgment).
- **0077**: `updated_at` (touch trigger; kanban dual chips 📥เข้ามา + ↻อัปเดต) +
  status split "กำลังดำเนินการ" → สโมกำลังดำเนินการ / คณะกำลังดำเนินการ (phase maps
  match substring 'ดำเนินการ' — unchanged; legacy value maps to the สโม column).
- **0078 staff-only comments**: board composer "ส่งถึงเจ้าหน้าที่เท่านั้น" →
  `vs_public_comments.staff_only`; served ONLY to staff/author (badge เฉพาะเจ้าหน้าที่);
  board counts exclude them. Old 2-arg `vs_post_public_comment` DROPPED (3-arg default).
- **0079 internal per-dept tags** (migration APPLIED to live; **frontend committed
  `5b082f2` + DEPLOYED to the VM**): `vs_tags`
  (id/dept/label/color/sort_order/is_active) + `vs_tickets.tags text[]` (loose, no FK,
  GIN idx). SECOND axis, orthogonal to the ONE public category taxonomy — tags are
  INTERNAL, staff-only, NEVER on the public board / guest RPCs, and OWNED BY A DEPT
  (each dept classifies its own workload; SE triage ≠ อุปนายก triage). RLS: read =
  `current_user_is_staff()`; write = vs_staff/dev/perm('vs') any dept, vp_admin OWN
  dept only. UI (admin entry only): kanban tag FACET beside the category facet (scoped
  to the acting dept, grouped by dept on the "all" view, hidden when the dept has no
  tags); per-ticket toggle-chip editor scoped to the ticket's `target_dept` (save
  MERGES this dept's selection with the ticket's other-dept tags — a save never drops
  another dept's tags); card chips coloured per owning dept; per-dept จัดการแท็ก
  manager (`modal-vs-tags.html`; VP locked to own dept, super users get a dept picker;
  10-colour dot palette `TAG_COLORS`). Written via the same staff `vs_tickets` PATCH
  path as `category` (staff-only log remark `internal:true`). NOT public-board related
  — the vs0072 isolation invariants are untouched.
- **0080 guest-lookup tag leak fix** (DB-only; APPLIED to live, no redeploy): 0079's
  new `vs_tickets.tags` was auto-exposed to `anon` because `get_vs_ticket_by_id` is
  `returns setof vs_tickets` via `select *`. 0080 blanks `r.tags := '{}'` (beside the
  0071 `duplicate_of := null`). Verified anon RPC returns `tags:[]` even with a real
  tag set; isolation proof 23/23. Lesson in mistakes.md: any ALTER of `vs_tickets`
  must audit that `select *` guest RPC per-column. **Known residual (low, pre-existing
  class, NOT fixed):** the owner-update RLS lets a submitter PATCH their OWN
  `vs_tickets.tags` (same exposure as `category`) — non-confidential opaque ids, a
  triage-integrity nuisance only, not a data leak. Fix only if it ever matters.
- **UI now live**: staff modal in 5 purpose-sections; duplicate cluster TREE + nested
  kanban dups ("ซ้ำ N เรื่อง" expand strip; a dup whose canonical is outside the
  current filter renders top-level so it never vanishes); dashboard SEARCH + หมวดหมู่
  FACET (`__none__` = untagged); category = ONE taxonomy (internal + board; 🔒
  assignable internally, never publishable) with TWO synced selects (section-2 +
  publish panel) + จัดการหมวดหมู่ manager (SE-only; add/rename/confidential-toggle
  with double-confirm/hide); public board: showcase strip "ผลงานที่แก้ไขสำเร็จ"
  (resolved problems leave the grid; hidden during search), ONE comment composer
  (me-too tap focuses it; button ส่งความคิดเห็น).
- **Invariants (breaking any re-exposes confidential complaints):**
  1. public reads = curated projections via SECURITY DEFINER RPCs only (never raw
  problem/submitter/remarks/duplicate_of); 2. SE writes `public_title`; 3.
  confidential categories hard-excluded from every public surface (category join
  re-checked in RPCs); 4. a submitter never receives another ticket's id; 5. an
  explicit consent decline cannot be published. **Proof: `tools/vs0072-isolation.mjs`
  (23/23) — re-run after ANY change touching vs_categories or the board RPCs; it
  catches CONFIG regressions too (a toggle once flipped `personal` publishable).**
- Live-data notes: test category `cat_mryxyw97` "หมวดหมู่ลับเอิง" exists (hide via
  the manager if unwanted); test ticket VS-260724-1612-5N6 soft-deleted (restorable).
- **NEXT (roadmap)**: slice 4 = transition guards (status dropdown offers only valid
  next states). Slice 3 (per-person assignee) DROPPED — depts use one shared account
  (memory: depts-use-shared-accounts). OPEN: "post public update" button for staff
  (curated update → board thread) — recommended over ever exposing the raw internal
  timeline (PDPA + `internal:true` cross-refs). Human e2e worth doing: merge two
  tickets → track the duplicate as its submitter → watch the mirror/banner.

## OTHER SYSTEMS (stable; details in archive + CONTEXT.md)

- **PR / News / Shop / Projects / Analytics**: unchanged this session. Shop = Model A
  shared admin (0057/0058); projects ปีงบ filter; analytics strip + staff dashboard live.
- **Passport** (separate repo `phuriphatma/samomdkkupassport`, same Supabase project,
  `passport` schema): kkumail-only gate live; 5 gmail→kkumail migrations verified;
  awaiting students' replies at mdstuddata.beta@gmail.com. Dev test still ACTIVE
  (pmphuriphat→phuriphat.ma) — revert SQL in `docs/state-archive/2026-07-24-full.md`
  ("ACTIVE TEST STATE"). Old project B `idwlabpbwiwgaoqwbozz` paused as cold backup —
  rotate its DB password (in `.env.local`) before deleting.
- **notify**: `/notify` Node service on the VM; `notify_log` (0055) recording;
  `main` branch protected (1 approval; owner ff-push exempt).
- Retention jobs NOT scheduled (`prune_analytics`, `prune_notify_log`) — run manually
  if tables grow.

## Housekeeping

- `.env.local` holds the Supabase PAT, VM sudo pw, project-B DB creds — never commit.
- CI = Node 22 (supabase-js WebSocket). `npm run build && npm test` before every
  commit — 140 tests green at session end; isolation proof 23/23.
