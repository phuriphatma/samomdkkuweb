# ทะเบียนคน

> หนึ่งคนหนึ่งรายการ ใช้ร่วมกันระหว่างระบบบ้านและทีม SAMO

Status: **EXPAND + bidirectional sync shipped (0132, 0133).** `people` is live — 304 rows, every
`students` and `team_members` row linked, no duplicate humans by address, and
one writer keeping the copies in step. What remains is the CONTRACT step:
retire the duplicated identity columns, one reader at a time.

Proof: `node tools/house0132-registry.mjs` (19/19 — all three editors, both
mirrors, ชื่อเล่น through a generated column, link-at-birth, and the deny half).

**All three doors reach the registry** (0133, 0134): the person's own card via
`update_my_identity()`, and both admin panes via a mirror UP on each placement
table. Both mirrors are guarded by `is distinct from`, which is what makes them
converge in two hops rather than recurse — that guard is load-bearing.

✅ **THE KNOWN GAP IS CLOSED (0135).** `team_members` now carries
`first_name_th` / `last_name_th` and derives `full_name` from them, so a name
edited in the ทีม SAMO pane reaches ระบบบ้าน as two columns. **Nothing was
backfilled**: a row acquires the split when a human types one, and a row that
still holds only a combined name never overwrites a person who has the split —
that would require guessing where the surname starts.

0135 also removed the reverse of the same bug, which was live and unreported:
`my-seat.js` split the person's own ชื่อ-สกุล on whitespace on the way to
ระบบบ้าน. `src/js/name-split.test.js` now fails the build on any module that
reconstructs a split from a combined string.

Proof: `node tools/team0135-name-split.mjs` (16/16).

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

## What 0132 actually built

```
people            ← THE registry (renamed from team_people, which 0108 had
                    already built and populated but nothing read).
                    kkumail (unique where present), first_name_th, last_name_th,
                    full_name, nickname, student_id, major, cohort_year,
                    year_offset, bio, photo_url, photo_focus, user_id

students          ← house placement. person_id → people. sai_code, self_edited,
                    import bookkeeping. KEEPS its identity columns for now.
team_members      ← org posting. person_id → people (already true since 0108).
                    KEEPS its identity columns for now.
```

**Not views.** The earlier plan proposed turning `students` and `team_people`
into views over `people`; that was rejected on contact with the code. Views
would need INSTEAD OF triggers for every write path and `security_invoker` on
every one of them — and "a VIEW without security_invoker reads its base table
with the VIEW OWNER's rights" is already an entry in `docs/mistakes/authz-rls.md`.
Keeping real tables and adding a mirror is less clever and much harder to get
silently wrong.

**The name shape resolved.** `people.full_name` is DERIVED from
`first_name_th` + `last_name_th` when those are present, and stands alone for
the 303 rows inherited from ทีม SAMO. Those were not split: "สมชาย ณ อยุธยา"
and "สมชาย ใจดี ดีมาก" both have three tokens and different answers, and the CSV
importer already refuses a combined column for that reason — a migration doing
what the importer refuses would be indefensible. Rows acquire the split when a
human supplies it.

**One writer.** `update_my_identity()` writes the house placement, every
ทีม SAMO posting, and the registry row from one call. That is what makes the
remaining duplicate columns safe: they are downstream of a single write.

## Migration path

Each step is independently shippable and independently revertible.

1. **DONE (0130)** — `lookup_student_by_kkumail(text)`: the ทีม SAMO member form
   fills itself from ระบบบ้าน instead of asking someone to retype. Removes the
   retyping, which is where the two copies diverge. No schema change.
1b. **DONE (0132)** — the EXPAND step, described above. Taken when `students`
   held THREE rows and exactly TWO humans existed in both tables; every day it
   waited, the backfill would have got harder and the duplicate count would have
   grown from two toward hundreds.
2. **DONE (0135) — split the ทีม SAMO name field.** Both columns added,
   `full_name` derived, both mirrors carry the split, nothing backfilled.

