# 2026-08-27 → 29 — passport totals, the false alarm, email, and the dev system

Pruned out of `STATE.md` on 2026-08-30 to keep it under its ~200-line target.
Nothing here is a live instruction: the rules that outlived these sessions are in
`docs/INVARIANTS.md`, the bugs are in `docs/mistakes/`, and the chronology is
`git log --oneline`. Kept because it says WHY these were done the way they were.

⚠️ **One line here is still operative** and is repeated in `STATE.md`: the
salvaged old-passport scan dump at `~/samo-passport-old-db-backup-2026-08-29/`
must never be committed — both repos are PUBLIC and it holds real student
emails.

---

## WHAT CHANGED BEFORE THAT (2026-08-29)

0. ✅ **PASSPORT — the "144 students cannot sign in" alarm was FALSE.** 179
   profiles have no auth row, which is the EXPECTED state: the trigger
   `on_auth_user_created_passport_link` re-keys a carried profile by email on
   first signup, so the student keeps their km. It was called a bug here for
   one commit because the wrong function was read — **check `pg_trigger` on
   `auth.users`, not a function body.** Residual: that re-key swallows its own
   errors (`raise warning`), so a failure would be silent. Detail:
   `docs/state/phuriphatma.md`.

0b. **PASSPORT TOTALS — CLOSED, do NOT re-investigate.** `total_km` could only
   go UP (only a BEFORE INSERT trigger since 0056); **0174** adds the
   delete/update halves. The leaderboard sums SCANS while the tier badge reads
   `total_km`, so all 11 drifting totals were recalculated from scans (drift 0,
   no leaderboard position moved). One scan lost in July was restored.
   ⚠️ **The old Supabase project was DELETED by the owner; its salvaged scan
   dump is at `~/samo-passport-old-db-backup-2026-08-29/` and must never be
   committed — both repos are PUBLIC and it holds real student emails.**

## WHAT CHANGED BEFORE THAT (2026-08-27 → 28)

1. **`samo-dev` exists** (`skills/build-the-dev-database.md`); **per-PR previews
   work**, pointing at it and a dev Discord channel. **Golden Period ships** at
   `/tools/golden-period` — an IT DRAFT the ฝ่าย own (`docs/DEPT-TOOLS.md` D8).
2. **Discord notify rotated; VitalSound routes per ฝ่าย to 12 channels.** Two
   real messages reached a live ฝ่าย channel then — **read the notify rules in
   `docs/INVARIANTS.md` BEFORE touching notifications.**
3. **EMAIL AUDITED — read `docs/EMAIL.md` before touching mail.** The VM CAN
   send via a relay on 587; it cannot BE or RECEIVE mail. **No password reset
   exists; mail config is why.** สถิติ shows email + GAS quota (0170–0173);
   nothing is near a limit and both numbers are FLOORS.
