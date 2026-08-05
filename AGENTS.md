# Agent Router — samomdkkuweb

**Read [`CLAUDE.md`](./CLAUDE.md).** It is the single router for every agent
working in this repo: project shape, tech stack, commands, file placement,
UI/UX rules, the memory layout, the end-of-turn loop, and the authority model.

This file used to be a full copy of it for Codex, and drifted. It spent months
pointing at a `.Codex/rules/` directory that has never existed — so any agent
following it went looking for the bug write-ups and found nothing — and still
named the retired `pages.dev` host as production. That is exactly the failure
class this repo logs as *"two implementations of one rule drift silently"*.
One router now, no mirror.

Quick orientation, so this file is not a dead end:

- **What loads automatically**: `CLAUDE.md`, `.claude/rules/mistakes.md`
  (recurring bug classes + a one-line index of every write-up),
  `.claude/rules/security.md`. Keep them small — `npm run check:context`
  enforces it, and `npm test` runs that.
- **Bug write-ups**: `docs/mistakes/*.md`, nine files by area, read on demand.
  `grep -rin "<symptom>" docs/mistakes/`.
- **What is true right now** (deploy, in-flight work, open issues): `STATE.md`.
- **Architecture, schema, RLS, deploy plumbing**: `docs/CONTEXT.md`.
- **Commands**: `npm run dev` · `npm run build` · `npm test`.
