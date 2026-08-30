# Moving this project off a personal account

**Status: DESIGNED, not done.** Nothing here has happened yet. Read
`STATE.md` first for whether that is still true.

The repository lives on a personal GitHub account (`package.json` →
`repository.url` is the one place that says so). The owner will retire from
SAMO; the project will not. This is how it moves without losing anything.

⚠️ **This page is only about GitHub. GitHub is the smallest part of the
handover** — the database, the Google sign-in, the VM key and `.env.local` all
matter more and are on nothing to do with GitHub. Read **`docs/SUCCESSION.md`**
first, and run `npm run succession:audit`.

---

## §0a In plain language — how you stop being the one who adds everybody

**The problem.** The project sits in your personal account. GitHub only lets the
account holder hand out access, so every new person is a job for you, and only
you.

**The fix, and the bit that keeps being misunderstood: a GitHub "organisation"
is not a new login.** It is not the shared `samo` email. Nobody signs into it
and there is no password to pass down. Think of it as **the club's cupboard
instead of your locker** — the project sits in the cupboard, several people hold
a key, and everyone still signs in as themselves with their own account and
their own Copilot.

**Most people will not need anything from you at all.** Three ways in, and only
the smallest involves you:

| Who | What they do | Your involvement |
|---|---|---|
| A ฝ่าย member with one page to add | Makes their own copy and sends the change back for review | **None.** This already works — it is what `CONTRIBUTING.md` describes |
| Someone working on it regularly | Gets added to a group ("team") | **Any key-holder can do it, not just you** |
| The 2–3 people running IT | Hold keys to the cupboard | Handed over once, when you retire |

Most ฝ่าย members are the first row. They never needed to be added — they needed
to be told how. That alone removes most of the clicking.

**The five steps.**

1. Create the organisation. Free, a few minutes.
2. Give **at least two people** keys — you and one other. Never one: one
   key-holder is one graduation away from nobody being able to let anyone in.
3. Move the project into it. One button.
4. Make a group called `maintainers` and put the regulars in it. Adding someone
   later means adding them to the group, which any key-holder can do.
5. **Point the review rule at the group instead of at you.** Today the project
   says "changes to the login code need Phuri's approval", with a name written
   in a file. Change it to "needs a maintainer's approval".

Step 5 is the one that actually matters. As it stands, when you stop being the
maintainer that rule does not switch off — **it keeps blocking every change,
waiting for an approval that is not coming.**

**Retiring afterwards** is: add the next person as a key-holder, remove
yourself. The project does not move, no links break, nothing is re-done. Same
every year after, without you.

---

## §0 The decision, and the premise that inverts it

The question as it was first put: *keep it on my personal account and keep
adding contributors forever, or move it to the shared `samo` email everyone
uses — but then we lose the GitHub Copilot that comes with a student kkumail?*

**That trade-off does not exist, and it points the wrong way.**

- **Copilot attaches to a PERSON, not to a repository.** Free student access
  runs through a Copilot plan granted to a *verified student's own account*. A
  student working on a repo owned by an organisation is still that student.
  Nobody loses Copilot by the repo moving.
- **A shared `samo` account is the option that DESTROYS Copilot.** Student
  access requires a verified student. A role account shared by a committee is
  not a student and never will be, so it qualifies for nothing — and everyone
  who signs in as it is working without the entitlement they already have.

So the shared account costs the thing it was supposed to protect. What is
actually needed is a **free GitHub Organisation**, which is not an account
anybody signs into: it is a container owned by *personal* accounts.

⚠️ **The one real Copilot hazard, and it is a setting, not the move.** An
organisation that BUYS Copilot and assigns a member a seat replaces that
member's personal subscription. So: **do not enable or purchase Copilot for the
organisation.** Members keep using their own.

⛔ **Do not take the paragraph above on trust — it is a 10-minute experiment.**
Create the organisation, move ONE small repo into it (`samomdkkupassport` is
the natural volunteer), open it in the editor, and check Copilot still
completes. This project's rule is to verify from the authority rather than
assert (`.claude/rules/mistakes.md` §7). Do that before moving anything that
matters.

### Why not "just keep adding contributors"

That is the status quo, and its cost is not the clicking. It is that **every
permission in the project terminates at one human being.** `.github/CODEOWNERS`
names `@phuriphatma` on `auth.js`, `db.js`, `supabase/`, `server/` and
`tools/`. When that account stops being the maintainer, the gate does not fail
loudly — it keeps blocking merges on a review that is never coming.

An organisation fixes it structurally: CODEOWNERS names a **team**, and the
team's membership changes without touching a file.

### Why not a shared account, beyond Copilot

