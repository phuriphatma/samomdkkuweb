# Mistakes — Routing, read-state, caches & serialization

State that outlives one render: what is in the URL, what "seen" means per user, and what a round trip drops.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## "Unread" highlight inside an item vanishes the moment you open it — mark seen AFTER capturing seenAt for the open view

**Symptom**: VPA writes a comment on a หนังสือ. Receiver sees the grid
"X คอมเมนต์" badge and the doc-card "อัปเดต" pill correctly. They
click the หนังสือ to read the comment → the inline comment banner
("คอมเมนต์ใหม่: …"), the "X ใหม่" thread header, and the per-row
`is-unread` highlight all FAIL to appear. The user can't see WHICH
comment is new even though they opened the doc specifically to read
it. Worse on iPad Safari normal-mode (probably timing-related)
which is why it looked like an iPad-specific bug at first.
**Cause**: The expand-click handler in `inbox.js` did
`expandedDocs.add(id); markCommentsSeen(id); render();`. The
`markCommentsSeen` writes `now` into localStorage BEFORE render runs.
Then `renderCommentBanner` and `renderCommentsList` both read
`getCommentsSeenAt(docId)` → get `now` → filter
`effectiveTs(e) > seenAt` returns nothing → no banner, no "ใหม่"
pill, no `is-unread` row. The outer grid/card highlights only "work"
because they render BEFORE expansion (different render pass).
**Fix**: Capture the **pre-expand** seenAt into a module-scope Map
(`expandedDocsSeenAt`) at the moment of expansion, then call
`markCommentsSeen` to persist "I saw it" globally. Pass the frozen
value into `renderCommentBanner(doc, role, seenAtOverride)` and
`renderCommentsList(doc, role, seenAtOverride)` so the expanded body
keeps showing what was new at expand-time. Clear the Map entry on
collapse / back-to-grid / doc delete so a re-expand without a fresh
comment shows no highlight (matches "they already read it").
**Where**: `src/js/projects/inbox.js` `toggleDocExpansion()` is the
single chokepoint; `openDocumentDetail` (deep-link), the
`projectsBackToGrid` handler, and `onDocDeleteClick` all touch
`expandedDocsSeenAt` alongside `expandedDocs`. **Pattern to reuse:
any time a "mark seen" persistence happens at the same moment the
view first shows the unread item, freeze the read-side state before
the write, and let the renderer use the frozen value while the
storage carries the new value.**

---

---

## Per-user read-state means a newly-granted account INHERITS the whole backlog as unread — baseline them at first run, and never trust a sentinel that was set on a no-op

**Symptom**: "I want my email to see หนังสือโครงการ like samomdkkuvpa sees it, but
when I log in with my email it shows many '1 อัปเดต' — as samomdkkuvpa I don't."
Both accounts have the SAME role/seat and see the same documents, so it reads like
a permission or scoping bug. It isn't.
**Cause**: read-state is per user — `project_doc_views` rows keyed by `user_id`,
plus a user-scoped localStorage map. Measured: `samomdkkuvpa` had 26 rows for 26
documents (clean because it has been reading them for months); the newly-granted
account had **0**, so `getDocSeenAt()` returned 0 for every doc and every card
rendered an "อัปเดต" pill for activity that predates the person's access. Working
as designed, and wrong as a product: joining an inbox should not mean inheriting a
year of unread. The existing first-run pass only MIGRATED localStorage → server, so
a brand-new user (nothing in localStorage either) got nothing.
**Fix**: `planSeenAtRows()` — pure, unit-tested — splits the two cases. MIGRATE an
existing reader's local map; BASELINE a reader with no history *anywhere* to "seen
as of now". Gated on the server map being empty, because baselining someone who
already has rows would mark their genuinely-unread documents as read.
**Two traps this hid behind, both worth the entry on their own:**
1. **A sentinel set on a no-op poisons the next fix.** The old code did
   `if (rows.length === 0) { setItem(sentinel); return; }` — so every user who had
   opened the tab once was already flagged "migrated" with zero rows written, and
   would have skipped the new BASELINE branch forever. The key had to be bumped
   (`…BulkMigrated` → `…BulkMigrated.v2`). Only set a "done" marker for work you
   actually did, or version the marker when the rule changes.
2. **Re-running a `merge-duplicates` upsert can move state BACKWARDS.**
   `bulkUpsertMyDocViews` posts with `prefer: resolution=merge-duplicates`, which
   OVERWRITES `seen_at`. Bumping the sentinel makes every established user re-run
   the pass, and any localStorage entry older than their server row would have
   re-flagged already-read documents. `planSeenAtRows` now emits a local value only
   when strictly newer than the server's.
