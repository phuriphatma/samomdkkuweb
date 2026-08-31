# House system

> Houses and the student directory — design document

**Status: SHIPPED** (migrations 0116–0118 applied; admin + student UI live).
Handover spec for the Data Analytics dept: `docs/house-data-spec-th.md`.
Authorization proof: `node tools/db-query.mjs tools/house0116-authz.sql`.

Runs with **zero data**: until the ~1,800-row import lands, the admin ภาพรวม
says so plainly and no student gets a card. Nothing is gated on a date — the
สายรหัส self-edit is an admin switch (default ON), and a house with no name
simply renders as "บ้าน N".

---

## 1. What this is

Replace the invisible อาจารย์ที่ปรึกษา system with **10 houses**, every student
in the faculty (~1,800, ปี 1–6) placed in one, revealed by ฉลาก at งานป้ายทอง.
A student signs in with their kkumail and sees their own record, their สายรหัส,
their อาจารย์, and their house.

**The one rule everything hangs off:**

> house = **the last digit of สายรหัส**

สายรหัส is **3 digits — any value from `001` to `999`.** There is no smaller
ceiling and none is assumed anywhere: a สาย is the running number within a
cohort, so how high they go is simply how many students a year has, and that
moves. `sais` is **DERIVED from the import** — the importer creates every
distinct code it sees before writing students.

0116 seeded exactly `001`–`100`, and because `students.sai_code` is a foreign
key, that would have rejected every student on a higher สาย on the first real
import. Fixed in 0121: nothing is seeded and no maximum is written down.

The last-digit rule stays balanced at any size — the ten houses can differ by at
most one สาย, whatever the highest number is (pinned by a test over 100, 287,
300, 320, 450 and 999).

**สายรหัส is NOT derived from รหัสนักศึกษา.** It is the university's own
อาจารย์ที่ปรึกษา assignment, handed out at random, and the university's list is
the only authority for it. Nothing in this system may compute, infer or "repair"
a สายรหัส — it is imported data, and a row without one is blank, never guessed.

The rule has a second useful property: **it does not depend on the digit
count.** If the source turns out to be 2- or 4-digit, the last digit is still
the last digit. What must be consistent is the *width* — `1`, `01` and `001` in
one file become three different สาย, which is why the spec spends most of its
สายรหัส section on Excel eating leading zeros.

### Two things to confirm before building

1. **Confirm the width is really 3.** The RANGE does not need confirming — the
   system derives it from the file and never assumes a maximum.
2. **Should students see who else is in their house?** Assumed **yes** below,
   as a name-only projection with an opt-out. It changes the privacy design.

---

## 2. Why a new set of tables, not `team_people`

`team_people` is the SAMO org roster — ~285 people, and every row is
permission-bearing: ten resolvers (`effective_team_*_for_email`) join through
`team_members` to decide what someone can do. Putting 1,800 ordinary students in
there would put 1,800 rows inside the permission engine's blast radius for no
benefit, and every existing proof script asserts against those row counts.

So: separate tables. A person can be in both; the join is **kkumail**, not an FK
— the same key `team_people` already treats as identity (proven by Google login,
never typed).

```
houses          10 fixed rows, id 0–9
sais            derived from the import, code '001'..'999', house_id GENERATED
advisors        อาจารย์ (a person)
sai_advisors    which อาจารย์ advises which สาย (many-to-many)
students        the ~1,800
student_change_requests   the correction queue (§7)
student_import_batches    one row per import, for audit + rollback identification
house_settings            single row: academic year, reveal flag, freeze date
```

### The house rule lives in SQL, not JS

```sql
create table sais (
  code     text primary key check (code ~ '^[0-9]{3}$'),
  house_id smallint generated always as ((right(code, 1))::smallint) stored
           check (house_id between 0 and 9),
  ...
);
```

A **generated stored column** means the rule cannot drift, cannot be hand-edited
wrong, and cannot disagree with the UI — because JS never computes it, it reads
`house_id` off the row. This repo's most-repeated bug is one rule with two
implementations; this is the cheapest possible way to have exactly one.