This project has already paid for this lesson at the application layer. On
2026-08-17 and 08-18 **all 17 shared password accounts were deleted** and their
work reassigned to named people, because a shared login cannot answer "who did
this" (`.claude/rules/security.md`, `docs/INVARIANTS.md`). Re-introducing one at
the GitHub layer would repeat, one level up, the exact mistake that session
existed to undo — and this time the audit trail it destroys is `git blame` on
`auth.js`.

Also: 2FA on a shared account is a shared secret held by whoever set it up. When
they graduate, the recovery codes graduate with them.

---

## §1 What the organisation looks like

| Piece | Choice | Why |
|---|---|---|
| Plan | **Free** | The repo is PUBLIC, and on a free org that means branch protection, unlimited collaborators, unlimited Actions minutes and Pages all keep working. Nothing we rely on is behind Team. |
| Owners | **At least two, always** | This is the whole succession mechanism. One owner is a single point of failure with a graduation date. |
| Members | Their **own** personal accounts | Each keeps their own Copilot, and `git blame` keeps naming humans. |
| Teams | `maintainers` (the CODEOWNERS gate) · `contributors` (the ฝ่าย) | So membership is edited in one place instead of per repo. |
| Copilot | **Do not enable for the org** | An org-assigned seat replaces a member's personal subscription (§0). |

**Handover is then: add the incoming lead as an Owner, remove yourself.** The
repository never moves again, and nothing in it has to change.

---

## §2 The move, in order

The ordering is not cosmetic — two steps below are wrong if done early.

1. **Test Copilot in the org** with a throwaway or the passport repo (§0).
2. **Create the org, add the second Owner.** Do not proceed with one.
3. **Transfer the repo.** Settings → Danger Zone → Transfer.
4. **Change ONE line and let the tests write your checklist:**

   ```bash
   # package.json → repository.url and homepage
   npm test        # src/js/repo-identity.test.js now LISTS every file to edit
   ```

   It prints each stale reference by file. Edit them, re-run until green.
   ⚠️ **Do not `sed` the old handle across the repo.** `@phuriphatma` in
   CODEOWNERS, the reviewer named in `CONTRIBUTING.md` and
   `docs/state/phuriphatma.md` name a HUMAN, who is still that human. The test
   knows the difference; a `sed` does not.
5. **Point CODEOWNERS at the team**, not the person:
   `/src/js/auth.js  @<org>/maintainers`
6. **Re-check branch protection**: `node tools/repo-protection.mjs`. Protection
   settings live on GitHub, outside git, and a transfer is exactly the kind of
   event that quietly resets them. A 404 there means protection is GONE, not
   "fine".
7. **Reconnect Cloudflare Pages — THIS ONE FAILS SILENTLY.** The Pages project
   binds to `source.config.owner` in Cloudflare's own config, which does not
   follow a transfer. Per-PR previews just stop being built; no test in this
   repo can see it, and a pull request with no preview comment looks like
   Cloudflare being slow. Install the Cloudflare GitHub App on the new
   organisation and reconnect the project. `tools/repo-protection.mjs` asserts
   the binding when `CLOUDFLARE_*` are in `.env.local` — run it WITH them.
8. **Re-enable GitHub Pages**, which does not survive a transfer either:

   ```bash
   gh api -X POST repos/<org>/samomdkkuweb/pages -f build_type=workflow
   ```

   Then push any change under `docs/` and confirm the `docs` workflow deploys.
9. **Move `samomdkkupassport` too.** Same account, same problem, and this repo
   links to it — `repo-identity.test.js` treats it as a sibling and will flag
   stale links to it.
10. **ONLY NOW, if you want a custom domain**, ask KKU for
    `docs.samo.md.kku.ac.th` → `<org>.github.io`. A CNAME points at the OWNER,
    so requesting it before the move means requesting it twice.

---

## §3 What does NOT need to change

- **The app deploy.** Production is the KKU VM and knows nothing about GitHub
  ownership. `server/deploy.sh` pulls over ssh.
- **Supabase, Apps Script, Discord, Drive.** None of them authenticate against
  GitHub.
- **Old links.** GitHub redirects a transferred repo — which is precisely why
  this is dangerous rather than easy: everything keeps working, so nothing
  tells you what you missed, until the old account is renamed or deleted and
  they all break at once with no commit to blame. That is what step 4 exists
  for.

---

## §4 The trap this whole file is built around

The owner of a repository is a fact with many homes, and only some of them are
in git. Before this was written down it had **42 homes across 19 files**, plus
two outside the repository entirely (Cloudflare's project binding, and the
Pages site). The homes inside git are now derived from one field and guarded;
the two outside are steps 6–8 above, and one of them is checked by a proof.

**Ask, for any move like this: what else stores this fact where my tests cannot
see it?**