**Also**: the pass resolves AFTER the first paint, so it returns whether it wrote
anything and `index.js` repaints — otherwise the new reader still sees one
screenful of pills until they reload.
**Where**: `src/js/projects/inbox.js` (`planSeenAtRows`,
`migrateLocalSeenAtToServer`, `BULK_MIGRATED_SENTINEL_KEY`),
`src/js/projects/index.js` (repaint on change),
`src/js/projects/seen-baseline.test.js` (9 cases).
**Rule**: any per-user read/seen/ack state needs a defined answer to "what does a
user who joins TODAY see?". The default — "has seen nothing" — is almost never it.
And before comparing two accounts' views, check whether the difference is
*authorization* or *accumulated per-user state*; they look identical in a
screenshot.

---

---

## Migrating a SHARED workflow account to a personal one moves the AUTHORIZATION but leaves every uid-bound row behind — read state, signature assignments, notifications

**Symptom**: after granting a personal kkumail account the `staff` seat, its
หนังสือโครงการ inbox showed "1 ใหม่" but NOT the "1 อัปเดต" that `sastaff` shows on
the same project. Looks like the seat isn't fully equivalent to the role.
**Cause**: the two badges have completely different sources, which is easy to miss
because they render side by side:
- **"N ใหม่"** = `docs.filter(d => d.status === 'sent').length` — pure document
  STATUS, identical for every uni_staff viewer. It matched immediately.
- **"N อัปเดต"** = `docHasUnseenBeyondStatusBadge()` → `getDocSeenAt()` — PER USER,
  from `project_doc_views` keyed by `user_id`.
So the seat was working perfectly; what differed was accumulated per-user state.
Worse, the first-run BASELINE (added the same day, see the entry above) had marked
all 26 documents seen for the new account — correct for a genuinely new person,
exactly wrong for someone taking over an existing workflow, where the point is to
inherit the predecessor's pending work.
**Fix**: `tools/proj-handover.mjs` — a dry-run-by-default transfer of
`project_doc_views` from the shared account to the personal one. **It REPLACES
rather than merges**: parity requires that a document the source has never opened
has NO row on the target either, or its "อัปเดต" stays hidden. sastaff had 22 rows
for 26 documents; a merge would have left 4 baseline rows masking 4 genuine
unreads. Verified per-document afterwards: 9 unseen for sastaff, 9 for the target,
0 mismatches.
**The same class is WORSE for `sa_prof`** (checked because the same migration is
planned for อาจารย์): a signature request names ONE `prof_id`. `scopeProjectsForRole()`
keeps only documents whose `sign_requests` name the viewer, and
`docPendingSignForProf()` ("N รอลงนาม") matches the same uid — so a migrated
อาจารย์ account does not merely lose badges, it sees a **completely EMPTY inbox**.
Measured: saprof 11 documents visible, a personal account 0. NEW requests are fine
(`list_project_profs()` already returns role `sa_prof` OR `prof`-seat holders, 0086),
so only the pre-existing ones are stranded — `--sign-requests` repoints them, and
it MOVES rather than copies because a request has exactly one professor.
**Where**: `tools/proj-handover.mjs`; badge sources in `src/js/projects/inbox.js`
(`renderProjectListRow`, `renderProjectCard`, `docPendingSignForProf`);
prof scoping in `src/js/projects/index.js` (`scopeProjectsForRole`).
**Residual to know about**: `getDocSeenAt()` falls back to a user-scoped
localStorage map when the server has no row for a document, so if the target
account had already opened one of the source's never-opened documents on that
device, the local cache can still mask it. Clear `projects.docSeenAt.<uid>` (or
site data) on that device after a handover if a badge looks wrong.
**Rule**: "granted the permission" ≠ "took over the job". Before migrating a shared
account, enumerate every table with a `user_id` / assignee column scoped to it —
read state, assignments, notifications, drafts — and decide per table whether it
COPIES (the shared account stays live) or MOVES (it is being retired). A
permission grant migrates none of them.

---

---

## Module-scope caches make an in-place account switch show two accounts at once — reload instead of teaching every module to reset

