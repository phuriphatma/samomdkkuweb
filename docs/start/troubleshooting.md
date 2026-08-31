# Troubleshooting

## I committed on main by accident

If you have not pushed yet, your work moves to a new branch intact:

```bash
git branch fix/my-work          # bookmark where you are
git reset --hard origin/main    # rewind main; the work is safe on the branch
git checkout fix/my-work
```

::: warning
`reset --hard` throws away anything not yet committed. Make sure `git status` is empty before you run it.
:::

## "This branch is out-of-date"

Someone merged into `main` after you branched.

```bash
git checkout main && git pull origin main
git checkout <your branch>
git merge main                  # resolve conflicts if any, then commit
git push
```

## Merge conflict

Git marks the disagreement inside the file:

```
<<<<<<< HEAD
the line that is in main
=======
the line you wrote
>>>>>>> ui/news-card-spacing
```

Open the file, decide which version you want (or combine them), and **delete all three marker lines**. Then `git add <file>` and `git commit`.

`git status` lists the files still left to resolve.

## CI is red but it passes on my machine

Almost always one of two things:

- **A different Node version** — `node -v` must be 22 or higher
- **A new file you forgot to stage** — run `git status` and look under *Untracked files*

## The preview site is not there

- It is still building — wait a couple of minutes
- You are working from a fork. Forks do not receive a preview site, by GitHub's design — attach screenshots to the pull request instead
- The build failed — check the *build* check on the pull request

## The page loads but nothing works

Menus open, the layout looks fine, but clicking does nothing. That means the main JavaScript file failed to load. Open the browser console (`F12`) and look for red lines.

## Still stuck

- Ask in Discord, or open a **draft pull request** with `[help]` in the title
- If your change touches anything in the "ask first" list ([What you can change](/contributing)), write one paragraph in the pull request describing what you want to do and why **before** writing code. It is much faster than writing it twice
