# STATE — current task & latest known state

Last updated: **2026-08-10**. Read on every cold start: this is "what is
true RIGHT NOW" and nothing else — `git log --oneline` is the chronology. Keep it
under ~200 lines; when it bloats, move SHIPPED narratives to
`docs/state-archive/YYYY-MM-DD.md` and leave a two-line pointer.

**Go straight to the `## NEXT-SESSION PROMPT` at the BOTTOM.** It carries the
two open items, the invariants that will bite you, and the signatures that
changed. **It also tells you to read your agent memory, which holds one item
this PUBLIC repo must not contain.** Then come back for CURRENT DEPLOY.

Archived narratives: `2026-08-10-chan-pi.md` (0145–0146, v4.6.0) ·
`2026-08-09-session.md` (0132–0144 — the person registry, the identity mirrors,
the Drive-cleanup work and both GAS redeploys) · `2026-08-08-late-0128-0131.md` ·
`2026-08-08-house-polish.md` · `2026-08-05-late-13-requests.md` ·
`2026-08-05-shipped.md` · `2026-08-04-shipped.md` ·
`2026-07-31-team-0104-detail.md` · `2026-07-30-pre-clear.md` ·
`2026-07-24-full.md`. All under `docs/state-archive/`.
Architecture/RLS: `docs/CONTEXT.md`. Bug corpus: **`docs/mistakes/*.md`**,
indexed by `.claude/rules/mistakes.md`.

## What shipped recently

**2026-08-10** — migrations 0145–0146, and **v4.6.0 cut and deployed**, the
release three sessions owed. **2026-08-09** — 0132–0144, the person registry,
both GAS projects redeployed.

The archives carry the reasoning. Everything that CHANGES WHAT YOU DO FIRST is
in the NEXT-SESSION PROMPT at the bottom — invariants, not history. Do not try
to re-derive them from `git log`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
  Deploy = commit → push `main` → `skills/deploy-vm.md`. **Needs VPN.**
- **samoweb**: `main` = `7d6e9fe`, **v4.6.0**, deployed and verified from the
  SERVED artifacts (`/build.json` → 4.6.0; six new Thai string literals grep in
  the served bundles; a control string that must be absent returns 0).
  ⚠️ `studyYearLabel` landed in the SHARED chunk `analytics-*.js`, which BOTH
  entries import — grepping only `public-*.js` / `admin-*.js` returns 0 on a
  perfectly good deploy.
  `PENDING` in `src/data/changelog.js` is **empty**; its 46 staged notes are now
  v4.6.0 on `/updates`. Stage the next note in the commit that ships it.
- **Migrations applied through 0147.** 0147 closed the last open security item:
  `public.users` SELECT is **self-only** now. Proof
  `node tools/db-query.mjs tools/authz-sweep-identity.sql` = **23/23**, and its
  ALLOW half (S7, "a student can still read their OWN row") is the one that
  distinguishes fixed from "every login is broken". ⚠️ Nothing may re-add a role
  branch to that policy — `role` and `permissions` share the row, so a full read
  is also a map of who holds `master`. Cross-user lookups go through
  `list_project_profs()` / `list_project_seat_users()` / `search_people()`.
- **Apps Script: BOTH projects redeployed** — samoweb **v11**, passport **v10**.
  Script ids live in each repo's `.env.local`, and the key is named (empty) in
  `passport/.env.example`. ⚠️ **A missing `GAS_SCRIPT_ID` makes
  `npm run deploy:gas` a SILENT NO-OP** — it prints "not set" and exits looking
  fine. That is how a committed GAS fix sat undeployed for an hour.
- **Live proofs — `tools/*.mjs` and `tools/*.sql`, ALL both-directional.** Run
  the one covering what you touch (`node tools/db-query.mjs tools/<x>.sql` for
  the SQL ones). Newest first, plus the two that catch the most:
  `authz-sweep-identity.sql` (23/23 — the identity boundary for anon AND an
  ungranted student; run it after ANY policy change on `users`/`people`/
  `students`/`team_members`) ·
  `team0145-one-chan-pi.sql` (16/16) · `team0145-save-as-the-member.sql` (12/12,
  impersonated) · `house0146-crest-refcount.sql` (5/5) ·
  `house0145-duplicate-person.sql` (5/5) · `house0144-delete-impact.sql` (18/18,
  differential) · `node tools/house0132-registry.mjs` (19/19 — run before
  touching ANY mirror). The rest are named after the migration they guard.