**Symptom**: switching accounts in the admin app leaves the previous account's
data on screen — a stale projects list, the old shop state, a section the new
account cannot open.
**Cause**: the account switcher swaps the Supabase session *in place*
(`setAuthSession`) and lets the `onAuthChange` subscriber repaint. But every
feature module holds module-scope caches (`cache.projects` + the seenAt map,
shop `state`, PR/VS lists, the team tree, `initialSectionApplied`) written for a
page that serves ONE account for its lifetime. Nothing resets them, and the next
module added will have the same gap by default.
**Fix**: `admin-main.js` records `bootUserId` on the first signed-in fire; if
`onAuthChange` later reports a DIFFERENT non-null id, `location.replace(pathname)`
— hard reload, hash dropped (a deep link like `#projects/PRJ-XXXX` may be a
section the new account cannot open) and no back-history entry into a page
rendered for the previous account. Gated on `bootUserId` being set, so an
ordinary first sign-in (null → user) does NOT reload, and on the id CHANGING, so
the 25-minute token refresh — which re-fires with the same id — does not either.
**Rule**: prefer one reload over N cache-reset call sites when identity changes
underneath a long-lived page. The reset approach is correct exactly once and then
rots with every module you add.

---

---

## A path-only router silently discards sub-state — and its own tab handler is what clears the hash you just wrote

**Symptom** (reported): "when I'm in ติดตามสถานะ inside a ticket and I reload to
see refreshed progress, it switches to กระดานปัญหา, and when I tap ติดตามสถานะ I
have to โหลดประวัติของฉัน and tap the ticket again." Reloading is the natural way
to check for progress on a ticket, so the app threw away the user's place at
exactly the moment they most wanted it kept.
**Cause**: the public site routes by PATH (`PATH_ROUTES` in `main.js`:
`/vssound` → the VS tab). Everything below a tab — which of the three VS modes
is showing, which ticket/problem is open — lived only in DOM state. Nothing
persisted it, so a reload rebuilt the default (board) view.
**Fix**: the hash carries the sub-state (`#track`, `#track/VS-XXXX`,
`#problem/VS-XXXX`, `#report`) in a small `vs-route.js`. The hash was free —
nothing else in the public bundle reads or writes it.
**Three traps that cost real debugging time:**
1. **The path router clears the hash on every tab activation.** Its
   `shown.bs.tab` handler does `history.pushState(null, '', tabToPath(target))`
   — a bare pathname, so the hash is dropped. Leaving the VS tab and returning
   left the URL saying "board" while the DOM still showed ติดตามสถานะ, and a
   reload then obeyed the URL. Fixed by re-syncing the URL FROM the live view
   on re-entry (`syncRouteFromView`) — sync the URL to the view, not the view
   to the URL; the user's place is the thing worth keeping. It must run in a
   `setTimeout(…, 0)` because the path router's listener is registered LATER in
   main.js but fires in the same synchronous `shown.bs.tab` chain.
2. **Every hash write fires `hashchange`**, which re-enters the router. Guard
   with a `lastWritten` value compared on the way in, plus an `applying` flag.
3. **Never decide "is the user signed in" before `authReady`.** On a cold
   reload `getUser()` is null for a perfectly valid session, so restoring
   `#track/<id>` immediately would always take the signed-out path. `await
   authReady` first, then fall back to the by-id guest lookup — which grants
   nothing new, since the id is already in the user's own URL.
**Also**: `replaceState`, not `pushState`. The mode radios are a segmented
control; one history entry per tap makes the back button feel broken.
**Where**: `src/js/vs-route.js`; writers in `vs-form.js toggleVitalSoundMode`,
`vs-tracking.js` (`openTicketDetail` / `trackWithTicketId` / `logoutTrack`),
`vs-board.js` (`vsBoardOpen` / `vsBoardBack`). Writers call `window.vsSetRoute`
rather than importing, to avoid a cycle (vs-route imports those modules).
**Rule**: any view a user would REFRESH to update needs its identity in the URL.
And when adding sub-state under an existing router, check what that router does
to the URL on navigation — a handler that rewrites the whole path will erase it.

---

---

## A snapshot table that COPIES a foreign resource id makes the original's delete path destroy history — count references, and count them AFTER the write