2a. **DONE (0137) — `search_people()`.** The member form finds a person by ชื่อ,
   นามสกุล, ชื่อเล่น, รหัสนักศึกษา, สาขา or kkumail instead of demanding the one
   field an admin does not have. Bounded: wildcards escaped, minimum 2
   characters, limit clamped to 50, identity-only projection, no anon grant.
   Proof: `tools/team0137-search.mjs` (14/14).

2b. **DONE (0138) — the roster import reconciliation.** See below.
2. **NEXT (b) — the CONTRACT step, one reader at a time.** Repoint each reader of a
   duplicated identity column at `people`, verify, then drop that column. Order
   by blast radius, smallest first: the CSV export, then the admin tables, then
   the ten `effective_team_*_for_email` resolvers (which still join
   `team_members.kkumail`), then the archives. **Do not batch them.**
3. **Repoint `team_members.year` at the derived ชั้นปี** (0131). 381 of 399 rows
   have a รหัส that yields a cohort and only 11 disagree with the computed year,
   so those 11 become `year_offset` values and the column goes. It waited for
   `people` precisely so it would not need a second offset column.
4. **Then `students` and `team_members` hold placements only** — sai_code,
   node_id, term, permissions, confirmed — and the registry holds the human.

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

## When the faculty file disagrees with a person (0138)

Three rules, and the third is what makes the other two work.

1. **Authority is per FIELD, not per actor.** สายรหัส is the university's own
   assignment and a student cannot know it better (0125 already removed their
   ability to write it). A person's ชื่อเล่น is not something a roster export can
   be right about. Between them sit รหัสนักศึกษา, ชื่อ, นามสกุล and สาขา, where
   either side can hold the typo.
2. **Silence is not agreement.** Somebody who never opened the page has claimed
   nothing, so the file simply writes — that is the great majority of the 1,800
   rows. Somebody who TYPED something has made a claim, and an import must not
   delete it quietly. `students.self_edited` (0125) already records the
   difference; 0138 only makes it visible.
3. **A disagreement is a thing, not a dropped write.** `students_keep_self_edits`
   discarded the file's value silently, which is the right outcome and an
   invisible one. It now records an `identity_conflicts` row instead.

**Who resolves it: the person.** 1,800 possible conflicts against one admin is
not a workflow; 1,800 people each answering one question about their own name
is, and each of them is the only one who knows the answer. The block on the home
page asks; the admin list is for whoever never comes. Both write through
`resolve_identity_conflict()`, which — when the file's value is chosen — also
releases the column from `self_edited`, because the person's claim has been
withdrawn and a future import should own that field again.

**`people.identity_confirmed_at`** is the operational half. It is the only thing
separating "looked at it, it is right" from "never opened the page", and those
need different follow-up. `identity_check_summary()` counts both, plus open and
resolved conflicts. Counts only — a list of names would be a roster projection.

The import preview says how many rows carry a value it will not be allowed to
write, with its own filter button. If that number is large the file is probably
wrong: several hundred people do not mistype their own names in the same week.

Proof: `node tools/house0138-conflicts.mjs` (21/21).

## Should ทีม SAMO's people be imported into ระบบบ้าน?

No, and the question dissolves once `people` exists. A `students` row is a HOUSE
PLACEMENT — it exists to carry `sai_code`, which decides the house — and ทีม SAMO
has no สายรหัส to give it. Creating ~380 placement rows with an empty สาย would
put those people in a house-less limbo the roster import would then have to
reconcile against, for no gain.

They are ALREADY shared: every ทีม SAMO member has a `people` row (0132/0133 link
at birth), which is where identity lives. When the faculty file lands, each of
them acquires a house placement by kkumail automatically, carrying the identity
they already have.

## The authorization question, stated

`students` holds ~1,800 people's names, รหัสนักศึกษา and kkumail, and its
standing rule is no public read and only hand-built projections (0086 / 0103 /
0108). A merged `people` table inherits that and gets stricter, because
ทีม SAMO's readers are wider.

0130 already made one deliberate widening: an admin holding only `team` can now
resolve one exact kkumail against ระบบบ้าน. That is bounded — exact match, one
row, named columns, no listing, no anon grant — and it is written down here so
the next widening is a decision rather than a drift.
