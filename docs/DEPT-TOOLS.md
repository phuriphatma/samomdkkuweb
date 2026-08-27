# เครื่องมือฝ่าย — how a ฝ่าย gets a tool onto samoweb without IT writing it

> ## ⛔ STATUS: NOTHING HERE IS BUILT. This is a design, written 2026-08-27.
>
> There is **no `src/data/tools.js` registry, no `public/embed/`, no tool frame,
> no `check:embeds`, no boundary CI, no tool-request template, no starter kit,
> no Golden Period route.** Do not read any sentence below as a description of
> something that exists.
>
> Sibling document: **`docs/TEAM-WORKFLOW.md`** is the plan for *developers*
> (dev database, previews, migrations, review). This file is the plan for
> *non-developers* — ฝ่าย members who build with Claude and cannot read the
> code they ship. The two overlap at exactly one point (§9) and must not be
> merged: the developer plan is about giving people MORE access safely; this
> one is about giving people LESS access and still letting them ship.
>
> **This file is the authoritative record.** If a rendered artifact copy
> disagrees with it, this file wins.

---

## §0. The problem, measured — not assumed

Trigger: ฝ่าย wants **Golden Period Calendar (GPC)** on the site — a per-ชั้นปี
"how likely are students free" heat map, sourced from a Google Sheet, plus the
exam-schedule Google Calendar. Their own proposal, verbatim: *"ให้ใช้ Claude
กลางเขียน UI มาเอง แล้วเดี๋ยวไอทีเอาใส่ให้"*, and the fallback *"ถ้าทำ golden
period ไม่ได้จริงๆ ก็คงจะเป็นแค่ลิ้งไปชีท"*.

What is actually true today (read from the code on 2026-08-27):

| Fact | Where | Consequence |
|---|---|---|
| Dept tool cards are a hardcoded JS object | `DEPT_DEFS` in `src/js/departments.js` | every card change is a commit |
| The launcher repeats the same list by hand | `src/html/tab-tools.html` | two copies of one fact — class 6 in `.claude/rules/mistakes.md`, already live |
| Routes are a hardcoded array | `PATH_ROUTES`, `src/js/main.js:385` | a new page is a code change |
| Only the owner can deploy | `skills/deploy-vm.md`, needs VPN | merge ≠ live; ~90 s per deploy, batched |
| No preview URL | `docs/TEAM-WORKFLOW.md` §8 phase 3, not built | a contributor cannot see their work on the real site |
| Five `write` collaborators, 16 past PRs | GitHub, measured 2026-08-26 | the PR road exists and has been driven |
| CI is not blocking | `required_status_checks` 404 | a red PR can be merged today |

So the request is not "can IT build GPC" — IT can, in an afternoon. The request
is **"can a ฝ่าย own a page and keep changing it without spending IT's time
each round"**, because the stated pain is not the first build, it is the
**tenth edit**.

📌 **Name the real cost.** The expensive part of "IT เอาใส่ให้" is not the
integration. It is that integration is a **rewrite**, and a rewrite restarts the
edit loop with IT holding the pen. Every subsequent "ขอแก้นิดนึง" then costs an
IT session. Any design that leaves IT holding the pen has not solved anything,
however good its documentation is.

---

## §1. The decision

**Three lanes, chosen by what the change can reach — not by who is asking.**

| Lane | What it is | Who does it | Blast radius | Cost per edit |
|---|---|---|---|---|
| **A — Content** | a link, a card, a cover image, a text block, a Google embed | ฝ่าย, through data (later: a GUI editor) | one card | minutes, no thought |
| **B — Embedded tool** | a real page with its own UI, running in a sandboxed frame | **ฝ่าย, with Claude** — IT reviews and merges | **the frame, and nothing else** | one review + the next deploy |
| **C — Native feature** | anything reading the database, the signed-in user, uploads, notifications, schema | IT only | the whole app | as today |

**The sentence that makes this work:**

> **IT owns the chrome. The ฝ่าย owns the inside of the frame.**
> The boundary of the iframe is also the boundary of the argument.

