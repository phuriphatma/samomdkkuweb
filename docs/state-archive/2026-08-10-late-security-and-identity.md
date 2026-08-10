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

## Not reproduced

Owner reported not seeing several portraits "on the web". Checked and could not
reproduce: all 5 files return HTTP 200 for every CDN variant the app requests;
`get_public_org_chart()` publishes all 6 photo-carrying postings; images render
on the public org chart, the public home card, the admin dashboard and the
member modal. The admin ทีม SAMO **tree** shows no avatars — but it never has,
`portraitSrc` is only used in the modal preview. Portraits are `loading="lazy"`
behind initials placeholders, so a slow link shows initials first. Left open
pending the owner naming the screen.
