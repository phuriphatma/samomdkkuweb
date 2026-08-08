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

## The follow-up: "then ask for only สายรหัส and get the names from SSO"

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
