# STATE archive — 2026-07-25 — ทีม SAMO grant-engine, per-migration detail

Narrative for migrations 0089–0093 pruned out of `STATE.md` once they were all
applied AND deployed. Kept because each one records a bug CLASS with its
reasoning, and the fixes are load-bearing — but none of it is in flight, so it
does not need to sit in the always-read file.

The live model, its invariants, the proof-script inventory and everything still
pending stay in `STATE.md`. Post-mortems: `.claude/rules/mistakes.md`.

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

**Admin account switch reloads (0093 cycle).** `admin-main.js` records
`bootUserId`; a later `onAuthChange` with a different non-null id does
`location.replace(pathname)`. Module-scope caches (projects + seenAt, shop state,
team tree, PR/VS lists) were written for a page serving one account for its
lifetime, so an in-place session swap showed a mix of both. Gated so a first
sign-in and the 25-min token refresh do not reload.
