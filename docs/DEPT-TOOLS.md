# เครื่องมือฝ่าย — how a ฝ่าย gets a tool onto samoweb without IT writing it

> ## ⚠️ STATUS: the WORKFLOW is built. The TOOLS are not. Written 2026-08-27.
>
> **Built and verified the same day** — these are real, do not re-plan them:
> branch protection now requires the `build` check AND code-owner review
> (measured back from the API, `enforce_admins` deliberately still `false`);
> `.github/CODEOWNERS` names the contributor paths; the tool-request template;
> `skills/onboard-a-contributor.md`; the `CONTRIBUTING.md` and pull-request
> template updates.
>
> **Still not built** — do not read any sentence about these as a description of
> something that exists: **no `src/data/tools.js` registry, no `public/embed/`,
> no tool frame, no `check:embeds`, no boundary CI, no `src/js/data/` doors, no
> starter kit, no Golden Period route.**
>
> Sibling document: **`docs/TEAM-WORKFLOW.md`** is the plan for *developers*
> (dev database, previews, migrations, review). This file is the plan for
> *non-developers* — ฝ่าย members who build with Claude and cannot read the
> code they ship. The two overlap at exactly one point (§9) and must not be
> merged: the developer plan is about giving people MORE access safely; this
> one is about giving people LESS access and still letting them ship.
>
> **This file is the authoritative record.** A rendered Thai version was
> published as an Artifact for the owner to read on a phone
> (`https://claude.ai/code/artifact/a5058409-0c45-4adb-bec2-27cb1b53bd36`); it
> is a COPY and may be stale. If the two disagree, this file wins.

---

## §0a. Decisions the owner made — DO NOT RE-LITIGATE

Decided 2026-08-27, after the first draft of this file was read. Several reverse
what that draft recommended. Listed with the reasoning so a later session does
not "fix" them back.

