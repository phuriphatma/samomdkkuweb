# Passport → samoweb auth merge — zero-data-loss playbook

> ## ⚠️ DONE. THIS MERGE HAS ALREADY HAPPENED — DO NOT RE-RUN IT.
>
> Status corrected 2026-08-12, measured against the live database: project
> `fheueuowbchsnsvbcgil` HAS a `passport` schema, with **13 tables** and real
> data (`passport.account_migrations` holds 6 rows). Passport runs against it
> today via `app.js`'s `{ db: { schema: 'passport' } }`, and the old project
> `idwlabpbwiwgaoqwbozz` is a FROZEN pre-move backup that must not be written.
>
> **This document still reads as a forward plan and contains destructive steps**
> — including "truncate `passport.*` user data and re-run Phase 1". Running the
> rollback or re-copy sections against the live project would destroy live
> student km-point data. They are recovery procedures for a cutover that is
> finished, not instructions.
>
> Current truth: `STATE.md` (passport section) and `docs/CONTEXT.md`.

Original status line (kept for context): **plan** (not started). Goal: one sign-in across samoweb (`/`) and
passport (`/passport/`) on `samo.md.kku.ac.th`, with **no data loss and no
forced downtime** for live passport users (students scanning QR codes for km
points + leaderboard).

## The shape (decided)

- **One Supabase project** for auth: samoweb's `fheueuowbchsnsvbcgil` (project
  **A**). Passport's current `idwlabpbwiwgaoqwbozz` (project **B**) is retired
  after cutover. One project is REQUIRED for SSO — Supabase sessions are
  per-project, so two projects always means two logins. Same origin
  (`samo.md.kku.ac.th`) + same project ref ⇒ the session is shared between `/`
  and `/passport/` automatically, no code.
- **Passport data in its own `passport` schema** inside A (NOT `public`). A
  passport migration says `create table passport.x` and can never touch
  `public.pr_tickets`. Structural firewall.
- **Two repos stay separate.** samoweb and passport remain independent
  frontends/repos; only the Supabase project is shared. A Claude session in the
  passport repo physically cannot edit samoweb files.

## Core safety principle: COPY, never MOVE

Project B is **only ever read** until the very end. Passport keeps running on B
the whole time. You build + populate `passport.*` in A alongside it, verify,
then flip passport's env to A. B stays intact for weeks as the backup. Rollback
at any point = point passport's `.env` back at B and redeploy. Nothing is
deleted, so nothing is lost.

## Passport's schema (project B, `public`)

| Table | User-keyed? | Key column(s) | Re-key needed |
|---|---|---|---|
| `profiles` | yes | `id = auth.uid()`, has `email` | yes (via email) |
| `season_results` | yes | `user_id uuid`, has `email` | yes (via email) |
| `certificates` | check | (uuid pk) | only if it has a user FK |
| `seasons`, `samo_years`, `samo_seasons` | no (reference) | — | copy straight |
| `activities`, `scans` | check policies 0008/0009 | likely `scanned_by`/`user_id` | if user-keyed, via email |

The stable cross-project identity is **`email`** (and Google `sub`), never the
UUID — UUIDs are minted per-project, so the same student has different
`auth.uid()` in A than in B.

## The cadence you asked about (copy today → flip next week)

### Phase 0 — build the target (no impact on live passport)
1. Create the `passport` schema + tables in A, porting passport's `db/*.sql`
   with `passport.` prefixes and RLS keyed on `auth.uid()`. Reference tables
   (`seasons`, `samo_years`, `samo_seasons`) unchanged shape.
