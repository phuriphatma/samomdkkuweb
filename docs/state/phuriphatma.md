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

## ▶ DO THIS FIRST — the Golden Period draft (~1 session)

Owner asked for it plainly: *"just setup the page, link, show the calendar,
google sheet as you think you should do"*. **Very simple on purpose** — it is the
D8 draft, not the real thing. `docs/DEPT-TOOLS.md` D8: the ฝ่าย own the page, IT
may draft a placeholder. **Keep it plain, SAY on the page that it is a
placeholder, and hand the route over when their version lands.**

### What goes on it

1. **วิธีอ่านค่า** — four bands as coloured chips: `% สูงมาก` → `สูง` →
   `ปานกลาง` → `ต่ำ`, with one line saying high = students likely free.
2. **The exam / activity calendar**, embedded:
   `https://calendar.google.com/calendar/embed?src=samomdkku.sod%40gmail.com&ctz=Asia%2FBangkok`
   ⚠️ **`MONTH` is unreadable at 390 px** — pick `&mode=AGENDA` under 768 px and
   `MONTH` above, and build the iframe `src` **when the tab opens**, not at page
   load, so a hidden iframe does not cost every visitor a request.
3. **A button to the GPC Dashboard sheet** (opens in a new tab):
   `https://docs.google.com/spreadsheets/d/1qnYMVQYwkvQ5MZTslNyoDZ6dbNUFDWqG94VnrP7nU_E/edit?gid=1453756721`

### The wiring — measured 2026-08-27, do not re-derive

| Step | Where |
|---|---|
| the partial | new `src/html/tab-golden-period.html`; copy the shell of `tab-projects-view.html` — `<div class="tab-pane fade" id="pills-golden-period" role="tabpanel">` + `.about-section-header` / eyebrow / title / lead |
| include it | `index.html`, beside the other `<include src="./src/html/tab-*.html" />` lines (~line 354) |
| the route | `PATH_ROUTES` in `src/js/main.js` (~line 385): `{ path: '/tools/golden-period', tab: 'pills-golden-period-tab' }`. Exact match, so no regex branch needed |
| the ฝ่าย card | `DEPT_DEFS.admin.tools` in `src/js/departments.js` — `kind: 'path'`. **Dept keys are `admin digital academic strategy media rt`**; ฝ่ายบริหารองค์กร is `admin`, which already holds หนังสือโครงการ |
| the launcher | `src/html/tab-tools.html` — ⚠️ **this is a hand-maintained SECOND copy of the dept tool list.** Adding here makes a third home for one fact. Add it, and **write the differential test in the same commit** (every `DEPT_DEFS` tool must appear in the launcher) so the next person is stopped rather than warned |
| the note | `PENDING` in `src/data/changelog.js` — a student WILL notice this. Plain Thai, no table names |

⚠️ **UNVERIFIED, check first:** where the `pills-*-tab` *buttons* are declared
(`navbar.html`? a hidden tab list?). Every other tab has one; find the pattern
before writing the partial, or the route will resolve to a tab that cannot be
activated.

**It needs a DEPLOY** (`skills/deploy-vm.md`, VPN). Batch it with anything else
pending — each deploy is ~90 s.

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
- **Golden Period is un-started.** `docs/DEPT-TOOLS.md` §13 has the order; the
  first code step is the one-source tool registry, because `DEPT_DEFS` in
  `src/js/departments.js` and `src/html/tab-tools.html` are two hand-maintained
  copies of one list today.

## Next time I have an hour

- The project board (the last outstanding piece of `TEAM-WORKFLOW` phase 0).
- Decide whether previews are per-pull-request or **one always-on dev site** —
  the owner said "the dev server", singular, which is the cheaper shape.
