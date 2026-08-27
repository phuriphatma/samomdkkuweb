# phuriphatma — session notes

One file per person, as designed in `docs/TEAM-WORKFLOW.md` §6.5. **Write your
own; never rewrite someone else's.**

What belongs here: what I am part-way through, what I tried that did not work,
what I want to pick up next. What does NOT belong here:

- a rule that will still be true next year → `docs/INVARIANTS.md`
- what is true right now for everyone → `STATE.md`
- why something was done the way it was → `docs/state-archive/`
- a bug that was fixed → `docs/mistakes/<area>.md`, then `npm run mistakes:index`

The dead-pointer sweep in `state-handoff.test.js` runs over this file too, so a
path named here must resolve.

---

## In flight

- ✅ **The database password is in `.env.local` and verified.** Schema dumped:
  64 tables, 165 functions, 156 policies, 592 GRANTs. Recipe and traps in
  `skills/build-the-dev-database.md`. **The dump is a build artifact and is NOT
  in the repo** — it lives in the session scratchpad and goes stale; re-run the
  dump rather than reusing an old file.
- ⏳ **Phase 1 now needs one thing only: a SEPARATE Supabase account** to create
  `samo-dev` in (D7 — a third project on the live account pauses another, and
  `letuxetrbejoqsnaqdgl` sitting INACTIVE is the evidence). Then load, then
  prove it by SIGNING IN as a copied account before calling it good.
- **`auth.users` loads FIRST** — seven public tables carry a foreign key to it.
- **Golden Period is un-started.** `docs/DEPT-TOOLS.md` §13 has the order; the
  first code step is the one-source tool registry, because `DEPT_DEFS` in
  `src/js/departments.js` and `src/html/tab-tools.html` are two hand-maintained
  copies of one list today.

## Next time I have an hour

- The project board (the last outstanding piece of `TEAM-WORKFLOW` phase 0).
- Decide whether previews are per-pull-request or **one always-on dev site** —
  the owner said "the dev server", singular, which is the cheaper shape.
