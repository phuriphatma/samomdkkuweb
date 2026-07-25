# STATE — current task & latest known state

Last updated: 2026-07-25. Slim by design — "what is true right now". Full
per-deploy narrative of the prior session: `docs/state-archive/2026-07-24-full.md`;
chronology: `git log --oneline`; architecture/RLS: `docs/CONTEXT.md`; bug
post-mortems: `.claude/rules/mistakes.md`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- Live web = pushed `main` HEAD `8636376`, **deployed to the VM** (VM HEAD matches;
  working tree CLEAN). Last code-bearing commit is `8636376`; anything after it is
  docs-only, so a VM/STATE mismatch of one or two `docs(state):` commits is normal
  and does NOT mean a deploy is pending — check `git diff --name-only <vm>..HEAD`
  for anything outside `STATE.md` / `.claude/` / `docs/` before redeploying.
  Migrations 0081–0094 applied to the live DB. Verify a deploy
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
`tools/proj0092-seat-parity.mjs` 13 · `tools/grant0093-reads.mjs` 15 ·
`tools/vs0072-isolation.mjs` 23. All green.
Not a test: `tools/proj-handover.mjs` (dry-run by default) transfers a SHARED
workflow account's uid-bound state — read state, and optionally the bell and
signature assignments — to a personal kkumail account during the migration.

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

**Seats: explicit beats inherited, + 3 more role-only gaps (0092, APPLIED).**
Reported as "granted myself หนังสือโครงการ as **คณะ** but it shows everything /
many updates". The seat resolver UNIONed a person's own `project_seat` with what
their ตำแหน่ง passed down, and `projectSeatRole()` picked the WIDEST — so under the
`vpa` ตำแหน่ง, choosing เจ้าหน้าที่คณะ resolved to `{staff,vpa}` → `vp_admin`, i.e.
the sender's see-everything inbox. Now the nearest explicit binding wins (own seat
replaces inheritance; the ancestor walk stops at the first seat); `SEAT_ORDER`
survives only as a tiebreak across two real postings. Same sweep fixed:
`project_sign_requests` insert/update/delete were role-only so a `staff` seat could
NOT ส่งให้อาจารย์ลงนาม; `project_settings` write was role-only so the `vpa` seat
could not save; and **0091 had regressed the real `saprof` account** —
`list_project_seat_users()` guards on `current_user_is_project_actor()`, false for a
professor, so the prof's sign/reject notified NOBODY (measured: saprof staff=0
vpa=0). Proof `tools/proj0092-seat-parity.mjs` 13/13 (was 8/13 before the fix).
NOTE the seat is a per-row choice: `phuriphat.ma` resolves to `vpa` because the
*member* row names no seat and inherits the ตำแหน่ง's — set the seat on the member
(or change the ตำแหน่ง) if a different seat is wanted.

**A newly-granted reader inherited a backlog of unread (seen-state baseline).**
Separate from the seat work, and the actual thing reported: seen-state is PER USER
(`project_doc_views` + a user-scoped localStorage map), so `samomdkkuvpa` shows no
"อัปเดต" only because it has 26/26 doc-view rows from months of reading, while a
freshly-granted account had 0 and every card badged. `planSeenAtRows()` (pure,
tested) now BASELINES a reader with no history anywhere to "caught up as of now",
and still MIGRATES an existing reader's localStorage. Never baselines someone who
already has server rows. The sentinel key is bumped to `.v2` because the old code
set it even when it wrote zero rows — without the bump anyone who had already
opened the tab would skip the new branch forever. Re-running is safe: the upsert is
`merge-duplicates` (it OVERWRITES `seen_at`), so a local value is only pushed when
strictly newer than the server's, or the re-run would roll read state backwards.

**Shared-account → personal-account handover (`tools/proj-handover.mjs`).** The
baseline is right for a NEW person and wrong for someone TAKING OVER a workflow —
a migrating account must inherit its predecessor's pending work, not start clean.
"N ใหม่" is document STATUS (identical for every viewer, matched immediately);
"N อัปเดต" is per-user `project_doc_views`. The tool REPLACES the target's read
state with the source's (a doc the source never opened must have NO target row, or
its อัปเดต stays hidden — sastaff has 22 rows for 26 docs). RUN 2026-07-25:
sastaff → `phuriphat.ma`, verified 9/9 unseen docs matching, 0 mismatches.
**อาจารย์ is the worse case and is NOT done**: a sign request names one `prof_id`,
and `scopeProjectsForRole()` keeps only docs naming the viewer — so a migrated
prof account sees an **empty inbox** (measured: saprof 11 docs, personal 0). New
requests are fine (`list_project_profs()` already returns seat holders). When
อาจารย์ migrates, run the tool with `--sign-requests` (it MOVES, since a request
has one professor).

