---
name: recover-ticket
description: Restore a PR or VS ticket that was accidentally deleted via the staff dashboard. Idempotent; safe to run when in doubt.
---

# Recover an accidentally-deleted ticket

The kanban / staff dashboard has delete buttons. They go through PostgREST
with `service_role`-equivalent (staff RLS), so the row is genuinely gone
from Supabase.

## Path A: ticket exists in the prod CSV (`sheetexample/prform.csv`)

This is the common case — the ticket was migrated from the legacy GAS
sheet and is in the CSV export.

```bash
grep "PR-XXXXXX" sheetexample/prform.csv   # confirm it's there
MIGRATE_RESTORE_ONLY=1 npm run migrate     # restore only missing rows
```

`MIGRATE_RESTORE_ONLY=1` inserts rows present in the CSV but missing
from Supabase. It does NOT overwrite existing rows, so other tickets'
edits stay intact.

Verify in Supabase Table Editor that the row is back.

## Path B: ticket was created via the live form (not in CSV)

If the ticket was submitted after the CSV was exported, the CSV doesn't
have it and restore can't bring it back. Two options:

1. **Re-create via the form**. New ticket gets a new ID; the original ID
   is gone. If you remember the content, fastest path.
2. **Restore from Supabase backups** (if you have point-in-time recovery
   enabled — free tier doesn't include it).
3. **Look for the row in the prod Google Sheet** — the legacy sheet is
   still active. If the ticket existed there before the kanban deletion,
   it's still in the sheet (sheets don't reflect kanban deletes).

   In that case: download the sheet as fresh `sheetexample/prform.csv`,
   then `MIGRATE_RESTORE_ONLY=1 npm run migrate`.

## Same logic for VS tickets

Replace `prform.csv` with `vssound.csv` and the same modes apply.

## How to avoid this in the future

The "delete" button on the PR staff kanban is hard delete. There's no
soft-delete / trash. Two cheap improvements if this happens often:

1. Add a `deleted_at` column to `pr_tickets` and make "delete" set it
   instead of removing the row. Update `fetchPRStaffTickets()` to filter
   `deleted_at is null`. ~1hr of work.
2. Add a confirmation modal with the ticket's department + content before
   submitting the delete. ~15min of work.

See `STATE.md` if either is a planned task.
