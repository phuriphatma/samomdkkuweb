# Your first change

From editing a file on your machine to having it merged.

![Your change travels from your machine to a branch, to a pull request, into main, and only then does a maintainer deploy it](../diagrams/journey.svg)

## 1. Get the latest code first

```bash
git checkout main
git pull origin main
```

This takes a few seconds and prevents merge conflicts later.

## 2. Create a branch

```bash
git checkout -b ui/news-card-spacing
```

::: warning A branch is required
`main` is protected. Pushing to it directly is refused — this is a rule the system enforces, not just a convention.
:::

![main is one long line; each branch splits off for a single job and merges back](../diagrams/branches.svg)

Name it `<type>/<short-topic>` in lowercase, with hyphens.

| Prefix | Use it for | Example |
|---|---|---|
| `feat/` | Something new | `feat/golden-period-page` |
| `fix/` | A bug | `fix/vs-form-double-submit` |
| `ui/` | Colours, spacing, layout | `ui/news-card-spacing` |
| `docs/` | Documentation only | `docs/install-guide` |

**The branch name becomes your preview address.** `ui/news-card-spacing` becomes `https://ui-news-card-spacing.samomdkkuweb.pages.dev`. Keep names short so the address stays readable.

**Use one branch per change.** If you want to change two unrelated things, create two branches. Smaller pull requests are reviewed faster, and a problem with one does not block the other.

## 3. Make the change and watch it

Leave a second terminal window running:

```bash
npm run dev
```

The page reloads as you edit. Before continuing, confirm both of these pass:

```bash
npm test
npm run build
```

## 4. Save your work

```bash
git status                       # see what changed before you stage anything
git add src/css/news.css         # stage only the files you meant to
git commit -m "ui(news): tighten news card spacing on mobile"
git push -u origin ui/news-card-spacing
```

You only need `-u origin <branch>` the first time you push a branch. After that, `git push` is enough.

::: danger Why `git status` before `git add .`
`git add .` stages *everything that changed*, including files you did not mean to add — a screenshot saved into the project folder, or a temporary file you forgot to delete.

This repository is public, and **git history cannot be reliably deleted**. Deleting a file tomorrow does not remove it from today's commit. Once a name, student ID, email address or photo is committed, it stays in the history permanently.
:::

## 5. Open a pull request

```bash
gh pr create --fill --web
```

Or open GitHub in a browser — a *Compare & pull request* banner appears after you push.

Include three things. None of them need to be long.

1. **What changed** — one sentence
2. **Why** — what it was like before
3. **How you tested it** — which screen widths you checked; 390 / 820 / 1280 px is the usual set

::: tip Open it before you are finished
Use *Create draft pull request*. Others can see what you are working on, so nobody duplicates it, and you get CI and a preview site while you are still working. Put `[help]` in the title if you are stuck.
:::

## 6. Check the preview site

Every branch gets its own live site automatically. The link appears in the pull request within a few minutes, or ask for it directly:

```bash
npm run preview:url
```

![Your machine and the preview site both use a copy of the database; only the live site uses the real one](../diagrams/environments.svg)

**The preview site is connected to `samo-dev`, a copy of the database — not the real one.** You can click buttons, submit forms and create test records without affecting anyone. Test here, not only on your own machine.

The address stays the same for the life of the branch, so you can bookmark it once and it will update on every push. You can send it to someone in your ฝ่าย for a second opinion; they do not need to install anything.

## 7. Wait for CI and review

| Check | Takes | If it is red |
|---|---|---|
| **build** — `npm test` and `npm run build` | ~2 min | Click *Details* and read the first red line |
| **Cloudflare Pages** — builds the preview | ~2 min | Usually means the build failed too |
| **smoke** — loads the preview in a real browser | ~1 min | The page loads but nothing responds |

To fix something, **do not open a new pull request.** Commit and push again. The existing pull request updates automatically and all checks re-run.

Who has to approve depends on which files you touched — see [What you can change](/contributing).

## 8. Merged is not published

Merging into `main` does not put your change on the live site. A maintainer has to connect to the KKU VPN and deploy, usually batching several pull requests together.

This is intentional. Approving a pull request is low-risk and easy to undo, which keeps review fast. The careful check happens once, at deploy time.

## Every command in one place

```bash
# starting a new piece of work
git checkout main && git pull origin main
git checkout -b ui/my-topic
npm run dev

# saving your work
git status
git add <files>
git commit -m "ui(scope): short description"
git push -u origin ui/my-topic

# sending it
npm test && npm run build
gh pr create --fill --web
npm run preview:url
```