That is deliberate. This team is fussy about UI — and it is *their* UI to be
fussy about. Handing them the inside of a box removes IT from the aesthetic
conversation entirely, which is where most of the wasted rounds go.

**Escalation rule, stated so it is not re-argued per request:**
*anything that can be Lane A must not become Lane B; anything that can be Lane B
must not become Lane C.* "แปะลิ้งไปชีท" is Lane A. A heat-map calendar drawn
from that sheet is Lane B. "แสดงว่าโครงการไหนชนกัน" reads `project_documents`
and is Lane C — IT, on IT's schedule.

### Why not the two options that were on the table

- **"They send it, IT incorporates it"** *(their proposal)* — this is Lane B
  with no contract. Without a contract, incorporation means rewriting their
  page into the app's idioms, and then IT owns it forever. It optimises the
  first delivery and loses every one after.
- **"They open pull requests like the dev team"** *(the other proposal)* — a PR
  is a delivery mechanism, not a boundary. On its own it does not stop a page
  from breaking the app, and `CODEOWNERS` routes everything interesting to the
  owner anyway. **Keep the PR, add the boundary** — that is §3 and §8. And
  accept that most of them will not manage git (§10.2); the boundary is what
  makes the non-git intake safe too.

---

## §2. Lane A — content, no code

Everything a ฝ่าย page currently shows — tool cards, Guidebook covers, Canva
links, Google Forms (see the live ฝ่ายบริหารองค์กร page) — is **content**, and
none of it should require a developer.

Step 1 (this plan): move the list out of code into **one registry**,
`src/data/tools.js`, read by all three consumers:

```
src/data/tools.js  ──▶  the ฝ่าย detail page  (departments.js)
                   ──▶  the launcher grid      (tab-tools.html, generated)
                   ──▶  the router             (PATH_ROUTES)
```

One entry:

```js
{
  slug: 'golden-period',
  dept: 'admin',                 // which ฝ่าย page it appears on
  kind: 'embed',                 // 'tab' | 'path' | 'external' | 'embed'
  title: 'Golden Period Calendar',
  desc: 'ดูช่วงที่นักศึกษาแต่ละชั้นปีน่าจะว่าง ก่อนเลือกวันจัดกิจกรรม',
  icon: 'bi-calendar-heart',
  color: 'var(--dept-admin)',
  route: '/tools/golden-period',
  visibility: 'signed-in',       // 'public' | 'signed-in' | 'permission:<key>'
  owner: 'ฝ่ายบริหารองค์กร — <ชื่อคน>',   // a PERSON, not a ฝ่าย (§10.7)
  source: 'https://docs.google.com/spreadsheets/d/1qnYMV…',
}
```

⚠️ **This refactor is a prerequisite, not an optional tidy-up.** Adding GPC to
`DEPT_DEFS` and `tab-tools.html` by hand makes a **third** hand-maintained copy
of one list, in a repo whose most repeated bug class is exactly that. Do the
registry first, with a differential test asserting the launcher and the ฝ่าย
page render from the same source. It is also the exact thing the future
per-ฝ่าย GUI editor needs (§12).

Step 2 (later, separate work): the registry moves to a table with an editor, and
Lane A becomes self-serve with no deploy at all.

---

## §3. Lane B — the embedded tool (the mechanism)

### What the ฝ่าย delivers

**One self-contained HTML file that works when you double-click it.**

That is not a compromise — it is the artifact a vibe-coding session actually
produces, it is the one they can verify themselves without installing anything,
and it is the one that needs no translation. **Match the contract to what they
can make, instead of demanding they make what the codebase wants.**

```
public/embed/golden-period/
  index.html        ← their file, verbatim
  data.js           ← the numbers, as a plain JS object
  README.md         ← who owns it, where the data comes from, who updates it
```

### How it appears on the site

