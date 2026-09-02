# Where the site runs

There are **four** places this site exists, and confusing two of them is the most expensive mistake a new contributor can make. This page is short on purpose; it is worth reading once, properly.

![Your machine and the preview site both use a copy of the database; only the live site uses the real one](../diagrams/environments.svg)

## The four places

### 1. Your machine — `localhost:5174`

**Who can see it:** only you. Nobody else, not even on the same wifi.

You start it with `npm run dev` and it stops when you close the terminal or press `Ctrl + C`. It rebuilds as you type, so it is where you do the actual work.

`localhost` means *this computer*. The address is not on the internet; typing it on a different machine reaches that machine's own nothing.

### 2. The preview site — `<your-branch>.samomdkkuweb.pages.dev`

**Who can see it:** anyone you send the link to. No install, no account, no VPN.

Every branch you push gets one, built automatically, updated on every push. The address comes from the branch name: `ui/news-card-spacing` becomes `https://ui-news-card-spacing.samomdkkuweb.pages.dev`.

This is the one to send to your ฝ่าย for an opinion. It is a real site on a real phone, which your `localhost` can never be.

```bash
npm run preview:url    # prints the address for the branch you are on
```

### 3. The live site — `samo.md.kku.ac.th`

**Who can see it:** every student and every member of staff in the faculty.

It runs on a KKU server. Merging your work does **not** put it here — a maintainer has to connect to the KKU VPN and deploy, usually batching several merged changes together. See [Your first change](/start/first-change), step 8.

### 4. `samomdkkuweb.pages.dev` (no branch prefix) — retired

You may find this address in an old message or an old document. **It is not the live site and has not been since the move to the KKU server.** It still answers, and it redirects — which means a check against it can look perfectly healthy while telling you nothing. Never test against it.

## The database is a separate question

The four addresses above are *where the code runs*. Which **database** each one talks to is a different axis, and it is the axis that actually matters for safety.

| Runs at | Database | What a Delete button really deletes |
|---|---|---|
| Your machine | `samo-dev` — a copy | nothing anybody depends on |
| A preview site | `samo-dev` — a copy | nothing anybody depends on |
| The live site | the real one | a real student's real record |

Two consequences worth holding on to:

**Everything you can reach as a contributor is pointed at the copy.** Submit the form. Delete the record. Break it on purpose and see what the error looks like. That is what a development database is for, and being timid with it just means bugs get found by students instead.

**But the copy contains real people.** It was copied so that *actions* are safe, not so that the *data* is fake. Real names, real รหัสนักศึกษา, real photographs. Screenshots of it are screenshots of real students, so do not put them in a public pull request without blurring; do not paste rows into a chat; do not publish the URL.

::: danger The one that is not a copy
If an address ends in `samo.md.kku.ac.th`, you are on the live site and the real database. Nothing there is practice. Contributors have no reason to be signed in there at all.
:::

## "Which one am I looking at?"

- The address bar starts with `localhost` → **your machine**.
- The address ends in `.pages.dev` and has a branch name in front → **a preview**.
- The address is `samo.md.kku.ac.th` → **live**. Stop and think before you click anything that writes.

**A preview also says so on the page**: every `*.pages.dev` build paints a `PREVIEW` ribbon, and that signal comes from the address itself, so it cannot be forgotten when a machine is rebuilt.

Read that ribbon in one direction only. **A ribbon means you are not on production. No ribbon does not mean you are.** A local run usually shows nothing at all, because the ribbon is switched on by a setting that a plain `npm run dev` does not set — and that polarity is deliberate: the alternative would paint `PREVIEW` across the live site the first time somebody forgot a variable on the server. So the address bar remains the thing you trust.

Next — [Your first change](/start/first-change)
