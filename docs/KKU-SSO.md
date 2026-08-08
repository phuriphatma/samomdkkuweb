# KKU SSO (SSONext) — what it can and cannot replace

Written 2026-08-08, from the vendor manual now at `docs/KKU-SSO-MANUAL.md`.
Credentials live in `.env.local` (`KKU_SSO_*`); the client secret is listed in
`.claude/rules/security.md`. **This repo is public — nothing here quotes it.**

## The question that prompted this

> "Can I get all the data from the SSO API instead of waiting for the CSV from
> Data Analytics?"

**No.** Not for ระบบบ้าน, and not for anything that needs a roster. The reasons
are structural, not a matter of asking for more scopes.

## What the API actually is

Three POST endpoints, all keyed to ONE person who has just logged in:

| Endpoint | Takes | Gives |
|---|---|---|
| `auth.token` | the `code` from the login redirect + client id/secret | an access token |
| `user.profile` | `Authorization: Bearer <token>` | that person's profile |
| `auth.status` | a token | whether it is still valid |

`user.profile` returns:
`email`, `userId`, `type`, `citizenId`, `title`, `firstname`, `lastname`,
`titleEng`, `firstnameEng`, `lastnameEng`, `facultyName`, `positionName`,
`positionTypeName`, `levelId`, `levelName`, `gender`, `workline`,
`phoneNumber`, `personStatus`, `lastVerify`.

## Why it cannot replace the import

1. **There is no roster endpoint.** Every call is scoped to the bearer token of
   the person who just logged in. There is no "list the students of the faculty",
   so the ~1,800 rows cannot be enumerated at all — only accumulated, one person
   at a time, as each of them happens to sign in.
2. **ระบบบ้าน needs the data BEFORE anyone logs in.** The whole design is that a
   student signs in and their record — and their house — is already there. A
   system that only learns about you *after* you arrive cannot tell you which
   house you are in, cannot show a house its members, and cannot tell an admin
   how many people are still missing.
3. **It does not carry the two fields the feature exists for.**
   - **สายรหัส** — the university's advisor-line assignment. Not an SSO
     attribute, and it is the field the entire house rule is computed from.
   - **สาขา (MD / MDI / RT)** — `facultyName` is the *faculty*
     (คณะแพทยศาสตร์), not the หลักสูตร. `levelName` is the degree level.
   - **รหัสนักศึกษา** — not present under that name. `userId` is undocumented and
     may or may not be it; it would have to be checked against a real login
     before anything relied on it.
   - **ชื่อเล่น** — not present, and never will be.
4. **It returns `citizenId`.** The handover spec explicitly refuses to collect
   เลขบัตรประชาชน. If we ever call `user.profile`, that field must be dropped on
   receipt and never written to a column — receiving it is not a reason to store
   it.

## The design being proposed: LAZY FILL

> Data Analytics send only `kkumail, sai`. When that person logs in through SSO,
> the app reads their profile and fills in ชื่อ / นามสกุล / รหัสนักศึกษา.

**The shape is sound** — it is the same "the row completes itself on first
visit" pattern the app already uses for `nickname_self`, and
`students.self_edited` (0125) already guarantees the auto-fill can never
overwrite something the person deliberately corrected. Treat an SSO fill exactly
like an import write: fill what is empty, never what is owned.

Three things decide whether it is worth doing.

### 1. It IS the SSO login project — there is no cheaper door

A profile can only be read with an access token, and a token only comes from a
login redirect. So "get the names from SSO" is not a data-import option that can
be chosen instead of building SSO; it is a thing that becomes possible once SSO
login exists. Cost is the section at the bottom of this file.

### 2. ANSWERED 2026-08-08 — yes, the รหัสนักศึกษา is there

One real student login through UAT (`tools/sso-probe.mjs`). The live
`user.profile` response carries **two fields the manual does not document**:

```
studentId     6530703170          ← undocumented
studentCode   653070317-0         ← undocumented, and ALREADY in our canonical shape
type          STUDENT
userId        6530703170
mail          …@kkumail.com       ← manual calls this `email`
title/firstname/lastname          ← Thai
titleEng/firstnameEng/lastnameEng ← English
facultyName   คณะแพทยศาสตร์
levelName     ปริญญาตรี ภาคปกติ
citizenId     <13 digits>         ← never store this
```

`auth.token` separately returns `email`, `firstName`, `lastName`, `citizenId`
and an **empty** `employeeId` (as suspected: it is the staff id) — and does NOT
return the `immutableId` the manual lists.

So SSO can supply, at first login: **ชื่อ · นามสกุล (Thai and English) ·
รหัสนักศึกษา · รุ่น (derived) · a STUDENT/staff flag · the faculty.**
`studentCode` arrives as `653070317-0`, exactly the form `normalizeStudentId`
produces, so nothing has to be parsed or guessed.

It still cannot supply **สาขา** — `levelName` is the degree level
(ปริญญาตรี ภาคปกติ), not MD / MDI / RT — or **ชื่อเล่น**.

**⚠️ The manual's field list is not the contract.** It documents a field the
response omits (`immutableId`), omits two the response has (`studentId`,
`studentCode`), and renames one (`email` → `mail` in `user.profile`). Anything
built against this must read defensively and must never assume a field is
present because the PDF says so.

**The UAT directory holds real people, not fixtures** — the probe returned the
tester's own genuine record, matching the row already in `students`. So this
result transfers to production.

### 3. What that makes possible, and what still blocks it

With SSO login built, the file from Data Analytics could be **two columns**
(`kkumail, sai`) plus `major` if we want สาขา without asking 1,800 students to
pick it — so three. Until then it must stay four: **`kkumail, student_id, sai,
major`**, because รุ่น is derived from the รหัส and a student with no รหัส has no
รุ่น until the day they happen to log in.