- **665 tests green.** `npm run build && npm test` before every commit.
- ⚠️ **Rotate the VM sudo password** and the **KKU SSO client secret** — both
  were exposed in chat transcripts (2026-08-07 / 08-08).

## NEXT — un-started work → `docs/NEXT.md`

The backlog (with the reasoning behind each item, including the
`notifyProjectEmail` content-hardening options) lives in **`docs/NEXT.md`**; the roles/permissions + member-photo design is a separate,
fuller document at **`docs/TEAM-ROLES-AND-PHOTOS.md`** (written 2026-08-04,
nothing built, and it ends with five decisions the user has to make).

## OTHER SYSTEMS — stable, nothing owed

PR · VitalSound · News · Shop · หนังสือโครงการ · ทีม SAMO · Analytics: unchanged
this session. Write-ups in `docs/state-archive/` (VS confidentiality invariants:
`2026-07-25-pr-vs.md`); architecture in `docs/CONTEXT.md`.

- **Passport** (repo `phuriphatma/samomdkkupassport`, same Supabase project,
  `passport` schema): kkumail-only gate live. Dev test still ACTIVE
  (pmphuriphat→phuriphat.ma) — revert SQL in
  `docs/state-archive/2026-07-24-full.md` ("ACTIVE TEST STATE"). Old project B
  `idwlabpbwiwgaoqwbozz` is a cold backup — rotate its DB password before deleting.
- **notify**: `/notify` Node service on the VM; `notify_log` (0055) recording;
  `main` protected (1 approval; owner ff-push exempt).
- Retention jobs NOT scheduled (`prune_analytics`, `prune_notify_log`).

## Housekeeping

The memory system — what auto-loads, what is fetched on demand, the enforced
budget — is described in `CLAUDE.md` § "Memory layout". It was duplicated here,
and two copies of one rule is the class this repo pays for most. Only what is
NOT in CLAUDE.md remains:

- **Do not re-create `.claude/rules/mistakes-archive.md`.** It lived in the
  auto-loaded directory, so archiving into it saved nothing.
- **Never hand-edit the mistakes index** — `npm run mistakes:index` generates it.
  If a line reads badly, fix the heading it came from.
- **Never raise the context cap** when `npm run check:context` fails. Move detail
  into `docs/`; reaching for the cap caused the 63k-token problem this replaced.
- `.env.local` holds the Supabase PAT, the VM sudo pw and project-B DB creds.
- CI = Node 22. `npm run build && npm test` before every commit.

## NEXT-SESSION PROMPT (paste this after a /clear — written 2026-08-10)

