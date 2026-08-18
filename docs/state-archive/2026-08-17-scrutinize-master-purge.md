# 2026-08-17 — the /scrutinize pass, master ≠ dev, and the shared-account purge

Moved out of `STATE.md` on 2026-08-18 (it was ~80 lines of finished narrative
that the NEXT-SESSION PROMPT already summarises; STATE.md itself named this as
the next structural prune). Everything below is the text as it stood.

⚠️ **ONE PART IS NOW OUT OF DATE**, and that is why it is here rather than in
STATE: the purge section says `sastaff` and `saprof` were KEPT with their weak
`1234` passwords. **They were DELETED on 2026-08-18** — their work was
reassigned to the named เจ้าหน้าที่คณะ / อาจารย์ who hold the ทีม SAMO seats,
and both usernames stay RESERVED in `auth.js`. See `.claude/rules/security.md`.
A second thing it does not know: the reassignment covered every uid COLUMN and
missed the JSONB timelines, fixed by migration `0166` the next day.

---

## จองโควตา Claude — /scrutinize pass (2026-08-17), migrations through 0164

Deployed bundle `admin-DDDRehOn.js` (verified from served `/admin/`).
- ✅ **Finding 1 FIXED (migration 0164 applied live):** `claude_usage_runs`
  marked a PAST week's final run `open_ended=true` (v_last_at is scoped to the
  requested range, not now) → historical weeks said "อาจยังใช้อยู่". Now guarded
  by `+ and p_to > now()`; new §G past-week case in
  `tools/claude0162-usage-runs.sql` (falsified 0→1).
- ✅ **Finding 3 FIXED:** the master-only "จองแบบเงียบ" toggle read
  `holdsMaster()` once at `wire()`, stale on an in-place account switch. Now
  re-decided per entry in `paintSilentToggle()`; listener still wired once.
- ⛔ **Finding 4 was STALE** — `claude_usage_samples_at_idx` already exists. No
  change made.
- ⏳ **Finding 2 (0161 cost claim) still open** — unbenchmarked; low priority.
- ➕ **ข้อตกลง gained two usage tips** (Sonnet/Haiku for light work; don't work a
  chat left open >30–60 min — context reload burns quota, /clear before a
  break). `TERMS_VERSION` bumped to `2026-08-17` so everyone re-sees it.

⚠️ **`claude0157-rail-segments.sql` is currently RED on control B4** — NOT a
regression from this work. There are **0 active bookings** right now, so the
rail has no stepping deadline and B4 (a control that refuses to pass vacuously)
goes red exactly as designed. The scenario is not fully self-contained: its
step-down depends on live booking geometry. **Fix (follow-up): add a second
synthetic booking that guarantees a stepping deadline independent of live data**
— but do NOT tune it to merely pass; verify B1/B2/B5 stay meaningful. The other
5 claude proofs + all 1122 tests are green.

## master ≠ dev role — frontend gates fixed (2026-08-17, deployed)

Reported: a `master` holder (phuriphat.ma, ทุกระบบ from ฝ่าย IT) found features
missing vs the shared `samomdkkudev` (role=dev). Cause: `master` is honored by
PERMISSION gates + RLS but a master holder is `role='user'`, so `role === 'dev'`
/ role-literal gates skipped them. Fixed the two reported sites:
- `main.js` `.dev-only-feature` (the PR/VS "ไม่ส่งแจ้งเตือน Discord" toggle) →
  `role !== 'dev' && !holdsMaster(user)`. **Verified in served bundle.**
- `vs-staff.js` `isVsSuper()` → `|| holdsMaster(u)`, matching the DB (which
  already made master VS-super).
- Guard: `src/js/master-role-gates.test.js` (falsified). Write-up in
  `docs/mistakes/authz-grants.md`, class 5.
- **Left as-is per owner**: the ~28 `role === 'dev'` gates in `src/js/projects/*`
  (หนังสือ send flow) — driven by the project-seat picker, not master.

Also confirmed same day: **ร้านค้า "0 รายการ" is NOT a bug** — 3 products exist,
all `is_active=false` (test items), hidden by a human on 2026-08-16 (saved one at
a time). No product was ever deleted; the account purge cannot delete products
(`shop_products.created_by` is SET NULL). Storefront shows active-only.

## Security — shared-account purge (2026-08-17)

**15 shared password accounts DELETED PERMANENTLY** (auth + public.users), after
their data was reassigned to real people first: the 10 VP accounts,
`samomdkkupr`, `samomdkkudigital`, `samomdkkupresident` (was role=dev),
`samomdkkuvssound`, `samomdkkushop`, and `passportadmin`. Reason: their
`samo69*` / `1234` passwords were published in the PUBLIC repo and verified to
open live dev/vp_admin sessions.

**KEPT** (owner's decision): `samomdkkudev` (owner will rotate its pw),
`sastaff`, `saprof` (both still have the weak `1234` pw — flagged, not rotated),
and `claude-reporter` (machine account).

**Attribution transferred BEFORE delete** (so nothing orphaned; every SET-NULL
column verified 0 before deletion):
- samomdkkuvpa → **พรู** (jinjutha.t): created_by on 27 projects/42 docs/47 files
  + its 43 read/unread rows (via `tools/proj-handover.mjs`). พรู holds `master`,
  which grants all project seats at the RLS level, so she sees them all; she was
  also given the explicit `vpa` seat.
- pr_tickets: samomdkkupr + samomdkkudigital → **พู่กัน** (putita.s);
  samomdkkupresident → **สายป่าน** (worapat.c); samomdkkuquality → **เอ๋ย** (naphat.pr).
- samomdkkuvssound → **ปัน** (nattapong.chi): 9 vs_tickets + 1 public comment.

⚠️ **`current_user_project_seats()` folds `master` → {vpa,staff,prof}** — a master
holder IS a project actor and sees ALL หนังสือโครงการ. The team editor stores
`master` alone and nulls the explicit project_seat on purpose (master already
covers it). This is NOT a bug; do not "fix" it by forcing a seat under master.

**Repo scrubbed**: `samo69*` literals removed from `tools/vp-accounts.mjs`,
`tools/president-account.mjs` (both now read a `*_SEED_PASSWORD` env var and
REFUSE to reseed without it) and from `docs/`. `tools/saprof-account.mjs` still
carries `1234` — saprof is a KEPT account, left per owner. No src/ change → **no
deploy needed**; the DB changes are already live.
