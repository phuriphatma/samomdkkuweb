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