`/tools/golden-period` opens a normal tab with the site's header, a back link
and a title bar (IT's chrome), whose body is:

```html
<iframe src="/embed/golden-period/"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
        title="Golden Period Calendar" loading="lazy"></iframe>
```

**`allow-same-origin` is deliberately absent.** Without it the frame runs on an
**opaque origin**: it cannot touch the parent DOM, cannot read the Supabase
session, cannot read cookies or `localStorage`, and cannot navigate the top
window. That single omission is the entire security model — which is why it is
guarded by a test (§8), not by a comment.

Height: the frame posts its height on a `ResizeObserver`; the parent verifies
`event.source === iframe.contentWindow` (the origin is `null`, so origin cannot
be the check) and sets the height. If no message arrives within 2 s, the frame
falls back to `min-height: 70vh` and scrolls internally. **Six lines, in the
starter template, written once, reused by every tool.**

### What the frame cannot do — say this in the brief, not in review

- no sign-in, no user name, no permissions, no database — **that is Lane C**
- no `localStorage` / `sessionStorage` (they *throw* on an opaque origin)
- no `parent.` / `top.` / `window.opener`
- no npm packages, no build step
- `fetch` to an external host sends `Origin: null` and most APIs will refuse —
  **so the data lives in `data.js`, in the folder** (this is a feature: the page
  keeps working when Google is slow, and the data is reviewable in the diff)

### Why a frame instead of a module in the app bundle

| | sandboxed frame *(chosen)* | native module in the bundle |
|---|---|---|
| Port cost per tool | ~0 — the file ships as written | a rewrite, every time |
| Cost per edit | swap a file, next deploy | an IT code review of Claude-written JS |
| CSS bleeding into the app | **impossible** | a real risk; needs prefix linting |
| A crash inside | contained to the frame | needs try/catch + lazy import to stay contained |
| Looks native | good, not perfect | perfect |
| Can read app data | **no** | yes |

The right-hand column is Lane C, and it is designed in §4 — built when a tool
actually needs it, not before.

---

## §4. Lane C — the native module contract (designed, deliberately not built)

When a tool outgrows the frame (needs the signed-in user, the database, uploads,
notifications), it is promoted, and **IT writes it**. The shape, recorded now so
the promotion is not a redesign:

- `src/tools/<slug>/index.js` exports `mount(root, ctx)` / `unmount()`
- dynamic-imported by the router, wrapped in try/catch → a broken tool renders
  "เครื่องมือนี้ขัดข้อง" and never kills boot (`boot-watchdog.test.js` exists
  because a module that never loads leaves a page dead and animated)
- `style.css` — every selector must start `.tool-<slug>`, CI-checked
- `ctx` is a frozen, documented surface (`escHtml`, `formatThaiDate`, the tint
  helpers, a read-only `user`). **Never the supabase client** — a tool that
  needs rows gets a purpose-built read function reviewed by the owner, so the
  authorization question is asked once, at the right altitude.
- one render test, mandatory

**Do not build this until a tool needs it.** Writing it now is a guess about a
feature that has not been requested.

---

## §5. Golden Period, concretely

### v0 — this week, IT, ~1 session (after the §2 registry)

`/tools/golden-period` exists as a real route and a real card on ฝ่ายบริหารองค์กร,
containing:

1. **วิธีอ่านค่า** — the four bands (% สูงมาก / สูง / ปานกลาง / ต่ำ) as coloured
   chips, in the site's own colours. This is the part people actually need
   explained, and it is three sentences of Thai.
2. **The Google Calendar embed** — `samomdkku.sod@gmail.com`, `ctz=Asia/Bangkok`.
   ⚠️ mobile: the default `MONTH` view is unreadable at 390 px — use `mode=AGENDA`
   under 768 px and `MONTH` above. Test both, this repo has a mistakes file full
   of the alternative.
3. **A button to the GPC Dashboard sheet**, opening in a new tab.

**v0 is not a fallback — it is version 0 of the same URL.** When their page
arrives it replaces the body of this route, and every link anyone already shared
still works. That is the whole reason to give it a route on day one instead of
pasting a sheet link into a card.

### v1 — theirs, whenever they finish

They fill in the request issue (§6), take the starter folder, tell Claude what
they want, and hand back `index.html` + `data.js`. IT reviews against §8 and
merges. **IT does not redesign it.**

### Visibility — decided, and reversible in one line

**`visibility: 'signed-in'`.** Their own words were *"มันข้อมูลเฉพาะกลุ่มเกิน"*,
and this is internal planning data about when students are busy.

⚠️ **State this honestly and do not let it be misremembered:** a client-side
gate **hides the tab, it does not protect the data.** Anything shipped in
`public/embed/` is fetchable by anyone who knows the URL. If the numbers must
truly not leave the club, they belong behind RLS — which makes the tool Lane C.
The recommendation is that percentages of free time do not meet that bar. The
owner can flip this to `'public'` by editing one field.

---

## §6. Intake — the format they send to IT

Two documents, both in Thai, both written for someone who does not code.

**1. `.github/ISSUE_TEMPLATE/tool-request.md`** — filing this issue is how Lane
B starts. It asks, and refuses to be vague about:

- ชื่อเครื่องมือ + ฝ่าย + **ชื่อคนที่ดูแล** (a person, not a ฝ่าย)
- ใครใช้ (นักศึกษาทุกคน / เฉพาะคนที่ล็อกอิน / เฉพาะฝ่าย)
- ข้อมูลมาจากไหน และ **ใครเป็นคนอัปเดต ทุกกี่เดือน**
- ต้องใช้ข้อมูลจากในเว็บไหม (ชื่อผู้ใช้ / โครงการ / คำสั่งซื้อ) — *ถ้าใช่ นี่คือ
  Lane C และคิวคืองาน IT*
- ภาพ mock ตอนเปิดบนมือถือ
- เดดไลน์จริง

This is also the **scope anchor**. When round eleven arrives, the answer is
"เปิด issue ใหม่" and the original issue is the record of what was agreed. That
is the only real defence against endless customisation, and it is social, not
technical (§10.3).

**2. `docs/tools/BRIEF-TEMPLATE.md`** — the text they paste into their own
Claude. It carries:

- the hard rules (§3: one file, no packages, no login, data in `data.js`,
  no `localStorage`, no external scripts)
- **`TOKENS.css`** — the site's real variables (`--brand-primary: #105922`,
  `--brand-orange: #FF6F30`, the `--dept-*` scale, Noto Sans Thai / Prompt)
