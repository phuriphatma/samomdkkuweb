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
- ✅ **`samo-dev` is BUILT, LOADED and PROVEN** (`xibugtlsphcfuvstnxxh`).
  Rebuild any time with `CONFIRM=1 npm run dev:refresh`; check it with
  `npm run dev:check`. Credentials are the `SUPABASE_DEV_*` block in
  `.env.local` and are safe to share with the team — that account holds nothing
  but disposable projects.
- **Next: decide previews.** Per-PR URLs, or one always-on dev site? The owner
  said "the dev server", singular, which is cheaper. Then phase 2's remainder:
  mail trap, `#samo-dev-bot`, dev GAS deployment.
- **Golden Period is un-started.** `docs/DEPT-TOOLS.md` §13 has the order; the
  first code step is the one-source tool registry, because `DEPT_DEFS` in
  `src/js/departments.js` and `src/html/tab-tools.html` are two hand-maintained
  copies of one list today.

## Next time I have an hour

- The project board (the last outstanding piece of `TEAM-WORKFLOW` phase 0).
- Decide whether previews are per-pull-request or **one always-on dev site** —
  the owner said "the dev server", singular, which is the cheaper shape.
