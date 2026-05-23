---
name: migrate-data
description: Run the CSV → Supabase data migration. Knows the three modes (default upsert, restore-only, patch-assignees) and when to use each.
---

# Migrate data from Google Sheets CSVs into Supabase

The script `tools/migrate-from-sheets.mjs` reads CSV exports from
`sheetexample/` (gitignored) and writes them into Supabase. Three modes
exist for different scenarios.

## Prerequisites

1. CSV files in `sheetexample/`:
   - `prform.csv` — prod PR Submissions sheet export
   - `vssound.csv` — prod VS Tickets sheet export (optional)
   - `announcements.csv` — prod Announcements sheet export (optional)
2. `.env.local` contains `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY`.

## Modes

### Default — overwrites existing rows

```bash
npm run migrate
```

Use case: **first-time migration** OR full re-sync (you accept any
Supabase-side changes since the last run getting reverted to CSV state).

Behavior:
- Seeds staff accounts (samomdkkupr / samomdkkuvssound / samomdkkudev)
- Inserts or **overwrites** every row in the CSV
- Idempotent on PK (`onConflict: 'id'`)

### Restore-only — fill gaps without touching existing rows

```bash
MIGRATE_RESTORE_ONLY=1 npm run migrate
```

Use case: **recover a deleted ticket** without reverting other live edits
(status changes, remarks added via the staff dashboard).

Behavior:
- Inserts rows the CSV has but Supabase doesn't
- **Existing rows untouched** (`ignoreDuplicates: true`)

### Patch-assignees — surgical backfill of CSV-only fields

```bash
MIGRATE_PATCH_ASSIGNEES=1 npm run migrate
```

Use case: backfilling fields that an earlier migration silently dropped
(assignees, other_platforms, other_platform_reason — CSV columns 20-22 had
empty headers).

Behavior:
- For each row in CSV: `UPDATE pr_tickets SET assignees, other_platforms,
  other_platform_reason WHERE id = ...`
- Other columns (status, remarks, brief, etc.) untouched

### Debug

```bash
MIGRATE_DEBUG=1 npm run migrate
```

Prints row counts and every parsed ticket ID. Use when a row appears
"missing" — confirms whether the CSV parser saw it.

Combine flags freely: `MIGRATE_DEBUG=1 MIGRATE_RESTORE_ONLY=1 npm run migrate`.

## What gets mapped

PR CSV → `pr_tickets`: all 23 columns including the three with empty
headers (assignees @ col 20, other_platforms @ col 21, other_platform_reason
@ col 22). Both `timestamp` and `created_at` get set from the CSV's
Timestamp column.

VS CSV → `vs_tickets`: all 11 columns (Password intentionally not migrated
— Supabase Auth handles passwords).

Announcements CSV → `announcements`: id auto-generated bigserial; CSV
Timestamp → `created_at`; Title / Content / Department / Thumbnail mapped
directly.

## What can go wrong

- **"Email rate limit exceeded"** during staff seeding → turn off email
  confirmation in Supabase Auth settings.
- **Last row of CSV missing in output** → look for `EOF reached inside a
  quoted field` warning. An earlier row has an unterminated quote that
  swallowed everything after.
- **Assignees empty after migration** → use `MIGRATE_PATCH_ASSIGNEES=1`.
- **PR-XXX missing after restore** → that ticket might not be in the CSV
  (created via live form after the CSV was exported). Check with
  `grep "PR-XXX" sheetexample/prform.csv`.

## After running

Verify in Supabase Table Editor:
- `pr_tickets` row count matches CSV (minus header)
- Spot-check a few rows for `assignees`, `other_platforms` populated
- `created_at` should match the original submission dates (not all
  clustered at migration time)
