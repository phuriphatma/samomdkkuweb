# STATE — current task & latest known state

Last updated: 2026-07-25. Slim by design — "what is true right now". Full
per-deploy narrative of the prior session: `docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: `.claude/rules/mistakes.md`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- Live web = pushed `main` HEAD `5d0e15d`, **deployed to the VM** and verified live
  (shared chunk carries the 0081 team-permission sync; admin bundle has
  `managedPermissions`). Migration 0081 applied to the live DB. Tree is CLEAN.
  Verify by grepping the served shared `analytics-*.js` chunk for feature strings.
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
- **Verified live**: resolver (pr,samoshop), guard (blocks client / allows server via
  the GUC), and the live-update trigger ([]→[pr] on member insert) all tested against
  the live DB via self-rolling-back probes. Deployed bundle (VM) carries the sync RPC
  (shared `analytics-*.js` chunk) + `managedPermissions` (admin bundle).
- **TODO**: no live BROWSER e2e of a real kkumail login → PR-tab-appears yet (all
  server + unit paths verified; the browser round-trip is the only unproven link).

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
