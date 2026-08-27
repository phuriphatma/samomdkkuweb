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

- **`docs/TEAM-WORKFLOW.md` phase 1 is blocked on ONE thing: the database
  password** (Supabase dashboard → Settings → Database), into `.env.local` as
  `SUPABASE_DB_URL`. With it: dump the schema, create the `samo-dev` project,
  load it, and prove it by signing in as a copied account (§7.5) before
  declaring the refresh good.
- **`pg_dump` is NOT missing** — `libpq` is keg-only, so it is at
  `/opt/homebrew/opt/libpq/bin/pg_dump` (18.4) and not on `PATH`. A newer client
  dumps an older server, so 18.4 against the server's 17.6 is fine.
- **Golden Period is un-started.** `docs/DEPT-TOOLS.md` §13 has the order; the
  first code step is the one-source tool registry, because `DEPT_DEFS` in
  `src/js/departments.js` and `src/html/tab-tools.html` are two hand-maintained
  copies of one list today.

## Next time I have an hour

- The project board (the last outstanding piece of `TEAM-WORKFLOW` phase 0).
- Decide whether previews are per-pull-request or **one always-on dev site** —
  the owner said "the dev server", singular, which is the cheaper shape.
