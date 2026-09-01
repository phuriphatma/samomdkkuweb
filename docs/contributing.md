# What you can change

## By difficulty

| You want to | You need |
|---|---|
| Fix a typo or reword something | Nothing — edit it on the GitHub website |
| Change colours, spacing, layout | To edit CSS — [install it first](/start/prerequisites) |
| Add a tool page for your ฝ่าย | To edit HTML — see [Department tools](/DEPT-TOOLS) |
| Change sign-in, the database, notifications | To ask the team first — see below |

## Fixing text without installing anything

1. Open the file on GitHub and click the pencil ✏️
2. Edit the text — GitHub makes you your own copy automatically
3. Click **Propose changes** and write one line about what and why
4. Click **Create pull request**

That is the whole process. You do not need Node or a terminal.

## The rule that matters most

::: danger Never put real student data in the code
Names · student IDs · email addresses · photos — not in files, not in commit messages, and not in screenshots.

This repository is public, and git history cannot truly be deleted. Removing something tomorrow does not remove today's commit. If you need an example, invent one.

The same applies to the `samo-dev` database. It is a copy of real data, not fake data.
:::

## Files to ask about before changing

HTML, CSS, wording and individual form modules need no permission. For the files below, **write one paragraph in the pull request describing your plan before writing code** — mistakes in these are not visible during review.

| File | Why |
|---|---|
| `src/js/auth.js` | Sign-in. Mistakes here have caused real outages |
| `src/js/db.js` | The database connection every page shares |
| `src/js/notify.js` | Discord notifications. Breaking this fails silently |
| `src/js/uploads.js` | File uploads to Google Drive |
| `supabase/migrations/*.sql` | The real database structure |
| `appscript/*.gs` | Connects to external services. A change reaches production immediately |

GitHub requests the right reviewer automatically, so you do not need to contact anyone. Files not on this list need one approval from any collaborator.

## Two things to watch when writing new code

- **User text going into `innerHTML`** must pass through `escHtml()` first. Otherwise you create a cross-site scripting (XSS) vulnerability
- **Database writes** (`update` / `delete` / `insert`) should use `dbRest()` with `prefer:'return=representation'`, then check that rows were actually returned. When permissions are insufficient, the database reports success with zero rows rather than an error

## Before you call it done

- [ ] `npm test` and `npm run build` both pass locally
- [ ] You opened the preview site and actually used it, not just looked at a screenshot
- [ ] The pull request says which screen widths you checked (390 / 820 / 1280)
- [ ] **If you fixed a bug**, write it up in the matching file under `docs/mistakes/` as *symptom → cause → fix → the general rule*. Lead with the symptom **as it was reported** — that is what the next person will search for. Then run `npm run mistakes:index`
- [ ] **If a person would notice the change**, add a plain-Thai line to `PENDING` in `src/data/changelog.js`, in the same commit
- [ ] **If you changed the database structure**, read `skills/ship-a-migration.md` first. The order matters and has taken the site down for 20 minutes before

## Department tools

A ฝ่าย can build its own tool page using the same process as the development team. The only difference is who approves it.

::: tip This is built — you can start today
**Copy `public/embed/starter/`** to a folder named after your tool, edit
`index.html` and `data.js`, and open a pull request from a branch called
`tool/<your-tool>`. **Double-click `index.html` to see your work** — there is
nothing to install and no build step.

The folder's own `README.md` is the full guide, and `CLAUDE.md` beside it is
what to hand Claude if you build it that way.
:::

Your page runs in an **isolated frame**, which is what lets a teammate approve
it in thirty seconds instead of the owner reading every line. It means the page
cannot read the signed-in user, the database, or `localStorage` — so the numbers
live in `data.js`, in your folder, and updating them is a pull request you can
see the diff of.

| Location | Approval it needs | Exists? |
|---|---|---|
| `public/embed/<slug>/` — your page, in an isolated frame | Any collaborator | ✅ yes |
| `src/data/tools.js` — the one entry that puts it on the site | The project owner | ✅ yes |
| `src/tools/` — a tool inside the app bundle, able to read app data | The project owner | ❌ not yet |

A `tool/*` branch may change **only** those first two paths, and CI enforces it.
That limit is the reason the approval can be quick. Check your own branch before
pushing:

```bash
npm run check:embeds          # your folder obeys the rules
npm run check:tool-boundary   # your branch stays inside the lane
```

Design and decisions — [Department tools](/DEPT-TOOLS).

## Tests you have to run yourself

Some rules only exist inside the database, such as who is allowed to read what. Those are checked by:

```bash
npm run proofs
```

**Run it if you changed the database structure or any permission.** It needs a maintainer's key, so CI cannot run it — a maintainer runs it before deploying.