**Symptom** (designed out, not observed): adding the long-missing `deleteTeamFile`
so a replaced/removed ทีม SAMO portrait stops orphaning in Drive. The obvious
implementation — trash the file whenever the member's `photo_url` changes —
would silently blank that person's card in a PUBLISHED ปีการศึกษา, months later.
**Cause**: `publish_team_term` copies `m.photo_url` **verbatim** into
`team_archive_members`. The archive is a snapshot of the ROW, but the photo is
not copied — both rows point at the SAME Drive file id. So the live table does
not own that file; it shares it. Deleting through one reference breaks the other,
and the archive is exactly the thing that can never be regenerated. The live data
hid this completely: at the time of writing there is 1 live photo and 0 archived,
so `shared_live_and_archive` measured **0** — the mechanism is in place and
produces the sharing on the next publish, which is the worst kind of latent bug
(a query says you are fine, the code says you are not).
**Fix**: `deleteTeamPhotoIfUnused()` in `src/js/team/api.js` counts references in
`team_members` AND `team_archive_members` and only then calls the GAS delete. Two
details that are the whole point:
- **A failed count must not read as "no references."** `live.error ||
  archived.error` skips the delete — the recurring fail-open shape in this repo.
- **Call it AFTER the row is gone or repointed, never from the form action.**
  Deleting on the นำรูปออก click would destroy a photo the DB still uses if the
  admin then cancels the editor. With the write committed first, the ref-count is
  simply the truth and needs no special-casing for "the row I am editing".
**Where**: `src/js/team/api.js` `deleteTeamPhotoIfUnused`; `appscript/prform.gs`
`handleDeleteTeamFile` (guarded by the existing `fileLivesUnderTop_(file,
'Team')`, and adding no new Google service so the OAuth scopes are unchanged —
see the re-consent entry above); call sites in `team/index.js` `onMemberSubmit` /
`onDeleteMember` and `team/terms.js` `onArchivePhoto` / the archive delete.
**Rule**: before adding a delete path for a row that references an EXTERNAL
resource (a Drive file, an uploaded blob, an S3 key), grep for every table that
copies that reference — a snapshot/archive/audit table usually copies the id
without copying the resource. If one exists, the delete is a refcount, not a
delete. And measuring the current data proves nothing when the sharing is created
by a code path that has not run yet.

---

---

## An allow-list feeding a BACKUP has the opposite safe default from one feeding a public projection — the same construct, inverted failure mode

**Symptom**: none observed — found by asking "what else enumerates team columns?"
after adding two. `buildExportJson` (`src/js/team/io.js`) and the two `create*`
calls in `importJson` (`src/js/team/index.js`) both list fields explicitly, and
neither carried `is_board`, `photo_url` or `photo_focus`. So the export →
restructure → re-import round trip that `io.js` exists FOR would have silently
wiped every member portrait and emptied the whole คณะกรรมการ grid. `photo_url`
had been missing since 0103; nothing failed, because nothing had been restored
yet.
**Cause**: this repo has trained itself, correctly, that a hand-built column list
is the safe pattern — `get_public_team_chart()` names keys one by one precisely
so a new column is NOT published by accident (0086/0103/0104), and
`returns setof <table>` is banned for exactly the opposite reason (0079/0080).
But the safe DIRECTION depends on which way the data flows:

| allow-list feeds | a column left out is… | correct default |
|---|---|---|
| a public projection | not published | **omit** (fail closed) |
| a backup / round trip | **destroyed on restore** | **include** (fail loud) |

Reaching for the projection habit on a serializer inverts the guarantee. And it
cannot be caught by reading either file alone: export and import were internally
consistent with each other — both simply forgot the same three columns.
**Fix**: add the fields to both sides, and pin the key sets in
`src/js/team/io.test.js` (`buildExportJson round-trip fidelity`) so the next
column added to `team_nodes`/`team_members` fails a test instead of vanishing on
a restore. Those tests immediately caught an error in my own expectation list
(`project_seat`), which is the argument for writing them rather than re-reading
the code. `shop_source` is deliberately still excluded — 0094 reverted shop
scoping and the column is inert; that exclusion is a comment in the file, not an
oversight.
**Rule**: whenever you add a column to a table that has an export/serialize path,
grep for every function that enumerates that table's fields and classify each by
data direction. "It's an allow-list, allow-lists are safe" is not the analysis.

---

## A scroll-to-top fix applied in the tab handler misses every link that navigates programmatically

