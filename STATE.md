# STATE — current task & latest known state

Last updated: 2026-07-25. Slim by design — "what is true right now". Full
per-deploy narrative of the prior session: `docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: `.claude/rules/mistakes.md`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- Live web = pushed `main` HEAD `c6d5159`, **deployed to the VM** (VM HEAD matches;
  working tree CLEAN). Migrations 0081–0091 applied to the live DB. Verify a deploy
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
- One Supabase project `fheueuowbchsnsvbcgil` (web `public` + passport in `passport`
  schema). Migrations applied through `tools/apply-migration.mjs` (Management-API PAT).

## ทีม SAMO is the grant engine (0081–0088, ALL APPLIED + DEPLOYED)

The org tree grants REAL access. Full narrative: `docs/state-archive/2026-07-25-team-grants.md`.

**Model.** A node or member carries permissions plus, per feature, a SCOPE binding.
Everything resolves at login (`sync_my_team_permissions()`, called in `auth.js
buildCurrentUser`) and live on any tree edit (statement triggers), into
server-managed, guarded `public.users` columns:

| dimension | tree column(s) | users column | RLS helper |
|---|---|---|---|
| app perms | `permissions[]` | `managed_permissions[]` | `current_user_has_permission()` |
| VitalSound dept | `vs_dept` | `managed_vs_depts[]` | `current_user_vs_scope()` |
| หนังสือโครงการ seat | `project_seat` (vpa/staff/prof) | `managed_project_seats[]` | `current_user_project_seats()` |
| SAMO Passport | `passport_dept_id` / `passport_sub_dept_id` | `managed_passport_scopes[]` (`d:<id>`/`s:<id>`) | `passport_admin_context()` |

**The rule that keeps biting — SCOPED IS NOT FULL.** A blanket permission key
(`vs`, `passport`) is an unconditional OR-branch in RLS and swallows any narrower
check, so a scoped grant stores the BINDING and drops the key. Consequences already
paid for (all in mistakes.md): the UI must tick the checkbox from EITHER signal
(`permTicked()` — a miss silently wipes the grant on the next save); the scope
picker's index 0 must be a non-choice, never "ทุกฝ่าย"; and a new access channel
must be threaded through EVERY gate the old one used.

**Seats vs scopes.** `projects` is the exception: the seat does NOT drop the
permission, because there the seat picks WHICH of three workflows
(`projectSeatRole()` maps it to the role string the module already branches on).
`prof` is deliberately not a project actor.

**Verification.** Four self-provisioning proof scripts, each running in rolled-back
transactions, independent of live config — re-run after ANY change to these RLS
paths:
`tools/vs0083-scope.mjs` 16 · `tools/proj0086-seats.mjs` 21 ·
`tools/pass0087-scope.mjs` 10 · `tools/team0089-manage.mjs` 5 ·
`tools/vs0072-isolation.mjs` 23. All green.

**Role-only gates — fixed twice more (0089, 0090).** `team_nodes`/`team_members`
were gated on role alone, so a tree-granted `team` holder could not edit the tree
at all (and therefore could not grant anything from that account) — the permission
that manages the grant engine was the one it did not honour. Same sweep found
`projects_insert/delete` + `project_documents_insert/delete` role-only, so the
`vpa` seat could update but not CREATE. Both fixed; 0090 adds the seat ALONGSIDE
the role list (not via `current_user_is_project_actor()`, which also admits
uni_staff, who must not create projects). 0091 completes the sweep: the notify
fan-out resolved every audience by role, so a seat holder got no in-app
notification at all — now `list_project_seat_users(seat)`. Lessons logged: test
the OPERATION not the predicate (proj0086 asserted the helper and missed the
policy), and the enumeration must cover audience LOOKUPS as well as writes.

**Public org chart (0086).** `team_nodes.is_public` (อาจารย์ + เจ้าหน้าที่คณะแพทย์ =
false). The flag is NOT the privacy boundary: `get_public_org_chart()` is a definer
PROJECTION (name/nickname/structure only, recursive so hiding a parent hides the
subtree) and is the ONLY sanctioned publisher. Never add a public SELECT policy to
`team_members` — anon reads 0 rows from it today and must keep doing so.

**⚠️ SAMO Passport grant enforces NOTHING yet.** 0087 is identity + scope only; the
`passport` schema still has 0056's `using(true)` for anon. Proven live (rolled
back): anon inserts an activity, updates ALL 845 scans, reads all 593 profiles
(name+email). Enforcement = `passport/SECURITY-HARDENING-PLAN.md` (separate repo,
NOT applied), which should now READ `passport_admin_context()` instead of building
its own admin table. Still awaiting 4 answers: admin allowlist / bulk-scan path /
`profiles.email` PII / cutover window.

## NEXT (pick up here)

1. **User to browser-test the grants end-to-end.** All server paths are proven by
   the scripts; no signed-in e2e run has been done for: a scoped VS user, a
   `staff`/`prof` seat, or a scoped passport admin. `phuriphat.ma@kkumail.com`
   currently holds `managed_permissions={creator,pr,team,vs}` (blanket `vs` = all
   depts, from the หัวหน้าฝ่าย IT node) — tree edits from that account work as of
   0089, no re-grant needed.
2. **Passport enforcement** — answer the 4 questions above, then apply the
   hardening plan and wire the passport app to `passport_admin_context()`.
3. **Org-chart renderer** — contract exists (`get_public_org_chart()`), no UI.
4. Optional: VS public-board staff-only comments are dept-scoped for handlers
   (0084) — no further work known.

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