Blocking, in order:

1. **The registration we hold is UAT.** A production app must be requested, with
   `https://samo.md.kku.ac.th/login` and `/logout` as its redirect URLs.
2. The SSO login build itself (see the cost section below).
3. `citizenId` comes back on **both** calls. It must be dropped on receipt and
   never written to a column.

### 4. The original unknown, for the record

Before the probe: does the response carry the **รหัสนักศึกษา**? The manual
documented three identifier-shaped fields and named none of them `studentId`:

| field | from | what it probably is |
|---|---|---|
| `immutableId` | `auth.token` | the SSO's own stable id |
| `employeeId` | `auth.token` | staff id — may be blank or may be the รหัส for a student |
| `userId` | `user.profile` | undocumented |

Answer: **none of the three**, and it did not matter — the response carries an
undocumented `studentId`/`studentCode` pair instead. Which is the lesson: the
question could not have been answered by reading harder.

`tools/sso-probe.mjs` answers this in two minutes without building anything:
it prints the login URL, you sign in **with a student account**, paste the
`?code=` back, and it dumps the field names (values redacted for `citizenId` /
`phoneNumber` / the token).

**The registration we hold is UAT, not production** (`sso-uat-web.kku.ac.th` /
`sso-uat-api.kku.ac.th`). The production login endpoint answers
`Cannot find the CREDENTIAL <AppID>`. A production app has to be requested
separately before any of this can go live; the probe defaults to UAT and takes
`KKU_SSO_ENV=prod` when there is one.

⚠️ **`auth.token` is not a credential check, and an earlier note here said it
was.** Posting a bogus code returns `ok:false — Cannot find the session …`
identically on both hosts *and* with a deliberately wrong `clientSecret`: it
resolves the session before it looks at the client, so its error says nothing
about whether the registration is valid. Only the LOGIN endpoint validates the
App ID. (Logged as an instance of "verify from the authority, and test BOTH
directions" — a probe that returns the same answer for every input is not
evidence of anything.)

### 3. สาขา can never come from SSO

`facultyName` is the faculty (คณะแพทยศาสตร์), not the หลักสูตร. MD / MDI / RT
either stays in the file or the student picks it (they can, since 0125).

### Recommendation (unchanged by the result)

**Send the four-column file now; treat SSO as a later login upgrade that happens
to auto-fill ชื่อ · นามสกุล · รหัสนักศึกษา.** Waiting for an integration that has not started, to avoid
a column Data Analytics can produce today, trades a certain week for an
uncertain month — and the short file already achieves the thing that actually
mattered, which is that the names never leave their department.

## The earlier version of the question: "ask for only สายรหัส, fill the rest in"

Half right, and the good half has nothing to do with SSO.

**Ask for less — yes, do this.** The two things ระบบบ้าน genuinely cannot derive
are the **สายรหัส** and the **address that identifies the person**. A name is not
one of them. So the ask to Data Analytics is now four columns —
`kkumail, student_id, sai, major` — and 1,800 people's names never leave their
department. `student_id` only because รุ่น is derived from it, `major` only
because nothing can guess it. `students.first_name_th` became nullable in 0126
to make that a legal row rather than a rejected one.

**Get the names from SSO — not today.** SSO can only tell us about someone who
has already logged in, and the integration does not exist yet (see the cost
below). What DOES exist, since 0125, is the student editing their own name —
which is the same "fills in on first visit" shape, needs no integration, and is
the one field the person certainly knows. If SSO is built later it becomes an
auto-fill for exactly this, and `students.self_edited` already guarantees it
cannot overwrite a name someone deliberately corrected.

**What you give up** by sending the short file: until a student signs in, the
admin pane shows them as an address and a สาย with no name. That is fine for
assigning houses and wrong for printing an event roster — so if a named list is
needed for the onsite event, ask for the full file for that purpose.

## What it IS good for (two real wins, neither urgent)

1. **A login button that proves the person is that kkumail.** Today identity
   comes from Google sign-in with a kkumail address. KKU SSO is the
   authoritative check, and it would also cover anyone whose kkumail is not a
   Google account.
2. **Filling in ชื่อ-สกุล automatically.** `firstname` / `lastname` are exactly
   the two fields a student currently retypes by hand in บ้านของฉัน (0125), and
   the SSO copy is the university's own spelling. `students.self_edited` already
   makes this safe: an SSO-sourced name would behave like an import — it must not
   overwrite a name the person deliberately fixed.

Neither removes the need for the CSV. **Ask Data Analytics for the file.**

## What building it would cost

- **A server-side token exchange.** `auth.token` takes the client secret, so the
  browser can never make that call — the secret would be in the public bundle.
  The `/notify` Node service on the VM is where this endpoint belongs.
- **Two new routes.** The registration points at `https://samo.md.kku.ac.th/login`
  and `/logout`; the SPA has neither, and nginx needs them to reach index.html
  (see the extensionless-deep-link entry in `docs/mistakes/deploy-hosting.md`).
- **A bridge to Supabase Auth.** Supabase is the session authority for this app.
  An SSO login has to end in a Supabase session, which means minting one
  server-side for the verified email — the same shape as the synthetic-email
  accounts already in `docs/AUTH-MODEL.md`, and worth designing there rather than
  bolting on.
- **UAT first.** The manual documents `sso-uat-*` hosts alongside production. The
  credentials we hold are for **production** and the redirect URLs are the live
  domain, so there is currently no way to test without touching the real site.

## Status

Nothing is built. Credentials are stored, the manual is filed, and the
assessment above is the decision record: **SSO is a login improvement, not a
data source.**