(`right(text,int)` and the smallint cast are both immutable, so the expression is
legal in a generated column.)

### `houses` has 10 rows and no delete

The 10 houses are *defined by the digit*, not by an admin. So the table is seeded
0–9 at migration time and the UI offers **edit only** — name, slogan, colour,
logo — plus "reset to placeholder". There is no Create and no Delete, because an
11th house is unreachable by the rule and a deleted house would orphan 10 สาย.

This is a deliberate narrowing of the "CRUD for house name/icon" ask: C and D
would be controls that can only produce a broken state. Everything actually
wanted — set the name, upload the logo, change them later, clear them — is
covered by U.

### `students` — imported truth vs. what the student typed

Only one field is genuinely contested between the import and the student:
ชื่อเล่น. So rather than a generic override layer, pair just that column:

```
nickname_imported   written by the import, always
nickname_self       written by the student, only
nickname            generated: coalesce(nullif(nickname_self,''), nickname_imported)
```

`photo_url`, `bio` are **self-only** — the import
has no source for them and must never write them. Identity columns
(`kkumail`, `student_id`, names, `major`, `sai_code`, `cohort_year`) are
**import-only**.

Result: the import is safely re-runnable any number of times and can never
destroy a student's own edits. That property is worth more than it sounds — it
is what lets you accept a corrected file from Data Analytics in October without
auditing what 1,800 people changed in September.

### รุ่น, not ชั้นปี (0123)

Stored: `cohort_year` (ปีที่เข้า, พ.ศ.), itself derived from the first two digits
of the รหัสนักศึกษา when the file does not carry it. Displayed: **`MD{cohort −
2515}`** — 65… is MD50, 64… is MD49 (`cohortLabel` in `src/js/house/fields.js`).

ชั้นปี used to be shown instead, as `coalesce(year_override, academic_year −
cohort_year + 1)`. It is gone, and so are `student_year()` in SQL and its JS
mirror. Three structural reasons, all of which รุ่น does not have:

- it needs a **clock** — `house_settings.academic_year`, a setting somebody has
  to move every August, and until they do every record reads wrong;
- it is wrong for anyone who ลาพัก / เรียนซ้ำ / จบช้า, which is what
  `year_override` existed to patch — a per-student manual correction of a
  derived value;
- it is **ambiguous across time**: "ปี 1" in a row written last year and "ปี 1"
  in a row written today are different humans, so old and new records cannot sit
  in one list.

รุ่น is fixed at admission and needs no maintenance. The spec still asks Data
Analytics not to send ชั้นปี — now because nothing consumes it at all.

---

## 3. Reading the data — the part that has to be right

`students` holds 1,800 kkumail addresses and รหัสนักศึกษา. This repo already has
the rule, twice over (0086, 0103, 0108): **a table holding kkumail/รหัส gets no
public SELECT policy, ever.** Published directories are hand-built projections.

Four read paths, no more:

| Path | Who | Returns |
|---|---|---|
| `get_my_student_record()` | the signed-in student | their own row + สาย + house + their อาจารย์ |
| RLS `select` on the tables | holders of the `house` permission | everything |
| CSV export | same, via the admin read path | everything |

`get_my_student_record()` follows `get_my_seat()` (0109) exactly: SECURITY
DEFINER, **takes no argument** — identity comes from `auth.uid()`, so there is no
address to probe with — and returns a hand-built `jsonb` allow-list, never
`returns setof students` (which would auto-expose any column a future migration
adds; the 0079/0080 trap).

Self-writes go through `update_my_student_record(jsonb)` with a hard column
allow-list **inside the function**, and there is deliberately **no self-UPDATE
RLS policy at all**. A per-row UPDATE policy is not a column policy — this repo
has now been bitten by that on `users` (0028), `vs_tickets` (0096) and
`shop_orders` (0100). Not having the policy is stronger than guarding it.

