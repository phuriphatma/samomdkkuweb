# Onboarding a ฝ่าย contributor

Written 2026-08-27. Design: `docs/DEPT-TOOLS.md`.

## First, the thing this file originally got wrong

**Nobody needs permission to contribute.** The repository is public, so anyone
with a GitHub account can fork it and open a pull request — no collaborator
invitation, no owner involvement, no ceremony. This file's first version
treated being added as a collaborator as step one. It is not step one; for most
people it is not a step at all. **The documentation IS the onboarding.**

What being a collaborator actually buys is narrower, and it is worth knowing
exactly:

| | fork → pull request | collaborator → branch on the repo |
|---|---|---|
| Who can | **anyone** | invited people |
| Open a PR, get review, get merged | ✅ | ✅ |
| CI runs | ✅ *(a first-time contributor's first run needs one click from a maintainer — GitHub's default on public repos)* | ✅ |
| **Preview build** | ❌ — a fork's workflow cannot read repository secrets, so the deploy credential is not there (`docs/TEAM-WORKFLOW.md` §7.7) | ✅ |

So: **the fork road is the default and needs nothing but this document.** Invite
someone as a collaborator when they contribute often enough that a preview URL
per pull request is worth it — not as a rite of passage.

⚠️ **Do not "solve" the fork preview with `pull_request_target`.** It runs the
BASE branch's workflow with secrets available, against a fork's code. That is
the standard way repositories leak their own credentials. If fork previews are
ever wanted, the mechanism is a maintainer-triggered deploy on the base repo,
never that trigger.

---

## The session, when you do sit with someone

Optional, and worth it for the one or two people who will contribute often. It
ends when they have **merged** a pull request that changes one word — a person
who has merged one will open a second; a person handed a document will not.

⚠️ **Onboard TWO people, not one.** SAMO turns over every year and medical
students disappear into ward rotations without notice. One trained contributor
is a bottleneck with less accountability than IT and no handover — the exact
thing this workflow exists to remove, relocated. Teach the successor **before**
the incumbent leaves.

---

### Before they arrive (owner, 5 min)

- Confirm they have a GitHub account and know its password.
- **Only if they will contribute often**, add them as a collaborator with
  `write` — that is what makes per-pull-request previews possible. Otherwise
  they fork, which needs nothing from you.

### On their laptop (35 min)

Everything here is typed by **them**, not by you. That is the point — the muscle
memory is the deliverable.

1. **Node 22.** `node -v`. Node 20 hard-throws on this repo's test suite
   (`supabase-js` needs a global WebSocket).
2. **Claude Code**, signed in.
3. `gh auth login` — browser flow, HTTPS.
4. **Clone.** Collaborator: `gh repo clone phuriphatma/samomdkkuweb`.
   Everyone else: `gh repo fork phuriphatma/samomdkkuweb --clone` — same result,
   their own copy, and `gh pr create` still opens the PR against this repo.
   Then `cd samomdkkuweb && npm ci`.
5. `npm run dev` → open `localhost:5174`. **They must see the real site running
   on their own machine.** This is the moment the whole thing becomes real to
   them; do not skip it to save five minutes.
6. **The practice pull request.** Have them ask Claude, in their own words, to
   change one visible word somewhere harmless, then:
   `git checkout -b tool/practice-<their-name>` → commit → `gh pr create`.
7. CI runs. **Show them the red/green.** Show them that red means it cannot be
   merged — this is what `required_status_checks` buys, enabled 2026-08-27.
8. You approve, they press merge. **They merge it, not you.**
9. Show them that the site has NOT changed. Merging is not publishing; the
   owner deploys, in batches (`skills/deploy-vm.md`). Say the words *"ขึ้นเว็บ
   จริงในรอบ deploy ถัดไป"* out loud, once, here — or it will be asked every
   time forever.

### The five sentences they leave with (5 min)

Say these; do not email them.

1. **"แก้ได้เฉพาะในโฟลเดอร์ของเครื่องมือตัวเอง"** — a pull request that touches
   anything else will be stopped, and that is a feature. `CODEOWNERS` names the
   protected paths.
2. **"อยากได้เครื่องมือใหม่ เปิด issue ก่อน"** — the tool-request template. The
   issue is the agreement; the review compares the work to it.
3. **"อยากเพิ่มทีหลัง เปิด issue ใหม่ ไม่ต่อในอันเดิม"**.
4. **"ห้ามใส่ชื่อจริง รหัสนักศึกษา หรือรูปคนจริงลงใน commit หรือใน screenshot"**
   — the repository is PUBLIC and git history is permanent. GitHub's scanner
   catches API keys; **it does not catch a person's name.**
5. **"ข้างในกล่องเป็นของฝ่าย"** — layout, colour, wording. IT reviews and
   publishes; IT does not redesign.

---

## The owner's habit, and it is the one that decides whether this works

**Send it back; do not fix it yourself.**

A contributed page will look slightly foreign — spacing a little off, a green
that is nearly the brand green. Asking for a change in a review comment costs a
sentence and keeps the work theirs. Opening the file and fixing it yourself
costs a session and takes the pen back permanently — which is the bottleneck
this whole workflow was built to remove, rebuilt by hand.

*(This started life as a question — "can you live with a page you did not
design?" — and it was the wrong shape. Nothing ships without the owner's
approval and the owner's deploy, so control was never at stake. It is a habit,
not a decision.)*

## Reviewing their pull request

The owner does not have to read it. In a **fresh** Claude session:

```
/code-review <PR#>
```

- **Fresh matters.** A session that helped write the change reviews its own
  assumptions. Start a new one.
- **Give it the spec**: paste the tool-request issue, and ask it to compare the
  diff *to the issue*, not just to itself. Claude reads the diff; only the issue
  says what was supposed to be built.
- **What this covers safely**: anything under `public/embed/**`. Worst case is
  one broken page inside a frame that reaches nothing.
- **What it does NOT cover**: the data doors in `src/js/data/`, and anything in
  the `CODEOWNERS` list. Those decide who may see what, that rule lives in the
  database rather than in the diff, and the owner reads those personally.

---

## Two things that will confuse someone later

- **The owner cannot approve their own pull request.** GitHub forbids it, and
  `require_code_owner_reviews` is now on — so an owner PR touching an
  owner-owned path (`supabase/`, `auth.js`, `STATE.md`, …) can never collect the
  approval it asks for. That is not a misconfiguration: `enforce_admins` is
  `false` on purpose, so the owner merges with the admin bypass or pushes `main`
  directly, which is the normal flow here. **Do not turn `enforce_admins` on to
  "make it consistent".**
- **A red CI check on a contributor's PR is usually not their change.** Ask them
  to run `npm test` locally first; the suite also enforces the agent-context
  byte budget and the handoff's pointers, so an unrelated edit elsewhere can be
  what is red.