**Symptom** (reported twice — the second time AFTER it had been "fixed" and
shipped): "when i press ดูอัปเดตทั้งหมด in the เบื้องหลังการพัฒนา it jump to
here it should jump to the top." The reader lands mid-timeline on `/updates`,
several releases down.
**Cause**: the fix lived in the `shown.bs.tab` handler and was guarded by
`if (location.pathname !== want)` — "only scroll on a real page change", which is
correct, and which is also false for half the callers. `window.navigateTo()`
pushes the new path BEFORE activating the tab, so by the time the handler runs
`location.pathname` already EQUALS `want` and the whole block is skipped. Clicking
a nav pill goes through the handler's own pushState and scrolls; every link that
calls `navigateTo()` — the ดูอัปเดตทั้งหมด CTA, the ฝ่าย tool links — does not.
One rule, two code paths, and the path that was tested was the one that worked.
**Fix**: `navigateTo()` scrolls to top itself when it actually moved. Back/forward
is unaffected, because `popstate` calls `applyPathRoute()` directly rather than
`navigateTo()`, leaving the browser's own scroll restoration in charge.
**Where**: `src/js/main.js` `window.navigateTo` + the `shown.bs.tab` handler
above it (which keeps its own copy, for the pill-click path).
**Rule**: when a behaviour is attached to an EVENT but the state it tests is set
by the CALLER, enumerate the callers. A guard reading `location.*` inside a
handler is really asking "how did I get here?", and the answer differs per entry
point — which is the routing-flavoured version of "authorization is per-PATH, not
per-table".

---

## An upsert that sends EVERY column wipes the ones the file did not have

**Symptom** (found by inspection, before it ran on real data): re-importing a
corrected name-list that happens to omit the `sai` column would clear
`sai_code` for every student in the file — and with it their house — while the
preview said, truthfully by its own arithmetic, "แก้ไข 1,800".

**Cause**: `toUpsertRow()` emitted the full `IMPORT_OWNED_COLUMNS` list with
`row[c] ?? null`, so a column the CSV never contained arrived as an explicit
`null`. PostgREST's `resolution=merge-duplicates` builds its
`ON CONFLICT DO UPDATE SET` from the keys present in the body, so an explicit
null is a write and an absent key is a no-op — the difference between
"this person has no ชื่อเล่น any more" and "this file does not talk about
ชื่อเล่น". The parser knew which columns were in the header and threw that away.

The preview could not have caught it either: `diffAgainstExisting()` compared
the same full column list, so the columns about to be destroyed were counted as
ordinary changes. **Both halves used the same wrong set, so they agreed.**

**Fix**: `parseStudentsCsv()` now returns `presentColumns` (the import-owned
columns actually in the header); `toUpsertRow(row, batch, present)` emits only
those plus `kkumail` (the conflict target), and `diffAgainstExisting(rows,
existing, present)` compares only those. A column IN the file but empty on a row
still writes null — that is a real clear, not a gap. Pinned by three tests in
`house/io.test.js`, including the "does not report a change it will not make"
one, because a preview that over-reports is how the destructive version looked
correct.

**Where it lives now**: `src/js/house/io.js` (`parseStudentsCsv`, `toUpsertRow`,
`diffAgainstExisting`), `src/js/house/index.js` (`runImport`, `onCsvPicked`),
`src/js/house/io.test.js`.

**Rules**: (1) **In an upsert, absent and null are different words.** Send a
column only when the source actually said something about it. (2) A PREVIEW and
the WRITE it previews must be computed from the same scope — and when they are
both wrong in the same way they will still agree, so the test has to check the
preview against the world, not against the writer.

---

## An export that carries a GENERATED column re-imports as the real one

**Symptom**: the students CSV export included `nickname`, which is
`coalesce(nickname_self, nickname_imported)` in Postgres. The importer resolves a
`nickname` header to `nickname_imported`. So export → re-import promoted every
student's SELF-chosen ชื่อเล่น into the university's column, permanently — the
one thing `nickname_imported` / `nickname_self` were split apart to prevent.

**Cause**: two vocabularies for one file. The export wrote the TABLE's column
names; the import canonicalised to its own spellings (`sai`, `nickname_th`), so
nobody could see by reading either list that `nickname` meant different things
at the two ends.

**Fix**: one vocabulary — the schema's. `CSV_COLUMNS` now canonicalises to
`nickname_imported` / `sai_code`, and every friendly spelling the world sends
(`sai`, `nickname_th`, `ชื่อเล่น`, `อีเมล`) is an ALIAS resolved at the door. The
generated `nickname` left the export. `house` is generated too and stays,
because the importer has no alias for it, so it round-trips as an ignored
column — which is the actual test: not "is it derived" but "would the importer
read it back as something else".

**Where it lives now**: `src/js/house/io.js` (`CSV_COLUMNS`, `HEADER_ALIAS`,
`EXPORT_COLUMNS`), `src/js/house/io.test.js`.