- the six-line height-report snippet, marked **DO NOT EDIT**
- "ทำให้อ่านได้ที่ความกว้าง 390px ก่อน แล้วค่อยขยาย"

**`public/embed/_starter/`** is a working copy of all of this — a page that
already looks like the site before they change a word. **This is the
highest-leverage artifact in the whole plan.** Most rounds of "ไม่สวย / ไม่
เข้ากับเว็บ" exist because the returned page never matched; a starter that
matches on line one deletes those rounds before they happen.

### Delivery — two roads, both supported

| | Road 1 — pull request | Road 2 — attach the file |
|---|---|---|
| Who | whoever can run git (realistically 1 of 5) | everyone else |
| How | branch `tool/<slug>`, boundary CI (§8), one approval | attach `index.html` + `data.js` to the issue; IT runs `npm run tool:import` |
| IT time | review only | ~15 min, mechanical, **no design decisions** |

**Road 2 is the one that will actually get used, and that is fine.** It is cheap
*because* the contract shape is already the shape of their artifact. Do not
design as though Road 1 is the main path (§10.2).

---

## §7. What Claude context the contributors get — and what they must NOT get

**Share the CONTRACT, not the CONTEXT.**

| | Give them | Why |
|---|---|---|
| `public/embed/<slug>/CLAUDE.md` | ✅ ~40 lines: the rules of §3, the tokens, "you may edit only the files in this folder" | scoped, small, and it is the only thing their session needs |
| `docs/tools/BRIEF-TEMPLATE.md` | ✅ | it is the prompt |
| `STATE.md` | ❌ **no** | 1,354 lines of deploy handoff, RLS invariants and open bugs. A contributor session that reads it will try to *act* on it — apply a migration, verify a bundle, deploy. Cost and risk, no benefit. |
| `.claude/rules/mistakes.md`, `docs/mistakes/` | ❌ no | written for people editing `auth.js` |
| The repo's personal auto-memory | ❌ **cannot** | it is per-machine and per-clone-path and is not in git (`docs/TEAM-WORKFLOW.md` §6.3). Five people have five disjoint memories. |

