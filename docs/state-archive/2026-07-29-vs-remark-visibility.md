# VitalSound 0096–0099 — full write-up (archived 2026-07-29)

Pruned out of `STATE.md` to hold it under the ~200-line budget. All of it is
applied and deployed; the invariants a future change must not break are
summarised back in STATE.md, and every bug named here has a full entry in
`.claude/rules/mistakes.md`.

## VITALSOUND 0096–0099 · project_files seat parity (0097)

**The ladder.** A remark entry carries `vis`, one of four ordered rungs, each
including the audience of the one above: `staff` (เจ้าหน้าที่ only — what
`internal: true` meant) → `ticket` (+ this ticket's submitter, **the default**)
→ `thread` (+ every submitter in the duplicate group) → `public` (+ the board).
Normalized by `vs_remark_vis()` server-side and `remarkVis()` in `utils.js` —
**mirrors; keep them in step**. No backfill: a missing `vis` reads as `ticket`,
`internal: true` reads as `staff`.

Staff pick the rung in the บันทึกข้อความ section of the ticket modal; the
widening rungs get a `confirm()` naming the audience, and the hint warns when a
`public` note is on an unpublished ticket (it is stored, but has nowhere to
show until เผยแพร่). Cross-ticket notes reach a sibling's submitter via
`vs_thread_remarks()`, tagged `from_thread` so the timeline labels them.

**The board's ความคืบหน้าจากทีมงาน stream** (`updates` on
`get_public_vs_problem`, `update_count` on `get_public_vs_board`) is
deliberately a SEPARATE block from `comments` — comments are the crowd, updates
are the team — and is styled as a log, not a conversation.

**Three live bugs closed on the way** (all proven against prod in rolled-back
transactions, all written up in mistakes.md):
1. **A submitter could self-publish to the public board.** `vs_tickets_update_owner`
   is row-level with no column guard, so `PATCH {is_public, public_title,
   category}` routed straight around `vs_set_public()`'s SE-curation gate —
   0072's invariant #2. Also self-close, reroute, retag, re-link. Closed by
   `vs_tickets_self_update_guard` (fires only when `auth.uid() = submitter_id`
   and the caller is not a VS handler, so server contexts are untouched).
2. **The owner history read shipped internal remarks on the wire** (8 rows
   live). `select=…,remarks,…` returned the 0071 `internal: true` entries whose
   TEXT embeds the canonical id ('รวมเป็นเรื่องซ้ำของ VS-…'); `rowToTicket`
   filtered them client-side, which is cosmetic. 0074 fixed this for the
   `duplicate_of` COLUMN and missed the same id in remark TEXT. Owner read is
   now `get_my_vs_tickets()`, submitter replies go through
   `vs_add_submitter_remark()` — the browser neither reads nor rewrites the raw
   array any more.
3. **`logoutTrack()` threw halfway through** — it cleared `#trackUsername` /
   `#trackPassword`, removed long ago, so the view switched but a stale error
   banner stayed and an uncaught TypeError fired. It is now the primary back
   affordance, so this mattered.

**0097** — `project_files_delete` was the last role-only policy on that table
(found by the standing sweep): a `vpa`/`staff` seat could upload and rename a
file but not delete it. Repointed at `current_user_is_project_actor()`, which is
an exact superset of the old role list. The sweep is back to the 3 deliberate.

**UI**: "กลับหน้าประวัติ" / "กลับหน้าค้นหาสถานะ" moved to the TOP of the ticket
detail, matching "กลับกระดานปัญหา"; the history list gained the same back link
(it previously had only "ออกจากระบบ", which does not sign anyone out). Internal
tags can now be hard-deleted — the confirm names how many tickets carry the tag
and steers to ซ่อน when it is in use (`vs_tickets.tags` is a loose `text[]`, so
orphaned ids already render as nothing).