**No student is published to another student.** There was a `get_house_roster()`
projection behind a "เพื่อนร่วมบ้าน" button; 0124 dropped both. What the card
shows instead is the อาจารย์ที่ปรึกษา of every สาย in the house (`house_advisors`,
already in `get_my_student_record`) — the thing people actually came to find
out, and staff rather than classmates. `students.is_listed` and
`house_settings.roster_visible` are vestigial from that removal.

---

## 4. The reveal

House names and logos must not be readable before **21–22 พ.ย.** — including
from the network tab. So `house_settings.revealed_at` is enforced **server-side**
in the RPCs, not in the UI: before the date the payload literally does not
contain names or logo URLs, only the digit.

Before reveal a student sees **"บ้าน 3"** and a locked card. That is the ลุ้น
ครั้งที่ 1 — they can already work out which สาย are with them, which is exactly
the "อาจหาคนดังว่าบ้านนี้มีใคร" effect wanted.

---

## 5. Permission + admin UI

One new permission key: **`house`**. `master` already answers yes to every key
(0111), so no extra work there.

Because "a new access channel must be threaded through EVERY gate" is the single
most repeated bug in this repo (0089 → 0090 → 0091 → 0093 → 0102), the full
thread list, to be done in one commit:

- `PERM_CATALOG` in `src/js/team-vocab.js` — puts it in the ทีม SAMO perm grid
- `ADMIN_FEATURES` — lets it open `/admin/`
- `PERM_SECTION` in `src/js/my-seat.js` — the ตำแหน่งของฉัน card's CTA link
- `SECTION_META` + the sidebar item + `canUseAdmin()` in `src/js/admin-main.js`
- RLS on all 7 tables — **writes and reads**, plus `revoke all … from anon`
  explicitly (a revoke you can see beats a denial you have to reason about)
- `my-seat.test.js` pins `PERM_SECTION` against `SECTION_META`; `team-vocab.test.js`
  pins the catalogue — both must be extended in the same commit

Deliberately **one rung, not two** (no `house_edit` yet). The obvious second
audience is อาจารย์ wanting to see their own สาย — but that is a *scope*, not a
rung, and อาจารย์ have no login today. Adding it later is a policy edit.

### Admin section "ระบบบ้าน", six panes

1. **ภาพรวม** — 10 house cards (logo, name, member/สาย/อาจารย์ counts) + coverage
   stats: how many have a สายรหัส, how many do not.
2. **นำเข้าข้อมูล** — pick file → **preview diff** (`จะเพิ่ม N · แก้ไข M ·
   ไม่เปลี่ยน K · มีปัญหา P`) → confirm → chunked upsert on kkumail. Batch
   history with counts and who ran it.
   **Never deletes** rows absent from the file — it stamps `missing_since`
   instead. A blind sync would wipe self-edits and anyone Data Analytics
   happened to omit.
3. **บ้าน** — edit name/slogan/colour, upload logo (reuse `image-crop.js` +
   `uploadTeamFile` under a `Team/_House/` folder, so **no GAS redeploy and no
   new OAuth scope**), and the reveal switch.
4. **สายรหัส** — every สาย the import created, grouped by house; the house is
   read-only (generated). **Click a สาย to add/remove its อาจารย์** — the same
   `sai_advisors` rows the อาจารย์ pane edits from the other side, because
   "who looks after สาย 017" is where an admin actually starts. Search by สาย or
   by อาจารย์ name, and filter to the สาย that still have none.
5. **นักศึกษา** — searchable, filter by house/สาย/รุ่น/สาขา, edit a row,
   **export CSV**.
6. **คำขอแก้ไข** — the queue from §7.

**The minimum useful row is `kkumail + สายรหัส`** (0126). `first_name_th` is
nullable: the import file may deliberately carry no names, because the two things
this system cannot derive are the สาย and the address, and the student types their
own name (0125). The recommended ask is four columns —
`kkumail, student_id, sai, major` — which keeps รุ่น and สาขา while no name leaves
Data Analytics. A file with ONE combined "ชื่อ-สกุล" column is still refused: no
name column names nobody, one combined column would rename everybody whose
surname has a space.

