# Prerequisites

Two kinds of thing: **software you install yourself**, and **access you have to ask a person for**. Get the asking started first, because it is the only part that waits on somebody else.

## 1. Ask for the database credentials now

The project cannot run without them, and they are not in the repository — they never will be, because a public repository is readable by everybody.

**Message a maintainer and ask for "the `SUPABASE_DEV_*` block for `.env.local`".** That sentence is enough; they will know what you mean.

::: tip What you are asking for, in plain terms
The site is a shop window; the database is the stockroom behind it. The code is public, the stockroom is not. What you are asking for is a key to the **practice** stockroom (`samo-dev`) — a copy of the real one that you can rearrange without anyone noticing.
:::

You will be sent four lines that look like this — real values, not these:

```
SUPABASE_DEV_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_DEV_ANON_KEY=eyJhbGciOi…
SUPABASE_DEV_ACCESS_TOKEN=sbp_…
SUPABASE_DEV_DB_URL=postgresql://…
```

[Install and run](/start/install) shows exactly where to put them. Read the rest of this page while you wait.

::: tip You will probably get a link that stops working — that is on purpose
A maintainer should send these through a **self-destructing link** rather than
pasting them into a chat. So expect a URL that opens once, or expires after a
day, and possibly a password sent separately by another route.

**Open it, copy all four lines somewhere safe, and finish the setup** — if you
leave it and come back tomorrow the link may be dead and you will have to ask
again. That is the system working, not a mistake.
:::

::: danger Do not paste them into a public place
Not into a GitHub issue, not into a pull request, not into a group chat with people outside the team. If you think a key has been seen by the wrong people, say so immediately — replacing one takes a maintainer about two minutes, and saying nothing is the only expensive option.
:::

### Why is there a key at all, if the data is only a copy?

Because it is a copy of **real student records** — real names, real รหัสนักศึกษา, real photographs. It was copied so you could click Delete without a person losing anything, not because it is fake. Treat what you can see there exactly as you would treat the live site.

## 2. Software to install

| What | Why | Where |
|---|---|---|
| **Node.js 22 or newer** | Runs the project and its tests | [nodejs.org](https://nodejs.org) — take the LTS build |
| **Git** | The tool that tracks and sends your changes | Already on macOS · Windows: [git-scm.com](https://git-scm.com) |
| **A GitHub account** | Where the project lives and where changes are reviewed | Free at [github.com](https://github.com) |
| **A code editor** | Anything works. [VS Code](https://code.visualstudio.com) is free and has a built-in terminal | |
| **GitHub CLI** (`gh`) — optional | Turns several browser steps into one command | [cli.github.com](https://cli.github.com) |

::: warning Node 20 will not work
`npm test` fails immediately on Node 20 — the database library needs a WebSocket that Node 20 does not have. Check with `node -v` before anything else. If it prints `v20.x`, install 22 and check again.
:::

## 3. The terminal — where every command in these pages goes

Everything written in a grey box on these pages is typed into the **terminal**, one line at a time, pressing Enter after each. It is not typed into your editor, and not into a browser.

::: tip Opening one
**macOS** — press `⌘ + Space`, type `Terminal`, press Enter
**Windows** — press the Windows key, type `Terminal`, press Enter
**VS Code (either system)** — menu `Terminal` → `New Terminal`. This one is the most convenient, because it opens already pointing at your project.
:::

Three things worth knowing before you start:

- **The terminal is always "in" one folder.** `pwd` prints which one. `cd <folder>` moves into another. Almost every command in this guide only works while you are inside the project folder — that is the single most common reason a command "does not work".
- **`Ctrl + C` stops whatever is running.** On macOS too — `Ctrl`, not `⌘`. Use it to stop the development server.
- **A command that prints nothing usually worked.** Silence is success. Errors are loud.

Now check what you have:

```bash
node -v          # must print v22 or higher
git --version
gh --version     # skip this line if you did not install gh
```

::: warning The `$` you see in other guides
Some guides prefix commands with `$` or `%`. That is the terminal's own prompt, printed by the terminal — **not something you type.** The boxes on these pages never include it, so you can copy them whole.
:::

## 4. You do not need permission to contribute

Anyone with a GitHub account can propose a change today. Nobody has to add you to the project first.

GitHub gives you your own copy of the project. You change your copy and submit it for review. **The live site does not move until a maintainer approves the change and then separately deploys it** — two deliberate steps, both by someone else. You cannot break the live site by accident, and nothing you do on your own machine reaches a student.

The one thing you do need a person for is the database key in step 1. That is a convenience, not a permission: it is what makes your local copy show real-shaped content instead of empty screens.

Next — [Install and run](/start/install)