**Rules**: (1) An export meant as a backup must be re-importable by the importer
that exists, and that is a TEST, not an intention. (2) Accept the world's
spellings as aliases; keep exactly one of your own. Two canonical vocabularies
for one field is the drift class this repo pays for most (class 6).

---

## Stripping a คำนำหน้า off a name renames the people whose name STARTS with one

**Symptom** (reported by the owner reading the spec, before any file was
imported): *"you shouldn't strip `นาย` / `นางสาว` — some people have นาย in their
names."* Correct: `นายก` would have been stored as `ก`, `นางาม` as `าม`.

**Cause**: the importer treated a leading `นาย` / `นาง` / `น.ส.` as a title and
cut it, on the theory that this app dropped its คำนำหน้า column (0113) and
"นายสมชาย" is not a first name. The theory is right about the common case and
silently wrong about the rest — `นาย` and `นาง` are the openings of real Thai
names, and a whitespace-free prefix carries no signal that separates the two.
Nothing downstream could ever detect the rename: the row looks like an ordinary
name that happens to be short.

This is the SAME class the same file already refuses elsewhere. `parseStudentsCsv`
rejects a combined "ชื่อ-สกุล" column rather than splitting it on whitespace,
with the reasoning written out — and then stripped a prefix two functions later.
A rule was applied in one place and its opposite in another, in one file.

**Fix**: `looksTitled()` replaces `stripTitle()` — it REPORTS the match as a
per-row warning and changes nothing. A file where every row is titled is a file
to send back, and one line per row is how a human notices that. The spec now
says plainly that we will not fix it, and why.

**Where it lives now**: `src/js/house/io.js` (`looksTitled`),
`src/js/house/io.test.js`, `docs/house-data-spec-th.md`.

**Rules**: (1) **Never normalise a person's NAME by guessing.** Case, whitespace
and digits have canonical forms; names do not. Report and keep. (2) When you
have already written "we refuse to guess here, because guessing renames people",
grep the same file for the other places it guesses — the reasoning generalises
even when the code did not. (3) `kkumail` is the counter-example that proves the
line: lowercasing it is not a preference but a requirement (a plain UNIQUE index
plus `lower()=lower()` lookups, enforced by a table trigger since 0119), and it
misidentifies nobody because the comparison was already case-insensitive.

---

## "แก้ชื่อในหน้าตัวเอง แล้วชื่อ-นามสกุลในระบบบ้านสลับกัน" — one module split a name on whitespace while another refused a whole file for it

**Symptom**: nobody reported it, which is the worst part. A person whose ระบบบ้าน
record correctly held `first_name_th = 'สมชาย ใจดี'`, `last_name_th = 'ดีมาก'`
found it silently rewritten to `first_name_th = 'สมชาย'`,
`last_name_th = 'ใจดี ดีมาก'` — the first time they saved ANYTHING on their own
card, including an unrelated ชื่อเล่น edit. `students.self_edited` then recorded
`first_name_th` as a value the person had chosen, so the next import preserved
the corruption on their behalf.

**Cause**: `src/js/my-seat.js` offered one combined ชื่อ-สกุล box, because
`team_members.full_name` was one column. On the way to ระบบบ้าน — which stores
the split — it did this:

```js
const [first, ...rest] = String(body.full_name || '').trim().split(/\s+/);
...(rest.length ? { first_name_th: first, last_name_th: rest.join(' ') } : {})
```

and `update_my_identity` passed the patch into `update_my_student_record`, which
writes both columns unconditionally. A comment above it claimed "the server
prefers the students row's own split when it has one" — true of the ทีม SAMO
direction it was written about, and false of the direction it was on.

`src/js/house/io.js` REFUSES an entire CSV for making exactly this guess, with
the reasoning spelled out (`_combined_name`: "สมชาย ณ อยุธยา" and
"สมชาย ใจดี ดีมาก" both have three tokens and different answers). Two
implementations of one rule, and one of them was the negation of the other.

**Fix**: migration 0135 gives `team_members` the same `first_name_th` /
`last_name_th` split and derives `full_name` from it, so no caller has anything
to reconstruct. The card has two boxes; a row that has only a combined name
keeps it and shows it beneath the empty boxes. **Nothing is backfilled** — a row
acquires the split when a human types one.

The paragraph was not the fix. `src/js/name-split.test.js` walks every module
under `src/js` and fails the build on a `.split(` within three lines of
`first_name_th` / `last_name_th`, and pins the card's editable field list
against `team_members_self_update_guard`'s SQL allow-list so the two lists
cannot drift.

