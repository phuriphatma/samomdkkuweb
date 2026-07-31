# Archived from STATE.md 2026-07-31 — VitalSound 0107 + ทีม SAMO 0104-0106

Both shipped and deployed. Post-mortems live in `.claude/rules/mistakes.md`;
chronology in `git log --oneline`.

## SHIPPED 2026-07-31 — VitalSound: transfer fixed + merge made two-directional

Migration **0107 applied**; the merge change needed none. Both LIVE.
Full post-mortems (the interesting part) are the two newest entries in
`.claude/rules/mistakes.md`; commit messages carry the rest.

- **`vs_transfer_dept(p_id, p_dept, p_remarks)`** (0107) — โอนคืน SE used to
  42501 for EVERY dept-scoped handler. Not the UPDATE policy: Postgres
  re-applies the SELECT policy to the NEW row on UPDATE, and `vs_tickets_read`
  scopes a handler to their own `target_dept`, so a handoff is un-PATCHable by
  construction. The RPC re-applies the same predicate server-side. **RLS on
  `vs_tickets` is unchanged.** `vs-staff.js` PATCHes everything else first with
  the transfer log withheld, then calls the RPC last.
  Proof `tools/vs0107-transfer.mjs` — 26/26. Swept the whole class:
  `vs_tickets.target_dept` is the only live instance.
- **เรื่องซ้ำ is two-directional.** push (open ticket becomes the duplicate) and
  pull (ticked tickets become duplicates of the open one, multi-select + one
  bulk action). Direction is an explicit mode restated as a sentence; the row
  button names what the ROW becomes. Bulk is sequential + per-ticket-reported,
  deliberately NOT atomic.
- **Form/copy**: กระดานปัญหา consent is opt-OUT (`checked`); a
  "กรุณาร้องเรียนทีละปัญหา" notice sits above the problem editor; "ส่งต่อให้คณะ"
  is retired from the เสร็จสิ้น reasons (`forwarded.manual = false`, kept in the
  vocab + DB CHECK for legacy rows — 0 live rows use it).


## SHIPPED EARLIER — ทีม SAMO portraits + ปีการศึกษา (0104–0106) — LIVE

Full text: `docs/state-archive/2026-07-31-team-0104-detail.md`. Applied + deployed.
Public ทีม SAMO opens with a docchula-style คณะกรรมการ portrait grid; every
ปีการศึกษา is a first-class editable snapshot (`team_terms` +
`team_archive_*`, written by `publish_team_term`, read by
`get_public_team_chart(year)`). Photos go to Drive and render through lh3
option strings (`=w<W>-h<H>-c-rw`) — **do not "optimise" this onto the VM**,
the measurements are in the archive.