2. Add `https://samo.md.kku.ac.th/**` to A's Supabase Redirect URLs + Google
   OAuth origins (A's OAuth client). Keep B's config as-is for now.

### Phase 1 — DRY-RUN copy + verify (this is your "copy today, test today")
Passport still live on B; students unaffected.
1. Export from B (dashboard → SQL, or `pg_dump --data-only` of the passport
   tables) and load into A's `passport.*`.
2. **Re-key user tables via email** (sketch):
   ```sql
   -- profiles: map B-uid rows onto A's auth.users by email
   insert into passport.profiles (id, full_name, email)
   select au.id, b.full_name, b.email
   from staging_b_profiles b
   join auth.users au on lower(au.email) = lower(b.email);
   -- season_results: same email bridge
   update passport.season_results sr
     set user_id = au.id
   from auth.users au
   where lower(au.email) = lower(sr.email);
   ```
   Students who have NOT yet signed into A have no `auth.users` row there — keep
   their rows keyed by `email` and resolve to `user_id` lazily on their first
   login (a `handle_new_user`-style trigger that back-fills `user_id` where
   `email` matches). Reference tables copy without re-keying.
3. **Verify — this is the whole point of the dry run.** Totals must match B:
   ```sql
   -- row counts per table A vs B, and leaderboard equality
   select email, sum(km) from passport.season_results group by email order by 2 desc;
   ```
   Compare against the same query on B. Spot-check 5 named students' km + tier.
   You can browse all of this in A's dashboard while passport runs on B.

> Everything you write to A during this dry run (test scans, test users) is
> **throwaway** — Phase 3 wipes and re-copies clean. Do NOT let real students
> onto A yet.

### Phase 2 — pick a quiet window
Schedule the flip for a dead hour (03–04:00) or, best, a **season boundary /
semester break** when almost nothing is being scanned. This erases the "delta
window" (points scanned between copy and flip).

### Phase 3 — cutover (short, scheduled)
1. Optionally show passport "อัพเดทระบบ ~15 นาที" / read-only.
2. **Fresh full re-copy** B→A (truncate `passport.*` user data, re-run Phase 1
   copy + re-key). Small dataset ⇒ seconds. This captures the whole week's new
   scans — no incremental reconciliation.
3. Point passport's `.env` (`VITE_SUPABASE_URL` / `ANON_KEY`) at **A**, rebuild,
   deploy to the VM (`/var/www/passport`).
4. **Kill split-brain (critical):** retire `samomdkkupassport.pages.dev` OR
   repoint its Cloudflare env vars at A too. After cutover, NO frontend may
   write to B — otherwise scans split across two DBs and points "vanish."
5. Move passport's `@kkumail.com` restriction from a B project-level setting to
   an **app-level check** in passport (A also serves non-kkumail staff).
6. Verify live: sign in as a student, scan a QR, confirm km increments and the
   leaderboard is correct.

### Phase 4 — settle
- Keep B intact and paused for several weeks as the fallback.
- Once confident, delete B (frees a free-tier active-project slot; you can then
  also delete the abandoned `samomembermanager` / `letuxetrbejoqsnaqdgl`).

## Rollback (any time before Phase 4)
Point passport's `.env` back at B, redeploy, re-enable pages.dev. B was only
read, so its data is exactly as it was. Zero loss.

## Answering the recurring worry
- **Data loss?** Essentially impossible if you copy-not-move and keep B until
  verified. The dry-run proves the numbers before anyone is affected.
- **Downtime while students scan?** None during prep; only a short, scheduled
  window at cutover (or none, at a season break).
- **"Will Claude working on passport break samoweb?"** No — separate repos
  (code firewall) + separate `passport` schema (DB firewall). Encode the
  boundary in each repo's CLAUDE.md: passport owns ONLY `passport.*`, may READ
  `public.users`/`auth.uid()`, never writes `public.*`; ref `fheueuowbchsnsvbcgil`.

## Guardrail to add to passport's CLAUDE.md/AGENTS.md when the merge starts
> This repo shares Supabase project `fheueuowbchsnsvbcgil` with samoweb but owns
> ONLY the `passport` schema. Every migration must be `... passport.<table>`.
> Never write to `public.*` (samoweb's). Identity is read-only via `auth.uid()`
> / `public.users`. Confirm the project ref before any SQL.
