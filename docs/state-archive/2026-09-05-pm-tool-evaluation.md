# 2026-09-05 — project-management tooling: evaluated, nothing adopted

**Verdict: no tool adopted. No code written, no VM changed, no account created.**
Recorded so the next person does not re-derive it. This is a *why-not*, not a status.

The question was: Jira for team plan + tickets, but its Free tier stops at 10
users and SAMO has ~40 people across 10 ฝ่าย. What else, and can we self-host
Plane?

**Why it stopped:** Oracle Cloud (the free-server route) requires a credit card
*and* a phone number, and Vikunja (the tool that won on merit) was judged not
worth the setup effort for the value it would return right now. Both are
reversible judgements — see *What would reopen this* at the bottom.

---

## 1. The tools — strength and limitation, one row each

Ordered by how seriously each was considered.

| Tool | Strength | Limitation — the reason it lost |
|---|---|---|
| **Vikunja** | The one that won on merit. Single **Go binary**, ~50 MB on SQLite / **~200 MB with Postgres** — the only capable option that FITS THE VM. List/Gantt/Kanban/Table views, multiple views per project. **Ships `th-TH`** (1 of 38 locales). OIDC, REST API, webhooks, CalDAV. Actively developed (**v2.6.0, 2026-08-31**). Uniquely, its **user webhooks fire on reminders and overdue** — the time-based events almost nothing else exposes. | **Not Jira.** No custom fields, no custom workflow statuses, no issue types, no automation rules, no reports/burndown, no sprints. **No public intake portal** — everyone who files needs an account. No native time tracking. Setup effort judged > payoff (2026-09-05). |
| **Plane** (`makeplane/plane`) | Feels like Linear/Jira — modern, fast. CE is AGPL-3.0 with **no hard-coded seat cap** (the "12 seats" everywhere in their docs is *cloud Free* + Commercial Edition, not CE — maintainer-confirmed in makeplane/plane#9086, where the limit is documented four contradictory ways). CE has all five layouts, cycles, modules, intake, pages, estimates. | **Needs 4 GB minimum, 8 GB recommended — the VM has 2 GB.** A **13-service Docker stack**. CE and Commercial are **separate codebases**, so "upgrade later" is a migration, not a licence key. Integrations/marketplace are Pro-only. Young and fast-moving; upgrades historically rough. |
| **OpenProject** | Very mature (Redmine lineage, ~2011). CE is GPL, **unlimited users forever**. Ships **`.deb`/`.rpm`** — no Docker at all, which is what survives annual student turnover (`apt upgrade` vs debugging a compose file you have never seen). Gantt, scheduling, budgets, time tracking, wiki in CE. | **4 GB minimum — does not fit the VM either.** Dense, dated UI ("too ancient looking", "very severe Gantt charts" — Cloudron forum). Advanced board types are Enterprise-gated. Heavier than the actual need. |
| **Taiga** | Genuinely liked by people who used it hard — "blazing fast… feature-wise no less than Jira" (Cloudron forum, Jan 2023). Clean agile model. | That endorsement is **Jan 2023** and its author **left Taiga** because it lacked mobile apps and push notifications. Development has slowed. A 2025 13-tool bake-off found its **due-date email notifications did not actually work**. Our students live on phones. |
| **Kanboard** | **Lightest by a wide margin** — PHP + SQLite, runs in ~128 MB, comfortable on a Raspberry Pi. MIT. 30+ languages. Official Slack plugin, which reaches Discord free via the `/slack` webhook suffix. | **Kanban only** — no Gantt, no timeline, which is what ฝ่าย event planning actually needs. Author considers it **in maintenance mode**; new features come from community plugins. Dated UI. |
| **Wekan** | Trello-shaped and familiar. Simple boards/lists/cards. | Meteor + MongoDB — **not light**, despite forum claims to the contrary. Rocky maintenance history. Due-date notifications found not to fire in the same 2025 bake-off. |
| **GitHub Projects** | **Free, unlimited collaborators, incl. private repos.** Already where `samomdkkuweb` lives; issues link to commits. Zero hosting, zero new accounts for people already there. | Alien to non-technical ฝ่าย members doing events, not code. No Thai UI. Wrong surface for 10 departments planning activities. |
| **ClickUp Free** | **Unlimited members, no cap**, zero ops, no card. Unlimited tasks, time tracking, Gantt. | 100 MB total storage, 100 automation runs/mo, and a **100-use cap on Gantt and Dashboards** that active use burns through in weeks. SaaS — data leaves KKU. |
| **Jira** | The thing everyone knows. | **Free stops at 10 users**; Standard ~$7.91/user/mo ≈ **$3,800/yr for 40 people**. The escape hatch is closed: Atlassian's Community (nonprofit) licence is explicitly **non-academic**, and universities lost free Data Center licensing in **April 2024**. Not a pricing negotiation — a closed door. |
| **NextCloud Deck** | Integrates with the rest of Nextcloud; decent mobile app. | We run no Nextcloud. Reports of NC instability. |
| **EspoCRM** | Endlessly configurable; can be bent into almost anything. | It is a CRM. "Like doing brain surgery on the hive mind of The Borg" (Cloudron forum) — a fair summary. |
| **Redmine** | Rock solid, ancient in the good sense. | UI looks its age. Nothing it does that OpenProject does not do better. |
| **osTicket / Zammad** | The only real *helpdesk* answers — custom fields, workflows, SLA, and a **public portal where someone with no account files a ticket**. osTicket is light PHP; Zammad is full-featured. | Never needed: Zammad wants Elasticsearch and 4 GB+; osTicket is helpdesk-only with no planning side. Only relevant if the need turns out to be a real support desk. |

**One post, ignored:** a "self-hosting was the wrong problem, automate it instead"
message ending in a link to a commercial automation platform. Standard astroturf
shape, and its premise (tasks from git commits, boards from deploy pipelines) is
useless for ~40 non-technical students who do not commit.

---

## 2. Where it would have run

| Option | Verdict |
|---|---|
| **The KKU VM** | The intended home. See §3 — it fits Vikunja and nothing heavier. |
| **Oracle Cloud Always Free** | ⛔ **The reason this stopped.** Requires a **credit card AND a phone number**. Also: allowance was **halved in June 2026** (4 OCPU/24 GB → **2 OCPU/12 GB**) with no announcement; **home region is permanent** and Always Free compute exists only there; idle reclaim stops A1 instances under 20% CPU *and* network *and* memory at the 95th percentile over 7 days (a PAYG upgrade exempts you, and keeps Always Free free — but needs the card again). Worst: Oracle's **own forums carry repeated "account terminated without warning, data purged, support cannot reactivate" threads**, including a lost production database and a *paying* customer cut off. Fine as a backup target where loss costs nothing; never as the primary. |
| **GitHub Student Pack** | **DigitalOcean left the pack on 2026-08-01.** Azure for Students is $100/yr — a 4 GB VM burns it in ~3 months. |
| **GCP / AWS / Azure free tiers** | 1 GB instances, and AWS/Azure expire after 12 months. Too small for anything here. |
| **Hetzner CAX11** | Not free, but ~€3.79/mo ≈ **฿150/month** for 2 vCPU / 4 GB / 40 GB. The pragmatic answer if it ever needs to leave campus — hosting cost was never the real constraint. |
| **Cloudron** | Recurs throughout the source forum threads. A paid PaaS we do not need and did not consider. |

---

## 3. Facts established along the way — these outlive the decision

**The VM's real size (measured 2026-09-05), which no doc recorded:**

```
CPU    2 vCPU          MEM   2.0 Gi total (95 Mi used, 1.9 Gi available)
DISK   40 G, 35 G free DOCKER not installed
```

It is a **Proxmox guest** (`/dev/mapper/pve-vm--324--disk--0`), so RAM and vCPU
are a **slider on the KKU host** — raising them is an ASK to KKU IT, not a
rebuild. This is the single fact that decided the whole evaluation: anything
wanting 4 GB+ (Plane, OpenProject, most compose stacks) does not fit today.
Recorded in the `samo-vm-access` memory so the next "can we also run X here?"
starts from a number.

⚠️ **Unexplained, harmless so far:** load average sits ~2.2–3.0 on 2 cores while
CPU is ~95% idle with **0 iowait and 0 steal**, and context switches/interrupts
run ~70k/~110k per second. Not I/O, not a noisy neighbour. Possibly the `wazuh`
agent. Worth a look if the box ever feels slow; nothing was changed.

**Two things we already own that any future tool should reuse:**

- **The VM can send mail** through an authenticated relay on 587/465 — proven
  with a real SMTP session, per `docs/EMAIL.md`. Gmail, Brevo, SendGrid, Resend,
  Postmark all reachable; port 25 out is blocked and inbound is impossible, but
  a relay needs neither.
- **`server/notify-server.mjs`** — 95 lines, deployed, behind nginx at
  `POST /notify`, systemd `samo-notify`, Discord webhook URLs in
  `/etc/samo-notify.env` (chmod 600). **Any tool's webhook can reach Discord
  through it** with a small shim. This nearly carried the decision on its own.

**Correction worth keeping:** Discord webhooks are **outbound only**. Pulling
Discord forum posts *into* a tracker needs a bot application with the Message
Content intent holding a gateway connection — a persistent process, not a shim.
Plan intake around a form in our own app (the PR/VS pattern), not around
syncing Discord inward.

⚠️ If a tracker ever does post to Discord, task titles become message content —
a task named `@everyone แก้ด่วน` would ping the server. Route it through
`postOnce` with `allowed_mentions:{parse:[]}`; the class is already in
`.claude/rules/mistakes.md` §4.

---

## 4. What was nearly built, and the shape it would take

Design only. Nothing exists.

```
intake   →  Discord forum channel (informal, zero accounts)
            + a form in our app (structured)  ──→ Vikunja REST API
queue    →  Vikunja on the VM, systemd MemoryMax=512M
alerts   →  Vikunja webhook → /notify → Discord
```

Served at `samo.md.kku.ac.th/plan` — a **path, not a subdomain**, so no DNS
request to KKU is needed. The nginx location block was identified as the only
step carrying real risk to production; `nginx -t` before any reload.

---

## 5. Two lessons that generalise past this decision

- **Size the tool to the server, not the server to the tool.** Three rounds
  were spent asking how to get 8 GB — for an app that needs 200 MB. The
  constraint was never capacity.
- **Pick for the volunteer who never logs in.** A 13-tool bake-off by a German
  non-profit staffed by unpaid volunteers found **twelve had broken or missing
  due-date notifications** — they *appear* to have the feature. For an org whose
  members will not open a tracker daily, the notification path is the product;
  the board is incidental. Vikunja won on this and nothing else.
- **Beware tool lock-in under annual turnover.** From the same threads: a team
  moved to Jira because one influential person insisted, and found it "too hard
  to switch back." With leadership rotating yearly, verify the **export** works
  before putting a year of planning into anything.

---

## 6. What would reopen this

- Someone asks "what is due across all 10 ฝ่าย this month?" and Discord cannot
  answer it. That is the gap a tracker fills; until it is felt, there is no case.
- KKU IT raises the VM to 8 GB (a Proxmox slider), which puts Plane and
  OpenProject back on the table — though Vikunja would still be the pick.
- The need turns out to be a real **support desk** (public portal, SLA,
  custom fields), in which case none of the above applies and it is
  osTicket/Zammad, re-planned from scratch.
- A durable, non-student credit card and phone number become available, which
  is the only thing that was blocking the Oracle route.

**Before adopting anything, try the free thing first:** a Discord **forum
channel** with tags per ฝ่าย and status. Zero hosting, zero accounts, zero
training, already on every phone. It may cover the ticket half outright, and it
costs ten minutes to find out.