**Where it lives now**: `supabase/migrations/0135_team_names_split_too.sql`,
`src/js/my-seat.js` (`DETAIL_FIELDS`, `displayFields`), `src/js/team/index.js`
(`readMemberName`), `src/js/name-split.test.js`,
`tools/team0135-name-split.mjs`.

**Rules**: (1) **Store the PARTS, derive the WHOLE, never split an existing
whole.** (2) A rule enforced at one boundary and violated at another is the
default outcome, not the unlucky one — when a module refuses to guess, grep for
every other module that consumes the same field. (3) A guess that writes to a
column tracked as "the user's own choice" is worse than a guess: it launders
itself into consent.

---

## "this person is the same person but it detects wrong because no email" — a single-pass identity key made "unknown" mean "different"

**Symptom**: ตรวจสอบข้อมูล reported `รหัส 663070019-9 2 คน` for ชญาภา
เลาหะตานนท์ — one posting carrying `chayapa.l@kkumail.com`, the other carrying
no address at all. One human, reported as a รหัสนักศึกษา clash between two.

**Cause**: `identity.js` documents its rule as "rows with NO kkumail sharing a
รหัส → one person", and implemented it as a single-pass key:

```js
const keyOf = (r) => (r.em ? `e:${r.em}` : r.sid ? `s:${r.sid}` : `r:${r.id}`);
```

The row WITH the address is keyed by the address, so a no-address row can never
reach it — rule 2 only ever grouped no-address rows with each other. The
documented rule and the code disagreed, and the comment was believed.

Underneath that: treating an ABSENT identity as a DISTINCT one. A cell holding
nothing (or the live `-`) is not a claim to be a different human; it is the
absence of a claim. Counting it as a second person is the fail-open direction
(class 2).

**Fix**: two passes. Build `sid → {emails that claim it}` first, then a
no-address row joins that person **iff exactly one** email-person claims its
รหัส. Two claimants leaves it separate — that ambiguity is the finding.

The safety property is preserved and now tested: 0108's `673070332-6`, one
mistyped รหัส worn by two humans, has an address on BOTH rows, so rule 2 never
looks at them and the clash is still reported.

Resolving them also had to not become silence. A posting with no kkumail is
still broken — every resolver in this app joins `team_members.kkumail`, so it is
invisible to the person's own card and to every permission lookup — so it now
raises `mail_gap`, the rare finding with one obviously correct answer and a
one-click apply.

**Where it lives now**: `src/js/team/identity.js` (rule 2 as a second pass,
`mail_gap`), `src/js/team/health.js` (the card + `data-hfillmail` handler),
`src/js/team/health.test.js` (six cases, including both directions of the
ambiguity).

**Rules**: (1) When a comment states a rule the code cannot implement in one
pass, the comment is a plan, not a description — check it against an example.
(2) Absent ≠ different. An unresolvable identity must not be counted as a
distinct one. (3) When a merge silences a finding, check that the thing being
merged is not itself broken — resolving it correctly must not turn a wrong
finding into no finding.

---

## The checkout form kept the PREVIOUS account's email after an in-place account switch — and the new recap asked the buyer to confirm it

**Symptom**: Found by review, not by a report. Switch accounts with the Gmail-style
switcher (no page reload), open SAMO Shop checkout, and the ชื่อ/อีเมล/เบอร์ fields
still hold the person who was signed in before.
**Cause**: `src/js/shop/checkout.js` keeps `buyerName` / `buyerEmail` /
`buyerPhone` at MODULE SCOPE, prefilled as
`if (!state.buyerEmail) state.buyerEmail = user.email || ''`. That guard exists
for a good reason — a typed edit must survive the re-render every slip upload
triggers — but it never overwrites, and `account-switch.js` has no
`location.reload`, so the module state outlives the account it was filled from.
`onAuthChange` re-renders checkout, which re-runs a prefill that declines to
change anything. Same class as the module-scope caches entry above it.
**Why it got worse before it got better**: the checkout had just grown a contact
recap above the confirm button. That turned a stale default into the thing the
buyer is explicitly asked to approve, and placing the order writes a stranger's
address as the only channel staff have for slip and pickup.
**Fix**: `applyBuyerPrefill(state, user)` — one exported function with two rules
that pull in opposite directions, which is why "just always overwrite" is also
wrong: when `user.id` differs from the `prefillUid` the state was filled from,
replace ALL THREE fields (typed or not); when it is the same account, fill only
what is empty, so edits survive a re-render and a placed order re-prefills.
**Where**: `src/js/shop/checkout.js` (`applyBuyerPrefill`, `state.prefillUid`),
guarded by `src/js/checkout-prefill.test.js` (7 cases, including the
switch-with-a-typed-value case and an account with NO email — the anonymous
route, where inheriting the previous address is the most misleading outcome).
**Rule**: a "fill only if empty" prefill is correct only while the IDENTITY
behind it cannot change. The moment an app can switch accounts without a reload,
every such prefill needs to remember WHOSE data it holds — the emptiness of a
field is not a proxy for the freshness of it. And when a value that was
previously a quiet default becomes something the user must confirm, re-examine
where it came from: the display change did not create this bug, but it raised
the cost of it from "wrong default" to "you approved a stranger's address".

