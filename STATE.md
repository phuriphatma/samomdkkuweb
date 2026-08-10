# STATE — current task & latest known state

Last updated: **2026-08-10**. This is "what is true RIGHT NOW" and nothing else;
`git log --oneline` is the chronology and `docs/state-archive/` holds the
reasoning. Keep it under ~200 lines — when it bloats, move narrative to the
archive rather than trimming the invariants.

**Read the `## NEXT-SESSION PROMPT` at the bottom first.** Then CURRENT DEPLOY.

Archives (all `docs/state-archive/`): `2026-08-10-late-security-and-identity.md`
(0147–0148, the identity swap, the first browser pass) · `2026-08-10-chan-pi.md`
(0145–0146, v4.6.0) · `2026-08-09-session.md` (the person registry, the mirrors,
Drive cleanup, both GAS redeploys) · `2026-08-08-late-0128-0131.md` ·
`2026-08-08-house-polish.md` · `2026-08-05-late-13-requests.md` ·
`2026-08-05-shipped.md` · `2026-08-04-shipped.md` ·
`2026-07-31-team-0104-detail.md` · `2026-07-30-pre-clear.md` ·
`2026-07-24-full.md`.
Architecture/RLS: `docs/CONTEXT.md`. Bugs: `docs/mistakes/*.md`, indexed by
`.claude/rules/mistakes.md`. Backlog: `docs/NEXT.md`.

## CURRENT DEPLOY

- Prod = KKU VM `samo.md.kku.ac.th`. Deploy = commit → push `main` →
  `skills/deploy-vm.md`. **Needs VPN. Pushing does NOT deploy.**
- **samoweb deployed = `c33d5cf`**, verified from the SERVED artifacts.
  **Migrations applied through 0148.** **678 tests green.**
- ⚠️ **Verify from the chunk the served HTML actually loads.** Code often lands
  in the SHARED `analytics-*.js` that BOTH entries import, and minified builds
  rename module-scope `let`s — grep a STRING LITERAL or a CSS class.
  ⚠️ **`askConfirm` is admin-only by import graph** (`confirm-modal.js` is
  reached only from `house/index.js`, `team/index.js`, `team/health.js`,
  `team/terms.js`), so its strings are absent from the PUBLIC bundle BY DESIGN.
- **Apps Script: both projects deployed** — samoweb v11, passport v10. ⚠️ A
  missing `GAS_SCRIPT_ID` makes `npm run deploy:gas` a SILENT NO-OP.
- ⚠️ **Rotate the VM sudo password** and the **KKU SSO client secret** — both
  were exposed in chat transcripts (2026-08-07 / 08-08).

## Live proofs — run the one covering what you touch

All both-directional. `node tools/db-query.mjs tools/<x>.sql` for the SQL ones.
**Read `skills/write-a-guard.md` before writing or trusting any of them.**

- `authz-sweep-identity.sql` (23/23) — the identity boundary for anon AND an
  ungranted student. Run after ANY policy change on
  `users`/`people`/`students`/`team_members`.
- `house0116-authz.sql` (8/8) · `house0144-delete-impact.sql` (18/18,
  differential) · `house0145-duplicate-person.sql` · `house0146-crest-refcount.sql`
- `team0145-one-chan-pi.sql` (16/16) · `team0145-save-as-the-member.sql` (12/12)
- `node tools/house0132-registry.mjs` (19/19) — before touching ANY mirror.
- `node tools/proj0092-seat-parity.mjs` (14/14)

## OTHER SYSTEMS — stable, nothing owed

PR · VitalSound · News · Shop · หนังสือโครงการ · Analytics: unchanged. Write-ups
in `docs/state-archive/`; architecture in `docs/CONTEXT.md`.

- **Passport** (repo `phuriphatma/samomdkkupassport`, same Supabase project,
  `passport` schema): kkumail-only gate live. Dev test still ACTIVE
  (pmphuriphat→phuriphat.ma) — revert SQL in `2026-07-24-full.md`. Old project
  `idwlabpbwiwgaoqwbozz` is a cold backup — rotate its DB password before deleting.
