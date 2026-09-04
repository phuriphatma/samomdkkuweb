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

---

## 8. Tooling that WILL bite you — learned the hard way on 2026-09-04

None of this is in the tools' own help text. Each cost real time.

### `tools/db-query.mjs` runs on PRODUCTION and ignores `--dev`

There is no guard. To send a read to samo-dev you must override the URL, and
**read the `→ project:` line it prints** — that line is the only thing standing
between you and a proof you think ran on dev:

```bash
VITE_SUPABASE_URL="$SUPABASE_DEV_URL" SUPABASE_ACCESS_TOKEN="$SUPABASE_DEV_ACCESS_TOKEN" \
  node tools/db-query.mjs tools/whatever.sql
```

`tools/apply-migration.mjs` **does** honour `--dev`. The two differ; do not
assume.

### A SQL proof must emit ROWS whose verdict starts with `PASS`

Three separate ways one correct proof failed in a row:

1. **`RAISE NOTICE` returns nothing** through the Management API — you get `[]`.
   Every case runs and none can be read. Insert into a temp table and `select`.
2. **`format()` uses `%s`; `RAISE` uses `%`.** Mixing them errors at runtime.
3. **`run-proofs.mjs` counts a case as passing only if the verdict STARTS WITH
   `PASS`.** Emitting `'ok'` reports six green cases as "6 failed".

And **adding the file is not adding the proof** — `PROOFS` in `run-proofs.mjs`
is a list. It now errors on an unlisted `tools/*.sql`, but only because that gap
was found; check your proof's name appears in the run output.

### Enum fields that reject silently-plausible values

- `changelog.js` — `type` is **`new` | `improved` | `fixed`** (not `changed`),
  `audience` is **`public` | `staff`** (not `all`). I typed invalid values
  **twice in one day** by guessing instead of reading. `changelog.test.js`
  catches both; read the constants first.

### Budgets that trip on almost every edit

- **`STATE.md` must be under 260 lines** and the test counts one more than
  `wc -l` does. Expect to trim your own addition two or three times. **Never
  raise the limit** — move durable facts to `docs/INVARIANTS.md`.
- **`CLAUDE.md` is at 100% of its 12,000-byte budget.** Any addition needs an
  equal deletion. Thai is 3 bytes/char, so trimming English frees less than it
  looks.

### `head -N` on a grep is not a search

Twice I reported a string "missing" from a fresh build because the file sorted
below my `head -2`. Both times the alarm was my instrument. If a result looks
alarming, re-run it **without** the truncation before believing it.

### The Chrome extension is usually available — try it

`skills/drive-the-browser.md` says it is "usually not connected". On 2026-09-04
it was connected and I did not try for hours, capturing logged-out GitHub with
headless Chrome instead. `list_connected_browsers` costs one call. Use it before
concluding you cannot reach a signed-in page.

---

## 9. How this owner works — worth knowing on day one

- **When they ask "why not do it", they are usually right.** "Because the build
  does it that way" was not a reason the dev server could not; pushing back
  produced the one-address dev server. Treat the question as a real one.
- **They ask short questions that find real bugs.** "isn't production
  samo.md.kku.ac.th" exposed half the Cloudflare build spend going to a retired
  host. "i thought you have connection to this" got the signed-in screenshots.
  Do not answer these defensively — check.
- **They want plain language.** They have asked twice for less jargon. Say the
  consequence, not the mechanism.
- **They delegate decisions but want a recommendation**, not a survey. "you can
  decide" means decide, and say why.
- **Ship it.** Commit, push and deploy are the normal flow, not events to ask
  about. Batch commits, then deploy once.
- **Verify, then say so.** Claims land better with the command that proved them.
  This repo has been burned by confident prose more than by bad code.

---

## 10. ⚠️ `tools/pass-hardening.mjs` — runs again, and needs one look

**It was CRASHING and nobody knew.** It resolved `../../../passport/` — a sibling
checkout *outside* this tree — which stopped existing when the repos merged. Any
run died with ENOENT on a file that was sitting in `passport/db/`. Path fixed
2026-09-04; it executes now.

**It reports 45 passed, 9 failed. Do NOT read that as "passport RLS is broken."**

Every failure is a DENY check, and the read check returned **637 profiles**:

```
FAIL cannot set own total_km          -> rows=1
FAIL cannot touch another student     -> rows=1
FAIL admin_leaderboard refused        -> ALLOWED
FAIL reads only own profile           -> 637
```

That is the signature of the PROBE holding the wrong identity, not of the
database letting students through. It runs through the Management API, which
connects as a role that **bypasses RLS** — under which every "cannot" is
expected to be allowed. `.claude/rules/mistakes.md` class 7: *a probe answers the
question its DIRECTION asks*, and a deny-only probe cannot tell a working guard
from a broken connection.

**Counter-evidence that passport is fine:** all **31 live proofs are green**
against production, including the passport ones (`passport0174-total-km-symmetry`,
`passport-link-on-signup`, `passport0180-season-gate`) and
`authz-sweep-identity`, which DO establish a real unprivileged identity.

**What is actually owed:** decide whether this tool still earns its place. Either
give it a genuine unprivileged identity (set `request.jwt.claims` and `set local
role authenticated`, as `passport0180-season-gate.sql` does) and add it to
`PROOFS`, or delete it. A tool that crashes silently for weeks and then reports
nine scary-looking failures it cannot substantiate is worse than no tool.

⛔ **Do not "fix" the nine failures by changing RLS.** Establish the identity
first and re-run; the failures will very likely evaporate.