**SAMO Shop is ONE role — the 0093 scope was REVERTED by 0094.** Every shop admin
manages every แหล่งที่มา; there is no per-source grant and the picker is gone.
`current_user_is_shop_admin()` is back to `role in (shop_admin,dev) OR
has_permission('samoshop')`, and `shop_products` writes are back on it. The
`shop_source` / `managed_shop_sources` COLUMNS remain but are inert — nothing
reads them. Drop them whenever (`alter table … drop column …`, listed in 0094's
header) and strip them from sync/recompute/users_self_update_guard. **Do not
re-add a source scope without being asked**: the reason it was declined is that
orders can't be scoped (one order holds items from several sources), so a
product-only scope isolates nothing anyone cares about.

**The READ half of the grant channel (0093 part B, KEPT).** Three policies gated
on `current_user_is_staff()` — a bare role list — excluded tree-granted accounts:
`announcements_read` (a `creator` grantee could WRITE a draft and not see it,
which is what broke เขียนประกาศ/ลำดับการแสดงประกาศ), `vs_followers` /
`vs_public_comments` (→ `current_user_is_vs_handler()`), and `analytics_events`
(→ new `current_user_has_any_grant()`). `current_user_is_staff()` itself was NOT
widened — `users_self_update_guard` trusts it for privileged-column writes, so
widening it would let any grantee self-promote to `dev`
(`tools/grant0093-reads.mjs` asserts this with a real attempt).
**Three role-only policies REMAIN BY DESIGN — do not "fix" them**:
`users_update_staff` (broadening it lets a grantee edit other people's rows),
`notify_log_select_staff` and `reserved_staff_usernames_read_staff` (internal
diagnostics / non-load-bearing reference data). Re-run the sweep after any RLS
change: flag policies matching `current_user_role|current_user_is_staff` that do
NOT also match `has_permission|managed_|_scope|_seats`; the expected count is 3.

**Admin account switch reloads (0093 cycle).** `admin-main.js` records
`bootUserId`; a later `onAuthChange` with a different non-null id does
`location.replace(pathname)`. Module-scope caches (projects + seenAt, shop state,
team tree, PR/VS lists) were written for a page serving one account for its
lifetime, so an in-place session swap showed a mix of both. Gated so a first
sign-in and the 25-min token refresh do not reload.

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

1. **Browser-test the new grants — nothing below has had a signed-in e2e run.**
   Every server path is proven by the 7 scripts, but the UI halves are unverified:
   the SAMO Shop แหล่งที่มา picker + a scoped admin's product list (0093), the
   ประกาศ read fix (a `creator` grantee should now see their own drafts), the
   admin account-switch reload, and the passport Google sign-in round-trip.
   `phuriphat.ma@kkumail.com` currently resolves to
   `managed_permissions={creator,pr,projects,samoshop,team,vs}`,
   `managed_project_seats={staff}`, `managed_passport_scopes={d:1}`,
   `managed_shop_sources={}` (so: blanket shop, เจ้าหน้าที่คณะ for หนังสือโครงการ,
   passport scoped to ฝ่ายบริหารองค์กร).
2. **Retire the passport `admin`/`1234` fallback.** It is one flag —
   `LEGACY_PASSWORD_LOGIN = false` in passport `js/admin-scope.js` — then delete
   the marked block, `handleLegacyLogin`, and `#admin-legacy-box`. While it is on,
   passport department scoping is opt-in, not enforced. Confirm every passport
   admin has a ทีม SAMO grant first (today: `putita.s` full, `phuriphat.ma` d:1).
3. **Passport RLS enforcement** — the `passport` schema is still `using(true)` for
   anon (0056), so the 0087 scope is a UI boundary only. Plan:
   `passport/SECURITY-HARDENING-PLAN.md`, still awaiting the 4 answers below; its
   policies must READ `passport_admin_context()`, not build a second admin table.
4. **When อาจารย์ / VPA migrate to personal kkumail accounts**, run
   `tools/proj-handover.mjs --from <shared> --to <personal> --apply`. For อาจารย์
   add `--sign-requests` — a sign request names ONE `prof_id`, so without it the
   personal account sees an EMPTY หนังสือโครงการ inbox (measured: saprof 11 docs,
   personal 0). Dry run first; it prints what it would change.
5. **Org-chart renderer** — contract exists (`get_public_org_chart()`), no UI.

## PR + VITALSOUND — stable, pruned to the archive

Both shipped and deployed (PR ฝ่าย single-source-of-truth `src/js/pr-depts.js`;
VS service desk + public board, migrations through 0080). Full write-up incl. the
VS confidentiality invariants: `docs/state-archive/2026-07-25-pr-vs.md`.

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
