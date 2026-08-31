# Contributing

**Everything you need, in order — what to install, how to run it, and how to
send your first change:**

### 👉 https://samo.md.kku.ac.th/docs/start/prerequisites

(Source: [`docs/start/`](docs/start/) — edit it there.)

**What you may change, the rules, and who has to approve what:**

### 👉 https://samo.md.kku.ac.th/docs/contributing

(Source: [`docs/contributing.md`](docs/contributing.md).)

Both pages are also published to GitHub Pages at
<https://samomdkku.github.io/samomdkkuweb/> — same content, built from the
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
