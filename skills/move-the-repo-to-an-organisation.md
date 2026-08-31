# Runbook — move the repo to a GitHub organisation

**Goal: stop being the one person who has to add every contributor.**

**Status: DESIGNED, nothing done.** Check `STATE.md` before assuming that is
still true.

⚠️ **This covers GitHub only, and GitHub is the smallest part of the handover.**
The database, student Google sign-in, the VM key and `.env.local` matter more
and have nothing to do with GitHub. Read **`docs/SUCCESSION.md`** and run
`npm run succession:audit` — the GitHub move is step 7 of 8 there, on purpose.

**Time: about 90 minutes**, plus one VPN session for the VM and one wait for a
Copilot check. It does not have to be done in one sitting; phases 0–2 and 3–5
are separable.

---

## §0a PROGRESS — measured 2026-08-31, do not re-derive

The move is **STARTED, not finished.** Verified against the GitHub API, not
assumed:

| | State |
|---|---|
| Organisation | ✅ **`samomdkku`** exists, Free plan |
| Owners | ✅ `phuriphatma` **and `panascha`** both admin/active — the "never one owner" rule is satisfied. `Kita1103` invited as admin, **pending acceptance** |
| Base permissions | ✅ already `read` |
| Require 2FA | ⛔ **OFF, and that is the owner's decision (2026-08-31) — do not re-raise.** Requiring it REMOVES every member who does not already have it, which is not a thing to spring on volunteers mid-term |
| Phase 0 Copilot test | ✅ `samomdkkupassport` transferred to the org; old URL redirects; `samo.md.kku.ac.th/passport/` still 200 |
| **`samomdkkuweb`** | ✅ **MOVED 2026-08-31** → `samomdkku/samomdkkuweb` |

**Passport was the right first move and cost nothing**: measured before
transferring, it had no GitHub Pages, no branch protection and no custom CI, so
there was nothing to repair afterwards. `samomdkkuweb` has all three, which is
why §5's repair steps exist and why they matter there and not here.

⚠️ **The VM's passport checkout still points at the OLD URL.** GitHub redirects,
so `deploy.sh` keeps working — this is tidy-up, not breakage.

### Next actions, in order

1. ✅ **Copilot is SETTLED — measured 2026-08-31, do not re-test in the editor.**
   `gh api orgs/samomdkku/copilot/billing` returned 0 seats, `unconfigured`, so
   nothing can displace a personal student subscription. §3 has the reasoning
   and the one standing rule (never buy org seats).
2. ✅ **DONE 2026-08-31 — `samomdkkuweb` is transferred.** Classic protection
   and Pages survived; **the ruleset's bypass actors did NOT** and refused the
   next push — §5d, which is new and is the trap on this step.
3. ✅ **DONE — `@samomdkku/maintainers` exists** (`closed` + `push`, verified
   from the API before `CODEOWNERS` was edited) and `CODEOWNERS` names it on
   all sixteen paths instead of a person.
4. ✅ **DONE — §7.** `package.json` changed, `repo-identity.test.js` named the
   other thirteen, all fixed, `npm test` green.
5. ✅ **DONE — §5a Cloudflare**, reconnected via the GitHub App installed on
   the ORG, not on a personal account — which is what makes it outlive the
   person who set it up. ⚠️ It surfaced a separate fault worth reading before
   you trust any pages.dev URL: **§5e**.
6. ✅ **DONE — the VM's git remote** (§8), repointed and proven by a completed
   deploy, which is the only thing that shows the VM can still fetch.
7. ⏳ **§10's last box: someone who is NOT the owner adds a person to a team.**
   Until that has happened once, nothing has actually changed.

---

## §1 In plain language — what actually fixes this

**The problem.** The project sits in your personal account. GitHub only lets the
account holder hand out access, so every new person is a job for you, and only
you.

**The fix, and the part that keeps being misunderstood: a GitHub "organisation"
is not a new login.** It is not the shared `samo` email. Nobody signs into it,
and there is no password to pass down. Think of it as **the club's cupboard
instead of your locker** — the project sits in the cupboard, several people hold
a key, and everyone still signs in as themselves, with their own account and
their own Copilot.

**Most people will not need anything from you at all:**

| Who | What they do | Your involvement |
|---|---|---|
| A ฝ่าย member with one page to add | Makes their own copy, sends the change back for review | **None.** Already works — it is what `CONTRIBUTING.md` describes |
| Someone working on it regularly | Gets added to a group ("team") | **Any key-holder can, not just you** |
| The 2–3 people running IT | Hold keys to the cupboard | Handed over once, when you retire |

Most ฝ่าย members are the first row. They never needed adding — they needed
telling. That alone removes most of the clicking.