⛔ **The rule, restated from the developer plan and true twice over here: if
another person needs to know it, it goes in the folder.** Anything a
contributor's Claude "learns" about their tool goes in
`public/embed/<slug>/README.md`, or it is lost the moment they `/clear`.

---

## §8. What CI must enforce — the guards, not the good intentions

This repo's standing rule is that **writing a hazard down does not make anyone
check it**. Four checks, all cheap:

1. **`check:embeds`** — for every `kind:'embed'` registry entry: the folder and
   `index.html` exist; the file contains no `<script src="http…">` outside a
   named allowlist; no `parent.` / `top.` / `localStorage`; a `README.md` names
   a human owner.
2. **The sandbox property test** — assert the rendered frame markup carries
   `sandbox` **without** `allow-same-origin`. This is the guard that matters:
   the isolation is one attribute, and a future refactor that "fixes" a frame by
   adding `allow-same-origin` silently deletes the entire security model.
   *Falsify it: add `allow-same-origin`, watch it go red, restore.*
3. **Boundary CI on `tool/*` branches** — fail the PR if `git diff --name-only`
   touches anything outside `public/embed/<slug>/**` plus **one** entry in
   `src/data/tools.js`. No `package.json`, no `src/js/`, no `supabase/`. This is
   what makes "let them PR" safe, and it is ~15 lines of workflow.
4. **The registry differential test** — the launcher grid and the ฝ่าย detail
   page must render from the same source, asserting the property, never the
   list (a guard written from the same list as the code passes a wrong list).

Plus the one already owed from `docs/TEAM-WORKFLOW.md` §8a: **make CI blocking**
(`required_status_checks`). Today a PR with the whole suite red can be merged —
and a contributor PR is precisely the case where nobody reads the diff closely.

`CODEOWNERS` gains one line: `/src/data/tools.js @phuriphatma`. That is the one
place a tool becomes reachable and receives its visibility gate; the owner
reviewing exactly that line is cheap and high-value. `public/embed/**` gets **no**
owner line — peer approval, on purpose.

---

## §9. Where this meets the developer plan

One point only: **preview URLs** (`docs/TEAM-WORKFLOW.md` §8 phase 3).

A contributor cannot see their tool on the real site until the owner deploys.
That is the loop that will generate the most nagging.

📌 **A useful sequencing fact: a Lane-B tool needs no database.** Phase 3 was
scheduled after phase 1 (the dev Supabase project) because the app needs data —
but an embed preview is static files. **A preview job restricted to `tool/*`
branches can be built ahead of phase 1**, and unblocks contributors months
earlier than the full plan does. It is the single highest-value thing to pull
forward.

Everything else stays: they never deploy, and merge ≠ live. Say the expectation
out loud in the docs — *"ขึ้นเว็บจริงในรอบ deploy ถัดไป"* — or it will be asked
every time.

---

## §10. Scrutiny — where this plan is weak

Written against the plan, not for it.

**10.1 — The cost is front-loaded onto IT, and GPC may be the only tool ever
built.** Registry refactor + frame + guards + starter + docs ≈ **2 sessions**
before a single contributor page exists. Writing GPC by hand is ~2 hours.
*The plan is only correct if a second and third ฝ่าย actually follow.* The owner
believes they will. If that belief is wrong, this is over-engineering, and the
honest cheaper answer is: build GPC v0, paste the sheet link, stop.
**Decision rule: build §2 + §3 only. If nobody files a second tool request
within a term, do not build §4, §6's Road 1, or §9.**

