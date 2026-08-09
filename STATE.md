# STATE — current task & latest known state

Last updated: **2026-08-09 (late)**. Read on every cold start: this is "what is
true RIGHT NOW" and nothing else — `git log --oneline` is the chronology. Keep it
under ~200 lines; when it bloats, move SHIPPED narratives to
`docs/state-archive/YYYY-MM-DD.md` and leave a two-line pointer.

**Go straight to the `## NEXT-SESSION PROMPT` at the BOTTOM.** It carries the
two open items, the invariants that will bite you, and the signatures that
changed. **It also tells you to read your agent memory, which holds one item
this PUBLIC repo must not contain.** Then come back for CURRENT DEPLOY.

Archived narratives: `docs/state-archive/2026-08-09-session.md` (0132–0144 — the
person registry, the identity mirrors, the Drive-cleanup work and both GAS
redeploys) · `2026-08-08-late-0128-0131.md` · `2026-08-08-house-polish.md` ·
`2026-08-05-late-13-requests.md` · `2026-08-05-shipped.md` ·
`2026-08-04-shipped.md` · `2026-07-31-team-0104-detail.md` ·
`2026-07-30-pre-clear.md` · `2026-07-24-full.md`.
Architecture/RLS: `docs/CONTEXT.md`. Bug corpus: **`docs/mistakes/*.md`**,
indexed by `.claude/rules/mistakes.md`.

## What shipped 2026-08-09 → `docs/state-archive/2026-08-09-session.md`

A long session: migrations **0132–0144**, both GAS projects redeployed, ~12 VM
deploys. The archive carries the reasoning; the things that CHANGE WHAT YOU DO
FIRST are in the NEXT-SESSION PROMPT at the bottom of this file. They are
invariants, not history — do not try to re-derive them from `git log`.

## CURRENT DEPLOY

- Prod host = KKU VM `samo.md.kku.ac.th` (pages.dev retired → splash-redirects).
  Deploy = commit → push `main` → `skills/deploy-vm.md`. **Needs VPN.**
- **samoweb**: `main` = `79df3eb`, deployed and verified from the served
  artifacts. Still **v4.5.0**.
  ⚠️ **`PENDING` in `src/data/changelog.js` holds ~42 entries** — three sessions
  of user-visible work with no version cut. **A `npm run release` minor bump is
  OWED** and `/updates` shows none of it. Read `docs/VERSIONING.md` first; the
  bump is a **minor**. This is the largest piece of finished-but-invisible work.
- **Migrations applied through 0144.**
- **Apps Script: BOTH projects redeployed** — samoweb **v11**, passport **v10**.
  Script ids live in each repo's `.env.local`, and the key is named (empty) in
  `passport/.env.example`. ⚠️ **A missing `GAS_SCRIPT_ID` makes
  `npm run deploy:gas` a SILENT NO-OP** — it prints "not set" and exits looking
  fine. That is how a committed GAS fix sat undeployed for an hour.
- **Live proofs, all both-directional** — run the one covering what you touch:
  `node tools/gas-delete-actions.mjs` (6/6, includes a control that must FAIL) ·
  `node tools/db-query.mjs tools/house0144-delete-impact.sql` (18/18,
  differential) · `node tools/house0132-registry.mjs` (19/19) ·
  `node tools/team0143-photo-refcount.mjs` (5/5) ·
  `node tools/house0138-conflicts.mjs` (21/21) ·
  `node tools/team0137-search.mjs` (14/14) ·
  `node tools/team0135-name-split.mjs` (16/16) ·
  `node tools/house0139-insert-path.mjs` (10/10) ·
  `node tools/team0140-merge.mjs` (7/7) · `node tools/proj0114-visibility.mjs` (29/29).
- **630 tests green.** `npm run build && npm test` before every commit.
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

## Housekeeping — the memory system

Restructured 2026-08-05 and stable since. **Do not re-create
`.claude/rules/mistakes-archive.md`** — it lived in the auto-loaded directory, so
archiving into it saved nothing.

| | where | loaded |
|---|---|---|
| recurring **classes** + a 1-line index of every entry | `.claude/rules/mistakes.md` | every session |
| the **write-ups**, nine files by area | `docs/mistakes/*.md` | on demand |

- **The index is GENERATED** — `npm run mistakes:index`. Never hand-edit it; if a
  line reads badly, fix the heading it came from.
- **The budget is ENFORCED** — `npm run check:context` (run by `npm test`) fails
  when an auto-loaded file exceeds its cap. **When it breaches, move detail into
  `docs/`. Never raise the cap** — reaching for the cap is what caused the 63k-token
  problem this replaced.
- **Release notes are staged as the work ships** — `PENDING` in
  `src/data/changelog.js`, folded in by `npm run release`. Not rendered on
  `/updates`: an unreleased list on a public page is a promise.
- **STATE.md**: keep COMPLETED work in `docs/state-archive/`; leave only what is
  true right now. `git log --oneline` is the chronology.
- `.env.local` holds the Supabase PAT, VM sudo pw, project-B DB creds — never commit.
- CI = Node 22. `npm run build && npm test` before every commit.

## NEXT-SESSION PROMPT (paste this after a /clear — written 2026-08-09, late)

> **Read this file first. Then read your agent memory — it holds one item that
> is NOT in this repo and must not be.** This repo is PUBLIC, so an open security
> finding lives in memory only (`open-security-users-read-all`). It is the
> highest-priority work. Do not write its detail into any tracked file until it
> is FIXED.
>
> ### 1. Two things are open, both already investigated
>
> 1. **The security item in memory.** Verified live, minimal fix scoped, and the
>    one thing that would make the fix dangerous was checked and is clear. The
>    owner was asked and had not answered when the session ended. Ask once, ship.
> 2. **`photo_reference_count()` cannot see `houses.icon_url`.** The house-crest
>    cleanup (`house/index.js` → `deleteTeamPhotoIfUnused(prevIcon)`) therefore
>    decides on a count that always answers 0. Safe today by coincidence — the
>    row is repointed first — but two houses sharing a crest means replacing one
>    trashes the other's, and since deletes now REVOKE SHARING first the victim
>    breaks instantly rather than lingering. Fix: add `houses` to the function in
>    a new migration, and widen `src/js/photo-refcount.test.js`, which scans only
>    for `photo_url` columns and so reports green on exactly this.
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
> Backlog: `docs/NEXT.md` · Registry plan: `docs/PERSON-REGISTRY.md` ·
> Bug corpus: `docs/mistakes/*.md`, indexed by `.claude/rules/mistakes.md`.
