## What changed, and why

<!-- One or two sentences. If it fixes something a person reported, quote them —
     their words are what the next person will search for. -->

## Where you checked it

<!-- Preview URL when previews exist; until then, `npm run dev` locally.
     Say which widths you looked at — 390 / 820 / 1280 is the usual set. -->

- [ ] `npm test && npm run build` pass locally

## If it touches any of these, say so here

- [ ] **A database change** — migration number, and confirm it is applied to the
      dev database. Order still matters: add before the code that reads it ships;
      drop only after the new bundle is confirmed served
      (`skills/ship-a-migration.md`).
- [ ] **`auth.js` / `db.js` / an RLS policy / a SECURITY DEFINER function** — say
      which write-up in `docs/mistakes/` you read first. Grep it by symptom:
      `grep -rin "<symptom>" docs/mistakes/`.
- [ ] **Something a student or staff member would NOTICE** — add an entry to
      `PENDING` in `src/data/changelog.js`, in this same PR, in plain Thai. A
      refactor or a test gets no entry.
- [ ] **A hazard this repo has already paid for twice** — add a guard test, and
      say how you falsified it (break the code, watch it fail on the assertion
      you expect, restore). `skills/write-a-guard.md`.

## Anything you are unsure about

<!-- Worth more than a confident summary. Say what you could not verify. -->