**10.2 — The pull-request lane will probably die, and the plan half-assumes
it.** They do not know code; git, node and a GitHub account are three walls
before line one. Realistically Road 2 (attach the file) carries everything.
That is designed for — but it means **IT is still in the loop on every single
edit**, at ~15 minutes each. Fifteen minutes is not zero. If a ฝ่าย iterates
ten times, that is 2.5 hours of IT time the plan quietly spends. Mitigation is
the preview URL (§9) plus one onboarding session to get *one* person per ฝ่าย
onto Road 1 — and if that fails, accept the 15 minutes as the price and say so.

**10.3 — This does not stop the edit requests. It only changes who pays.**
The mechanism that limits round eleven is a *sentence the owner has to say*:
"หลัง v1 ทีม IT รับผิดชอบแค่ตรวจกับขึ้นเว็บ — แก้ข้างในกล่องเป็นของฝ่าย".
No CI check enforces that. If the owner keeps saying yes, the bottleneck
returns wearing a new hat, and the whole plan is decoration.

**10.4 — The biggest real risk: the owner will not tolerate an off-brand page.**
This repo went six rounds on the copy of one sign-in modal. A contributor page
inside a frame *will* look slightly foreign — different spacing, different type
scale, a colour that is nearly right. If the owner then edits it, they have
taken the pen back and rebuilt the exact bottleneck this design exists to
remove. **This must be answered before building: can you live with a page on
your site that you did not design?** If the answer is no, the correct design is
not this one — it is Lane A plus IT building everything, with a hard quota
("one tool per ฝ่าย per term"), which is a legitimate choice and much cheaper.

**10.5 — Sandboxing costs exactly the features they will ask for next.** No
login, no data, no personalisation. The first "ให้มันจำว่าเราเลือกอะไรไว้" or
"ให้ดูว่าโครงการชนกันไหม" promotes the tool to Lane C, which is IT work. Expect
that request within months; the frame is not a permanent home for a successful
tool.

**10.6 — The visibility gate is a hide, not a lock** (§5). Written twice on
purpose, because "signed-in" reads like a security control and is not one.

**10.7 — The data will rot, and rot lands back on IT.** A sheet whose column
someone renames turns the page blank, and the person who reports it will report
it to IT. Defences: the data lives in `data.js` in the folder (so a break is a
*commit*, not a surprise), the README names a **person**, and the page renders
a visible "ข้อมูล ณ วันที่ …" stamp. If a tool's README names a ฝ่าย instead of
a human, reject the PR — a ฝ่าย cannot be asked a question.

**10.8 — Three assumptions in §3 are unverified and must be measured before
building** (§11). If the height channel misbehaves on iOS Safari, the frame
degrades to a fixed-height scroller — usable, uglier — and 10.4 gets harder.

**10.9 — The registry is an interim shape.** §12's GUI editor moves it from a
file to a table, and half of §2 is rewritten when that happens. It is chosen
anyway because a file-based registry is a *strict improvement* over three
hardcoded copies, and because the entry's fields are the columns that table
would have. But do not describe it as final.

**10.10 — Two tools do not fit this taxonomy, and pretending they do is how
Lane C gets bypassed.** A tool that *collects* anything from students (a form, a
vote, a sign-up) is Lane C no matter how simple it looks — it needs a table, RLS
and a retention answer. And a tool that *shows* anything about a named person is
Lane C too. Write both exclusions into the request template, or the first
"แค่ฟอร์มเล็กๆ" will arrive as an embed with a Google Form iframe and a
copy-pasted webhook in it.

---

## §11. Verify before building — do not assume

1. **Sandboxed-frame height on real iOS Safari.** `postMessage` from an opaque
   origin + `ResizeObserver` on iPad, and a real iPhone. *This repo has been
   caught assuming WebKit behaviour from Playwright.* Fallback path must be
   tested too — the SLOW-BUT-FINE case, not only the broken one.