**The single most important step is §6.** Today the project says *"changes to
the login code need Phuri's approval"*, with a name written into
`.github/CODEOWNERS`. When you stop being the maintainer, that rule does not
switch off — **it keeps blocking every change, waiting for an approval that is
not coming.** Pointing it at a team is the difference between a handover and a
time bomb.

---

## §2 Decide these before starting

| Decision | Recommendation |
|---|---|
| Organisation name | Something the club owns, not a person — e.g. `samo-mdkku`. It becomes part of the docs-site URL. |
| Plan | **Free.** The repo is public, so branch protection, unlimited collaborators, unlimited Actions and Pages all stay free. Nothing we use is behind the paid tier. |
| Who else is an Owner | **At least one other person, from day one.** One owner is one graduation away from nobody being able to let anyone in. |
| Org Copilot | **Do not enable or buy it.** See §3. |
| Custom docs domain | Later, and only after the move — §9. |

### Why not a shared `samo` GitHub login instead

- **It is the option that loses Copilot.** Free access requires a *verified
  student*. A role account shared by a committee is not one and never will be,
  so it qualifies for nothing. (Still true after the 2026-03-12 change — what a
  student now forfeits is the Copilot Student plan rather than Pro; §3.)
- It destroys `git blame`. This project already deleted 17 shared application
  logins on 2026-08-17/18 for exactly that reason
  (`.claude/rules/security.md`); doing it again one level up would put the
  audit trail on `auth.js` in the same bin.
- 2FA becomes a secret held by whoever set it up, and it graduates with them.

*(The two Google role accounts in `docs/SUCCESSION.md` are a different and
legitimate case — infrastructure owner accounts held one person at a time, not
a login many people use at once.)*

---

## §3 Phase 0 — prove the Copilot question (10 minutes, do this first)

Copilot attaches to a **person**, not a repository, so moving the repo should
change nothing. The one real hazard is a **setting**: an organisation that buys
Copilot and assigns a member a seat *replaces* that member's personal
subscription.

⛔ **Do not take that on trust — but do not use the editor test either.**
This section used to say "move one small repo in, open it in your editor and
confirm Copilot still completes". **That test cannot see the hazard.** Inline
completion runs on the OPEN FILE, not on the remote, so it passes on a file in
no git repository at all — it would have reported success no matter what the
org did (`.claude/rules/mistakes.md` §7, "check the INSTRUMENT can see it").

**Ask the authority instead.** The only thing that can take a personal
(student) Copilot away is an org ASSIGNING that person a seat — GitHub cancels
the personal plan and refunds it pro rata, and from then on the person cannot
cancel their own plan. So the question is whether the org has any seats:

```bash
gh api orgs/<org>/copilot/billing
```

✅ **Safe** — what `samomdkku` returned on 2026-08-31:

```
seat_breakdown.total       0             ← no seats assigned to anyone
seat_management_setting    unconfigured  ← nobody has enabled org Copilot
```

⛔ **The standing rule: never buy or enable Copilot seats for the org** — but
the REASON changed under us on 2026-03-12, and the old reason is now false.

Until then a verified student got Copilot **Pro** free, which made an org seat
a strict downgrade: free replaced by billed, for the same thing. Since
2026-03-12 students get the **Copilot Student** plan instead — unlimited IDE
completions plus **200 AI credits a month** covering chat, code review, agents
and the CLI. A Copilot Business seat LIFTS that cap, so it is no longer
strictly worse.

**The rule survives on COST, not capability.** It is a per-person monthly bill
for a volunteer committee, out of a club budget that does not exist, to remove
a cap this repo's pull-request volume does not come near. If someone one day
argues for it, that is the argument to have — not "it would take away their
free Pro", which is no longer true.

⚠️ **NOT VERIFIED: what an org seat does to a free Copilot Student plan.**
GitHub documents cancelling-and-refunding a PAID personal plan (Pro/Pro+/Max).
A free plan has nothing to refund, and this runbook has no evidence either way.
Do not assert it; ask the authority if it ever matters.

Personal Copilot stays each person's own, and stays each person's own switch,
under their account Settings → Copilot.

**If `total` is anything but 0, STOP and reassess before moving this repo.**

---

## §4 Phase 1 — create the organisation

1. github.com → **+ → New organization → Free**.
2. Name it as decided in §2.
3. **Invite the second Owner and wait for them to accept.** Do not continue
   with one Owner.
4. Settings → Member privileges → **Base permissions: Read**. (Write access
   comes from a team, so that membership is the thing being managed, not
   per-repo grants.)

---

## §5 Phase 2 — transfer, then repair what does not follow

**Transfer:** repo → Settings → Danger Zone → **Transfer ownership**.

Three things do **not** come with it. The first fails silently.

### 5a. Cloudflare Pages — ⚠️ SILENT FAILURE

