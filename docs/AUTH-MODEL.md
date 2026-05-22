# Auth + User Model — Proposed Unified Structure

Status: **proposal** (not yet implemented). This document describes how to
unify user data across PR, Vital Sound, and future tools so every project
reads/writes from a single source of truth.

## Current state (problematic)

Two backends, two data shapes:

- **VS backend** (`vssound.gs`): user accounts are stored *inside* the
  `Tickets` sheet — username and password live in columns D and E of each
  ticket row. An account only "exists" after the user submits a ticket.
  `verifyAccount mode=create` just checks for username collision; it
  doesn't actually persist anything.
- **PR backend** (`prform.gs`): no user table at all. The submitter
  identity is a free-form string in column R (`Submissions` sheet).
- **Google sign-in**: client-side JWT decode only; no backend record.

Symptoms:
- Password user registers via the sign-in modal → backend never writes
  them anywhere → trying to load PR/VS history before submitting their
  first ticket fails.
- PR staff and VS staff credentials are hardcoded in two different `.gs`
  files with two different patterns.
- A user's Google sign-in is invisible to the backend; future
  permission/role checks have nothing to query.
- Migrating to Supabase is hard because there's no canonical "user" entity.

## Target structure

A single `Users` sheet shared by both backends (or one of them owns it
and the other reads it via a library import). When we migrate to
Supabase this becomes a `users` table with the same columns.

### `Users` sheet schema

| Col | Field            | Notes                                                                 |
|-----|------------------|-----------------------------------------------------------------------|
| A   | `id`             | Stable identifier: email (Google) or `@<username>` (password)         |
| B   | `created_at`     | First sign-in / register timestamp                                    |
| C   | `display_name`   | User's name (Google) or username (password). Free to update.          |
| D   | `method`         | `google` or `password`                                                |
| E   | `google_sub`     | Google account ID (only for method=google). Stable across sessions.   |
| F   | `password_hash`  | Hashed password (only for method=password). See "Password storage"    |
| G   | `role`           | `user`, `pr_staff`, `vs_staff`, `dev`. Default `user`.                |
| H   | `department`     | Optional dept tag for routing/filtering                               |
| I   | `last_seen_at`   | Updated on every authenticated request                                |

### Ticket schema changes

Both `Submissions` (PR) and `Tickets` (VS) sheets reference `Users.id` via
a single submitter column:

- PR `Submissions`: col 18 (`submitterEmail`) → rename to `submitter_id`,
  keep the same column index for backward compatibility.
- VS `Tickets`: replace cols D + E (username, password) with a single
  `submitter_id` column. Existing rows get migrated by combining
  `username` → `@username` to match the new convention.

After migration, history lookups don't need a password at all — the
backend just filters tickets by `submitter_id` and the frontend's auth
state proves the user owns that identifier.

## New backend actions

Add to whichever GAS owns the `Users` sheet (suggest `prform.gs` since
it's the "primary" project URL):

| Action               | Body fields                                                    | Returns                                   |
|----------------------|----------------------------------------------------------------|-------------------------------------------|
| `registerUser`       | `id`, `method`, `display_name`, `password_hash?`, `google_sub?`| `{ success, user }` or `{ success: false }` if `id` taken |
| `loginUser`          | `id`, `password_hash?` (password method), `google_sub?` (google method) | `{ success, user }` |
| `getUser`            | `id`                                                           | `{ success, user }`                       |
| `updateUserProfile`  | `id`, `display_name?`, `department?`                           | `{ success, user }`                       |
| `setUserRole`        | `id`, `role` (dev-only)                                        | `{ success }`                             |

The VS backend's `verifyAccount` and `getUserHistory` actions become thin
wrappers: `verifyAccount` calls `loginUser`/`registerUser`, and
`getUserHistory` skips the password check entirely (auth state is trusted
because the frontend already authenticated against `Users`).

## Password storage

Even though this is internal and low-stakes, **don't store plaintext
passwords in the sheet.** Use one of:

- **PBKDF2 via Apps Script `Utilities.computeDigest`** — write
  `salt:base64hash` in the `password_hash` column. ~10 lines of code.
- **Punt to Supabase auth.** Supabase handles hashing properly. If
  migration is imminent, this is the cleaner answer.

The current `Tickets`-as-user-store keeps passwords in plaintext (col E),
which means anyone with read access to the sheet can dump them. Fix this
as part of the migration.

## Frontend changes

`src/js/auth.js` doesn't need much change in shape — `currentUser`
already has `method`, `username`/`email`, `password`, `sub`, `role`. The
update is:

- `registerWithPassword(username, password)` → hash password client-side
  (or send to backend to hash), call `registerUser`.
- `signInWithPassword` → call `loginUser` with the hash.
- Existing `signInWithCredential` (Google) → also call `loginUser`/
  `registerUser` with the `google_sub` so the user appears in the table.
- After successful login, `currentUser.role` comes from the backend
  response, not from a hardcoded `STAFF_ACCOUNTS` map in the frontend.

This last change moves staff role assignment to the backend, which means
no more shipping `samomdkkupr` / `samo69pr` literals in the JS bundle.
Staff usernames become regular `Users` rows with `role: 'pr_staff'`.

## Migration order (when we do this)

1. Create `Users` sheet with header row. Populate manually with the
   known staff accounts.
2. Add new backend actions (`registerUser`, `loginUser`, `getUser`).
3. Update frontend `auth.js` to call new actions; ship.
4. Backfill: walk existing `Tickets` rows, materialize one `Users` row
   per unique `(username, password)` pair, rewrite cols D+E to the new
   `submitter_id` format.
5. Update VS submit/history to read `submitter_id`.
6. Update PR submit/history similarly.
7. Drop `STAFF_ACCOUNTS` literals from the frontend.

Phases 4-6 are not strictly required if we're heading to Supabase anyway
— a Supabase migration is a natural rewrite of all this.