| # | First draft proposed | **Decided** | Why |
|---|---|---|---|
| D1 | Contributors attach an HTML file to an issue; IT imports it (the PR road was written off as "will probably die") | ❌ **They learn GitHub. Pull requests are the road, and the attachment road is a per-person exception, not a lane.** | *"it's tiring to handle files sent… i'll just make them learn github"*. Correct on both halves: file shuttling keeps IT in the loop on every edit forever, and it is not how anyone works. **The draft's §10.2 was a prediction about these five people, not a statement about practice, and the owner is entitled to change the prediction by onboarding them.** |
| D2 | ฝ่าย tools never touch user data — the sandboxed frame excludes it by construction | ❌ **Data-backed tools are IN SCOPE.** | *"this department sometimes want to touch user data, handle database"*. A design that excludes exactly the requests that hurt most has not removed the bottleneck, it has renamed it. |
| D3 | *(new, proposed in response to D2 — needs the owner's yes)* | ⏳ **The owner writes the data door; the ฝ่าย writes the room around it.** | Authorization is the single thing this repo has repeatedly got wrong (most of the write-ups in `docs/mistakes/authz-*.md`, and class 4/5 of the seven). UI is not. Splitting them puts the reviewed, tested, IT-owned part around the *access decision* and leaves everything else — layout, colour, the ten rounds of edits — with the ฝ่าย. |

| D4 | The ฝ่าย get their own intake, separate from the dev team's | ❌ **One workflow. They work exactly like the dev team.** | *"i want them to be like how dev team works"*. Two processes for one repo is the drift class this repo documents, in prose. **See §0b — this is the biggest structural simplification in the file, and it comes from the owner.** |
| D5 | Every contributor PR is reviewed by the owner personally | ❌ **Claude reviews first; the owner still approves.** | *"i'll just have claude do it"*. Correct as a FILTER — it makes the human's 30 seconds honest by handing them a clean diff. It is not correct as the GATE on anything that can reach student data (§10.4). |
| D6 | Onboard all five | ❌ **One person, taught properly.** | *"i have to teach them only one person"*. Cost drops from ~4 hours to 45 minutes. **New risk created — see §10.5; one person is a bus factor, and SAMO turns over every year.** |

| D7 | Step 0 was a gate: *"can you live with a page you did not design?"* | ❌ **Wrong question, retired.** It is a HABIT, not a decision. | *"i don't understand this when i can just make who want to develop this project test in local, test in developer server and i'll just push into main server later"*. Correct, and it exposes an error in the draft: **control was never at stake.** Nothing merges without approval and nothing ships without the owner's deploy. The real risk was always narrower — that the owner *personally does the polishing*, which costs a session and takes the pen back. The remedy is one sentence in `skills/onboard-a-contributor.md`: **send it back, do not fix it yourself.** It is no longer a gate on anything. |

⚠️ **What D1 changes about this document**: the frame (§3) stops being "the
mechanism" and becomes **the fast lane** — the class of tool that can be
approved in thirty seconds because it cannot reach anything. §4 stops being
"designed, not built" and becomes the road most data-backed requests take.

---

## §0b. "Like the dev team" — one workflow, and the difference lives in CODEOWNERS

D4 is right, and it deletes a layer of this document. **The lanes in §1 should
not be a process.** A separate intake for ฝ่าย contributors would be a second
implementation of one workflow, and this repo's most expensive recurring bug is
two implementations of one rule drifting apart — including in prose, which
`STATE.md` has already done to itself.

**The reconciliation, and it is exactly what professional orgs do:**

> **Same workflow for everybody. Different paths they may merge into.**
>
> A frontend engineer at a large company uses the identical pull-request
> pipeline as the payments team — and cannot merge a change to the payments
> service without that team's approval. That is not a second-class workflow. It
> is one workflow plus **ownership**.

So: branch, commit, open a PR, CI runs, review, squash merge, the owner deploys.
Identical for the dev team and for a ฝ่าย member. **`CODEOWNERS` carries the
entire difference**, and the lanes in §1 become a *description of what a PR
touches*, not a process anyone has to follow:

| Path | Who must approve | Which lane that makes it |
|---|---|---|
| `public/embed/**` | any collaborator | B — it can reach nothing |
| `src/data/tools.js` | **owner** | A — one line decides what is reachable and who may see it |
| `src/tools/**` | **owner** | C — it runs inside the app |
| `src/js/data/**` (the doors) | **owner** | D — it decides who sees what |
| `auth.js` · `db.js` · `notify.js` · `uploads.js` · `supabase/` · `server/` · `appscript/` · `tools/` | **owner** | D — already listed today |

⚠️ **This only works once `require_code_owner_reviews` is `true`.** Measured
2026-08-27: it is **`false`**, so every line above is advisory and any one of the
five collaborators can merge into any of those paths. §10.1.

📌 **The consequence for planning, and it is the useful one:** this is not a
second project beside `docs/TEAM-WORKFLOW.md`. It is **the same project with
more users**. Build phases 0–3 of that plan and adding ฝ่าย contributors is
nearly free. What remains genuinely new here is only: **the frame** (§3), **the
doors** (§4), **the request template and starter kit** (§6), and **the guards**
(§8). Everything else in this file is `TEAM-WORKFLOW` restated — and when those
phases land, delete the restatement rather than maintaining it twice.

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

**Three lanes, chosen by what a change can reach — not by who is asking.**
Everything arrives the same way: **a pull request** (§6). The lanes decide how
much review that pull request needs, and who has to be the one who gives it.

| Lane | What it is | Who writes it | What it can reach | Review needed |
|---|---|---|---|---|
| **A — Content** | a link, a card, a cover image, a text block, a Google embed | ฝ่าย, editing data | one card | any peer, seconds |
| **B — Framed tool** | a page with its own UI, running in a sandboxed frame | **ฝ่าย, with Claude** | **nothing outside the frame** | any peer, ~30 seconds |
| **C — Data tool** | a page that reads real app data through a door the owner wrote | **ฝ่าย, with Claude** | only the named data functions it was given | **the owner, properly** |
| **D — Platform** | the data door itself, RLS, migrations, auth, uploads, notifications, deploy | **owner / IT only** | everything | — |

**The line that moved, and it is a better line than the first draft's:**

> The first draft drew the boundary at **"can it run code in my app"**.
> The real boundary is **"can it decide who sees what."**
>
> Code can be read, tested and reverted. An authorization decision fails
> silently, in production, on someone else's data — and it is the mistake this
> repo has made most often, by people who *do* know the codebase.

So a ฝ่าย may write a page that shows student data. A ฝ่าย may **not** write the
rule that decides which students' data it shows. That rule is a function the
owner writes once, reviews once, and tests once (§4).

### What lane C actually looks like

1. The ฝ่าย opens a tool request: *"เราอยากได้หน้าที่แสดง … ให้ … ดู"*.
2. The **owner writes the door** — one named function that answers exactly that
   question and nothing wider, with the permission rule inside it and a test
   beside it. Perhaps an hour, once.
3. The ฝ่าย builds everything on top of the door: the layout, the filters, the
   colours, the ten rounds of edits. They never see the supabase client.
4. CI refuses any tool file that imports `db.js`, calls `.from(`, or names a
   table (§8).

**The owner is now asked once per data QUESTION, instead of once per EDIT.**
That is the whole gain, and it is the same shape professional teams use: the
platform team owns the API and the access rules; product teams build UI on top
of it and ship on their own cadence.

---

## §1b. What professional teams actually do — because the answer is two answers

The owner's instinct (*"isn't PR just best practice"*) is right, and the honest
industry picture is more useful than a yes:

**For engineers, yes — this is exactly it.** Short-lived branches, pull requests,
`CODEOWNERS`, required status checks, one approval, squash merge, a preview
deploy per PR, and nobody pushing to `main`. This repo already has most of it
(§8a of `docs/TEAM-WORKFLOW.md`); it is two settings away from having it
enforced rather than suggested.

**For non-engineers, no — and this is the part worth taking seriously.** Real
companies do not hand the product repo to the marketing team and review their
code. They give them a different surface:

| What the non-engineer wants | What a professional org gives them | The equivalent here |
|---|---|---|
| change a page's words, links, images | a CMS (Contentful, Sanity, Storyblok) or a page builder | **Lane A**, and later the ฝ่าย GUI editor (§12) |
| a page with its own design | a design system + templates, or an engineer | **Lane B** — the frame is the template |
| **see** the data | a BI tool — Metabase, Looker, Redash — connected to a read-only replica with per-team permissions | **not built, and it should be** (§1c) |
| an internal tool over the data | a low-code platform — Retool, Appsmith, AppSheet — over an API the platform team exposes | **Lane C** |
| **collect** data from people | a form product, or an engineer | Google Forms today; an engineer for anything else |

Two practices from that world are worth stealing outright, and one is worth
refusing:

- ✅ **docs-as-code.** Plenty of serious companies do teach non-engineers git —
  for *content*, reviewed by PR. That is the precedent that says D1 can work.
- ✅ **The platform boundary.** Non-engineers build on an interface, never on the
  database directly. That is §1's moved line, and it is why lane C is safe.
- ❌ **"one approval and merge" applied to product code by people who cannot
  read it.** No professional org does this. What makes their PR process safe is
  everything *around* it — a staging environment, seeded fake data, automated
  tests that block, and a reviewer who is an engineer on that code. Take the PR
  workflow *and* take the things that make it safe, or it is cargo cult (§10).

## §1c. Most "we need database access" requests are not that

Before building lane C for a request, sort it:

- **"we want to SEE the numbers"** — how many orders, how many people per ชั้นปี,
  who has not submitted. **This needs no app code at all.** A BI tool
  (Metabase is free and self-hostable; a read-only Postgres role over the live
  database) answers it, the ฝ่าย build their own charts, and IT is out of the
  loop entirely. **This is probably the single highest-value thing on this whole
  page**, and it is a smaller build than the frame.
- **"we want students to see something about themselves"** — lane C, and it
  needs a door.
- **"we want to collect something from students"** — lane D. A form needs a
  table, an access rule, and an answer to "how long do we keep this". It is
  never a contributor's first pull request, however small it looks.

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

## §4. Lane C — a data tool, and the door it is built on

Reversed by D2: this is no longer "designed, deliberately not built". It is the
road most data-backed requests take, and the ฝ่าย writes the page.

**The door — written by the owner, one per data question:**

```js
// src/js/data/<tool>.js  — OWNER-OWNED. CODEOWNERS routes it here.
// Answers exactly one question, with the access rule inside it.
export async function listGoldenPeriodWeeks() { … }
```

Rules that make the door a real boundary rather than a naming convention:

- it answers **one question**, not "give me the table" — a door that returns
  rows the page does not draw is a door that leaks the ones it does not draw
- the access rule lives **inside** it, and a test beside it proves both
  directions: the person who should see rows sees them, the person who should
  not gets zero. *(A probe that only asserts "denied" cannot tell a working
  guard from a broken service — this repo has paid for that.)*
- RLS still stands behind it. The door is not the only gate; it is the only gate
  a contributor can see.

**The page — written by the ฝ่าย:**

- `src/tools/<slug>/index.js` exports `mount(root, ctx)` / `unmount()`
- dynamic-imported by the router, wrapped in try/catch → a broken tool renders
  "เครื่องมือนี้ขัดข้อง" and never kills boot (`boot-watchdog.test.js` exists
  because a module that never loads leaves a page dead and animated)
- `style.css` — every selector starts `.tool-<slug>`, CI-checked
- `ctx` is a frozen surface: `escHtml`, `formatThaiDate`, the tint helpers, a
  read-only `user`, **and the doors this tool was granted**. Never the supabase
  client.
- one render test, mandatory

⚠️ **A lane-C pull request is a real review, by the owner, not a rubber stamp.**
That is the price of the lane, and it is bounded: the *access* question was
already answered when the door was written, so the review is about correctness
and copy, not about whether student data leaks.

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

### Delivery — pull requests, and an exception

**Decided (D1): every contribution arrives as a pull request.** Not because it
sounds professional, but because the alternative keeps IT inside every edit,
forever, at fifteen minutes a time.

What a ฝ่าย member has to learn is smaller than it sounds — Claude Code does the
git. The real cost is **one-time setup**, not per-edit effort:

| Once per person (~45 min, sitting next to them) | Every time after |
|---|---|
| GitHub account, added as a collaborator | *"claude, เอาที่แก้ขึ้นเป็น PR ให้หน่อย"* |
| Node + the repo cloned | open the preview link, check it |
| `gh auth login` | ask for review |
| **one practice PR that changes one word** | — |

⚠️ **Onboarding is a real task with a real owner, and if it is skipped the road
does not exist.** It is a step in §13, done in person, and the practice PR is
part of it. Someone who has merged one PR will open a second; someone handed a
document will not.

**The exception, not a lane**: a person who genuinely cannot be onboarded
attaches `index.html` + `data.js` to their issue and IT imports it. **Count how
often this happens.** If it is happening often, the onboarding failed — fix
that, do not quietly rebuild the file-shuttling workflow.

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
4. **No tool file may reach the database directly** — CI fails any file under
   `src/tools/**` that imports `db.js` or `auth.js`, calls `.from(`, or names a
   table. A data tool talks only to the doors in `src/js/data/` it was granted.
   *Falsify it: add a `.from('users')` to a tool, watch it go red, restore.*
5. **Every door has a both-directions permission test** in the same commit that
   creates it — allowed sees rows, not-allowed sees zero. A door with only a
   deny test cannot tell a working rule from a broken query.
6. **The registry differential test** — the launcher grid and the ฝ่าย detail
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

Rewritten 2026-08-27 after the owner's counter-proposal (§0a). Written against
the plan, not for it. **Findings measured live from the GitHub API on
2026-08-27, not assumed.**

### The blockers — these are true of the repo TODAY

**10.1 — "I'll just approve" is not what the branch rule says.** Measured:
`required_approving_review_count: 1`, and **any of the five collaborators
satisfies it**. `require_code_owner_reviews` is **`false`**, so `CODEOWNERS` only
*requests* the owner's review — it does not block. Two contributors can approve
each other's pull request into `auth.js` today and merge it, with the owner
never involved. *Fix: `require_code_owner_reviews: true`. One flag.*

**10.2 — CI cannot block anything.** Measured: `required_status_checks` returns
**404 — not enabled**. `build.yml` runs `npm test` + `npm run build` on every
pull request and **nothing enforces the result**. Every guard described in §8 is
decorative until this is switched on: a contributor pull request with the whole
suite red is mergeable. *Fix: a full `PUT` of the protection object including the
`build` check — see `docs/TEAM-WORKFLOW.md` §10a; a `PATCH` cannot add it.*

**10.3 — Right now, a contributor touching data is touching PRODUCTION.**
`CONTRIBUTING.md` says it plainly today: both branches hit the same Supabase
project and the same Discord channels, tick the silent-notify box, and *"ask
Phuri to delete the TEST- rows"*. There is no dev database. So D2 —
"the ฝ่าย sometimes want to touch user data" — currently means **five students
querying live student records from their laptops**, in a repo that is
**public**, where a screenshot in a pull request or a fixture file in a commit
puts a real name and a real รหัสนักศึกษา in git history permanently. Secret
scanning (measured: **enabled**, with push protection) catches API keys. **It
does not catch a student's name.**

> **This is the one hard ordering constraint in the whole document.**
> Lane C cannot open before `docs/TEAM-WORKFLOW.md` phase 1 (the `samo-dev`
> database) exists. Lanes A and B can open immediately — they touch no data.

### The rest

**10.4 — "Just approve" is not free, and it is the cost the counter-proposal
hides.** A pull request whose diff is 400 lines of Claude-written JavaScript,
for a page the owner did not spec, is not a thirty-second approval — it is a
code review, at 11pm, by the one person the plan is trying to unblock. This is
**not an argument against pull requests**; it is the argument for the boundary.
A lane-B pull request that can only touch one folder inside a frame that reaches
nothing is genuinely approvable in thirty seconds. A lane-C one is not, and §4
says so out loud. *The boundary is what makes "I'll just approve" honest.*

**10.5 — One teacher instead of five removes a risk and creates a worse one.**
D6 drops onboarding from ~4 hours to 45 minutes, and the draft's "nobody owns
the teaching" objection largely dies with it. What replaces it is sharper:

- **Bus factor of one.** SAMO turns over every year, and medical students
  disappear into ward rotations without warning. The single person who can open
  a PR *is* the new bottleneck — with less accountability than IT and no
  handover. **Teach two, not one**, and treat the second as insurance, not
  redundancy.
- **The file-shuttling did not vanish, it moved.** Everyone else in the ฝ่าย now
  sends *that person* their files. That is an improvement — it is their problem
  rather than IT's — but do not describe it as solved.
- **Write the onboarding down** as `skills/onboard-a-contributor.md` the first
  time you do it, or the second person costs the same 45 minutes of your
  attention, every year, forever.
- **Time it to the SAMO year.** Onboard the successor *before* the incumbent
  leaves, not after.

**10.6 — An AI review is a filter, not a gate, and four specific things it
cannot do.** D5 is right that Claude should review every contributor PR first —
it is cheap, it catches real bugs, and it hands the human a clean diff, which is
what makes a thirty-second approval honest. But:

1. **It reviews the diff, not the intent.** It cannot know the page was supposed
   to show ปี 4 only. Nobody but the requester and the owner knows the spec.
2. **It cannot verify the access rule from the diff**, because the rule lives in
   the database — the policy, the door's body, who actually holds the
   permission. This repo's own standing rule is *verify from the authority*, and
   the authority is not the pull request.
3. **Claude wrote the PR.** A reviewer sharing the author's blind spots reads
   code that consistently implements the same misunderstanding and finds it
   consistent. **Correlated failure, and it is invisible from inside.**
4. **It fails green.** A review that found nothing looks exactly like a review
   that understood nothing.

> **So the boundary is what decides whether an AI review is enough.** For a
> framed tool the worst case is a broken page inside a box — Claude's review
> genuinely suffices, and any peer can merge it.

📌 **And the doors (§4) are what make "the owner does not read pull requests"
work rather than merely feel efficient.** Objections 1 and 2 above both say the
same thing: the dangerous part is not in the diff. The doors move the dangerous
part **out of the contributor's pull request entirely** — if the access rule
lives in a file only the owner may merge, then a contributor PR *cannot contain
an access decision*, and a reviewer reading only the diff is reading everything
that is there. The design was justified as "who may decide"; it turns out to
also be the thing that makes delegated review sound.

The two residual gaps close cheaply, and both are now shipped:

- **Intent** — the tool-request issue IS the spec, the pull-request template asks
  for the link, and `skills/onboard-a-contributor.md` says to paste the issue
  into the review and compare the diff *to it*.
- **Correlated blind spots** — review in a **fresh** session, never the one that
  helped write the change. Also in the skill.

What does not close: **anything in the `CODEOWNERS` list, and the doors
themselves, the owner reads personally.** That is a small, bounded amount of
reading — one function per data question — and it is the only reading the
workflow actually requires of them.

**10.7 — "Work like the dev team" is currently parity with a DESIGN, not with a
working system.** `docs/TEAM-WORKFLOW.md` opens with ⛔ *nothing here is built*:
no dev database, no preview URLs, no `migrate:status`, and CI does not block. So
today, "like the dev team" means *a team with no test environment and no
enforced checks*. That is not an argument against D4 — it is the reason the
build order now leads with the two protection flags and treats
`TEAM-WORKFLOW` phases 0–3 as the actual dependency (§13).

**10.8 — RETIRED by D7, and the reason is worth keeping.** This finding used to
read *"the biggest risk is the owner — can you live with a page you did not
design?"*, and it was raised three times. It was the wrong shape: the owner
approves every merge and performs every deploy, so **control was never being
given up**. What remains is narrower and is a habit, not a gate — *send it back,
do not fix it yourself* — and it now lives in
`skills/onboard-a-contributor.md` where the person who needs it will actually
read it. **A concern that survives three restatements without ever becoming
actionable is usually mis-stated, not under-emphasised.**

**10.9 — Most "we need the database" requests are cheaper answered elsewhere,
and building lane C first would hide that.** §1c: if the ask is "we want to see
the numbers", a BI tool answers it with no app code, no review and no
contributor near the schema. Build that before lane C, or lane C will be used
for questions that never needed a page.

**10.10 — This does not stop the edit requests. It only changes who pays.**
The mechanism that limits round eleven is a sentence the owner has to say:
"after v1, IT reviews and publishes — the inside is yours". No CI check enforces
it.

**10.11 — Sandboxing costs exactly the features they ask for next**, which is why
D2 was right to reject the frame as the only shape. The promotion path from B to
C is real work: a framed tool cannot be handed a session, so moving it means
rewriting it as a module. **Choose the lane at request time, not after they have
built it.**

**10.12 — "Login required" hides, it does not lock.** Anything under
`public/embed/` is fetchable by anyone with the URL. Written twice on purpose.

**10.13 — The data will rot, and the rot lands on IT.** A sheet whose column
someone renames turns the page blank, and the person who notices tells IT. The
README must name **a person**; a ฝ่าย cannot be asked a question.

**10.14 — Front-loaded cost.** Registry, frame, guards, starter, doors, docs, two
protection flags and five onboarding sessions ≈ **three sessions plus half a
day** before a second ฝ่าย benefits. Writing Golden Period by hand is two hours.
The plan is only correct if a second and third ฝ่าย follow — the owner believes
they will, and D2 is evidence they already are.

**10.15 — The registry is an interim shape** (§12): the ฝ่าย GUI editor moves it
from a file to a table and rewrites half of §2. Chosen anyway because one file
beats three hand-maintained copies, and its fields are that table's columns. Do
not call it final.

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

Reordered 2026-08-27 for D4–D7. **Framing: this is not a plan beside
`docs/TEAM-WORKFLOW.md` — it is that plan with more users** (§0b). Steps marked
⚙️ are `TEAM-WORKFLOW`'s.

**The old step 0 is gone** (D7). Nothing gates the rest.

| # | Step | State |
|---|---|---|
| 1 | ⚙️ Require the `build` check + code-owner review on `main` | ✅ **DONE 2026-08-27**, read back from the API; `enforce_admins` deliberately left `false` so the owner can still push `main` |
| 2 | `CODEOWNERS` for `src/data/tools.js`, `src/tools/`, `src/js/data/`; `public/embed/**` deliberately unowned | ✅ **DONE** |
| 3 | Tool-request issue template, in Thai | ✅ **DONE** |
| 4 | `skills/onboard-a-contributor.md` + the `CONTRIBUTING.md` and PR-template updates | ✅ **DONE** |
| 5 | Verify §11.1–11.4 on the VM and a real phone | ~30 min |
| 6 | `src/data/tools.js` registry + differential test; migrate `DEPT_DEFS` and `tab-tools.html` | ~1 session |
| 7 | Golden Period **v0** | ~1 session |
| 8 | **Onboard TWO contributors** — each ending in a merged practice PR (§10.5) | 45 min × 2 |
| 9 | The frame: `/tools/<slug>` host, height channel, sandbox test, `check:embeds` | ~1 session |
| 10 | Starter kit + `BRIEF-TEMPLATE.md` + `TOKENS.css` | ~1 session |
| 11 | Boundary CI on `tool/*` branches | ~30 min |
| 12 | ⚙️ Preview builds for `tool/*` (pulled forward from phase 3) | ~2 h |
| 13 | Golden Period **v1** — their pull request | review only |
| — | **Read-only BI for "we want to see the numbers"** (§1c) | ~half a day, independent — **probably before 15** |
| 14 | ⚙️ `TEAM-WORKFLOW` phase 1 — the `samo-dev` database | ~2 h + its own blockers |
| 15 | **Lane C**: `src/js/data/` doors + the first data tool | ~2 sessions. **Hard block on 14 — §10.3** |

Steps 6 + 7 are one batch and one deploy; 9–11 are the second. **Step 15 must
not start early**: opening the data lane without a dev database points
contributors at production student records.

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
