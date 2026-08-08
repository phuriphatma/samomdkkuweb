# One person registry — ระบบบ้าน + ทีม SAMO

Status: **proposal**. Migration 0130 shipped the interim bridge (an exact
kkumail lookup); nothing below has been built.

## The ask

> "I think House and teamsamo should be integrated to use the same data, like
> many fields are similar, like the house system will hold more people than
> teamsamo, but when adding people in teamsamo, or add to roles, department they
> should can use the data from house system, like there should be one big system
> that hold account management"

Correct on every point, including the sizing: `students` will hold ~1,800 people
and `team_people` holds ~380 of the same humans.

## What is actually duplicated

| Fact | `students` (ระบบบ้าน) | `team_people` (ทีม SAMO) |
|---|---|---|
| identity key | `kkumail` (unique) | `kkumail` (unique) |
| ชื่อ / นามสกุล | `first_name_th` / `last_name_th` | `full_name` (one column) |
| ชื่อเล่น | `nickname_imported` + `nickname_self` → `nickname` | `nickname` |
| รหัสนักศึกษา | `student_id` | `student_id` |
| สาขา | `major` → `team_majors` | `major` → `team_majors` |
| cohort | `cohort_year` → รุ่น MDnn | `year` (ชั้นปี 1–6) |
| photo | `photo_url` / `photo_focus` | `photo_url` / `photo_focus` |
| login link | `user_id` | `user_id` |

Eight of nine fields are the same fact stored twice. Both already agree that
**kkumail identifies the person and รหัสนักศึกษา is a field somebody typed** —
that is 0108's finding, and it is what makes a merge possible at all.

The two genuine differences:

- **Name shape.** `students` splits ชื่อ / นามสกุล; `team_people` has one
  `full_name`. The split is the stricter form and the importer refuses a
  combined column precisely because splitting renames people ("สมชาย ณ อยุธยา").
  A merged table keeps the split and generates `full_name`, which `students`
  already does.
- **Cohort vocabulary.** ระบบบ้าน uses **รุ่น** (MD50, fixed at admission,
  needs no clock); ทีม SAMO uses **ชั้นปี** (1–6, needs a current academic year
  and is wrong for anyone who ลาพัก / เรียนซ้ำ / จบช้า). See `house/fields.js`
  `cohortLabel` for why ชั้นปี was dropped from ระบบบ้าน. A merge must pick one,
  and รุ่น is the one that is a fact rather than a calculation.

## What must NOT merge

Membership is not identity, and this is the line the whole design rests on.

- `team_members` — a person's **placement** in the org tree (node, term,
  position, permissions, `confirmed`). One human can hold several placements
  across terms; that is what `team_people` → `team_members` already models.
- `students.sai_code` — the university's own อาจารย์ที่ปรึกษา assignment, and
  the thing that decides the house. It belongs to ระบบบ้าน and nothing in
  ทีม SAMO should read or write it.
- The grant channels (`users.permissions`, `users.managed_permissions`,
  `managed_vs_depts`, `managed_project_seats`). Those hang off `users`, i.e.
  off a LOGIN, not off a person. Someone can exist in the registry with no
  account at all.

So the shape is **one `people` table, many membership tables** — not one table
with a `kind` column.

## Proposed target

```
people                     ← the registry. One row per human, keyed on kkumail.
  kkumail (unique), first_name_th, last_name_th, full_name (generated),
  nickname_*, student_id, major, cohort_year, photo_url, photo_focus, user_id

house_placements           ← was students' house half
  person_id → people, sai_code → sais, self_edited[], missing_since, …

team_members               ← unchanged, repointed from team_people to people
```

`students` and `team_people` become views over `people` (+ its placement table)
so every existing reader keeps working while call sites are migrated one at a
time. That is the only way to do this without a flag day.

## Migration path

Each step is independently shippable and independently revertible.

1. **DONE (0130)** — `lookup_student_by_kkumail(text)`: the ทีม SAMO member form
   fills itself from ระบบบ้าน instead of asking someone to retype. Removes the
   retyping, which is where the two copies diverge. No schema change.
2. **A differential report.** For every kkumail in both tables, list the fields
   that disagree. This is the same job `ตรวจสอบข้อมูล` already does within
   ทีม SAMO, pointed at the pair. **Do this before any merge** — a merge decides
   a winner for every conflict, and you want to have read the conflicts first.
   Expect the bulk to be ชื่อเล่น and สาขา spelling.
3. **Create `people`, backfill from both, keep both tables as views.** The
   backfill needs one rule per conflicting field. Proposed: ระบบบ้าน wins on
   ชื่อ / นามสกุล / รหัสนักศึกษา (it comes from the university), ทีม SAMO wins on
   photo (it has the crop pipeline), newest write wins on ชื่อเล่น and สาขา.
4. **Repoint writers**, one module at a time. Readers keep using the views.
5. **Drop the views** when nothing references them.

## The three traps this repo has already paid for

- **A merge must not merge on a name.** 0108: `673070332-6` is one mistyped
  รหัสนักศึกษา on two different humans. kkumail, or nothing.
- **Every read path, not one.** Step 3 creates a second way to read a person.
  0089 → 0090 → 0091 → 0093 → 0102 is the same bug five times: a new channel
  threaded through the write path and not through the audience lookup, the
  definer RPC, and the UI's `role === 'x'` branch.
- **Two implementations of one rule drift.** During steps 3–5 there are two
  writers for one fact by construction. The differential test from step 2 must
  keep running for the whole migration, in CI, not as a one-off.

## The authorization question, stated

`students` holds ~1,800 people's names, รหัสนักศึกษา and kkumail, and its
standing rule is no public read and only hand-built projections (0086 / 0103 /
0108). A merged `people` table inherits that and gets stricter, because
ทีม SAMO's readers are wider.

0130 already made one deliberate widening: an admin holding only `team` can now
resolve one exact kkumail against ระบบบ้าน. That is bounded — exact match, one
row, named columns, no listing, no anon grant — and it is written down here so
the next widening is a decision rather than a drift.
