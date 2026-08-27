# Building `samo-dev` from production

`docs/TEAM-WORKFLOW.md` phase 1. **Measured 2026-08-27 against the live
project** — every number and every trap below came from running it, not from
reading documentation.

⚠️ **Do NOT build the dev schema by replaying the 169 migrations.** Nothing
proves the chain reproduces production: function bodies have been edited live,
and a replay that differs silently makes dev wrong in ways nobody notices. Take
it from `pg_dump`; dev is then identical by construction. §7.2.

---

## 0. The connection facts, because each one cost a wrong guess

- **`pg_dump` is NOT on `PATH`.** Homebrew's `libpq` is keg-only. It is at
  `/opt/homebrew/opt/libpq/bin/` — **18.4**, and a NEWER client dumps an OLDER
  server, so 18.4 against the server's 17.6 is correct. (`which pg_dump` finding
  nothing is a statement about `PATH`, not about the disk —
  `docs/mistakes/tooling-proofs.md`.)
- **The direct host is IPv6-ONLY.** `db.<ref>.supabase.co` has an AAAA record
  and no A record. It works from this machine because it has IPv6 egress; on a
  v4-only network it will not resolve, and **that failure looks exactly like a
  wrong password.** Check `dig +short <host> AAAA` before blaming the credential.
- **The pooler is not a drop-in.** `aws-0-ap-southeast-1.pooler.supabase.com`
  refuses `postgres.<ref>` with `(ENOTFOUND) tenant/user not found`. Use the
  direct host; the pooler's tenant format is a separate rabbit hole.
- Credential: `SUPABASE_DB_URL` in `.env.local` (gitignored — confirmed with
  `git check-ignore`). Prefer `PGPASSWORD` in the environment over a password in
  `argv`, which is visible in `ps`.

Confirm the credential before anything else, and read the ANSWER, not the exit
code:

```bash
PGPASSWORD='…' /opt/homebrew/opt/libpq/bin/psql \
  "postgresql://postgres@db.<ref>.supabase.co:5432/postgres?sslmode=require" \
  -tAc "select current_user || ' · ' || split_part(version(),' ',2);"
```

## 1. Dump the schema — and keep the privileges

```bash
/opt/homebrew/opt/libpq/bin/pg_dump "$SUPABASE_DB_URL" \
  --schema-only --no-owner \
  --schema=public --schema=passport \
  -f schema.sql
```

⛔ **Never add `--no-privileges`.** It strips every `GRANT`, and **RLS policies
with no GRANT deny everyone while reading exactly like the policies working** —
this repo has already paid for that once (0138). The first dump taken here had
`--no-privileges` and produced **0 GRANTs**; the correct one has **592**:
79 to `authenticated`, 65 to `anon`, 62 to `service_role`, 1 to `postgres`.
**Count the GRANTs after every dump.** A dev copy that denies everything is the
worst possible dev copy, because every test "passes" by refusing.

`--no-owner` is fine and wanted: ownership differs between projects.

What the live project holds (2026-08-27): **64 tables · 165 functions · 156
policies · 64 triggers · 1 view**, across `public` (52 tables) and `passport`
(13). `auth` has 23 more that Supabase creates itself.

## 2. Prepare the target BEFORE loading

The dump names things the platform must already provide:

- **`pg_trgm`** — 6 uses (`gin_trgm_ops`, `similarity`). Not on by default:
  `create extension if not exists pg_trgm with schema extensions;`
- `gen_random_uuid` — 25 uses, built into PostgreSQL 13+; nothing to install.
- **No `uuid-ossp`, no `pgcrypto` calls** in the schema. Do not enable them
  because production has them; enable what is USED.
- `auth`, `storage`, `realtime`, `vault` are created by Supabase on any project.

## 3. `auth.users` comes FIRST — seven tables depend on it

`public.people`, `public.users`, `public.students`, `public.team_nodes`,
`public.student_change_requests`, `public.student_import_batches` and
`public.shop_promptpay_qrs` all carry a foreign key to `auth.users`. Load the
accounts before any of them or every insert fails.

⚠️ **GoTrue's admin API cannot create a user with a chosen id**, and those ids
are the foreign keys — so the accounts must be written into `auth.users`
directly over the superuser connection (§7.5). That couples the load to the dev
project's auth schema version, which may be newer than production's: **copy only
the columns both sides have and let defaults fill the rest.**

**Then prove it before declaring the refresh good: sign in as a copied account.**
Nothing else settles whether the auth load worked.

## 4. After loading — the check that matters

RLS behaves identically on dev, or the whole design (`docs/TEAM-WORKFLOW.md`
§7.3 — no door gate on the preview) is unsafe. So:

- `npm run proofs` against dev. All of them are both-directional.
- One ALLOW and one DENY over the same rows with the **anon key**. A deny-only
  probe cannot tell a working guard from a broken service.
- `npm run migrate:status` — after loading a `pg_dump`, the dev database has the
  schema but an EMPTY `schema_migrations` unless the table came with it. Run
  `node tools/migrate-status.mjs --backfill` against dev once, or every
  migration will read as pending for ever.

## 5. Still unknown — do not plan around these as if settled

- Whether the free tier allows two active projects on a new account (§7.6). The
  owner has hit a pause before. **A third project on the LIVE account is already
  INACTIVE** (`letuxetrbejoqsnaqdgl`, ap-southeast-1) — evidence the limit is
  real, and the reason `samo-dev` goes on a SEPARATE account (D7).
- The auth schema version skew in §3.
- Whether `storage` objects need copying at all — nothing in the app's schema
  references `storage.*` (measured: 0 hits), so probably not.