**Import/export share ONE vocabulary — the table's column names.** The export
writes them, the importer canonicalises to them, and the friendlier spellings a
spreadsheet arrives with (`sai`, `nickname_th`, `ชื่อ`, `อีเมล`) are aliases
resolved at the door. An export can therefore be handed straight back to the
importer. Two consequences worth knowing: a GENERATED column is exported only if
the importer has no alias for it (`house` yes, `nickname` no — see
`docs/mistakes/app-state.md`), and **an import only writes the columns its file
actually contained**, so a partial file cannot clear what it does not mention.

**Export is a backup, so its column list is an allow-list with the opposite safe
default from a public projection**: a column left out of a backup is silently
destroyed on the next export→import round trip. `io.js` already carries this
lesson in a comment; the house export must carry it too, with a test.

---

## 6. Phasing against the real dates

| When | Ship |
|---|---|
| now → data arrives | schema + import + admin read/export. Nothing student-facing. |
| before mid-Sept promo | student self-view: "คุณอยู่บ้านหมายเลข ?" (number only) + self-edit ชื่อเล่น |
| Oct (onsite talk) | อาจารย์ per สาย + อาจารย์ทั้งบ้าน visible, badge |
| early Nov | สายรหัส self-edit **freezes**; names/logos loaded but hidden |
| 21–22 Nov | flip `revealed_at`. Names + logos appear. Export "รายชื่อตามบ้าน" for the event. |
| later | house points / กีฬาสี |

---

## 7. สายรหัส corrections — the "will I have to manage it all?" problem

Your friend's instinct is right about the risk (a freely editable สายรหัส is
house-shopping) but it converts **every genuine typo into your inbox**. Three
layers invert that:

**1. Prevent — catch it at the file, not at the student.**
There is no derivation to check against: สายรหัส is random and the university's
list is the only truth. So the leverage is entirely in the import. The importer
refuses a file whose `sai` values are not all the same width (the leading-zero
failure, which silently merges `001` into `1`), reports every สาย whose member
count is far from ~18, lists สาย codes that appear in the file but not in the
university's list and vice versa, and shows blank-สาย rows as a count to chase
rather than importing them as a house. Every one of those is a transcription
error caught before 180 people see a wrong house.

**2. Self-serve window — front-load corrections to when they are free.**
From launch until a freeze date in early Nov, a student who sees the wrong สาย
fixes it themselves: one confirm dialog saying plainly *"การแก้สายรหัสจะย้ายบ้าน
ของคุณ"*, capped at **one** change, every one logged.

This is the key move. **Before the reveal, changing สาย is not a house transfer
in anyone's mind** — houses have no names, no logos, no points, nothing to
prefer. Corrections cost nothing socially and zero admin time. Expect ~95% of
all corrections ever to happen here, for free.

**3. Request queue after the freeze.**
The button changes from "แก้ไข" to "แจ้งข้อมูลไม่ถูกต้อง" and writes a row to
`student_change_requests` (field, current, requested, reason, optional photo of
the student card). Admin approves/rejects in one click; the reason goes back to
the student. Approve applies the change and moves the house automatically, with
an audit row.

There is **no "ยืนยันข้อมูลของฉัน"** button (removed in 0123). It stamped
`verified_at`, nothing branched on it, and it asked ~1,800 people for a click
that bought a number on an admin card. A per-student `sai_locked` flag remains,
for the rare abuser.

Net effect: the queue only ever carries exceptions, and it carries them as a
triaged list with a decision button rather than as chat messages.

**One consequence of สายรหัส being random and un-derivable:** a student cannot
check their own สาย against anything, so a wrong value is invisible to them
until it is compared with the university's mentor list. That makes the
verification window (layer 2) the *only* cheap detection mechanism there is —
which is a reason to open it early and promote it, not to skip it.

---

## 8. Naming

The system replacing mdkkulife still has no name. Not blocking — every table
above is named for what it holds (`students`, `houses`, `sais`), not for the
product, so a name can be chosen at promo time without a migration.