> **Read this file first.** The security item that used to be parked in agent
> memory (because this repo is PUBLIC and the finding was open) is **CLOSED** —
> 0147, asked-and-approved on 2026-08-10. Its full write-up is now in the repo
> where it belongs: `docs/mistakes/authz-rls.md` and the migration header.
>
> ### 1. Nothing is open
>
> `public.users` read-restriction: **DONE** (0147, 23/23). The crest refcount:
> **DONE** (0146), along with the guard test that had been green over it.
>
> Two follow-ups with full reasoning in `docs/NEXT.md`:
> **(a) drop `team_members.year` and `people.year`** — dead since 0145, left in
> place because the served bundle still named them; v4.6.0 has been served since
> 2026-08-10, so the window is open. Three things go together: the columns,
> `'year'` in `team_members_self_update_guard`'s `v_allowed` (and the exception
> naming it in `src/js/name-split.test.js`), and the `'year', m.year` key still
> emitted by `get_my_team_seat()`.
> **(b) `photo_reference_count` compares URL STRINGS**, so it cannot be widened
> past portraits until Drive file IDs are normalised.
>
> ### 2. Invariants that will bite you
>
> - **A TRASHED Drive file is still served publicly.**
>   `lh3.googleusercontent.com/d/<id>` returns HTTP 200 and the real image for a
>   file sitting in the trash — proved twice with curl. So deleting a file in
>   Drive does NOT remove it from the app, and "trash" is not "gone". Every GAS
>   delete now revokes sharing first (`revokeAndTrash_`). When a user says "I
>   deleted it and it still shows", check the CDN before hunting a cache or a
>   stale row.
> - **`public.people` is the person registry** — one row per human, keyed on
>   kkumail. `students.person_id` (house) and `team_members.person_id` (posting)
>   are PLACEMENTS pointing at it, both `ON DELETE SET NULL`. Both mirrors are
>   guarded by `is distinct from`, and **that guard is the termination
>   condition**, not an optimisation. Run `node tools/house0132-registry.mjs`
>   (19/19) before touching any of it.
> - **Deleting a นักศึกษา is two different deletes.** With a ทีม SAMO posting only
>   the house placement goes; house-only + never-signed-in + never-confirmed also
>   prunes their `people` row. `student_delete_impact()` (0144) is the only
>   correct way to tell them apart, and because it restates
>   `prune_orphan_person`'s conditions, `tools/house0144-delete-impact.sql` is a
>   DIFFERENTIAL test — edit the trigger and that proof is what tells you the RPC
>   went stale.
> - **A client-side count over an RLS-gated table is a fail-open.** RLS returns
>   ZERO ROWS, not an error, so the check answers "nothing references this" for
>   exactly the caller who triggered it. Three bugs so far (0143 portraits, the
>   crest count above, and it is why 0144 is an RPC). Count server-side.
> - **Deploy first, drop second.** 0129 dropped columns the SERVED bundle still
>   named and took ระบบบ้าน's admin tab down for 20 minutes.
> - **ชั้นปี IS NOT STORED (0145).** `src/js/study-year.js` computes it:
>   `ปีการศึกษา − ปีที่เข้า + 1 + year_offset`. `cohort_year` and `year_offset`
>   live on `public.people` and are MIRRORED DOWN onto both placements, read-only
>   there — a direct PATCH is undone on the next registry touch. The one writer
>   is the person's own card, via `update_my_identity` → `year_offset`. Nothing
>   may introduce a stored ชั้นปี again: `study-year.test.js` fails the build on a
>   `year:` key in ANY write payload.
> - **A mirror is only bidirectional on the columns BOTH directions NAME.**
>   `people.year` was pushed down and never carried up, so any touch of the
>   registry reverted a person's own ชั้นปี edit — "nothing happens". The
>   `is distinct from` guard cannot see this; it is a TERMINATION condition, not
>   a completeness check.
> - **`person_mirror_down` SAVES AND RESTORES `app.team_sync`, never blanks it.**
>   It writes columns outside the self-update guard's allow-list, so it needs the
>   server-writer exemption — and `set_config(…, true)` is TRANSACTION-scoped, so
>   blanking it lets row 1's mirror disarm the exemption for row 2. That failure
>   appears ONLY for members with more than one ตำแหน่ง.
> - **A stale `cohort_year` outvotes a corrected รหัส in the FORMS too.**
>   `studyYear` reads `cohort_year || cohortFromStudentId(sid)`. Never spread a
>   row and overwrite only `student_id` — call `yearBasis(stored, typed)`.
> - **A guard TEST can be blind to its own hazard.** `photo-refcount.test.js` was
>   asked to find `photo_url` columns and found every one, faithfully, while the
>   hazard sat in `houses.icon_url` one column along. Scan by SHAPE and force a
>   decision on each hit, never by one name.
> - **Grep the SERVED artifact for a STRING LITERAL or a CSS class.** Minified
>   builds rename module-scope `let`s, so grepping a variable name returns 0 on a
>   perfectly good deploy. Code also often lands in a SHARED chunk rather than the
>   entry bundle — find which chunk the entry imports first.
> - **`curl -L` cannot probe a GAS `/exec`.** It 302s and curl turns POST into
>   GET, so the body is dropped and every probe returns Drive's "ไม่พบเพจ" HTML,
>   indistinguishable from a broken deployment. Use Node's fetch.
> - **`set_config(..., true)` is TRANSACTION-scoped and `reset role` does not
>   clear it.** A deny case running after an impersonation helper passes with the
>   previous identity still in place and looks exactly like a broken guard.
>
> ### 3. How this repo wants you to work
>
> - **The owner tests live and reports in bursts**, often against code shipped
>   hours earlier. Treat their message as the test pass this repo does not have.
> - **A fix on ONE path is not a fix.** Nearly every bug here is that shape.
>   Enumerate the writers — grep the column, grep the RPC, list the editors.
>   `เปลี่ยนรูป` leaked Drive files because the cleanup existed on two of three.
> - **Prove it live, both directions.** A probe that can only print "denied"
>   cannot distinguish a working guard from a broken connection. Every proof here
>   has an allow half and a control that must fail.
> - **When a hazard has been paid for twice, the third fix is a TEST.** Four
>   ratchets exist and every one of them found something:
>   `undefined-refs.test.js` (identifiers bound nowhere — it caught the
>   เพิ่มสมาชิก outage), `native-dialog.test.js` (suppressible dialogs; a
>   shrink-only list), `upload-cleanup.test.js` (an AUDIT registry: every upload
>   site names what cleans up after it), `photo-retire.test.js`.
> - **Drive the UI before believing it.** Headless Chrome over CDP at 390 / 412 /
>   768 / 1440 (see the `headless-chrome-cdp-driver` memory). It found a ลบ button
>   rendering OUTSIDE its modal on phones, which no test and no code read caught.
> - **Batch commits before deploying** — each VM deploy is ~90 s.
>
> ### 4. Signatures that changed on 2026-08-09
>
> - `photoToRetire(prevUrl, payload, key)` — `team/api.js`. The ONE rule for
>   "which file did this save stop pointing at", used by all three portrait
>   writers. Its **key-presence** test is load-bearing: นำรูปออก sends `null`, and
>   any `??`/`||` fallback reads that as "unchanged" and skips the cleanup.
> - `filesToRetire(before, after, others)` — `announcements.js`. Diffs Drive
>   **FILE IDS**, never URL strings; one file has many spellings (`=w1200`,
>   `=w600`, `/view`).
> - `deletePRFile(url)` / `driveIdsInHtml(html)` — `uploads.js`.
> - `fetchDeleteImpact(id)` — `house/api.js`; `deleteWarningFor(impact)` —
>   `house/index.js` (exported for its test).
> - `canOpenSection(which)` — `admin-main.js`. The hash router is gated now, so
>   `/admin/#vs` no longer opens VitalSound for an account without the grant.
>
> ### 5. Signatures that changed on 2026-08-10
>
> - **`src/js/study-year.js` is NEW** and owns ชั้นปี / รุ่น / ปีการศึกษา for the
>   whole app: `studyYear` · `studyYearLabel` · `cohortLabel` ·
>   `cohortFromStudentId` · `offsetForPickedYear` · `yearBasis` ·
>   `setAcademicYear` / `academicYear`. `house/fields.js` re-exports all of them
>   so no caller had to change; new code imports from `study-year.js`.
> - `arabicDigits` moved to `utils.js` — it had grown three copies.
> - `normalizeIdentityFields()` no longer returns `year`. It still REPORTS an
>   unreadable ชั้นปี; it just never hands a caller one to store.
> - `IDENTITY_FIELDS` (`team/identity.js`) dropped `year` — two postings cannot
>   disagree about a derived value.
> - `duplicateMessage(err, payload)` — `house/index.js`, exported for its test.
>   Turns a 23505 into a sentence about a PERSON; every other error passes
>   through untranslated, and there is a control for that.
> - `admin-main.js` calls `primeAcademicYear()` at boot. It used to be primed
>   only when ระบบบ้าน opened, which was fine while ระบบบ้าน was the only pane
>   computing a ชั้นปี.
>
> Backlog: `docs/NEXT.md` · Registry plan: `docs/PERSON-REGISTRY.md` ·
> Bug corpus: `docs/mistakes/*.md`, indexed by `.claude/rules/mistakes.md`.
