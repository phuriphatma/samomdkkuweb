---
layout: home
hero:
  name: SAMO MDKKU
  text: Working documentation
  tagline: The docs behind the student portal at samo.md.kku.ac.th — architecture, the rules that outlive a session, and every bug this repo has already paid for.
  actions:
    - theme: brand
      text: Start here — the invariants
      link: /INVARIANTS
    - theme: alt
      text: Architecture map
      link: /CONTEXT
    - theme: alt
      text: Contributing
      link: https://github.com/phuriphatma/samomdkkuweb/blob/main/CONTRIBUTING.md
features:
  - title: Rules that outlive a session
    details: docs/INVARIANTS.md — what must stay true no matter who is working. Read it before notifications, deploys, or reparenting a ฝ่าย.
    link: /INVARIANTS
  - title: Bug write-ups
    details: Ten files, one per area, every one of them a mistake this project made once and wrote down so it is not made twice. Symptom → cause → fix → the general rule.
    link: /mistakes/INDEX
  - title: How a ฝ่าย ships a tool
    details: One pull-request workflow for everybody, with CODEOWNERS carrying the whole difference. No department needs IT to write their page.
    link: /DEPT-TOOLS
  - title: The team workflow
    details: The dev database, per-PR previews, credentials and review flow — what is built, what is still a design, and which decisions are closed.
    link: /TEAM-WORKFLOW
---

## What this site is, and what it is not

This is the `docs/` directory of
[`phuriphatma/samomdkkuweb`](https://github.com/phuriphatma/samomdkkuweb),
rendered. It is the working documentation for the MDKKU SAMO student portal —
written for the people who maintain it and for the agents that help.

**It is not the status of the system.** That lives in `STATE.md` at the root of
the repository, on purpose: it changes almost every session, and a copy of it
here would be a second home for a decaying fact — which is the single most
expensive mistake this codebase has repeated. If you want to know what is
deployed, what is in flight and what is owed, read
[`STATE.md`](https://github.com/phuriphatma/samomdkkuweb/blob/main/STATE.md).

**It is not a manual for students.** Nothing here is user documentation; the
portal itself is at [samo.md.kku.ac.th](https://samo.md.kku.ac.th).

## Where to go first

| You want | Read |
|---|---|
| The rules that must not be broken | [INVARIANTS](/INVARIANTS) |
| How the thing is put together — schema, RLS, deploy | [CONTEXT](/CONTEXT) |
| To contribute a page for your ฝ่าย | [DEPT-TOOLS](/DEPT-TOOLS) |
| Whether this bug has happened before | [the write-up index](/mistakes/INDEX) — or `grep -rin "<symptom>" docs/mistakes/`, which searches the write-ups themselves |
| Why something was built the way it was | the [archive](/state-archive/2026-08-27-state-split) |

⚠️ **Everything here is public**, because the repository is. No key, no
credential, no unlisted URL and no student's name, รหัสนักศึกษา or photograph
belongs in `docs/` — that was already true of a public repo, and this site only
makes it easier to find.
