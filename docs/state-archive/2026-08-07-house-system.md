# 2026-08-07 — ระบบบ้าน (House), the DELETE guard, and the example-data scrub

Archived from `STATE.md`. Everything here is SHIPPED and live; kept for the
reasoning, not as a to-do list. Chronology: `git log --oneline`.
Commits: `2911686` → `83b940e` → `0259d3d` → `396f270` → `1c3c4d6` → `d62a374`.

---

## 1. "ลบสมาชิกไม่ได้" — every DELETE now reports a block

Reported as: cannot delete `j@kkumail.com` in ทีม SAMO, and **nothing happens at
all** on click.

**Not an RLS problem.** Simulating the DELETE as the signed-in account (which
holds `master`) inside `begin; … rollback;` returned `deleted_rows: 1`. Nothing
FK-references `team_members`; the only triggers are `AFTER UPDATE` and
statement-level. Three independent silent paths were stacked on one button:

1. `onDeleteMember`'s `if (!m) return` — a DOM row outliving its model.
2. A native `confirm()` the browser can permanently suppress. Chrome's *"Prevent
   this page from creating additional dialogs"*, once ticked, makes every later
   `confirm()` return `false` instantly with no UI. `team/index.js` calls
   `confirm()` in 8 places. **This is the leading explanation for the reported
   symptom and is why only delete broke** — แก้ไข/ย้าย open Bootstrap modals.
3. `deleteMember()` checking only `error`, when PostgREST answers an RLS-blocked
   DELETE with `204` and zero rows rather than an error.

**Fixed**: guards on all 5 deletes in `team/api.js` + 3 in `shop/api.js`
(`prefer: 'return=representation'` + a `data.length` check), matching what
`projects/api.js`, `vs-staff.js` and `announcements.js` already did. Both silent
early-returns now alert and resync. `bulkDelete` surfaces failures.
`src/js/delete-guard.test.js` sweeps every `method: 'DELETE'` in `src/js` and was
verified to FAIL when a guard is removed.

**STILL UNCONFIRMED**: the suppressed-`confirm()` diagnosis. A hard reload settles
it. If confirmed, replace the 8 native `confirm()` calls with an app-owned modal.

---

## 2. ระบบบ้าน (House) — migrations 0116–0121

Design: `docs/HOUSE-SYSTEM.md`. Handover spec: `docs/house-data-spec-th.md`.
Proof: `node tools/db-query.mjs tools/house0116-authz.sql`.

**The rule**: `house = the last digit of สายรหัส`. สายรหัส is 3 digits, **any
value `001`–`999`**, assigned at random by the university's mentor system and
**not derivable from รหัสนักศึกษา**. `sais.house_id` is a GENERATED STORED
column, so the rule has exactly one implementation.

Tables: `houses` (10 seeded, UPDATE-only), `sais` (derived from the import),
`advisors` + `sai_advisors`, `students`, `student_change_requests`,
`student_import_batches`, `house_settings`.

New permission key `house`, threaded through `PERM_CATALOG`, `ADMIN_FEATURES`,
`PERM_SECTION`, `SECTION_META`, `SIDE_FEATURE`, the sidebar and RLS on all 8
tables. `my-seat.test.js` caught the missing `SECTION_META` entry — which is
exactly why that test exists.

### Four decisions, all from the user, all simplifications

- **Nothing is gated on a date.** 0117 replaced the `sai_edit_until` deadline
  with a plain admin switch (default ON). The first cut shipped the correction
  workflow CLOSED until someone remembered to set a date.
- **No reveal flag.** An unnamed house *is* the un-revealed state; the UI renders
  "บ้าน N" whenever `name is null`. A `revealed_at` column would have been a
  second source of truth for a fact the data already carries.
- **ปีที่เข้า is derived from รหัสนักศึกษา**, so the CSV asks for **7 columns
  only** — no ชั้นปี, no ปีที่เข้า, no สถานภาพ.
