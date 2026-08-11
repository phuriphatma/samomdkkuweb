# Mistakes — Bootstrap, CSS, DOM & the browser

Layout, modals, touch, icons, escaping, and markup that ships without its stylesheet.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## Ticket renderers interpolate user-text into innerHTML → XSS

**Symptom**: A guest who submits a PR/VS ticket with `<img src=x onerror=alert(1)>`
in any free-text field (brief, caption, rushReason, otherPlatformReason,
contentName, contact, problem, remark, …) pops scripts at every staff
viewer of that ticket.
**Cause**: Renderers like `renderPRDashboard`, `renderPRHistoryList`,
`renderUserHistoryList`, `renderTimeline`, the VS staff kanban, and
`renderManageAgentsList` build their HTML with template literals and
`insertAdjacentHTML` / `innerHTML`. Any user-text field interpolated
raw is an XSS hole.
**Fix**: Use `escHtml` from `utils.js` for any text field. Use `safeUrl`
for any URL going into an `href` attribute (blocks `javascript:`,
`data:`, attribute-injection payloads). The only string that may go
through innerHTML *raw* is Quill-produced rich text (announcement
content + VS problem field) — both are explicitly trusted.
**Where**: applied in `src/js/pr-tracking.js`, `pr-staff.js`,
`vs-tracking.js`, `vs-staff.js`, `utils.js renderTimeline`,
`announcements.js`. Don't add a new renderer without an `escHtml`
audit.

---

---

## A module shared across two shells carries shell-specific assumptions that silently break in the other shell

**Symptom (two faces, same root)**:
  1. Tapping a หนังสือโครงการ notification from another admin section
     (ภาพรวม / PR / Shop) does nothing — you must already be on the
     หนังสือโครงการ section for it to navigate.
  2. The public read-only customer mirror (`/projects-view`) flashes a
     "คอมเมนต์ใหม่" banner + "ใหม่" pills on every comment, even though
     the customer has no unread state.
**Cause**: `src/js/projects/*` is mounted in BOTH the public SPA and the
admin app. (1) `openProjectsTab()` switched sections via
`window.activateTab('pills-projects-tab')` — a Bootstrap pill that only
exists in the public shell; the admin shell switches sections via
`showAdminSide()`, so the jump silently no-op'd. (2) `renderCommentBanner`
/ `renderCommentsList` decided "unread" purely from `e.role !== role`;
for the synthetic `role='customer'` there is no per-user seenAt
(`getDocSeenAt` returns 0), so every comment read as new.
**Fix**: (1) `openProjectsTab()` detects the admin shell
(`document.getElementById('adminSideNav')`) and routes through
`window.openAdminSection('projects')` instead of the pill; added a
single-flight guard on `loadInitialData()` so the sidebar + jump paths
don't double-fetch. (2) Gate the comment banner + unread highlighting on
`!customerMode` in `inbox.js`.
**Where**: `src/js/projects/index.js` `openProjectsTab` + `loadInitialData`
single-flight; `src/js/projects/inbox.js` `renderCommentBanner` /
`renderCommentsList`. When reusing a module in a second shell, audit every
`activateTab` / `#bootstrap-id` / role assumption against the host shell.
**CSS flavor of the same trap (2026-07-24)**: styles for an ADMIN-only surface
(the VS staff modal's `.vs-duptree*` / `.vs-modal-section*`) were added to
`src/css/vs.css`, which only the PUBLIC entry imports (`main.css`); the admin
entry loads `src/admin.css` → the new UI shipped completely unstyled on the
admin app (looked like raw text on iPad). Before styling any component, check
WHICH html includes its partial (`grep modal-x admin/index.html index.html`)
and put the CSS in the entry that actually loads it: public-only → `vs.css`
(via `main.css`), admin-only → e.g. `vs-admin.css` (via `admin.css`), both →
a file imported by both.

---

---

## An anon-INSERTable table's text columns are ATTACKER-controlled — escape on render even in a "staff-only" internal dashboard

**Symptom**: The new `analytics_events` table (migration 0065) is publicly
INSERTable via the bundled anon key (same append-only pattern as `notify_log`
/ `pr_tickets`). Its `path` column is normally written by the frontend tracker
from `location`, so it *looks* like trusted first-party data. But the staff
usage dashboard (`analytics-dashboard.js` `rankBars`) rendered `top_paths[].path`
into `innerHTML` raw — and an attacker can `POST /rest/v1/analytics_events` with
`{"path":"<img src=x onerror=…>"}` directly. Result: **stored XSS that fires in
every staff member's browser** when they open สถิติการใช้งาน (confirmed: the raw
`<img onerror>` string stores verbatim).
**Cause**: "internal / staff-only view" gave a false sense that its inputs are
trusted. Authorization on the *read* (staff-only SELECT / RPC) says nothing
about who could *write* the row. Any table whose INSERT policy is
`with check (true)` for anon has every text column attacker-controlled,
regardless of who reads it back. Same root class as the ticket-renderer XSS
entry above — just reached through an anon-writable log instead of a form.
**Fix**: `escHtml()` every such field on render (path AND role, both into the
text node and the `title=""` attribute). Length CHECKs in the migration cap
size but do NOT sanitize content — escaping at render is the actual defense.
**Where**: `src/js/analytics-dashboard.js` (`rankBars` + `barChart` now import
and apply `escHtml` from `utils.js`). **Rule**: before rendering ANY column of
an anon-INSERTable table (`analytics_events`, `notify_log`, `pr_tickets`,
`vs_tickets`, …) into innerHTML — even in a staff-only dashboard — treat it as
untrusted and `escHtml` it. Read-side authorization is not input validation.

---

---

## Re-opening an ALREADY-OPEN Bootstrap modal with `new bootstrap.Modal(...).show()` stacks a second backdrop — page stays dimmed after close

**Symptom**: In the VS staff modal, tapping a ticket in the แผนผังเรื่องซ้ำ
(dup tree) — which re-runs `openStaffModal` to jump to the linked ticket while
the modal is already open — left the page dimmed ("web dimmer") afterward.
Closing the modal removed one backdrop but another stayed forever.
**Cause**: `openStaffModal` ended with `new bootstrap.Modal(el).show()`. When
the element is ALREADY shown, constructing a fresh Modal instance and calling
`.show()` adds a SECOND `.modal-backdrop` that the original instance's
`.hide()` never cleans up. Any "navigate within an open modal" flow (dup tree,
kanban dup-rows, similar-list jumps) triggers it.
**Fix**: `bootstrap.Modal.getOrCreateInstance(el).show()` — reuses the live
instance, whose `.show()` no-ops when `_isShown`; the DOM content re-rendered
above it just appears. Rule: NEVER `new bootstrap.Modal(...)` in a code path
that can run while that modal is open; always `getOrCreateInstance`.
**Where**: `src/js/vs-staff.js` `openStaffModal`. Grep for `new bootstrap.Modal`
if any other modal ever gains an internal "jump to other record" affordance.

---

---

## A destructive-direction toggle without a confirm silently dropped a privacy guard (vs_categories.personal flipped to publishable)

**Symptom**: The 0072 isolation proof went 19/23 — the CONFIDENTIAL test
ticket appeared on the public board, its detail returned data, SE could
publish it, students could me-too it. Root cause was DATA, not code: the
seeded `personal` category had `is_confidential=false, public_eligible=true`.
**Cause**: The new category manager confirmed the toggle only when turning
confidential ON. Turning it OFF — the direction that REMOVES a privacy
guard — was a silent one-tap, and a tap during user testing flipped the
personal-complaints lane to publishable. No real ticket leaked (none in that
category was published), but every confidential re-check downstream keys on
that flag, so the whole hard-exclusion stood on an unguarded toggle.
**Fix**: (1) restored `personal` to confidential; (2) the manager now
confirms BOTH directions, with the OFF confirm worded as removing
protection. **Rule**: when adding a toggle whose one direction weakens a
security/privacy invariant, that direction needs the STRONGER confirm (or a
type-to-confirm) — not the safe direction. Also: re-run
`tools/vs0072-isolation.mjs` after ANY change that touches vs_categories or
the public-board RPCs; it catches config-level regressions, not just code.

---

---

## A modal that closes on save makes every edit a round trip — refresh in place instead

**Symptom** (reported): "when บันทึกข้อมูล on a VitalSound ticket it closes the
ticket and I have to keep opening it again — I think it's for refresh, but I
want better UX."
**Cause**: `submitStaffAction` ended with `alert('อัปเดตข้อมูลสำเร็จ!')` →
`modal.hide()` → `fetchStaffTickets()`. Closing was doing the work of
*refreshing*: the only way to see the new timeline entry was to reopen the
ticket, because the modal's content is rendered once at open time. So every
status bump and one-line remark bounced the staffer back to the kanban to find
the ticket again — and the success `alert()` was a blocking dialog on top of a
modal, for the happy path, on every single save.
**Fix**: `await fetchStaffTickets()` (which repaints the kanban behind the
modal), then re-render the modal from the fresh row and report success inline in
the footer. Closing becomes the ปิด button's job, i.e. the user's choice.
Re-rendering while shown is safe *only* because `openStaffModal` ends in
`bootstrap.Modal.getOrCreateInstance(el).show()`, which no-ops on an open modal
— `new bootstrap.Modal(...)` there would stack a second backdrop (see the
stacked-backdrop entry). Guard the case where the refetched cache no longer
contains the ticket (transferred to a dept this user can't see, or deleted
concurrently): hide the modal rather than rendering stale data.
**Where**: `src/js/vs-staff.js` `submitStaffAction` / `reopenCurrentTicket` /
`staffSaveStatus`; `#staffSaveStatus` in `src/html/modal-vs-staff.html`.
**Rule**: if a dialog closes itself after a write, ask whether it is closing
because the user is *done* or because the code has no way to refresh in place.
The second is a bug wearing a feature's clothes.

---

---

## A manager modal opened ON TOP of a form must repaint that form's inputs — the vocabulary it edits was rendered once, at open time

