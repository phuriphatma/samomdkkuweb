# STATE — current task & latest known state

Last updated: 2026-07-24 (end of session, pre-/clear). Slim by design — "what is
true right now". Full per-deploy narrative of this session:
`docs/state-archive/2026-07-24-full.md`; chronology: `git log --oneline`;
architecture/RLS: `docs/CONTEXT.md`; bug post-mortems: `.claude/rules/mistakes.md`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
- Live web = latest `main` (every deploy this session was committed+pushed; tree
  clean). Verify with `/build.json` vs a fresh local `npm run build`.
- Deploy method: ssh `samo-vm` → pull → `npm ci` → build → sudo rsync `dist/` →
  `/var/www/samo-web` → `nginx -t` → reload. Sudo pw = `.env.local
  SAMO_VM_SUDO_PASSWORD` piped to `sudo -S` (env vars don't cross ssh — pipe via stdin).
- One Supabase project `fheueuowbchsnsvbcgil` (web `public` + passport in `passport`
  schema). Migrations applied through `tools/apply-migration.mjs` (Management-API PAT).

## VITALSOUND — service-desk system (all DEPLOYED + migrations APPLIED through 0078)

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