---

## An INSERT is a write path too — the import guard covered UPDATE only

**Symptom**: none yet, because the roster file has not landed. Found by asking
"will there be an issue when data from dataanalytic come, or people edit their
names". Measured on a rollback transaction:

```
people   : ชื่อที่เจ้าตัวกรอก นามสกุลจริง   ← what the person typed
students : ชื่อจากไฟล์ นามสกุลจากไฟล์        ← what the file said
linked   : yes            conflicts: 0
```

**Cause**: 0125's `students_keep_self_edits` and both of 0138's hooks are
`before update`. For the ~380 ทีม SAMO members who are not yet in ระบบบ้าน, the
import does not UPDATE their placement — it **INSERTs** it. On that path
`self_edited` is empty (the row is new), so nothing was protected, the file's
spelling won, and the registry silently disagreed with the placement pointing at
it. The person's own card reads `students`, so their edit was simply gone.

Class 4, fourth instance: a fix applied to one PATH is not a fix.

**Fix**: the reconciliation moved into `students_link_person` — one BEFORE
INSERT trigger that resolves the person and then reconciles against them, in
that order. Folded into the existing function rather than added beside it,
because two triggers on one event fire in NAME order and a rule that depends on
nobody renaming a trigger is not a rule. An import keeps the registry's value
and records a conflict; a human-created row wins and now mirrors UP, which an
INSERT never did either.

**Where it lives now**: `supabase/migrations/0139_an_insert_is_a_write_path_too.sql`,
`tools/house0139-insert-path.mjs` (10/10).

**Rules**: (1) Enumerate INSERT, UPDATE and DELETE separately for every
invariant — "the write path is guarded" is only ever true of the one you looked
at. (2) A trigger whose correctness depends on firing after another trigger
should be the same trigger.

## "in next next week, it still show ใช้ไปแล้วจริง value, which it would be reset by then"

**Symptom.** Browsing forward on the จองโควตา Claude board, the week card kept
reading "287 / 700% ใช้ไปแล้วจริงสัปดาห์นี้" — a measured figure — on weeks that
had not started, whose pool will have reset once or twice before they do.

**Cause.** Two different SCOPES reading one payload. The pane has a hero panel
that means *right now* and a week card that means *the week the arrows landed
on*. `right_now.week` was built to serve the hero, and the card was pointed at
it too, so every number in the card silently became a fact about today. It was
correct on the current week — which is the week it was built and tested on — and
wrong on every other.

**Fix.** The card's three numbers are now scoped to the week being drawn, in
SQL: `measured_used_pct` is the newest sample INSIDE `[week_start, week_end)`,
`reserved_pct` counts only that week's unfinished bookings, and `is_current`
lets the panels that genuinely mean "now" say so. A future week measures **NULL**
and the card falls back to the booked ledger with a label that says which
quantity is on screen.

**NULL, not 0** — that is the load-bearing half. A future week returning zero
draws an empty bar and reads as "nothing used yet", which is indistinguishable
from a real reading and is the same bug wearing a plausible number.

**Where it lives now.** `get_claude_board()` in
`supabase/migrations/0156_claude_the_week_card_describes_the_week_on_screen.sql`;
`paintWeekMeter()` and `paintMeasured()` in `src/js/claude/index.js`.

**The general rule.** *When one payload serves two panels with different time
scopes, the narrower scope has to be in the payload — not assumed by whoever
reads it.* "Now" and "the period on screen" agree exactly while you are looking
at the current period, which is when the feature is built, demonstrated and
reviewed. The disagreement only appears when someone presses the arrow.