**Symptom** (reported): "after I จัดการหมวดหมู่ → add a หมวดหมู่, I can't select
the one I added immediately — I have to close the ticket and open it again."
**Cause**: `#staffCategory` / `#staffPubCategorySel` are filled ONCE by
`fillStaffCategorySelect()` inside `openStaffModal()`. The category manager is a
stacked modal opened over that still-open ticket, and after a write it repainted
the kanban facet, the publish panel and its own list — but never the two selects
underneath it. So the new row existed everywhere except the control the user
opened the manager in order to use. The TAG manager next door had it right
(`refreshTagsAfterMutate()` re-fills the open ticket's tag editor); the category
manager was simply never given the equivalent, and the gap is invisible unless
you use the two features back to back.
**Fix**: `refreshCategoriesAfterMutate()`, called from add / patch / delete
alike. Two details that matter more than the repaint itself:
- **Preserve the pending selection.** `fillStaffCategorySelect()` resets the
  selects to the ticket's SAVED category, so a naive re-fill throws away an
  unsaved pick the user made just before opening the manager. Snapshot
  `sel.value`, re-fill, restore it if that option still exists (it won't if they
  just deleted it).
- **Do NOT auto-select the newly added category.** It is what the user
  "obviously" wants, but category drives confidentiality and board eligibility,
  so auto-selecting silently stages a re-classification on a ticket they only
  meant to add vocabulary for. Make it available in one click and say so in the
  status line instead.
**Where**: `src/js/vs-staff.js` `refreshCategoriesAfterMutate` (+ `vsCatAdd` /
`vsCatPatch` / `vsCatDelete`); the pattern to copy is `refreshTagsAfterMutate`.
**Rule**: whenever a modal edits the VOCABULARY that a form behind it renders as
options, list every control that consumed that vocabulary and repaint all of
them — the one you forget is usually the one the user opened the modal to fill.

---

---

## Attribute-driven visibility: check that EVERY value in the markup has a handler, and which way an unhandled one fails

**Symptom class** (three instances found in one sweep): an element gated by a
`data-*` attribute is shown to the wrong people, or to nobody, because the JS
that toggles it doesn't know that attribute value.
**The sweep** — cheap, run it whenever a role/permission is added:
```sh
grep -rho 'data-projects-role="[^"]*"' src/html/*.html | sort -u   # values in markup
grep -n  'data-projects-role='          src/js/projects/index.js   # values with a handler
```
Repeat for `data-admin-side` (vs `SIDE_FEATURE`), `data-role-only`,
`data-perm-only`, `data-admin-pane` (vs `SECTION_META`).
**Which way it fails depends on the markup, and that is the part to check first:**
- `#projectsGridEmpty` spans carry NO `d-none` → the JS hides by ADDING it → an
  unhandled value **fails OPEN** (visible to everyone). This bit: a new
  `data-projects-role="sa_prof"` span with no matching `querySelectorAll` block
  would have shown professor copy to vp_admin as well.
- The article edit/delete buttons DO carry `d-none` → **fails CLOSED**. Safer,
  but it hides the bug: the buttons were gated `data-role-only="pr_staff dev"`,
  so a ทีม SAMO `creator` grantee (role='user') never got them even though
  `announcements_write` lets them edit. Replaced with `data-perm-only="creator"`,
  resolved through `userCanAccess()` so role defaults, `permissions[]` and the
  tree all count.
**Also found the same shape in plain JS**, not attributes: the inbox bucket
empty-copy was `role === 'uni_staff' ? A : B`, so อาจารย์ silently got the
vp_admin wording ("ไม่มีหนังสือถูกตีกลับให้แก้") for a bucket that for them means
รอลงนาม. A two-way ternary on a three-role system is the same missing-handler bug
with no attribute involved.
**Rules**: (1) prefer `d-none`-in-markup + opt-in showing, so an unhandled value
fails closed. (2) Gate on a CAPABILITY (`data-perm-only` → `userCanAccess`) not a
role list, or every ทีม SAMO grant works except at that one control. (3) Any
`role === 'x' ? … : …` is a missing branch as soon as a third role exists — grep
for them after adding a role.

---

---

## A directional action whose direction lives ONLY in a label on the other party's row gets read backwards — and offering just one direction turns an N-item job into N searches

**Symptom** (reported): "when I want a ticket to be a subticket, `รวมเข้าเรื่องนี้`
— the user is confused, they think the current ticket is the master and the
listed one becomes the subticket." Exactly inverted from what it did.
**Cause**: the merge panel had ONE direction, stated nowhere except a button
label sitting on the OTHER ticket's row. "รวมเข้าเรื่องนี้" = "merge into THIS
one" — and `นี้` has no fixed referent: read on the row it means the row, read
by someone who just opened a ticket it means the open ticket. The action took
the second reading and did the opposite of it. A demonstrative pronoun in a
button label is ambiguous BY CONSTRUCTION whenever the button sits on one of
the two things it could refer to.
**The second half, which the user found by using it**: with only the
duplicate→canonical direction, merging 10 tickets into one main meant opening
each of the 10 and re-searching for the main every time. The workflow existed
only from the side that happens to be *one* ticket, so the bulk case — which is
the common one when curating a known main — was N× the work.
**Fix**: (1) direction is an explicit MODE, restated as a sentence naming the
open ticket's id and what happens to it; (2) every button names what the ROW
becomes (`เลือกเป็นเรื่องหลัก`), never what "this" does; (3) BOTH directions
ship — push (the open ticket becomes a duplicate; one target ⇒ a button) and
pull (ticked tickets become duplicates of the open one; many targets ⇒
checkboxes + one bulk action). Same `merge_vs_tickets(p_dup, p_canonical)`,
only the argument order differs — no migration.
**Where**: `src/js/vs-staff.js` (`mergeDir` / `mergeTargetRow` /
`renderMergeDirection` / `onPullMergeClick`), `src/html/modal-vs-staff.html`,
`src/css/vs-admin.css`.
**Three details worth reusing for any bulk action:**
- *Pre-empt the refusals the server will make.* `merge_vs_tickets` rejects a
  source that already owns duplicates. In pull mode that row is locked with the
  reason ON the row, rather than letting the user tick it and collect an error.
- *Bulk ≠ atomic.* Each merge is independently meaningful, so 8-of-10 is a
  correct outcome, not a broken transaction — sequential calls, per-ticket
  failure report. What is NOT acceptable is a silent partial.
- *A selection is scoped to the thing it was made in.* It is cleared when the
  modal opens another ticket; otherwise it silently follows the user into a
  different cluster and the next click merges the wrong things.
**Rule**: whenever an action relates two records asymmetrically (merge, link,
parent, supersede, assign), the UI must name BOTH sides and which one changes —
never rely on "this"/"นี้"/"here". And ask which side the user will be looking
at when they start the task: if it can be either, both directions need to
exist, and the many-to-one side needs multi-select or it is N separate jobs.

---

---

## `touch-action: none` on a drag handle makes the page unscrollable THERE — so every scroll that starts on a handle becomes a drag

**Symptom** (reported): "on ทีม SAMO on mobile, sometimes I just scroll the phone,
and it accidentally swaps / moves the role." Intermittent, never on desktop, and
it looked like a SortableJS sensitivity problem.
**Cause**: CSS, not the drag library. `.team-handle` carried
`touch-action: none`. That property tells the browser to suppress **every**
default touch gesture on the element — including panning — so a touch that merely
*began* on a handle could not scroll the page at all. SortableJS (no `delay`
configured) starts dragging on `touchstart`. Combined: finger lands on a handle
while flicking down the list → the browser refuses to scroll → the library
interprets the movement as a drag → a ตำแหน่ง silently moves. `touch-action: none`
is the right advice for a handle when drags start immediately (it stops the page
fighting the drag), which is exactly why it gets copied in — but it makes the
handle a scroll dead-zone, and on a tree view the handles are spread down the
whole scrollable surface.
**Fix**: make touch drags require intent, and let the browser keep panning.
- `touch-action: pan-y` on the handle (vertical scroll still belongs to the
  browser);
- `delay: 220` + **`delayOnTouchOnly: true`** so a mouse stays instant and only
  touch needs a hold;
- `touchStartThreshold: 8` so any finger travel inside the delay cancels the
  pending drag — this is what makes "scroll wins, hold wins" unambiguous;
- `chosenClass` feedback, because a touch drag that starts with no visual signal
  reads as either broken or accidental;
- a larger hit box under `@media (pointer: coarse)` — the mouse-sized
  `padding: 0.15rem` caused BOTH accidental drags and failed deliberate ones;
- and drag disabled outright in the mode where reordering is not the task
  (จัดการสิทธิ์), since there it can only ever happen by mistake.
**Where**: `src/css/team.css` `.team-handle`; `src/js/team/index.js` `TOUCH_DRAG`
+ `attachSortables` + the `mode === 'team'` gate on the attach call.
**Rule**: never pair `touch-action: none` with a drag that begins on
`touchstart` inside a scrollable list. Pick one: immediate drag on a small
dedicated non-scrolling surface, or (for a list) long-press + `pan-y`. And when a
mobile gesture "sometimes" does the wrong thing, check the CSS `touch-action` of
whatever the finger landed on before tuning the JS library.

---

---

## A partial left behind by a restructure is a DECOY — edits land in a file nothing includes, and the page simply does not change

**Symptom**: added a year picker and a board grid to `src/html/tab-team-public.html`,
rebuilt, reloaded — neither element existed in the DOM
(`document.getElementById('orgBoard')` → null). The rest of that same partial was
clearly live: `#orgBody`, `#orgSearch` and the whole spine tree rendered fine. So
the page looked like it was serving a STALE copy of the file I had just edited,
and the first two theories were both about caching (the HTML-include plugin not
watching partials; Vite holding a transform). Restarting the dev server changed
nothing, which is the tell.
**Cause**: `grep -rn "tab-team-public" index.html` returns NOTHING. Commit
`07b9beb` ("merge ทีม SAMO org chart into เกี่ยวกับเรา tab") had COPIED that
markup into `src/html/tab-about.html` and repointed `index.html` at it, leaving
the original partial on disk, unreferenced. The ids matched because it was a
copy, so every symptom pointed at the live file while every edit went to the dead
one. `git grep` for the id would have found two hits in ~5 seconds; I searched for
the behaviour instead of the file.
**Fix**: apply the edits to `tab-about.html`, and `git rm` the orphan so there is
one copy again. **Rule**: before editing any `src/html/*.html` partial, confirm
something includes it — `grep -rn "<partial-name>" index.html admin/index.html`.
An unreferenced partial is worse than a deleted one: it absorbs edits silently.
And when a DOM element you just added is missing while its siblings render,
suspect TWO FILES before suspecting one stale one — `getElementById` returning
null for new markup next to working old markup is the signature.

---

---

## A shared `render()` that repaints a pane another module owns will destroy that module's in-progress input

**Symptom**: none reported — found by tracing what fires `render()` in
`src/js/team/index.js`. It is the target of `scheduleRemoteRender()`, i.e. the
Supabase Realtime subscription on `team_nodes`/`team_members`. The new
ปีการศึกษา branch ended in `renderTerms()`, so **another admin editing the live
tree would `innerHTML`-rebuild the archive editor and throw away whatever the
first admin was typing** — a name half-corrected, an unsaved ชื่อเล่น.
**Cause**: `render()` already knew this hazard for drag (`dragging` /
`pendingRender` exist because a remote event mid-SortableJS-gesture cancels the
drag — logged above). Adding a third mode that owns its own DOM re-introduced the
same exposure through a different door: a text input is as destroyable as a drag
gesture, and there was no equivalent guard. The archive is also *independent of
the live tree*, so the repaint had no informational value at all.
**Fix**: the `isYears` branch toggles visibility and returns. `terms.js` owns its
pane and repaints on its own actions; `enterTerms()` paints a loading line on
cold entry, since `render()` no longer does it.
**Rule**: when a shell's `render()` can be invoked by a remote/background event,
it must not rebuild DOM owned by a sub-module that holds user input. Either the
sub-module owns its repaint, or the shell needs the same "is the user mid-gesture"
guard the drag path already has. Before adding a branch to a shared render, list
every caller of that function — not just the one you are writing for.

---

---

## A `busy` flag that RETURNS EARLY silently discards the second action — serialise instead of dropping

**Symptom**: none reported. `guard()` in `src/js/team/terms.js` opened with
`if (busy) return;`. Type a corrected name, Tab to ชื่อเล่น, type, blur — the two
`change` events land close enough together that the second PATCH is dropped. The
status line still reads "บันทึกแล้ว" (from the first), so the edit looks saved
and is not; the value survives on screen until the next repaint, then reverts.
**Cause**: a re-entrancy guard was reached for where a QUEUE was needed. Dropping
is only correct when the second call is a duplicate of the first (a double-clicked
submit). Here every call carries different data, so dropping is data loss —
and the early `return` gives the caller no way to know it happened.
**Fix**: `chain = chain.then(...)` — every call queues behind the previous one,
nothing is discarded, and the status line reports the last real outcome.
**Rule**: before writing `if (busy) return`, ask what the dropped call CARRIED. If
it carries user input, serialise it. Reserve the drop for idempotent re-submits,
and even then prefer disabling the control so the user can see why nothing
happened.

---

---

## A Bootstrap icon name from a LATER release renders as nothing — no error, no failed request, just an empty box

**Symptom**: none reported for months. `SAMO Passport` showed a blank gap where
its icon should be, in the ทีม SAMO permission modal and (newly) on the landing
timeline; the profile modal's "รอยืนยัน" email badge had the same hole.
**Cause**: `bi-passport`, `bi-passport-fill` and `bi-envelope-arrow-up` were all
added in **bootstrap-icons 1.11**. Both entries pin **1.10.5** via CDN
(`index.html` and `admin/index.html`). A Bootstrap icon is a `::before`
codepoint in an icon font, so a name that does not exist is not a 404 and not a
console error — the font loaded fine, the class simply matches no rule and the
glyph is absent. It fails **silently and invisibly**, which is why it survived:
you only catch it by looking at that exact pixel, and a missing icon looks like
deliberate whitespace.
**Fix**: `npm run check:icons` (`tools/check-icons.mjs`) — reads the pinned
version out of `index.html`, fetches that stylesheet, extracts all ~1950 real
names, and fails on any `bi-*` class in the repo that is not among them. It
strips comments first, or it flags its own documentation: `projects/data.js`
already carried a comment naming `bi-send-arrow-up-fill` as missing, which is
evidence this had been hit before and fixed one-off without a guard.
**Deliberately NOT in `npm test`** — it fetches over the network, and a unit
suite that needs the internet is a suite that fails on a plane.
**Where**: `tools/check-icons.mjs`; fixes in `src/data/changelog.js`,
`src/html/tab-team.html`, `src/js/profile.js`.
**Rule**: before using a Bootstrap icon you have not used before, run
`npm run check:icons`. Do not trust the icon browser on the Bootstrap website —
it shows the LATEST release, not the version you pin. The same trap applies to
any icon font (Material Symbols, Font Awesome): a name is not a URL, so a wrong
one cannot 404.

---

---

## iOS Safari `100vh` hides the bottom of a full-height drawer

**Symptom**: Sign-out button (or any bottom-anchored control) in the
mobile admin sidebar drawer was unreachable on iPhone — buried under
Safari's bottom URL chrome.
**Cause**: iOS Safari measures `100vh` against the *large viewport*
(URL bar hidden). When the URL bar is shown — which is the default
state on first open — the drawer extends *past* the visible area, and
the user has to scroll to reach the bottom. Adding `bottom: 0` on a
fixed element doesn't help: the element is positioned relative to the
same large viewport.
**Fix**: Use `100dvh` (dynamic viewport height) for the drawer height,
which shrinks when the chrome is shown. Keep `100vh` above it as a
fallback for browsers that don't grok `dvh`. Additionally pad the bottom
of the bottom-anchored control with
`max(0.85rem, calc(env(safe-area-inset-bottom) + 0.6rem))` so it sits
above the iOS home-indicator inset too.
**Where**: `src/css/workspace.css` `.workspace-side` (mobile @media block)
+ `.workspace-side-foot` (same block). Apply the same pattern to any
new full-height mobile overlay (offcanvas, modal-fullscreen on mobile).

---

---

## Pane-scoped DOM selectors break when the shell is rewritten

**Symptom**: In the admin app, clicking "การตั้งค่า" inside the หนังสือโครงการ
pane does nothing — the manage view never replaces the inbox view.
**Cause**: `setView()` in `src/js/projects/index.js` scoped its selectors
to `#pills-projects [data-projects-view]` / `[data-projects-pane]`, and
its click delegation listened on `#pills-projects`. The cc27157 public→
admin split removed the `id="pills-projects"` wrapper (tab-projects.html
now sits inside `<section data-admin-pane="projects">`), so every
scoped query found nothing and the click handler never bound.
**Fix**: Drop the `#pills-projects` scoping — the `data-projects-view`
/ `data-projects-pane` attributes are unique to this feature, so match
them at document scope. Delegate the click on `document` too.
**Where**: `src/js/projects/index.js` `setView()` + the `initProjects()`
click delegate. Whenever a refactor moves a partial into a new shell,
audit any module-scoped `#foo`-rooted query selectors against the new
DOM — the JS module's selector strings travel with the module and
will silently break if the host wrapper id changes.

---

---

## A full-height centered page with `height:100% + overflow:hidden` is unscrollable on mobile when the content is taller than the viewport

**Symptom**: The pages.dev "we've moved" splash (`public/moved.html`) could not be
scrolled up/down on iPad — the card (and the countdown + CTA below it) were
clipped, unreachable. Fine on desktop / tall phone viewports; only bit where the
card exceeds the viewport (iPad landscape, large text / zoom, short screens).
**Cause**: the splash `body` used `html,body{height:100%}` + `body{display:grid;
place-items:center; overflow:hidden}`. `height:100%` pins the body to exactly the
viewport height, and `overflow:hidden` then clips anything taller — so a centered
card bigger than the viewport has its overflow hidden with no way to scroll to it.
(Same family as the iOS `100vh` drawer entry above — full-height mobile layouts
are the recurring trap.)
**Fix**: drop the fixed `height:100%` (keep `min-height:100dvh` so it still fills
the screen but can GROW past it), and change `overflow:hidden` → `overflow-x:hidden`
(kills only horizontal aurora bleed; per CSS the y-axis then computes to `auto`, so
the page scrolls vertically). Grid `place-items:center` with auto rows keeps the
card centered when it fits and top-aligned+scrollable when it doesn't. The fixed
background layers (`.aurora`/`.stars`, `position:fixed`) are unaffected — `body`'s
overflow never clips fixed descendants (their containing block is the viewport,
not `body`), so the backdrop stays put while content scrolls.
**Where**: `public/moved.html` in BOTH this repo and the passport repo. For any
future full-screen centered page, use `min-height:100dvh` (never `height:100%`)
and never `overflow:hidden` on the scroll root — reach for `overflow-x:hidden` if
you only need to tame horizontal bleed.

---

---

## Bootstrap tab JS keeps the parent dropdown open

**Symptom**: After clicking "PR Form" inside the "เครื่องมือ" dropdown, the
dropdown stays open and the toggle stays styled active.
**Cause**: Bootstrap's tab JS directly sets `.show` on the parent
`.dropdown-menu`, bypassing the Dropdown API — so `.hide()` doesn't help.
**Fix**: Listen for `shown.bs.tab`. Strip `.show` from any `.dropdown-menu.show`
inside `.samo-navbar` and reset `aria-expanded="false"` on the toggle.
**Where**: `src/js/main.js`.

---

---

## Bootstrap mobile offcanvas + `data-bs-toggle="pill"` race

**Symptom**: On mobile, tapping a tool in the offcanvas drawer activates the
new pane on top of the old one (stacked panes).
**Cause**: The offcanvas pill buttons aren't part of the navbar's tablist, so
Bootstrap activates the new pane but never deactivates the previously-active
one.
**Fix**: In the offcanvas, drop `data-bs-toggle="pill"` and use
`onclick="activateTab('pills-X-tab')"` which routes through the canonical
tab button (in the right tablist). Close offcanvas in a delegated click
handler.
**Where**: `src/html/navbar.html` + `src/js/main.js`.

---

---

## `form.reset()` clears the file input but `fileInput.files` still references the old File

Not currently biting us, but worth knowing: after `form.reset()`, the file
input element's `.files` property may still reference the previously-selected
file in some browsers. If you trigger an upload in a second submission and
read `fileInput.files`, you can re-upload the previous file. Re-create the
input element OR explicitly `fileInput.value = ''` if this becomes a problem.

---

---

## `form.reset()` clears hidden inputs

**Symptom**: First PR submit succeeds; second submit goes through with
`submitter = 'Guest'` even though user is signed in.
**Cause**: After success, we call `form.reset()` to clear visible fields.
This also resets hidden inputs `prGoogleUserEmail` / `prGoogleUserName`.
**Fix**: Re-populate hidden inputs from `authGetUser()` immediately after reset.
**Where**: `src/js/pr-form.js` success path inside `handlePrFormSubmit`.

---

---

## HTML5 `required` on a hidden field silently blocks form submit

**Symptom**: User fills in every visible field of the project send-document
modal, clicks "ส่ง" — nothing happens. No error, no spinner, no Discord
ping, no row. DevTools console quietly says
`An invalid form control with name='' is not focusable.`
**Cause**: The same `<form>` does double duty for "create project + first
doc" and "add doc to existing project". Depending on mode, half its fields
are hidden via `d-none`. But HTML5 form validation **still runs on hidden
required fields** — and because the browser can't focus a hidden field to
show the validation tooltip, it just refuses to submit, silently.
**Fix**: Add `novalidate` to the `<form>` AND remove all `required`
attributes from inputs that may be hidden by mode. Do validation in JS
(`onSubmit` throws clear Thai errors that surface via `alert`). HTML5
required + dynamic hide/show is a footgun in any multi-mode form here.
**Where**: `src/html/modal-project-send.html` `#projectSendForm`. If you
add a new dual-mode modal, do the same.

---

---

## Adding `prefers-color-scheme: dark` to ONE component in a light-only app makes just that component go dark on a dark-mode OS

**Symptom**: The new landing-page stat strip rendered **dark green** while the
rest of the (white) site stayed light. Only happened for users whose OS/browser
was set to dark mode.
**Cause**: This app is **light-only** — a repo-wide grep shows ZERO
`prefers-color-scheme` / `data-theme` rules anywhere except the files just added
(`home-stats.css`, `analytics.css`). Those new files included
`@media (prefers-color-scheme: dark)` + `:root[data-theme="dark"]` overrides
(a good habit for standalone artifacts / theme-aware sites — but wrong here).
With no app-level theme system, the media query is the ONLY thing reacting to
the OS preference, so a dark-mode visitor got a dark component island floating
in the otherwise-white page. The general "design both themes" guidance has an
explicit carve-out — *"a design that deliberately commits to one visual world
may stay single-theme"* — and this app has committed to light.
**Fix**: Remove all `prefers-color-scheme` / `data-theme` blocks from
`home-stats.css` + `analytics.css`; they now render light unconditionally.
**Rule**: before adding dark-mode CSS to a NEW component, grep the app for an
existing theme system (`prefers-color-scheme`, `data-theme`, a theme toggle). If
there is none, the app is single-theme — match it, don't unilaterally introduce
a half-theme that only your component honors. (Standalone Artifacts are the
exception — those SHOULD be theme-aware; the deployed app is not.)
**Where**: `src/css/home-stats.css`, `src/css/analytics.css`.

---

---

## A `data-role="x"` element with no matching toggle in the JS is visible to EVERYONE — and a role with no empty-state copy reads as a broken page

**Symptom**: "I assigned myself as อาจารย์ on ทีม SAMO, but when I open
หนังสือโครงการ I see nothing." Not a permission bug — verified live that 0 sign
requests named that account (all 11 named `saprof`), so an empty inbox was
CORRECT. It looked broken because of what the empty state said: nothing.
**Cause**: `#projectsGridEmpty` carries one `<span data-projects-role="…">` per
role, and `applyRoleVisibility()` toggled `d-none` on the `vp_admin` and
`uni_staff` spans only. There was no `sa_prof` span at all, so a professor got
the heading "ยังไม่มีโครงการในมุมมองนี้" above an EMPTY paragraph — no reason, no
next step. A role whose normal state is "empty until someone sends you
something" needs that said out loud, or every professor's first login looks like
a failure.
**The trap in the fix**: these spans carry NO `d-none` in the markup — they are
hidden by the JS toggling it ON. So adding a `data-projects-role="sa_prof"` span
WITHOUT adding a matching `querySelectorAll` block makes it visible to every
role instead of only the professor (a vp_admin would read both "กด สร้าง
โครงการใหม่" and "เมื่อเจ้าหน้าที่คณะส่งหนังสือมาให้ลงนาม"). Default-visible +
opt-in hiding means an unhandled attribute FAILS OPEN.
**Where**: `src/html/tab-projects.html` `#projectsGridEmpty`;
`src/js/projects/index.js` `applyRoleVisibility()` (now toggles all three roles).
**Rules**: (1) when a role can legitimately see zero rows, write its empty-state
copy — "nothing here yet" and "you have no access" look identical to a user.
(2) Any attribute-driven visibility scheme that hides by ADDING a class fails
open; grep that every value in the markup has a handler
(`grep -o 'data-projects-role="[a-z_]*"' src/html/*.html | sort -u` vs the
`querySelectorAll` calls) whenever you add a role.

---

---

## Bootstrap gives EVERY modal the same z-index — so a stacked modal declared earlier in the HTML paints BEHIND the one that opened it

**Symptom** (reported): in จัดการทีม → a person → the ตำแหน่ง selector, "it
doesn't show the popup, it shows เลือกตำแหน่ง behind it". The picker opens, the
backdrop dims, focus moves into it — and it is invisible, underneath the member
editor. Reads like a broken `.show()` call or a missing `d-none` toggle.
**Cause**: Bootstrap's docs say "multiple open modals are not supported" and the
CSS means it — every `.modal` is z-index 1055 and every `.modal-backdrop` 1050,
with no per-instance adjustment. Equal z-index means **DOM order decides the
painting order**, so the modal declared LATER in the HTML wins. `#teamPickerModal`
sits at line ~149 of `tab-team.html` and `#teamMemberModal` at ~372, so opening
the picker from the member editor put it behind. Nothing about the JS is wrong,
and the same code works perfectly when the picker is opened from the tree (no
other modal up), which is what makes it look intermittent.
**Fix**: `src/js/modal-stack.js` — ONE delegated `show.bs.modal` listener,
wired in both entries. It counts `.modal.show` (the event fires before Bootstrap
adds `.show` to this element and before it appends this modal's backdrop, so the
count is exactly the modals already up), and lifts this modal to
`1055 + depth*20` with its backdrop 10 below. `hidden.bs.modal` clears the
inline z-index and re-asserts `modal-open` on `<body>`, which Bootstrap strips
on ANY hide even when an outer modal is still shown.
**Where**: `src/js/modal-stack.js`; `initModalStack()` in `main.js` +
`admin-main.js`. **Rules**: (1) opening a modal from inside another modal needs
this — do not "fix" it by reordering the HTML, which only moves the problem to
the next pair. (2) It composes with the existing stacked-backdrop entry above:
use `getOrCreateInstance(el).show()` (never `new bootstrap.Modal`) AND let the
stacker place it.

---

---

## A class in the markup with NO rule in any stylesheet is invisible in review and looks exactly like a broken value — assert the coverage

**Symptom** (reported with a screenshot): the ทีม SAMO member editor's portrait
preview rendered at full size and burst out of the modal, over the form. The
call site looked right. The markup looked right.
**Cause**: `.team-photo-field` / `-preview` / `-controls` / `-empty` were written
into `src/html/tab-team.html` and **the stylesheet rules were never added** —
`grep -rn "team-photo" src/css/` returned nothing. With no box to fit, an `<img>`
renders at its natural size (Bootstrap 5's Reboot does NOT set a global
`img{max-width:100%}` — that is `.img-fluid`, opt-in). Nothing errors, nothing
logs, and the diff that introduced it reads as complete.
**Fix**: the rules, plus a TEST that makes the class impossible to forget —
`src/js/team/health.test.js` extracts every `team-*` class from the partial and
every `team-health-*` / `imgcrop-*` class from the JS, and asserts each has a
rule in the stylesheets those entries load. Run on the existing code it
immediately found four more: two deliberate layout hooks (allow-listed by name,
so the list itself stays meaningful), one **dead class** (`team-picker-dialog` —
no rule, no JS selector, removed), and one genuinely missing rule
(`team-perm-inherited-label`).
**Where**: `src/css/team.css`; the coverage tests at the bottom of
`src/js/team/health.test.js`. Two things that make the test not-annoying: the
allow-list is explicit and named (a growing allow-list is a smell, not a
solution), and the regex uses `(?<!-)` so a CSS CUSTOM PROPERTY set from JS
(`--imgcrop-ratio`) is not mistaken for a class.
**Rule**: when a layout bug appears in NEW markup, `grep` one of its class names
against `src/css/` before debugging the JS. And for any module that owns its own
class namespace, assert the coverage — it costs six lines and catches the whole
class. Related: the entry above on `convertDriveUrl`'s ignored size argument;
both bugs were in that one screenshot, and either alone was survivable.

---

---

## An indicator that links to a LIST moves the work instead of removing it — the click already said WHICH one, so carry it

**Symptom** (reported): "when I click the flag on a person in จัดการทีม it goes
to ตรวจสอบข้อมูล, but I don't know where to look — the admin shouldn't have to
remember the person they just clicked." Exactly right, and the feature had
looked finished: the flag was on the correct rows, the tooltip named the real
reasons, the navigation worked.
**Cause**: the flag answered "does this person need attention?" and then handed
over to a screen answering "who needs attention?" — a strictly *less* specific
question than the one just asked. With 24 findings the admin re-scans a list to
re-find someone they had already pointed at. The information was thrown away at
the exact moment it was most precise.
**Fix**: the navigation carries the subject. A member-row flag opens the pane
filtered to that person; a rolled-up count on a ตำแหน่ง filters to that whole
branch (clicking "11" is asking about those 11). Three details that make a
filter safe rather than confusing:
- **The filter is stated and reversible on screen** — a "แสดงเฉพาะ … · N
  รายการ" banner with a "ดูทั้งหมด (24)" button. A silent filter is worse than
  none.
- **Arriving by the ordinary tab CLEARS it.** A screen that quietly keeps
  showing a subset reads as "everything else is fixed".
- **The empty state must know it is filtered.** "ข้อมูลครบถ้วน" under a filter
  is a lie about the other 23; it says "…สำหรับ <คนนี้> แล้ว" instead.
**The bug this shape hides**: the filter and the indicator must agree about
which records a finding concerns. If the filter's id extraction missed one of
the shapes the indicator uses, clicking a flag would open a pane declaring that
person has NOTHING wrong — indistinguishable from a resolved problem, so nobody
reports it. `idsOf()` is therefore exported and unit-tested directly against the
flag map ("every flagged member is reachable from at least one finding").
**Where**: `src/js/team/health.js` (`idsOf`, `focusIds`, `enterHealth(focus)`),
`src/js/team/index.js` (`openHealthFor`, `memberIdsUnder`).
**Rule**: whenever a per-row indicator navigates to an aggregate view, pass the
row through. And when two code paths derive "which records does this concern?",
test them against each other — the failure mode is a screen confidently saying
"nothing here", which reads as success.

---

## State parked on a REUSED DOM element outlives the record it describes — a modal is filled again, the element is not

**Symptom** (found by a bug scan, but it had already SHIPPED): open a ตำแหน่ง
holding the `master` grant in จัดการสิทธิ์, close it, then open an ordinary
person. Their permission grid shows the FIRST row's permissions. The grid is
what gets saved, so pressing บันทึก writes the second person a set of
permissions they never had.
**Cause**: `syncMasterVisibility()` needs to know whether master was on a moment
ago, so that turning it OFF can restore the grant it overwrote when it force-
ticked everything. It kept that memory on the grid element — an `is-master`
class plus a `preMaster` dataset snapshot. That is fine WITHIN one row and
wrong across rows: the modal is re-filled from the same DOM every time it opens,
so the element outlives the record. On the second open the function read
"master was on, now it is off" — a transition that never happened — and restored
the first row's snapshot over the second row's real values.
**The tell**: the value being remembered describes a ROW, but the place it is
stored is scoped to the SCREEN. Any `dataset.*` / class flag used as memory has
this hazard the moment its host is reused, and a modal, a table row template
and a re-rendered list are all reused hosts.
**Fix**: `resetMasterState(grid)` at the top of each fill path
(`fillNodePermPane` / `fillMemberPermPane`), before the row's values are
applied — so the grid can never carry one record's state into another. It must
be in the FILL, not in the sync: the sync also runs on every `change` event,
where the memory is exactly what is needed.
**Where**: `src/js/team/index.js` `resetMasterState` / `syncMasterVisibility`.
**Rules**: (1) when a DOM element stores state ABOUT a record, clear it where
the element is re-pointed at a new record, not where the state is read.
(2) Prefer deriving "what was it before?" from the record you are editing over
remembering it in the DOM. (3) Reproduce this class by opening TWO different
records in sequence — one open never shows it, and neither does a unit test that
renders once. This one was caught by driving a real browser through
open-A-then-open-B.

---

## Uploading a replacement photo on PICK leaves the previous file in Drive forever

**Symptom** (reported): "when there's already a picture of me uploaded on
teamsamo and i press upload files, and upload it without pressing the นำรูปออก,
the drive now store both files."
**What it was NOT**: the delete plumbing. `deleteTeamPhotoIfUnused()` ref-counts
`team_members` + `team_archive_members` and only then calls the GAS
`deleteTeamFile` action — and that action is live and working. Probed it before
touching anything, with a well-formed but non-existent Drive id, which returns
`{success:true, alreadyGone:true}`; the same probe with a junk action name
returns `Unknown action`, so the probe could tell "works" from "not deployed"
(both directions — class 7). The archive theory was wrong too: the live DB had
exactly ONE row with a photo and zero archive rows.
**Cause**: the admin member form uploaded the framed file the instant it was
PICKED, and only wrote the resulting URL into a hidden input. So every
intermediate choice became a real Drive file while only the last one ever
reached the row. Pick twice → the first upload is an orphan. Pick once and close
the editor → the upload is an orphan. And the delete path could never clean them
up, because it trashes the photo the DB was POINTING AT — precisely the file that
is not the orphan.
**Fix**: nothing leaves the browser until บันทึก. The crop dialog's output is
held in `memberPhotoPending` with an `URL.createObjectURL` preview; the submit
handler uploads it (with the modal still open and the button showing
`กำลังอัปโหลดรูป…`, so a failure has somewhere to be reported), then the existing
"trash the previous file if unreferenced" step runs as before. `นำรูปออก` drops
the pending pick as well as the stored URL, and `openMemberModal` clears it — the
modal is one reused DOM element, the same hazard as the permission grid above.
**Where**: `src/js/team/index.js` (`memberPhotoPending`, `clearPendingPhoto`,
`onMemberPhotoPick`, `uploadPendingPhoto`, `onMemberSubmit`); the same rule in
`src/js/my-seat.js` `wireSelfEdit`, which grew a photo field in the same commit.
**Rule**: an upload is a WRITE to an external store, so it belongs on the save
path, not on the pick. If a file can be uploaded before the record that will
reference it is committed, the difference between the two is a leak nobody can
find later — and the cleanup routine you already have cannot help, because it
only knows about files the database still names.

---

## A filled "danger" style made an UNCHECKED checkbox look ticked

**Symptom** (reported): "don't highlight the ทุกระบบ (Master) in the แก้ไขสิทธิ์
it makes people confusing if it's being selected or not."
**Cause**: the grid says "this option is ON" with
`.team-perm-opt:has(input:checked) { border-color: green; background: tinted }`.
The Master row then styled itself with `.is-danger { border-color: orange;
background: #fff6f0 }` — the same two properties, unconditionally. So the one
row in the form where being wrong about the state hands out every permission in
the app looked identical whether or not it was ticked.
**Fix**: OFF is a plain white row whose LABEL is orange (marking it out without
claiming a state); ON gets the filled panel plus an inset orange bar, and
`accent-color` makes the tick itself orange. Same information, but the
"selected" channel is used only for selected.
**Where**: `src/css/team.css` `.team-perm-opt.is-danger`.
**Rule**: a component's severity/kind styling must not borrow the same visual
channel the component already uses for STATE. If "checked" is a tinted
background, a variant must not have a tinted background at rest.

---

## A second pass over the same controls silently UNLOCKED the checkbox the first pass had locked

**Symptom** (found by driving the modal, not reported): ทีม SAMO (ดู) in
แก้ไขสิทธิ์ was supposed to be ticked-and-locked — the server grants it to
everyone with a posting, so a live checkbox there is a control that does
nothing. It rendered with the padlock and the dashed "อัตโนมัติ" chip, but the
box was fully clickable: `disabled` was `false` on every open. Unticking it
made the pane claim the person has no view access; reopening the modal put the
tick back.

**Cause**: two passes decide `disabled` on the same nodes, and the second one is
unconditional. `fillPermGrid()` writes `checked disabled` into the markup for an
implicit key. `syncMasterVisibility()` runs immediately after and does
`cb.disabled = on` over every non-master checkbox — where `on` is "is master
ticked". In the normal case master is OFF, so that line assigns `false` and
clears the lock the markup had just set. The bug is invisible in either function
read alone: each is correct about the rule it owns.

**Fix**: skip `IMPLICIT_PERMS` in the master loop entirely — the implicit row's
state is not master's to decide, in either direction. Guard test in
`team-vocab.test.js` asserts the skip exists AND precedes the assignment;
verified to go red with the line removed.

**Where**: `src/js/team/index.js` `syncMasterVisibility()`.

**Rule**: **only ever touch the controls THIS pass locked.** A pass that assigns
`el.disabled = <its own condition>` across a shared set will overwrite locks put
there for unrelated reasons. The read-only pass in this very file already
carries that lesson in a comment (`[data-readonly-locked]` exists precisely so
it can un-disable only what it disabled) — the master pass was written without
it. When one bug has already been paid for in a file, grep the file for the
other passes over the same nodes before assuming it was the only one.

---

## "ลบสมาชิกไม่ได้" — the delete button did nothing at all, and BOTH ways it can do nothing were silent

**Symptom**: In /admin/ → ทีม SAMO, clicking the trash icon on a member row
(`j@kkumail.com`, under หัวหน้าฝ่าย IT) did **nothing** — no confirm dialog, no
error, no change. Reported as "i can't delete this".

**Cause**: The database was never the problem, and proving that first is what
made the rest tractable. Simulating the exact DELETE as the signed-in account
(`phuriphat.ma@kkumail.com`, which holds `master`) inside `begin; … rollback;`
returned `deleted_rows: 1` — RLS allows it, there is no FK referencing
`team_members`, and the only triggers are `AFTER UPDATE` / statement-level.

So the failure was entirely client-side, and `onDeleteMember()` had **two**
silent exits before it ever reached the network:

1. `const m = findMember(id); if (!m) return;` — a DOM row that outlived the
   model it was rendered from produces a dead button with no trace.
2. `if (!confirm(...)) return;` — and a native `confirm()` **cannot tell you it
   was suppressed**. Chrome's "Prevent this page from creating additional
   dialogs" checkbox, once ticked, makes every later `confirm()` return `false`
   instantly with no UI for the lifetime of that page. The team module calls
   `confirm()` in 8 places, so an admin session reaches that checkbox easily.
   This is why only DELETE broke while แก้ไข / ย้าย kept working — those open
   Bootstrap modals, not dialogs.

And had the click reached the network, it would *still* have been silent:
`deleteMember()` checked only `error`, and PostgREST answers an RLS-blocked
DELETE with `204` and zero rows, not an error (the entry above,
"silent-success on RLS-blocked updates / deletes"). Three independent silent
paths stacked on one button.

**Fix**: Both early exits now say something and resync (`alert` + `reload()`)
instead of returning. All five deletes in `src/js/team/api.js` and three in
`src/js/shop/api.js` now send `prefer: 'return=representation'` and throw on an
empty array — matching what `projects/api.js`, `vs-staff.js` and
`announcements.js` already did. `src/js/delete-guard.test.js` sweeps every
`method: 'DELETE'` in `src/js` and asserts both halves; it was verified to FAIL
when a guard is removed, not merely to pass.

**Where it lives now**: `src/js/team/api.js` (deleteNode / deleteMember /
deleteTerm / deleteArchiveMember / deleteMajor), `src/js/shop/api.js`
(deleteProductType / deletePromptpayQr / deletePickupLocation),
`src/js/team/index.js` (onDeleteNode / onDeleteMember),
`src/js/delete-guard.test.js`.

**Rules**: (1) A handler that can `return` without doing anything must say why —
"nothing happened" is the hardest symptom to debug because it names no
component. (2) Native `confirm()` / `alert()` are not reliable control flow in a
long-lived SPA: the browser can disable them permanently and silently, and
`false` then means "suppressed", not "cancelled". Destructive confirmations
belong in an app-owned modal. (3) When a UI action fails, prove which SIDE it
fails on before reading either — simulating the write as the real user, rolled
back, cost one query and eliminated RLS, FKs, triggers and realtime in one shot.

---

## "แก้ไขข้อมูล ของระบบบ้าน — ต้องกดหลายครั้งถึงจะขึ้น" — one listener per re-render, and a toggle that reads its own state

**Symptom** (as reported): *"the แก้ไขข้อมูล of ระบบบ้าน on samoweb main page, i
need to click many times and sometime it will appear, also the เพื่อนร่วมบ้าน"*.
Intermittent, unreproducible on a fresh load, and it "healed" if you kept
clicking — the profile of a bug nobody can pin down.

**Cause**: two ordinary decisions that are harmless apart and fatal together.

1. `renderMyHouse()` painted the card with `host.innerHTML = …` and then called
   `wireCard(host)`, which attached a **delegated** `click` listener **to `host`
   itself**. `host` is `#homeMyHouse` — a node in `index.html` that survives
   every re-paint. The card re-renders on every auth event (`onAuthChange` fires
   on load, on each token refresh, after every save), so the listener count grew
   by one each time: 1, 2, 3…
2. The handler opened the panel with `p.classList.toggle('d-none')` — visibility
   derived from the element's *own current class*.

N listeners × a self-referential toggle = the panel flips N times per click, so
it opens on an **odd** number of paints and does nothing on an even one. First
load: one listener, works. After the session settles or after one save: two,
dead. Click twice: opens.

**Fix**: listeners go on the nodes **this paint created** (`host.querySelector(...)`
inside the freshly written markup), so the next `innerHTML =` throws them away
with the nodes. Panel visibility is one variable — `open = 'edit' | 'report' |
'roster' | null` — and every panel's `hidden` is assigned from it explicitly;
nothing asks the DOM what state it is in. `src/js/house/my-house.test.js` pins
both shapes at the source (no `host.addEventListener`, no
`classList.toggle('d-none')`), the way `delete-guard.test.js` pins the DELETE
convention.

**Where it lives now**: `src/js/house/my-house.js` (`wireCard`),
`src/js/house/my-house.test.js`.

**Rules**: (1) **A listener attached to a node that outlives the render is a
leak with behaviour.** If a function both writes `innerHTML` and adds a
listener, the listener must go on something inside that `innerHTML` — otherwise
call it exactly once, from a place that cannot run twice. (2) **Never derive UI
state from the DOM you are about to change.** `classList.toggle` answers "what
is it now?", which is only correct if the handler runs exactly once; hold the
state in a variable and assign every dependent property from it. This is the
same geometry as the perm-grid checkbox that a second pass silently unlocked
(class 6) — one property, two sources of truth. (3) An **intermittent** UI bug
that gets better when you click more is almost always a handler-count problem,
not a race.

---

## A chooser that opens as an empty placeholder while its vocabulary loads SUBMITS the empty value

**Symptom** (found by tracing, before it reached anyone): opening บ้านของฉัน →
แก้ไขข้อมูล and pressing บันทึก quickly would silently clear the student's สาขา.

**Cause**: the form was rendered with `<select name="major"><option value="">—
กำลังโหลด —</option></select>` and the real list was fetched when the panel
opened. The form is submittable the instant it appears, so a submit inside that
window read `value === ''`. The RPC treats a present-but-empty key as an
intentional clear (`nullif(btrim(''),'') → NULL`), so the สาขา was erased — and
because the same call records the field in `students.self_edited`, the
0125 trigger then protects the *erased* value from every future import. A
half-second race produced a permanent loss.

Two things made it invisible: the window is short, and the sibling component
had already solved it. `my-seat.js` renders its สาขา chooser as
`optionsHtml(majors, val)` — which, with `majors` still `[]`, keeps the stored
value as its own selected option — so the pre-load markup there is already
correct. The house card was written later and drifted from it.

**Fix**: render the select from `majorOptionsHtml(rec.major)` at paint time; the
async load only ever REPLACES options with a longer list. `my-house.test.js`
asserts the initial markup carries `value="<current>" selected` and no loading
placeholder, and the guard was verified to FAIL when the placeholder is put back.

**Where it lives now**: `src/js/house/my-house.js` (`editFormHtml`,
`majorOptionsHtml`), `src/js/house/my-house.test.js`.

**Rules**: (1) **A control that is visible is submittable.** Anything rendered
before its data arrives must render with the CURRENT value already correct —
"loading" is a state for the options, never for the value. (2) When a sibling
component already does the same job, read it before writing the second one; the
older one here was right and the new one regressed against it (class 6).
(3) Watch for a fix that makes a loss PERMANENT: `self_edited` is exactly right
for a deliberate edit and exactly wrong for an accidental one, so the accidental
path has to be closed at the source.

---

## "ปฏิเสธ ไม่ทำงาน แต่อนุมัติทำงาน" — the same suppressed-dialog bug, on a different button

**Symptom** (as reported): *"ขอแก้ สายรหัส จาก 100 เป็น 200 … when i hit ปฏิเสธ it
doesn't work, when i hit อนุมัติ it works"* — the house คำขอแก้ไข queue.

**Cause**: the reject path collected a reason with `prompt()`:

```js
const note = approve ? null : (prompt('เหตุผลที่ปฏิเสธ …') || null);
if (!approve && note === null) return;      // "cancelled"
```

**Two** silent exits, and the reporter could have hit either:
1. Chrome's "Prevent this page from creating additional dialogs", once ticked,
   makes every later `prompt()` return `null` instantly with no UI for the life
   of the page — read here as "cancelled".
2. Pressing OK on an EMPTY box returns `''`, which `|| null` also turns into
   `null`. So an admin with no particular reason got the same nothing, and
   nobody had ever been told a reason was mandatory.

อนุมัติ worked for exactly one reason: it never opened a dialog.

**This was already known and written down.** The identical cause is logged two
entries above for ทีม SAMO's delete button, `my-house.js` had already replaced
its two `prompt()`s for this reason and says so in a comment, and a scan earlier
the same day listed "the house admin pane still uses 4 native
`confirm()`/`prompt()` calls" as an open item — and shipped. **A hazard written
down three times still shipped a live bug**, which is the actual lesson.

**Fix**: the reason is an ordinary `<input>` in the request card — always
visible, genuinely optional, impossible for the browser to suppress. The two
remaining `confirm()` calls (delete student, delete advisor) now use
`src/js/confirm-modal.js`, an app-owned dialog that always resolves and treats
ESC / backdrop / ยกเลิก as false. It reuses `vs-staff.js`'s stacked-modal
plumbing verbatim — both deletes open from inside an already-open modal, and
Bootstrap gives every modal the same z-index and drops `body.modal-open` when the
top one closes.

**Where it lives now**: `src/js/confirm-modal.js`, `src/js/house/index.js`
(`onDecide`, `onStudentDelete`, `onAdvisorDelete`).

**Rules**: (1) **A native dialog is not control flow.** `confirm()` → false and
`prompt()` → null are indistinguishable from "the browser turned them off".
(2) When a fix is applied to one module, grep the SIBLING modules in the same
commit — `my-house.js` was fixed and `index.js`, twenty lines away in the same
feature, was not. (3) An open item in a scan report is not a fix; if it is a live
silent failure on a destructive control, it is the thing to do first, not the
thing to write down. `team/index.js` still has 9 `confirm()` calls — same fix,
same helper.

---

## "แก้ไขสมาชิก shows ชื่อ นามสกุล as blank, that isn't good" — a correct refusal, applied where there WAS a human to ask

**Symptom**: after the ชื่อ/นามสกุล split shipped (0135), opening แก้ไขสมาชิก on
any of the 399 pre-split members showed both name boxes EMPTY, with the stored
name printed underneath as a hint. Reported within minutes.

**Cause**: the rule "never split a stored name on whitespace" was applied
literally instead of by its purpose. The purpose is *no unreviewed guess is ever
written* — which is why `house/io.js` refuses a whole CSV: there is no human in
the loop for 1,800 rows. A member modal is the opposite situation: one admin,
one person, the stored name on screen. Refusing to suggest there bought no
safety and cost two things — an editor whose most visible field opens empty
reads as data loss, and a split nobody would ever fill in for 399 people
one blank pair at a time.

**Fix**: `suggestNameSplit()` (`team/fields.js`) fills the boxes from the first
run of whitespace, the stored name is shown beside them, and the save path asks
once — through `askConfirm`, never `window.confirm` — when the values are still
the untouched suggestion. The guess becomes a decision, and only on the first
edit of each legacy row.

**Where it lives now**: `src/js/team/fields.js` (`suggestNameSplit`, with the
"never call this to build a patch" warning), `src/js/team/index.js`
(`openMemberModal`, `onMemberSubmit`).

**Rules**: (1) A safety rule states an OUTCOME, not a mechanism — before
applying one somewhere new, ask which of its preconditions actually hold here.
(2) "Refuse" and "suggest, then confirm" are different answers to the same risk,
and the right one depends on whether a human is present to review. (3) An
editor that opens with an empty field the user can see filled elsewhere will be
reported as data loss, correctly.

---

## Adding an `await` before the modal closes re-opened a double-submit window

**Symptom**: found by audit, same session it was introduced. Pressing บันทึก
twice on a NEW ทีม SAMO member could create the person twice.

**Cause**: `onMemberSubmit` disabled the submit button only inside its
`if (memberPhotoPending)` branch. That was safe for a reason nobody had written
down — with no photo there was no `await` between the submit event and
`modalInstance(...).hide()`, so there was no window to click in. Adding the
ชื่อ/นามสกุล confirmation put an `await askConfirm(...)` **before** the hide,
with the modal open and the button live. Two presses, two dialogs, two
`createMember` calls.

The precondition was invisible: the safety came from the absence of an await,
which is not something a reader thinks to preserve.

**Fix**: a wrapper that disables the button and drops re-entrant submits, with a
`finally` that restores it. The photo branch's inner `finally` now restores only
the LABEL — re-enabling `disabled` there would have re-opened the window for the
rest of the save.

Dropping the second press is right here and is NOT the "a busy flag that returns
early silently discards the second action" trap in this file: that is about two
DIFFERENT actions being collapsed. This is the same submit twice, and the honest
answer to "save this form again while it is saving" is nothing.

**Where it lives now**: `src/js/team/index.js` (`onMemberSubmit` /
`runMemberSubmit`).

**Rule**: any handler that ends in a mutation must own its busy state
explicitly. "There is no await before the close" is a precondition, not a
design — the next person to add a confirmation will not know they are removing
it.

---

## "เพิ่มสมาชิก ไม่ทำงาน" + "ค้นหาคนจากระบบ ไม่ขึ้นรายชื่อ" — one deletion took out the block sitting next to it

**Symptom**: two reports, one session, on iPad AND desktop. (1) In `/admin/`
ทีม SAMO, the **เพิ่มสมาชิก** button did nothing at all — no modal, no message,
no alert. (2) The **ค้นหาคนจากระบบ** box in the member editor never showed a
suggestion. Nothing in the build or the 552 tests was red.

**Cause**: migration 0141's commit removed the "ดึงจากระบบบ้าน" button, whose
handler `onFillFromHouse` lived in `team/index.js`. The deletion ran past the
end of that function and took the **next 95 lines** with it — the 0137 person
picker: `personSearchToken` / `personSearchTimer` / `personSearchHits` and the
two renderers `renderPersonResults()` / `pickPerson()`. Every CALL site stayed.

Five free identifiers, two symptoms:

- `fillMemberModal` resets the picker on open (`personSearchToken += 1`). That
  line is a `ReferenceError`, thrown while **preparing** the dialog — so the
  modal never got shown, on every path into it. A silent nothing.
- the search input's handler touches `personSearchTimer` on the first keystroke
  and dies before it ever queries.

Nothing in this repo could see it. Vite/Rollup do not resolve free identifiers
— an unknown name is assumed to be a global — and there is no linter. The
symptom only exists at runtime, in a signed-in admin pane that no test drives.

Two containment fixes shipped first and neither was the cure, which is itself
worth recording: splitting `openMemberModal` into open-then-fill, and wrapping
each of `initTeam`'s ten `wire*()` calls in its own try/catch. Both were right
(the modal now opens half-filled instead of not at all, and one broken wire-up
no longer kills the tree delegation eight lines later) — but they turned a dead
button into a degraded one. **Containment that makes a failure visible is not a
diagnosis; the console line it adds is.**

**Fix**: restore the deleted block verbatim. Then the mechanism, because the
comment version of this rule ("check what you are deleting next to") is exactly
the kind nobody reads: `src/js/undefined-refs.test.js` parses every module with
`rollup/parseAst` and fails the build on any identifier that is read but bound
nowhere in its file and is not a global. The binding scan is whole-file and
over-approximate on purpose — shadowing and hoisting become non-issues, and a
guard that never cries wolf is one that survives. It found the five names and
six real vendor/browser globals (`bootstrap`, `Quill`, `createImageBitmap`),
which are now an explicit allow-list.

Also removed: `teamMemberHouseFillHint`, the removed button's status line, left
behind in both the markup and `fillMemberModal` — the same partial-deletion
class, in the harmless direction.

**Where it lives now**: `src/js/team/index.js` (the restored
`// ---- the person picker (0137)` block) · `src/js/undefined-refs.test.js` ·
`src/html/tab-team.html`.

**Rule**: a delete is an edit to its NEIGHBOURS. And when a language will not
tell you that a name resolves to nothing, make the build tell you — this repo
has now paid twice in one week for a removal that took an unrelated neighbour
with it (`485478f` deleted Drive files it thought were unused; this one deleted
code it thought was part of what it was removing).

---

## The ลบ button on a สาขา row rendered OUTSIDE the modal on a phone — an `auto` grid track sized from min-content

**Symptom**: found by driving the admin app at 390 px, not by a report. In
จัดการรายการสาขา (ทีม SAMO → member editor → จัดการรายการสาขา), each row was
**426 px wide inside a 374 px dialog**. The trash button sat entirely off the
right edge and the pencil was half-clipped, so on an iPhone or an Android phone
**a สาขา could not be deleted at all**. The page reported no horizontal overflow
(`documentElement.scrollWidth === innerWidth`) because the modal body clipped
it — the usual overflow check said everything was fine.

**Cause**: `.team-majors-list` was `display: grid` with no `grid-template-columns`.
The implicit track is `auto`, and an `auto` track is floored at its content's
**min-content** width. The row's min-content is not negotiable: a `white-space:
nowrap` count plus two 32 px buttons plus the gaps. So the track grew past its
container instead of the row shrinking, and `.team-major-main { flex: 1;
min-width: 0 }` — which looks like it handles exactly this — never got the
chance, because the row it lives in was never the constrained thing.

It looked correct on every desktop it had ever been opened on.

**Fix**: `grid-template-columns: minmax(0, 1fr)` so the track cannot exceed the
container, `flex-wrap: wrap` on the row so the actions drop to a second line
rather than off the edge, `margin-left: auto` on the count so count + both
buttons travel as one right-aligned cluster, and a `<576px` rule giving the name
the whole first line. Verified at 390 / 412 / 768 / 1440 px in headless Chrome.

**Where it lives now**: `src/css/team.css` (`.team-majors-list`,
`.team-major-row`, `.team-major-main`, `.team-major-count`).

**Rule**: `overflow-x` on `<html>` is not a mobile test. A clipped ancestor
hides the overflow from every page-level check, so the thing to measure is
whether each control's `getBoundingClientRect().right` is inside the container
that clips it. And a CSS grid's default `auto` track does not shrink below
min-content — inside a fixed-width parent, spell the track `minmax(0, 1fr)`.

---

## `confirm()` on a SAVE path, not just a delete — permissions silently refused to save

**Symptom**: found by audit while sweeping this class. In ทีม SAMO → จัดการสิทธิ์,
pressing บันทึก on a grant that includes full `vs` ("ทุกแผนก") or full `passport`
("ทุกฝ่าย") could do nothing at all — no save, no error, no dialog.

**Cause**: the same suppressed-dialog mechanism that killed ลบสมาชิก and ระบบบ้าน's
ปฏิเสธ, but on a *write* path. `readPermInputsOrWarn()` guarded those two
escalating grants with `confirm()` and returned `null` on a false. Once Chrome's
"Prevent this page from creating additional dialogs" box is ticked — and the
admin session that hands out permissions is exactly the session that ticks it —
`confirm()` returns false instantly with no UI, so the guard read "the admin
backed out" and the submit handler returned. Forever, for that page.

The two earlier instances of this class were both DELETES, which is how it kept
being filed as "the delete button is broken" rather than as what it is: a
dialog is not a value you can read.

**Fix**: every native dialog in `team/index.js` and `team/terms.js` now goes
through `askConfirm` / `askDelete` (`src/js/confirm-modal.js`), which this app
draws and which always resolves. `readPermInputsOrWarn` and `confirmMaster`
became async and are awaited at all four call sites. `renameMajor`'s `prompt()`
became an input in the row it renames — there is deliberately no `askPrompt`,
because a value the user types belongs in the form it affects.

The guard is `src/js/native-dialog.test.js`: a RATCHET listing the modules that
still use native dialogs, which may only shrink, plus an explicit
must-stay-clean list for the ทีม SAMO / ระบบบ้าน / self-service surfaces.

**Where it lives now**: `src/js/team/index.js` · `src/js/team/terms.js` ·
`src/js/native-dialog.test.js`.

**Rule**: when a hazard has already been paid for twice, the third fix is a
test, not a third patch. And look for the class on the WRITE paths too — a
guard that fails closed on a delete is annoying; on a save it is invisible.

---

## `/admin/#vs` opened the VitalSound workspace for an admin with no VitalSound grant

**Symptom**: found by tracing the admin router. The sidebar hides sections the
account cannot use, and the click delegate skips a hidden button — but the HASH
was never checked. Typing (or bookmarking, or following an old link to)
`/admin/#vs`, `#shop`, `#house` ran that section's `enter*()` loader and painted
its workspace, with no sidebar entry to leave by.

**Cause**: `showAdminSide(which)` trusted its argument. Two more doors shared
the gap: `tryCreatorDeepLink()` opened the announcement editor for `#creator/<id>`
without checking `creator`, and the `?scan=<order>` subscriber routed to the shop.

Not a data leak — RLS returns no rows, so the panes come up empty — which is
precisely what makes it worth fixing: a workspace that renders and then can do
nothing is the "live-looking ลบ button that 42501s" shape, one layer up.

**Fix**: `canOpenSection(which)` resolves the section's key through the existing
`SIDE_FEATURE` map and `userCanAccess()`, and `showAdminSide` falls back to the
landing pane. An UNKNOWN section stays allowed — `showAdminSide` already lands
those on the landing pane, and failing closed here would be a second copy of the
section list to keep in step.

**Where it lives now**: `src/js/admin-main.js` (`canOpenSection`).

**Rule**: a gate on the widget is not a gate on the route. Enumerate every way
in — click, hash, query string, deep link — because the URL bar is one of them
and it is the one nobody renders.

---

## `{"code":"23505" … "students_kkumail_key"}` in an alert() — a unique index used as a first line of defence

**Symptom**: reported verbatim — *"what if i add student data in ระบบบ้าน that
already exist in teamsamo, it shows `{"code":"23505","details":null,"hint":null,
"message":"duplicate key value violates unique constraint \"students_kkumail_key\""}`.
what if the data isn't the same, or some field left blank, etc."*

**Cause**: the create path had no duplicate handling at all, so the raw PostgREST
envelope reached `alert()`. A unique index is the correct BACKSTOP and a terrible
first line of defence: by the time it fires the admin has filled in a whole form,
and what comes back names an index rather than a person — it does not say who the
address belongs to, whether they are already in a บ้าน, or what to do next. The
admin's only remaining move is to guess.

**Fix**: "already exists" is THREE situations wanting three different next
actions, so the form grew three states rather than one error message.

1. **Already a นักศึกษา** — nothing to create. Name them, name their สาย and
   บ้าน, and offer a button that switches the modal to the row that exists.
2. **In the registry, not in ระบบบ้าน** — a ทีม SAMO member getting a house
   placement for the first time. A legitimate save; the DB links them to the same
   `public.people` row. "ใช้ข้อมูลจากระบบ" fills the BLANK boxes only, and every
   field where the registry DISAGREES is listed with both values — choosing
   between two spellings of a real person's name is a decision, not a merge.
3. **Nobody** — no banner.

**Two things that would have made it wrong**:

- The lookup is `search_people` (SECURITY DEFINER), **not** a scan of the
  `students` array the pane already holds. RLS returns zero rows rather than an
  error, so a local scan answers "no such person" for exactly the rows the caller
  cannot see — a fail-open, and the shape behind three bugs here already.
- **Exact kkumail equality only.** `search_people` is a SEARCH; treating its best
  guess as an identity would let a half-typed address claim a stranger's record
  ("an ILIKE lookup makes the id a PATTERN, not a capability").

`duplicateMessage()` stays as the second line and is **not** redundant: the
lookup can be in flight or failed, two admins can pass the check in the same
instant, and the รหัสนักศึกษา clash is deliberately not pre-checked at all (a
shared รหัส is an ambiguous fact about two humans — 0108 — not a duplicate to
merge). Same shape as `update_my_student_record` (0125), whose own comment says
it: *the pre-check gives the good message in the ordinary case; the exception
handler is what makes it true.*

**Where it lives now**: `src/js/house/index.js` (`paintPersonMatch`,
`duplicateMessage`) · `src/js/house/duplicate-message.test.js` · proof
`tools/house0145-duplicate-person.sql` (5/5).

**Rule**: a constraint violation is a fact about a PERSON, and the UI owes the
reader that sentence — but say it while the field is still being typed, not after
a form has been filled in. Keep the handler anyway: a pre-check is a courtesy and
only the index is the guarantee. And every error translator needs a control that
NON-matching errors pass through untranslated — one that swallows a permissions
failure as "ข้อมูลซ้ำ" costs an admin an afternoon hunting a duplicate that does
not exist.

---

## "แก้ไขสมาชิก … ค้นหาคนจากระบบ … พู่กัน picture become myself" — a picker built for ADD, reused in EDIT, wired to a mirror

**Symptom**: as reported — open แก้ไขสมาชิก on your OWN row, use ค้นหาคนจากระบบ,
click a different person, and the form fills with them. Then the other person's
portrait becomes yours. Measured on prod afterwards: **five rows across
`people`, `students` and `team_members` had collapsed onto a single photo.**

**Cause**: `pickPerson()` (`team/index.js`) overwrites the identity fields with
the picked person's. That is correct for **เพิ่มสมาชิก**, where "who is this"
has no previous answer. In **แก้ไขสมาชิก** the identical click means something
else — it REASSIGNS an existing posting to a different human — and the function
could not tell the two apart, because it never looked at `teamMemberId`.

The blast radius is the part worth remembering. The picker only edits a form;
the damage is done by three correct mechanisms downstream:

1. save writes the picked `kkumail` onto the edited posting;
2. `team_members_link_person` repoints that row's `person_id` at the picked
   person's `public.people` row (the registry matches on kkumail);
3. `team_member_mirror_up` UPDATEs that registry row from the posting —
   including `photo_url` and `photo_focus`;
4. `person_mirror_down` fans the result to every OTHER posting that person holds
   and to their `students` row.

Nothing raised. Every one of those steps is doing exactly its job. **A form that
can change WHICH ENTITY a row refers to is a different kind of control from one
that edits the row's fields, and the mirrors turn it into a multi-system write.**

The portrait was a second, independent bug underneath it: `search_people`
returned no photo, so `pickPerson` left the *previous* row's face in the form
while changing who the row was. Clearing it instead would have been no safer —
`team_member_mirror_up` assigns unconditionally, so `photo_url = null` does not
mean "leave it alone", it means "wipe this person's portrait everywhere".

**Fix**: (a) `pickPerson` asks first — `askConfirm`, danger, default cancel —
but ONLY when it is genuinely a swap: editing, with an existing kkumail, picking
a different one. A posting with no kkumail yet (15 live) is the case this picker
legitimately serves during an edit and stays one click. (b) migration **0148**
adds `photo_url`/`photo_focus` to `search_people`, so the portrait travels with
the person and step 3 writes their own face back onto them — a no-op. (c) the
damaged data was repaired through the registry, letting the same mirror fan the
correct portrait back down.

**Where it lives now**: `src/js/team/index.js` (`pickPerson`),
`supabase/migrations/0148_search_people_carries_the_portrait.sql`.

**Rules**: (1) **A control that reassigns identity is not an edit control** —
when the same widget serves ADD and EDIT, ask what the click MEANS in each, not
whether it fills the same boxes. (2) A mirror makes every local write a
distributed one: before allowing a form to change a foreign key, ask what
follows it. (3) When a projection feeds a form, it must carry EVERY column the
save will write, or the form composes one entity out of two. (4) Fixing this in
the client alone was not possible — the missing column was the bug.

---

## The ยกเลิก button in `askConfirm` did nothing — in the module written because buttons did nothing

**Symptom**: found by driving the real UI, not by a report. A confirm dialog
opened, and clicking **ยกเลิก** left it on screen. Clicked again — still there.
Clicked by element reference rather than coordinates, to rule out an overlay
stealing the hit — still there. `ESC` dismissed it instantly.

**Cause**: the markup in `confirm-modal.js` was

```html
<button type="button" class="btn btn-sm btn-secondary" data-confirm-no>ยกเลิก</button>
```

Nothing in the module binds a click handler to `[data-confirm-no]`. That is by
design and it is the good design — the promise resolves from `hidden.bs.modal`,
so ESC, the backdrop and the button all funnel through one exit and cannot
disagree. But that only works if something actually HIDES the modal. The yes
button calls `modal.hide()` explicitly. The no button was relying on a
`data-bs-dismiss="modal"` attribute **that was never written**. So it was inert:
21 call sites, every destructive confirmation in the app, and the only way out
was a key nobody is told about.

The file's own header comment asserted *"ESC / backdrop / ยกเลิก all mean
false"*. The intent was documented; the wiring was absent. **A comment is not a
mechanism** — and this is the second time that sentence has been earned by this
exact file.

**The irony is the finding.** `confirm-modal.js` exists *because* Chrome's
"prevent this page from creating additional dialogs" checkbox turns native
`confirm()` into a silently-false no-op, reported twice here as
"ลบสมาชิกไม่ได้" and "ปฏิเสธ ไม่ทำงาน". The replacement shipped a button that
does nothing. A fix for a class of bug is not immune to that class.

**Fix**: `data-bs-dismiss="modal"` on the button, plus
`src/js/confirm-modal.test.js`, which accepts EITHER that attribute or a real
click handler, and separately pins that the resolution still happens in
`hidden.bs.modal` (so "fixing" cancel by resolving in a click handler, which
would break the ESC and backdrop paths instead, also fails).

**Two ways the test itself was wrong first, both worth keeping**:
1. Its helper found the marker with `indexOf`, and the marker string also
   appears in the source's own COMMENT, so it reported "no cancel button found"
   against markup that was right there. It matches a `<button …>` tag now.
2. Its "or a click handler exists" branch matched the words `[data-confirm-no]`
   in a comment plus an unrelated `addEventListener('click', onYes)` further
   down — so with the bug reintroduced the test still PASSED. It strips comments
   before asserting now. **A guard that reads comments can be satisfied by
   writing about the fix instead of making it.**

**And the explanatory comment broke the build once**: written as an HTML comment
INSIDE the `innerHTML` template literal, it contained attribute names in
backticks, and a backtick inside a template literal ends the template literal.
`undefined-refs.test.js` caught it as a Rollup parse error.

**Where it lives now**: `src/js/confirm-modal.js`, `src/js/confirm-modal.test.js`.

**Rules**: (1) When a dismissal is declarative (`data-bs-dismiss`), it is CODE —
losing it is losing a line of logic, so pin it. (2) Drive the control a person
actually aims at; ESC working is not the button working. (3) Verify a new guard
BOTH ways — reintroduce the bug and watch it fail — or you have written a test
that asserts your own comment. (4) The module that fixes a bug class is not
exempt from that class.

---

## A VIEW is not a BREAKPOINT — scoping a layout to `@media` and then making it user-selectable

**Symptom**: none visible, which is why it survived. The public org chart's
รายการ view lost its connector rails and its depth-scaled headings on any screen
≥1024px. Nothing looked broken; the tree simply rendered flat, exactly as it had
before those rules were written.

**Cause**: the layout started out chosen by SCREEN SIZE — indented list under
1024px, horizontal chart above — so the list rules lived in
`@media (max-width: 1023.98px)`. Correct at the time. Then the owner asked for a
toggle, and the views became a `data-view` attribute the reader controls. The
media query was never revisited, so on a desktop the reader could select รายการ
and get a version of it that had been silently disabled.

**Fix**: scope on `[data-view="list"]` / `[data-view="chart"]`. The rule is the
generalisation: **a media query answers "how big is the screen", a view answers
"what did the reader ask for", and the moment the second exists the first is the
wrong question.** Nothing about 1024px was ever what those rails depended on.

**Where it lives now**: `src/css/org-chart.css`, the "THE TWO VIEWS" block, whose
header says this in three lines so the next person does not re-derive it.

**Rules**: (1) When a layout becomes user-selectable, grep every `@media` that
was standing in for the choice. (2) A rule that stops applying is invisible —
CSS has no undefined-reference error. The only way to catch it is to ask the
browser for the computed value.

---

## A markup refactor silently unhooked every `> .org-station` selector

**Symptom**: also invisible. The depth-scaled ตำแหน่ง headings (a ฝ่าย larger
than a ตำแหน่ง four levels down) simply never applied — every heading rendered at
the base size, which looks like a design that was never added rather than one
that stopped working.

**Cause**: the horizontal chart needed each node's box to be a layout SIBLING of
its children row, so `nodeBlock` began wrapping the station in `.org-box`:

```
li.org-node > h3.org-station              →  li.org-node > div.org-box > h3.org-station
```

Five selectors written as `.org-node[data-depth="N"] > .org-station …` kept
parsing, kept being served, and matched nothing.

**Fix**: `> .org-box > .org-station`. Found by asking the page for
`getComputedStyle(...).fontSize` and getting `none` for an element the selector
claimed to style — then confirming with
`document.querySelector(sel)` returning `null` for the old path and an element
for the new one, which distinguishes "the rule is wrong" from "the element is
absent".

**Where it lives now**: `src/css/org-chart.css`, with a comment on the hop.

**Rules**: (1) **A child combinator is a contract with the markup.** Changing the
DOM shape breaks every `>` selector that crossed the changed boundary, silently,
with no build error and no console warning. When you insert a wrapper, grep for
`> .<child>` on the element you wrapped. (2) The instrument for "is this rule
applying" is the computed style, never the stylesheet.

---

## `justify-content: center` makes the overflow of a scroll container UNREACHABLE

**Symptom**: reported as "สมาชิกฝ่าย Production it department got cutoff". Boxes
at the start of a horizontally-scrolling org chart were clipped, and no amount
of scrolling revealed them.

**Cause**: a flex row centred with `justify-content: center` distributes its
overflow to BOTH sides. The end-side overflow is scrollable; the start-side
overflow sits at a negative offset that the scroll range does not cover, so the
browser clips it and there is no scroll position that shows it. Any ฝ่าย wider
than the viewport lost content off the left.

**Fix**: `justify-content: safe center` — the `safe` keyword falls back to
`start` exactly when the alignment would cause overflow. A section that fits
stays centred; one that does not becomes fully reachable.

Verified by measuring, not by looking: for every box, compute
`rect.left - wrapper.left + wrapper.scrollLeft` and assert none is negative.
0 boxes after, several before.

**Where it lives now**: `src/css/org-chart.css`.

**Rules**: (1) Any centred flex/grid that can overflow its scroll container needs
`safe`. (2) "It looks cut off" has a mechanical test — a negative scroll-space
offset — that is far more reliable than scrolling around looking for it.

---

## `flex-wrap` does nothing inside `width: max-content`

**Symptom**: added `flex-wrap: wrap` to make a twelve-column org-chart row wrap
on an iPad, rebuilt, re-measured — and the numbers came back **byte-identical**.
Not "a bit better": exactly the same, to the pixel.

**Cause**: the flex container's ancestor chain carried `width: max-content`, so
the container is always as wide as its content wants to be. A wrap point is a
width the content is not allowed to exceed, and `max-content` guarantees there
is no such width. Wrapping was correctly enabled and could never trigger.

**Fix**: bound the wrapping row — `max-width: calc(100vw - <gutter>)`. Wrapping
then happens at the screen edge, and costs nothing when the row already fits
because it is a no-op there.

**Where it lives now**: `src/css/org-chart.css`, noted in the block header
because the failed attempt is more instructive than the fix.

**Rules**: (1) `flex-wrap` needs a CONSTRAINT, not just permission. If nothing
bounds the container, nothing wraps. (2) **Identical measurements after a change
mean the change did not apply** — that is a stronger signal than a small
improvement, and it is worth re-measuring precisely so the difference between
"no effect" and "small effect" is visible.

---

## "เข้าสู่ระบบด้วย Google" read as KKU-only — a steer written as a rule, and a form hidden behind a collapse

**Symptom**: reported as two complaints about the sign-in modal at once. "it
shows too many text", and — the substantive one — the copy made Google sign-in
look restricted to KKU: *"i not just want to encourage only kku people, it'd be
misleading for other normal people who thinks oh only kku would use login with
google, in fact they can use it also and i want them to use it."* Plus: the
username/password form "shouldn't be collapse, it should be expand all".

**Cause**: three separate mistakes stacked on the same screen.

1. **A steer stated as a requirement.** The copy read "นักศึกษาและบุคลากร MDKKU
   ใช้บัญชี Google ของมหาวิทยาลัย" and "เลือกบัญชีที่ลงท้ายด้วย @kkumail.com หรือ
   @kku.ac.th". Both are imperative. The intent was true and useful — a
   non-kkumail account can never match `students.kkumail`, so ระบบบ้าน is empty
   for it — but the reader cannot see intent, only grammar. An outsider reading
   an instruction they cannot follow concludes the door is not theirs.
2. **The benefit clause made it worse, not better.** "…เพื่อให้เห็นข้อมูลสายรหัส
   บ้าน และตำแหน่งในทีม SAMO ของตัวเอง" was added to justify the steer, and it
   re-created the impression it was meant to soften: a list of things you get by
   using the KKU domains reads as the reason the KKU domains are required.
3. **The collapse hid a route AND broke a caller.** The form lived in a
   `.collapse` opened by a text link. `account-switch.js` `pickAccount()`
   prefills `#signinLoginUsername` and then calls `pInput.focus()` — and
   `.focus()` on a `display:none` input is a silent no-op. So switching back to
   a saved password account opened a modal that looked empty and inert, with the
   username invisibly prefilled inside a shut collapse.

Found while fixing the copy, not reported: `samoShowSigninScreen()` toggles a
`d-none` between the login and register screens and **nothing ever toggled it
back**. One visit to สมัครสมาชิก made register the permanent landing screen for
every later open — including the switcher path in (3), which prefills a form on
a screen that is no longer showing.

**Fix**: each line now names an AUDIENCE instead of stating a rule —
"สำหรับบุคคลทั่วไป และนักศึกษา/บุคลากร มข. (@kkumail.com หรือ @kku.ac.th)" over the
Google button, and "สำหรับผู้ที่ไม่ต้องการเปิดเผยตัวตน" over the password form,
which is what that route has always actually been (it was mislabelled "สำหรับ
บัญชีของฝ่ายงาน"). The domains survive as a parenthetical because KKU students
scan for them; nothing tells anyone which account to pick. The collapse is gone,
so both routes are visible and hierarchy is carried by button WEIGHT — filled
Google, outline password. The screen reset is one `hidden.bs.modal` listener in
`mountAccountSwitch()`, the only module BOTH entries import.

**Where it lives now**: `src/html/modal-signin.html`, `src/css/cards.css`
(`.signin-kku-hint`, `.signin-alt-caption`), `src/js/account-switch.js`.
Guarded by `src/js/signin-screen.test.js` — no collapse on the login screen, the
copy names บุคคลทั่วไป and never says "เลือกบัญชีที่ลงท้ายด้วย", and the reset
listener exists. Verified by reintroducing all three bugs and watching four
assertions fail.

**Rules**: (1) **A steer written in the imperative is a rule to the reader**,
whatever it was meant as. If a channel accepts everyone, the copy has to say who
it is FOR, not what to pick. (2) Justifying a steer with the benefits it unlocks
strengthens it — the benefit list is read as the reason for the restriction.
(3) **Hiding a legitimate route behind a disclosure widget is an API change**:
every caller that focuses, prefills, or scrolls to something inside it now acts
on a `display:none` node, and `.focus()` fails silently. (4) A screen toggle
with no reset is a mode the user cannot leave — pair every `d-none` flip that
survives a close with a reset on `hidden.bs.modal`.