The Pages project binds to `source.config.owner` in **Cloudflare's own config**,
which a transfer does not update. Previews simply stop being built: no error,
no red check — a pull request just never gets its preview comment, which reads
as Cloudflare being slow.

1. Install the **Cloudflare GitHub App** on the new organisation.
2. Cloudflare → Pages → `samomdkkuweb` → Settings → Builds → reconnect to the
   repo under its new owner.
3. Verify: `node tools/repo-protection.mjs` — it asserts the binding when
   `CLOUDFLARE_*` are in `.env.local`. Run it **with** them.

📌 **Preview URLs do not change.** They are `<branch>.samomdkkuweb.pages.dev`,
named after the **Cloudflare project**, not the GitHub owner.

### 5b. GitHub Pages — the docs site

```bash
gh api -X POST repos/<org>/samomdkkuweb/pages -f build_type=workflow
```

Then push any change under `docs/` and confirm the `docs` workflow deploys.
**The site's host changes** to `https://<org>.github.io/samomdkkuweb/`; the path
`/samomdkkuweb/` does not, because the repo name has not changed.

### 5e. What a pages.dev deployment is WIRED TO — check it, do not read the URL

⚠️ **Reconnecting Cloudflare is not the end of it.** Afterwards every deployment
was `env=production, branch=main`, and that environment's variables named the
**real Supabase project** — so a `<hash>.samomdkkuweb.pages.dev` URL served a
working app against live student data **while displaying a PREVIEW ribbon** (no
`VITE_ENV_NAME` plus a `.pages.dev` host makes `ribbonLabel` guess).

It surfaced only because signing in there bounced to the production host — the
`site_url` fallback, because a hash subdomain does not match the allow-list
entry for the bare host.

⛔ **Do not "fix" that by allow-listing the preview wildcard on PRODUCTION.**
It removes the only symptom and makes the cause permanent.

Both Cloudflare environments are now pinned to `samo-dev` with
`VITE_ENV_NAME=preview`, and `tools/repo-protection.mjs` asserts it. Full
write-up: `docs/mistakes/deploy-hosting.md`.

### 5c. Branch protection

```bash
node tools/repo-protection.mjs
```

Protection lives on GitHub, outside git, and a transfer is exactly the kind of
event that resets it. **A 404 there means protection is GONE, not "fine".**

📌 **Measured 2026-08-31: classic protection and GitHub Pages BOTH SURVIVED**
the transfer of `samomdkkuweb`, name unchanged, into the org. A restore script
was prepared on the assumption they would not, and was not needed. Check
anyway — but expect green here, and spend the attention on 5a and 5d.

### 5d. Ruleset bypass actors — ⚠️ WIPED, AND THIS IS THE ONE THAT BIT

**The transfer emptied `bypass_actors` on the `main-protect` ruleset.** The very
next `git push origin main` was refused:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Changes must be made through a pull request.
```

⛔ **Rulesets are a SECOND enforcement path, separate from classic protection.**
Before 2026-08-31 `repo-protection.mjs` read only the classic API, so it
reported six green checks — including `enforce_admins stays OFF`, whose whole
purpose is the owner's direct push — while pushes were being refused. It now
reads both. Full write-up: `docs/mistakes/tooling-proofs.md`.

Restore the admin bypass, which is what the owner's normal flow rests on:

```bash
gh api repos/<org>/samomdkkuweb/rulesets            # find the id
gh api repos/<org>/samomdkkuweb/rulesets/<id>/history   # GitHub keeps versions —
                                                        # read what was there BEFORE
