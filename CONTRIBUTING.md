# Contributing

**The guide lives here, and it is written for everyone — ฝ่าย members and
developers read the same page:**

### 👉 https://samo.md.kku.ac.th/docs/CONTRIBUTE

(Source: [`docs/CONTRIBUTE.md`](docs/CONTRIBUTE.md) — edit it there.)

**Want the commands, in order, with diagrams?** — from opening Terminal to a
merged pull request, including what to do when your feature depends on one that
is still in review:

### 👉 https://samo.md.kku.ac.th/docs/STEP-BY-STEP

(Source: [`docs/STEP-BY-STEP.md`](docs/STEP-BY-STEP.md).)

Both pages are also published to GitHub Pages at
<https://phuriphatma.github.io/samomdkkuweb/> — same content, built from the
same commit. That copy exists so the documentation is still readable if the KKU
server is down, which is exactly when you are most likely to want it.

---

This file is deliberately a pointer and not a copy. GitHub shows `CONTRIBUTING.md`
when someone opens a pull request, so it has to exist; but the moment it also
held the workflow, there were **two homes for one set of instructions** — and on
2026-08-30 the copy in this file was found still DENYING that per-PR previews existed,
weeks after they had started working. That is
this project's most repeated bug, in prose (`.claude/rules/mistakes.md`, class 6).

So: one home. Add nothing here that belongs in the guide.

## The 30-second version

1. You do **not** need to be added to the project first. Edit, and GitHub makes
   you your own copy.
2. Open a pull request. Every branch gets a **preview site**, pointed at the
   development database — safe to click and submit on.
3. ⛔ **Never commit a real student's name, รหัสนักศึกษา, email or photo.** This
   repository is public and git history is permanent.
4. Merging to `main` does **not** deploy. A maintainer deploys to the KKU VM.

Everything else — what needs a review first, running it locally, what to do
after you fix a bug — is in the guide.
