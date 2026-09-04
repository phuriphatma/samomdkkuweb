# Everything still owed — the cross-session handoff

Written 2026-09-04. **This is the one place that lists what is NOT done.**
`STATE.md` says what is true right now; this says what is left, why it is left,
and who can do it. When an item is finished, delete it from here.

⛔ **Nothing below is blocking anything else.** The codebase is in a clean,
shipped, verified state. These are choices and errands, not loose ends.

---

## 1. The one with a security edge — do this first

**Reset the Discord bot token** — app `1492541609445949465`, *"Role assignment
bot for SAMO69"*. It holds **Administrator** and was pasted into a chat
transcript on 2026-08-28.

Nothing built in this repo uses it, so resetting it breaks nothing. Discord
Developer Portal → that app → Bot → Reset Token.

**Owner only.** Five minutes.

---

## 2. A release is overdue — the biggest user-visible gap

**108 release notes are staged and invisible.** The last release was **4.6.0 on
2026-08-10**; today is 2026-09-04. Everything since — the shared sign-in, the QR
season rule, the Silent-toggle fix, a month of ฝ่าย page editing, permissions and
หนังสือโครงการ work — is written in plain Thai in `PENDING` and **not shown at
`/updates`**.

`npm run release` folds `PENDING` into a new version and clears it. **Read
`docs/VERSIONING.md` first** — it says to, and the version number is a judgement
call. Given single sign-on and a behaviour change to QR codes, this is probably
not a routine patch bump.

**Needs the owner to choose the number; anyone can run it after that.**

---

## 3. Tell the ฝ่าย before Q3 starts

Two things become true the moment somebody presses **Start new Season**, and
both will otherwise arrive as surprises:

- **Every Q2 QR stops scanning.** That is the rule the ฝ่าย asked for
  (*"ถ้าเกิน quater ก็คือสแกนไม่ได้ๆๆ"*), shipped as migration 0180. Concretely
  **เปิดโลกกิจกรรม 2569 had 84 scans in the last 30 days and will stop.**
- **An activity must be created IN the quarter it should count toward.** An
  event spanning the rollover loses its QR.

⛔ Do not "fix" either by falling back to the current season — that restores the
original bug wearing a helpful face. `docs/INVARIANTS.md` says so.

**Owner / ฝ่าย. A conversation, not a task.**

---

## 4. Owner-only errands, none urgent

| | What |
|---|---|
| Dev Apps Script | under its own Google account + a `DEV` Drive folder — last piece of dev-system phase 2 |
| GitHub project board | phase 0's last piece; the `gh` here lacks the `project` scope |
| One non-owner team add | last box of the org-move checklist: somebody who is not the owner adds a person to a team, once |
| Confirm the dev-channel test | delivery is proved (16×204); a human must confirm the 12 ฝ่าย messages landed in `#developer-server-notify` and none in a real `#vs-*` |

---

## 5. People, not software

- **Teach two ฝ่าย members the tool flow** (`docs/DEPT-TOOLS.md` §13 step 8).
  The design is built and shipped; nobody has been walked through it.
- **Test a ฝ่าย page on a real phone** (step 5). Emulated widths are not a phone.
- **A visual-editor spike awaits a verdict** — "แก้แบบเห็นภาพ" on an html row
  (GrapesJS, admin-only, lazy). ⛔ Build nothing more on it until the owner
  answers; if the feel is wrong, delete `dept-visual-editor.js` and the
  dependency and nothing else knows it existed.

---

## 6. Two screenshots only you can take

The contribute guide is fully photographed **except** where a capture would need
your GitHub session in a way I could not reach from a headless browser. Both
signed-in shots now exist (banner, checks box), so this is optional polish:
a capture of the **Files changed** tab and of **Squash and merge** would finish
the set.

---

## 7. Known-unknown, recorded so it is not rediscovered

**Which Supabase project the frozen `samomdkkupassport` Cloudflare build reaches.**
Six chunks were searched and no URL found — that is *inconclusive*, not proof of
absence. `cf:pin-dev` repointed the variables but they apply to the next build,
and none has run. Settle it with a browser network tab, not grep.

⛔ **Never delete that Cloudflare project** — 82% of printed QR posters name it.
Do not replace it with redirects either; that was considered, measured and
rejected (`docs/PASSPORT-MONOREPO.md` §3).

---

## Where to look for anything else

| | |
|---|---|
| what is true now | `STATE.md` |
| rules that outlive a session | `docs/INVARIANTS.md` |
| the passport merge, start to finish | `docs/PASSPORT-MONOREPO.md` |
| bugs already paid for | `docs/mistakes/*.md` — `grep -rin "<symptom>" docs/mistakes/` |
| what production serves | `npm run deploy:owed` — **the only authority** |