**หมวดหมู่ + แท็ก are both deletable (0098).** `vs_tickets.category` / `.tags`
are loose text with NO foreign key (0072/0079's choice), so deleting either
leaves dangling ids and breaks nothing — but a category is load-bearing where a
tag is not, so the confirm names the usage count, how many published problems
will drop off the board, and (second confirm) whether it is the ความลับ lane.
Deleting is SE-publisher-only; a vp_admin / student / anon DELETE is a 0-row
no-op that the client surfaces via `return=representation`.

**The reason 0098 exists**: a dangling category id made
`get_public_vs_problem` fail OPEN — `coalesce(is_confidential, FALSE)`, where
the board list, `vs_post_public_comment`, `vs_add_me_too` and `vs_set_public`
all coalesce to TRUE. Measured: deleting a confidential category SERVED the
detail of a confidential ticket left at `is_public = true` (a state the app
reaches on purpose). Now `coalesce(v_conf, true)` — an unresolvable category is
treated as confidential, and the detail finally agrees with the list.

**Category manager repaints the open ticket's selects** — it is a stacked modal
over the ticket, and a newly added หมวดหมู่ used to be unusable until the ticket
was closed and reopened. `refreshCategoriesAfterMutate()` mirrors what
`refreshTagsAfterMutate()` already did for tags. It preserves an unsaved pick
and deliberately does NOT auto-select the new category (that would silently
stage a re-classification).

**The canonical's submitter now sees their report on the board (0099).** Only
DUPLICATES got a board banner before; the person whose report actually BECAME
the public problem was told nothing. `get_vs_linked_context()` — which already
answered "is there a public thing to link to, and is it safe to name it?" —
gained a `self_public` branch returning the caller's OWN id + the SE-written
title, so no new column had to be added to the submitter read. Banner reads
"เรื่องของคุณถูกเผยแพร่บนกระดานปัญหาแล้ว: <title>" with a ดูบนกระดานปัญหา CTA.

**0099's load-bearing half is a bug fix that the หมวดหมู่ delete opened.**
`get_vs_linked_context` decided publishability over a LEFT JOIN with
`coalesce(is_confidential,false)` / `coalesce(public_eligible,true)` — both
defaults wrong — so a DELETED category made it hand a duplicate's submitter the
CONFIDENTIAL canonical's id AND title. 0098 had said "grep every reader"; the
four board readers were checked and this fifth (submitter-facing) one was not.
Run the audit as a query, not from memory:
`select proname, pg_get_functiondef(oid) … where pg_get_functiondef(oid) ~
'is_confidential|public_eligible'` (add `p.prokind='f'` — functiondef throws on
aggregates). Seven readers; all seven now fail CLOSED on an unknown category.

**VS sub-state is in the URL now (`src/js/vs-route.js`).** The public site
routes by PATH (`/vssound` → the tab); everything below that lived only in DOM
state, so a reload dropped you back on กระดานปัญหา and you had to press
โหลดประวัติของฉัน and re-find your ticket. The hash carries it:
`#report` · `#track` · `#track/VS-XXXX` · `#problem/VS-XXXX`.
Two things to know before touching it: the path router's `shown.bs.tab` handler
pushes a BARE pathname, which erases the hash on every tab switch (hence
`syncRouteFromView`, deferred a tick so it runs after that handler); and the
`#track/<id>` restore must `await authReady` before asking whether the user is
signed in, or a cold reload always takes the signed-out path. Writers call
`window.vsSetRoute` instead of importing, to avoid a cycle.

**The staff ticket modal no longer closes on บันทึกข้อมูล.** It refetches,
re-renders itself from the fresh row, and reports success inline in the footer
(the blocking `alert()` is gone). Closing is the ปิด button's job. Safe to
re-render while shown only because `openStaffModal` uses
`getOrCreateInstance(...).show()`.

**Browser-verified this time** (public half, Chrome, local dev): mode↔hash both
directions; a cold load of `#track/VS-XXXX` lands on the ticket with its
timeline via the guest lookup; `#problem/VS-XXXX` opens the board detail;
back-links rewrite the hash; leaving the tab and returning preserves both mode
and ticket; plain `/vssound` still defaults to the board; ความคืบหน้าจากทีมงาน
renders as a separate block from ความคิดเห็น with its text escaped (checked by
intercepting the RPC response — no prod write). Zero console errors.
**Still NOT browser-verified**: everything behind the admin login — the staff
remark visibility picker, tag/category delete, and the modal-stays-open change
(no way to authenticate from here). Server side is proven by
`tools/vs0096-remark-vis.mjs` (31 checks).