- **notify**: `/notify` Node service on the VM; `notify_log` (0055) recording.
- Retention jobs NOT scheduled (`prune_analytics`, `prune_notify_log`).

## Housekeeping

The memory layout is in `CLAUDE.md` § "Memory layout" — not repeated here,
because two copies of one rule is the class this repo pays for most.

- **Do not re-create `.claude/rules/mistakes-archive.md`** — it lived in the
  auto-loaded directory, so archiving into it saved nothing.
- **Never hand-edit the mistakes index** — `npm run mistakes:index` generates it.
- **Never raise the context cap** when `npm run check:context` fails. Move detail
  into `docs/`.
- `.env.local` holds the Supabase PAT, the VM sudo pw, project-B DB creds.
- CI = Node 22. `npm run build && npm test` before every commit.

## NEXT-SESSION PROMPT (paste this after a /clear — written 2026-08-10)

> **Read this file, then `skills/write-a-guard.md`.** Nothing is blocking. The
> security item that used to live in agent memory is CLOSED (0147); its write-up
> is in `docs/mistakes/authz-rls.md`.
>
> ### 1. What is owed
>
> - **The signed-in browser pass, continued.** It started 2026-08-10 and
>   immediately found a bug nothing else could: the ยกเลิก button in EVERY
>   confirm dialog did nothing, because ESC worked and nobody clicks ESC.
>   **Keep driving the UI.** Clicked so far: ทีม SAMO member modal, the confirm
>   dialog, the sign-in modal (390/768 via headless CDP), the public org chart.
>   Still unclicked: VS staff modal, ประกาศ drafts, อาจารย์ signature queue,
>   Shop, mobile drag — `docs/NEXT.md` §1.
> - **One UNREPRODUCED report**: the owner does not see some portraits "on the
>   web". Every check passed — all 5 files HTTP 200 on every CDN variant the app
>   requests, all 6 photo-carrying postings published by
>   `get_public_org_chart()`, images render on the org chart, the home card, the
>   admin dashboard and the member modal. The admin ทีม SAMO **tree** shows no
>   avatars but never has (`portraitSrc` is only used in the modal preview).
>   Portraits are `loading="lazy"` behind initials placeholders, so a slow link
>   shows initials first. **Ask WHICH SCREEN before investigating further.**
> - `docs/NEXT.md` §0b — three small things seen while driving: `/admin/#team` is
>   not honoured on a COLD load; a stale "ไม่พบใคร" hint sits above live search
>   results; ตรวจสอบข้อมูล has 8 unexamined findings.
> - `docs/NEXT.md` also carries: **drop the dead `team_members.year` /
>   `people.year`** (safe now — v4.6.0 has been served since 2026-08-10; the
>   columns, `'year'` in `team_members_self_update_guard`'s `v_allowed`, the
>   exception in `name-split.test.js` and the `'year', m.year` key in
>   `get_my_team_seat()` all go together), and **`photo_reference_count` compares
>   URL STRINGS** so it cannot widen past portraits until Drive IDs are normalised.
>
> ### 2. Invariants that will bite you
>
> - **A control that changes WHICH ENTITY a row refers to is not an edit
>   control.** `pickPerson` reassigned a posting to another human with no
>   confirmation, and the mirrors turned that into a write across ทีม SAMO, the
>   registry and ระบบบ้าน — portrait included. When one widget serves ADD and
>   EDIT, ask what the click MEANS in each.
> - **A projection that feeds a form must carry every column the save writes**,
>   or the form composes one entity out of two (0148 — `search_people` had no
>   portrait, so the form described one person while holding another's face).
> - **`public.people` is the person registry.** `students.person_id` and
>   `team_members.person_id` are PLACEMENTS, both `ON DELETE SET NULL`. Both
>   mirrors are guarded by `is distinct from`, and **that guard is the
>   TERMINATION CONDITION**, not an optimisation. A mirror is only bidirectional
>   on the columns BOTH directions NAME. Run `node tools/house0132-registry.mjs`
>   before touching any of it.
> - **Deleting a นักศึกษา is two different deletes.** With a ทีม SAMO posting only
>   the house placement goes; house-only + never-signed-in + never-confirmed also
>   prunes the `people` row. `student_delete_impact()` (0144) is the only correct
>   way to tell them apart, and `house0144-delete-impact.sql` is DIFFERENTIAL
>   because the RPC restates `prune_orphan_person`'s conditions.
> - **`team_members` has NO unique key on kkumail, on purpose** — 82 people hold
>   2–4 ตำแหน่ง. A duplicate there is legal and silent, which is why เพิ่มสมาชิก
>   WARNS rather than blocks. `students.kkumail` IS unique, so ระบบบ้าน refuses.
>   Do not "fix" the asymmetry.
> - **Nothing may re-add a role branch to `users_read_all`** — `role` and
>   `permissions` share the row, so a full read is a map of who holds `master`.
>   Cross-user lookups go through `list_project_profs()` /
>   `list_project_seat_users()` / `search_people()`.
> - **ชั้นปี IS NOT STORED.** `src/js/study-year.js` computes it:
>   ปีการศึกษา − ปีที่เข้า + 1 + `year_offset`. `study-year.test.js` fails the
>   build on a `year:` key in ANY write payload. Never spread a row and overwrite
>   only `student_id` — call `yearBasis(stored, typed)`.
> - **A client-side count over an RLS-gated table is a fail-open** — RLS returns
>   ZERO ROWS, not an error. Count server-side.
> - **Deploy first, drop second.** 0129 dropped columns the SERVED bundle still
>   named and took ระบบบ้าน's admin tab down for 20 minutes.
> - **A TRASHED Drive file is still served publicly** by `lh3` (HTTP 200, real
>   image). "I deleted it and it still shows" is the CDN, not a stale row. Every
>   GAS delete revokes sharing first (`revokeAndTrash_`).
> - **`set_config(…, true)` is TRANSACTION-scoped** and `reset role` does not
>   clear it — a deny case after an impersonation helper can pass with the
>   previous identity still in place.
> - **`person_mirror_down` SAVES AND RESTORES `app.team_sync`, never blanks it.**
>   Blanking disarms the exemption for row 2 — visible only for members with more
>   than one ตำแหน่ง.
>
> ### 3. How this repo wants you to work
>
> - **The owner tests live and reports in bursts**, often against code shipped
>   hours earlier. Treat their message as the test pass this repo does not have.
> - **A fix on ONE path is not a fix** (class 4) and **prove it live in BOTH
>   directions** (class 7) — both are in the auto-loaded
>   `.claude/rules/mistakes.md`; not restated here on purpose.
> - **When a hazard has been paid for twice, the third fix is a TEST** — and
>   `skills/write-a-guard.md` says how to write one that is not blind to its own
>   hazard. Six ratchets exist and every one found something:
>   `undefined-refs.test.js` · `native-dialog.test.js` · `upload-cleanup.test.js`
>   · `photo-retire.test.js` · `portrait-filename.test.js` (found a 4th bad call
>   site on its first run) · `confirm-modal.test.js`.
> - **Batch commits before deploying** — each VM deploy is ~90 s. A `tools/`- or
>   `docs/`-only commit needs no deploy.
>
> ### 4. Signatures that changed on 2026-08-10
>
> - `src/js/study-year.js` owns ชั้นปี / รุ่น / ปีการศึกษา for the whole app.
> - `src/js/duplicate-message.js` — the 23505 translator, keyed on CONSTRAINT
>   NAME. `house/index.js` imports and re-exports it.
> - `src/css/person-match.css` — the "พบคนนี้ในระบบแล้ว" panel, shared by
>   ระบบบ้าน and ทีม SAMO (`.person-match*`).
> - `listUsersByRole()` is GONE (0147). `renderMyHouse(host, rec, {signedIn,
>   account})` renders an explainer instead of nothing.
> - `photoToRetire(prevUrl, payload, key)` · `filesToRetire(before, after,
>   others)` · `fetchDeleteImpact(id)` · `canOpenSection(which)` — see the
>   2026-08-09 archive.