- **`students.status` dropped** (0120). Never requested from Data Analytics, so
  it could only hold its default — and `get_house_roster` was *filtering* on it.

### Five bugs found by scanning, none user-reported

1. **The import was dead on arrival** (0119). `?on_conflict=kkumail` renders
   `ON CONFLICT (kkumail)`, which only binds to a unique index on the bare
   column; 0116 made kkumail unique with an EXPRESSION index on
   `lower(btrim(kkumail))`. Every chunk would have `42P10`'d. Fixed by
   normalising kkumail on write so a plain unique constraint says the same thing.
2. **สายรหัส was seeded as a fixed range** (0121). 0116 seeded exactly
   `001`–`100`; `students.sai_code` is a foreign key, so every student on a
   higher สาย would have failed with `23503`. `sais` is now DERIVED —
   `ensure_sais()` creates every distinct code the file contains, called before
   students are written. No maximum is written down anywhere.
3. **Two dead controls** in the student card — ยกเลิก and "แจ้งว่าข้อมูลไม่ถูกต้อง"
   are injected *after* the listener attached. Now one delegated listener.
4. **`missing_since` was never written**, though the import preview promised it.
5. **`fetchStudents` 416'd** when the row count was an exact multiple of the page
   size, and a **third copy** of the ชั้นปี rule lived in admin JS.

### Verified live, both directions

`tools/house0116-authz.sql`: anon **DENIED 42501** (revoked, not merely filtered)
· signed-in without the grant **0 rows** · `master` **2 rows** (the allow path,
without which the denials prove nothing) · roster exposes
`name/nickname/year/major/sai/photo_url` only, **no kkumail and no รหัส** · a
self-edit smuggling `status` + `sai_locked` applied the nickname and **ignored
both**.

Also proven: `houses` INSERT/DELETE blocked (42501) while UPDATE works; สายรหัส
self-edit works once → refused on the second (cap) → refused with the switch off
→ **and a nickname edit still works with the switch off**, so the gate is scoped
to สายรหัส alone. `ensure_sais` refuses a caller without the `house` permission.
`001/099/100/287/500/999` map to houses `1/9/0/7/0/9`; 4-digit codes rejected.

The last-digit split stays within one สาย of even at any range (tested over 100,
287, 300, 320, 450, 999) — ≈170 people per house at ~287 สาย.

---

## 3. Example data was a real student's identity

`653070317-0` is the repo owner's actual รหัสนักศึกษา. It had spread into the CSV
template that goes to another department, the handover spec, migration comments,
unit tests, and **two form placeholders rendered on the live site for every
user** — in a **public** repo.

Replaced with `659999999-9` (faculty code 9999 cannot exist; the `65` prefix is
kept so the ชั้นปี examples still compute). Sample names are now Thai textbook
placeholders (มานี ใจดี / ปิติ รักเรียน / ชูใจ ดีงาม / วีระ ตั้งใจ /
สุดา ณ ลำปาง — the last keeps the multi-word-surname example).

**8 stale `analytics-*.js` chunks on the VM were still serving it.** The deploy
script keeps old chunks for 7 days so open tabs don't 404 mid-session; those 8
were purged specifically, the 19 current chunks left alone, site verified 200.

---

## 4. Deploying to the VM — three traps, each hit for real

Captured in `skills/deploy-vm.md`:

1. **`-tt` is required.** sudo's credential cache is per-TTY and `deploy.sh`
   re-execs itself, so without a PTY it dies *after* both builds.
2. **Never combine a heredoc with a stdin pipe** — the heredoc claims ssh's
   stdin and the password gets executed as a remote command, echoing it into the
   transcript. This happened; **the VM sudo password needs rotating.**
3. The trailing `sleep` that holds stdin open means the wrapper exits **143 after
   a successful deploy**. `DEPLOY_EXIT=0` is the real verdict.