```

then `PUT` the ruleset back with
`{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}` in
`bypass_actors` (5 = admin), and confirm with `node tools/repo-protection.mjs`.

📌 **The history endpoint is the point.** It turns "what did the transfer
change?" from a guess into a diff. Read it before restoring anything.

⚠️ **Three `Integration` (GitHub App) bypasses were also wiped and were
deliberately NOT restored** — no public endpoint resolves an app id to a name,
and `gh api orgs/<org>/installations` returned `total_count: 0`, so they granted
nothing. Do not re-add a bypass you cannot name.

---

## §6 Phase 3 — make membership, not you, the thing that grants access

**This is the phase that answers the original question.**

1. Org → Teams → **New team: `maintainers`**. Add the regulars.
2. Team → Settings → **Visibility: visible**, and give it **Write** on the repo.
   *(CODEOWNERS silently ignores a team that is secret or lacks write.)*
3. Edit `.github/CODEOWNERS` — replace the person with the team:

   ```
   /src/js/auth.js     @<org>/maintainers
   /src/js/db.js       @<org>/maintainers
   /src/js/notify.js   @<org>/maintainers
   /src/js/uploads.js  @<org>/maintainers
   /supabase/          @<org>/maintainers
   /server/            @<org>/maintainers
   /appscript/         @<org>/maintainers
   /tools/             @<org>/maintainers
   ```

4. Optional: a `contributors` team for ฝ่าย members who work on the project
   often. Everyone else uses fork + pull request and needs **nothing**.

From here, adding someone = adding them to a team, and **any Owner can do it**.

---

## §7 Phase 4 — one line in the repo, and the tests write your checklist

The owner/repo has exactly one home: `package.json` → `repository.url`
(`tools/repo-identity.mjs`).

```bash
# edit package.json: repository.url AND homepage
npm test          # src/js/repo-identity.test.js LISTS every file still stale
```

Fix what it names, re-run until green. It produced a 13-item list in rehearsal,
including links to the passport repo.

⛔ **Do not `sed` the old handle across the repo.** `@phuriphatma` in
CODEOWNERS, the reviewer named in `CONTRIBUTING.md`, and
`docs/state/phuriphatma.md` name a **human**, who is still that human
afterwards. The test knows the difference; `sed` does not.

---

## §8 Phase 5 — routing: what changes, and what does not

**Checked against each system's own API on 2026-08-30, not assumed.**

### Nothing in the running application routes through GitHub

| Thing | Value | Changes? |
|---|---|---|
| Production site | `samo.md.kku.ac.th` — the KKU VM | ❌ no |
| Supabase `site_url` | `https://samo.md.kku.ac.th` | ❌ no |
| Supabase redirect allow-list (prod) | localhost, `samomdkkuweb.pages.dev`, `samo.md.kku.ac.th` | ❌ no |
| Supabase redirect allow-list (dev) | localhost + `https://*.samomdkkuweb.pages.dev/**` | ❌ no — named after the **Cloudflare project** |
| Google OAuth redirect URI | the **Supabase** callback | ❌ no |
| KKU SSO login/logout redirects | the VM | ❌ no |
| Apps Script `/exec`, Drive, Discord | none authenticate against GitHub | ❌ no |
| App source referencing github.com | one comment in `src/js/auth.js` | ❌ no |

**So: no student, no ฝ่าย member and no running service sees any difference.**

### Three routes DO change — all outside the app

| Route | Action |
|---|---|
| Docs site host | `<org>.github.io/samomdkkuweb/` — derived from `package.json` (§7) |
| **The VM's git remote** | Needs VPN. GitHub redirects, so it keeps working and hides the staleness — fix it anyway |
| Cloudflare → GitHub binding | §5a |

**On the VM (needs VPN):**

```bash
ssh samo-vm
cd ~/samo-projects/samomdkkuweb
git remote set-url origin https://github.com/<org>/samomdkkuweb.git
git remote -v && git pull --ff-only
```

Then deploy once (`skills/deploy-vm.md`) and confirm the served bundle is
current — **a deploy is the only thing that proves the VM can still fetch.**

---

## §9 Afterwards

- **The passport repo** (`samomdkkupassport`) moves the same way, same account,
  same problem. `repo-identity.test.js` treats it as a sibling and flags stale
  links to it.
- **A custom docs domain, only now.** Ask KKU for
  `docs.samo.md.kku.ac.th` → `<org>.github.io`. A CNAME points at the **owner**,
  so requesting it before the move means requesting it twice.
- **Remove the outgoing student's personal access** — a role handover does not
  revoke it (`docs/SUCCESSION.md`).

## §10 Done when

- [ ] Copilot still works for you inside the org (§3)
- [ ] Two Owners, both accepted
- [ ] `node tools/repo-protection.mjs` — all checks pass, **including the
      Cloudflare binding**
- [ ] A test pull request gets a **preview comment**, and the preview loads
- [ ] `npm test` green — no stale identity references
- [ ] The docs workflow deployed, and `<org>.github.io/samomdkkuweb/` serves
- [ ] `CODEOWNERS` names a **team**, and a PR touching `auth.js` requests that
      team
- [ ] The VM's remote updated **and a deploy completed**
- [ ] Someone who is **not you** has added a person to a team

That last box is the whole point. Until someone else has done it once, nothing
has actually changed.

## §11 If it goes wrong

A transfer is reversible — transfer it back; GitHub redirects both ways. What
is **not** automatic is everything in §5: Cloudflare's binding, Pages, and
branch protection all need redoing in either direction. Nothing in the transfer
touches production, the database or student data, so **the app cannot break as
a result of this** — the blast radius is previews, the docs site and the ability
to merge.

## §12 The trap this file exists for

The owner of a repository is a fact with many homes, and only some are in git.
Before it was given one, it had **42 across 19 files**, plus two outside the
repository entirely — Cloudflare's binding and the Pages site. GitHub's
redirects mean every stale copy keeps *working*, so nothing tells you what you
missed until the old account is renamed and they all fail at once, months later,
with no commit to blame.

**Ask, of any move like this: what else stores this fact where my tests cannot
see it?**
