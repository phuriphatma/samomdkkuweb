# 2026-08-27 → 30 — the older status blocks, pruned from STATE.md

Pruned on 2026-08-30 to keep `STATE.md` under its ~200-line target. Nothing here
is a live instruction; the durable rules are in `docs/INVARIANTS.md`, the bugs
in `docs/mistakes/`, the chronology in `git log --oneline`.

⚠️ **Still operative and repeated in `STATE.md`:** the salvaged old-passport scan
dump at `~/samo-passport-old-db-backup-2026-08-29/` must never be committed —
both repos are PUBLIC and it holds real student emails.

---

## WHAT CHANGED BEFORE THAT — 2026-08-27 → 29

Pruned to `docs/state-archive/2026-08-29-passport-email-dev-system.md` on
2026-08-30. What is still operative, and nothing else:

- **PASSPORT TOTALS — CLOSED, do NOT re-investigate.** 0174 + 0175 close both
  halves; every total now equals the scans behind it. ⚠️ The salvaged old-project
  scan dump at `~/samo-passport-old-db-backup-2026-08-29/` **must never be
  committed** — both repos are PUBLIC and it holds real student emails.
- **179 passport profiles with no `auth.users` row is the EXPECTED state**, not
  a bug. It was called one for a day. The re-key happens on first signup.
- **READ `docs/EMAIL.md` BEFORE TOUCHING MAIL.** The VM can SEND through a relay
  on 587; it cannot BE or RECEIVE mail. **No password reset exists; mail config
  is why.** สถิติ's email + GAS numbers are FLOORS.
- **Discord notify is rotated; VitalSound routes per ฝ่าย to 12 channels** —
  read the notify rules in `docs/INVARIANTS.md` BEFORE touching notifications.
