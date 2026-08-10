# 2026-08-10 (late) — 0147/0148, the identity swap, and the first signed-in browser pass

Narrative for the second session of 2026-08-10. `STATE.md` keeps only the
invariants; this is the reasoning and the order things were found in.

## What shipped

| Commit | What |
|---|---|
| `237a82d` | **0147** — `public.users` SELECT is self-only. Closed the last open security item. |
| `87df685` | Two proofs that had stopped guarding anything (`house0116-authz.sql`, `proj0092-seat-parity.mjs`). |
| `599a767` | **0148** + the ทีม SAMO identity-swap guard, the "พบคนนี้ในระบบแล้ว" panel, portrait filenames. |
| `46dc306` | The dead ยกเลิก button in `askConfirm`. |
| `05a3a86` | Sign-in redesign (Google first, kkumail named) + ระบบบ้าน's silent empty state. |
| `c33d5cf` | `duplicateMessage()` reaching all four write paths instead of one. |

## The security item (0147)

Open since 2026-08-09, asked three times, approved on the third. `users_read_all`
was `auth.role() = 'authenticated'` since 0001 — every signed-in account could
read all 531 rows: every email, the phones that are set, and because `role` and
`permissions` share the row, a map of which accounts hold `master`/`dev`.

The policy carried its own justification in a comment ("needed for staff
dashboards to show submitter info") and that justification had been false for a
long time — tickets denormalise their submitter at submit time. **The
transferable lesson is to re-read what a rule CLAIMS to need, not just what it
permits.**

What made it safe to tighten was checked first, against the live catalog, with
controls: of 109 policies, the 5 with inline subqueries were printed and none
names `users`; zero SECURITY INVOKER functions read it; zero views exist. The
first version of that sweep returned zero for the hazard AND zero for its
control, which is worth nothing — see `skills/write-a-guard.md`.

## The identity swap — the worst bug of the session

Reported as: *"when i press at myself แก้ไขสมาชิก then i ค้นหาคนจากระบบ พู่กัน
then click … it fills this information, and พู่กัน picture become myself."*

`pickPerson()` was written for **เพิ่มสมาชิก**, where overwriting the form is the
point, and never looked at `teamMemberId`. In **แก้ไขสมาชิก** the same click
reassigns a posting to a different human — and three correct mechanisms then did
the damage:

1. save writes the picked `kkumail` onto the posting;
2. `team_members_link_person` repoints `person_id` at that person's registry row;
3. `team_member_mirror_up` writes the FORM's fields up into it, photo included;
4. `person_mirror_down` fans it to every other posting they hold and their
   `students` row.

Measured afterwards: five rows across `people`/`students`/`team_members` had
collapsed onto one portrait. Repaired through the registry so the same mirror
carried the correct photo back down; verified all four of พู่กัน's rows and that
เอิง's was untouched.

**The general shape: a control that changes WHICH ENTITY a row refers to is not
an edit control, and with mirrors in place it is a multi-system write.**

The photo half could not be fixed client-side — `search_people` returned no
portrait, so the form described one person while holding another's face, and
clearing it would be no safer because the mirror assigns unconditionally. Hence
0148.

## The dead ยกเลิก button

Found by driving the UI, not by any test. Clicking ยกเลิก in `askConfirm` did
nothing — by coordinate and by element ref. Only ESC worked. Nothing binds a
handler to `[data-confirm-no]`; the promise resolves from `hidden.bs.modal`,
which is good design but only works if something HIDES the modal, and the
`data-bs-dismiss="modal"` attribute was never written. 21 call sites.

The module exists *because* Chrome's "prevent additional dialogs" checkbox turns
native `confirm()` into a silently-false no-op. **A fix for a bug class is not
immune to that class.**

## Guards that were wrong — including three I wrote

This is the theme worth carrying forward, and why `skills/write-a-guard.md` now
exists.

- `house0116-authz.sql` had been **dead since 0124** — it called a dropped
  function from inside its `DO` block, so zero assertions ran for 23 migrations
  while still looking like coverage. It also named an email that has never
  existed in `public.users`, so its ALLOW half was always vacuous.
- `proj0092-seat-parity.mjs` had been failing for an entirely correct reason —
  its hardcoded member no longer inherits a seat.
- **My** authz sweep's control returned zero alongside the hazard.
- **My** `confirm-modal.test.js` passed with the bug reintroduced, matching
  `[data-confirm-no]` inside a *comment*.
- **My** `buttonTag` helper used `indexOf` and found the marker in a comment.
- **My** explanatory comment, written inside a template literal with backticked
  attribute names, ended the template literal and broke the build.

Every one is the same failure: the instrument could not see, or was satisfied by
prose. The ritual that catches all of them is *reintroduce the bug and watch it
fail.*

## The portraits that "did not show" — CLOSED, and the diagnosis was mine to get wrong

Owner reported not seeing several portraits. Every check passed: all 5 files
return HTTP 200 for every CDN variant the app requests, `get_public_org_chart()`
publishes all 6 photo-carrying postings, and images render on the public org
chart, the home card, the admin dashboard and the member modal.

Then the owner refreshed and saw their card — so it was transient. The cause is
almost certainly `loading="lazy"`: every portrait sits behind an initials
placeholder until it scrolls into view, and a slow link (or a burst of my own
repeated fetches) shows initials for a while. **I twice reported an image as
"failing" on the strength of `complete === true && naturalWidth === 0`, which is
also what a lazy image that has not started loading looks like.** The honest
instrument is to force `loading='eager'`, scroll it into view, wait, and only
then read `naturalWidth`.

Worth keeping: the admin ทีม SAMO **tree** genuinely shows no avatars, and never
has — `portraitSrc` is only used in the member modal's preview. That is a
feature request, not a regression, if it ever comes up again.

---

## The public org chart — the second half of 2026-08-10

Driven entirely by live feedback, in this order, which is why the commit history
zig-zags: the owner sent reference images (Apple, Saudi Aramco, and then SAMO's
own recruitment poster), and each round measured the result before the next.

**What was asked, and what it turned into**

1. *"the head of like each ฝ่าย got drowned inside many people"* → first attempt
   gave หัวหน้า a bigger card, detected from a list of Thai title prefixes.
   **Withdrawn on the owner's argument**, which was better than mine: the tree
   already ranks people — position 0 under a ฝ่าย IS the head, verified across
   the whole ฝ่ายดิจิทัล subtree. A prefix list is a second source of truth that
   drifts on the first rename. Card size is now the same for everyone.
2. *"making it horizontally like the picture"* → the horizontal chart. `nodeBlock`
   wraps each station in `.org-box` so the box is a layout SIBLING of the
   children row, the only shape the pure-CSS connector technique can draw.
3. *"don't leave the อุปนายก up there"* → the คณะกรรมการ grid deleted.
4. *"should be line link under สโมสรนักศึกษาแพทย์"* → a synthetic organisation
   root, list view only.
5. *"i have to pan left right"* → the width fight, below.
6. *"สมาชิกฝ่าย Production got cutoff"* → `safe center`.

**The width fight, measured at every step** — this is the part worth keeping:

| change | widest section |
|---|---|
| one chart, fully expanded | 44,386px (~30 screens) |
| depth-limited auto-expand | 32,402px |
| one section per ฝ่าย | 10,911px |
| branch sideways once, then vertical | 2,498px |
| full-width breakout | (wider viewport) |
| tightened spacing | 2,170px |
| spreading row wraps, bounded | **~13px over, every section, at 390/820/1024** |

Two dead ends are more instructive than the fixes. `flex-wrap: wrap` produced
**byte-identical** measurements because `.org-tree` is `width: max-content` — a
wrapping row must be BOUNDED, permission is not enough. And a "more than four
children" threshold rescued ฝ่ายเวชนิทัศน์ (twelve sub-ฝ่าย) while leaving
ฝ่ายกิจการภายใน panning, so the bound went on every spreading row instead.

**The final scrutinize pass found four more bugs**, all invisible:
a view scoped to `@media` after it became user-selectable (list view lost its
rails on desktop); five `> .org-station` selectors unhooked by the `.org-box`
wrapper; `justify-content: center` making overflow unreachable; and dead
`CHART_OPEN_DEPTH` / `nodeDepth` left behind by the iteration. The CSS was also
consolidated 421 → 328 lines (20 selectors had been defined 2–4 times), proved
a visual no-op by diffing 55 computed-style rows and all 12 section geometries
before and after — 0 differences.
