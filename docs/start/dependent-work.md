# When your work depends on other work

The most common question: *my change needs another change that is still under review — do I have to wait?*

**No.** There are two ways round it.

![Two options: branch off the pending branch and rebase, or merge the first one early but unreachable](../diagrams/dependent-features.svg)

## Option 1 — merge A first, but leave it unreachable

**Try this first.** It is much simpler.

Merge A into `main` immediately, but keep it **unreachable**: no link in the menu, or hidden behind a permission nobody has yet. B then branches off `main` as usual. Nothing is stacked, and nothing has to be rewritten later.

This is safe because **merging into `main` does not publish anything.** Work sitting in `main` does not reach students until a maintainer deploys.

## Option 2 — stack the branches

Use this when A genuinely **should not be merged yet**, because it has not been reviewed or is not finished.

```bash
git checkout feat/a          # stand on the branch that is waiting
git checkout -b feat/b       # branch off A, not off main
```

When you open the pull request for B, **change its base branch to `feat/a`**. There is an *Edit* button next to the title on GitHub. Without this, reviewers see both changes mixed together and cannot review either one.

Once A is merged into `main`, move B across:

```bash
git checkout main && git pull origin main
git checkout feat/b
git rebase --onto main feat/a feat/b
git push --force-with-lease
```

::: warning `--force-with-lease`, not `--force`
`--force-with-lease` refuses if someone else pushed to the branch in the meantime. **Only ever use it on your own branch — never on `main`.**
:::

Then set the pull request's base back to `main`. GitHub usually does this for you once A is merged.

## What not to do

**Do not collect commits in one branch while waiting for A.** This is the slowest option. The longer a branch lives, the more conflicts it accumulates, and a pull request that is too large to read does not get reviewed.