2. **nginx serves `/embed/<slug>/`** via `try_files $uri $uri/` — confirm the
   directory index resolves on the VM, and confirm `deploy.sh`'s
   `rsync --delete` (non-assets are mirrored) treats the folder as expected.
3. **Frame + `Cache-Control: no-cache, must-revalidate`** — `public/_headers` is
   Cloudflare-only and reaches nothing on the VM; the nginx `location /` block
   is what applies. Check an updated embed actually replaces a cached one.
4. **`/tools/<slug>` must not collide with `/embed/<slug>/`** — keep the SPA
   route and the static folder on *different* prefixes, exactly as written here.
5. **The GPC sheet's shape** — before promising a heat map, read the actual
   sheet. Whether it is per-week, per-day or per-block changes the UI, and it is
   the ฝ่าย's data to explain, not IT's to reverse-engineer.

---

## §12. Forward compatibility with the per-ฝ่าย GUI editor

The owner's separate, later ask is a GUI for each ฝ่าย to customise its own page.
**Do not build it here.** One decision now keeps it cheap later:

> **Content is DATA. Tools are CODE. Draw the line now.**

Cards, links, covers, text, ordering, colours → registry fields → a table → an
editor. Anything with behaviour → a frame or a module → a review. When the
editor arrives it edits rows and never touches `public/embed/`, and Lane A
becomes fully self-serve with no deploy at all. If instead cards stay hardcoded
in `departments.js`, the editor's first task is un-hardcoding them — which is
§2, paid for later at a worse time.

---

## §13. Build order

| # | Step | Effort | Gate |
|---|---|---|---|
| 0 | Answer §10.4 — *can the owner live with a page they did not design?* | 0 | **if no, stop; build GPC v0 only and set a quota** |
| 1 | Verify §11.1–11.4 on the VM and a real phone | ~30 min | none |
| 2 | `src/data/tools.js` registry + differential test; migrate `DEPT_DEFS` and `tab-tools.html` | ~1 session | 1 |
| 3 | GPC **v0**: route, card, วิธีอ่านค่า, calendar embed (AGENDA on mobile), sheet button | ~1 session | 2 |
| 4 | The frame: `/tools/<slug>` embed host, height channel, sandbox test, `check:embeds` | ~1 session | 1 |
| 5 | Starter kit + `BRIEF-TEMPLATE.md` + `TOKENS.css` + tool-request template | ~1 session | 4 |
| 6 | Boundary CI + `CODEOWNERS` line + **make CI blocking** (`TEAM-WORKFLOW` §8a) | ~30 min | 4 |
| 7 | Preview builds for `tool/*` branches only (pulled forward from `TEAM-WORKFLOW` phase 3) | ~2 h | 6 |
| 8 | GPC **v1** — their file, imported | ~15 min | 5, and them |

Steps 2 + 3 are one batch and one deploy. Steps 4–6 are the second.
**Step 0 is not a formality** — it is the only step that can cancel the rest.

---

## §14. What must be corrected elsewhere when this ships

Left alone deliberately until the phase lands — a document that describes a plan
as though it were real is the failure this repo keeps paying for.

- **`CONTRIBUTING.md`** — "touch zones" gains `public/embed/**` (peer approval)
  and `src/data/tools.js` (owner).
- **`CLAUDE.md`** — the file-placement table gains a row: *a ฝ่าย tool →
  `public/embed/<slug>/`, see `docs/DEPT-TOOLS.md`*.
- **`README.md`** — "Key features", only when GPC v0 ships (a student notices it).
- **`src/data/changelog.js`** — a `PENDING` entry in the same commit as GPC v0,
  in plain Thai: what you can now see, and what you no longer have to open a
  sheet to find out.
- **`docs/TEAM-WORKFLOW.md`** — §8 phase 3 gains the note that a `tool/*`-only
  preview can be built ahead of phase 1 (§9 above).
- **`docs/CONTEXT.md`** — only at step 4, when the embed host is real plumbing.
