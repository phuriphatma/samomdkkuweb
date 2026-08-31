# Prerequisites

You need three things before you can run the project locally.

## Requirements

- **Node.js 22 or newer** — download the LTS build from [nodejs.org](https://nodejs.org)
- **Git** — already installed on macOS; on Windows get it from [git-scm.com](https://git-scm.com)
- **A GitHub account** — free at [github.com](https://github.com)
- **GitHub CLI** (`gh`) — optional, but it makes every step shorter ([cli.github.com](https://cli.github.com))

::: warning Node 20 will not work
`npm test` fails immediately on Node 20, because the database library needs a WebSocket that Node 20 does not have. Always check with `node -v` first.
:::

## Check what you have

Open a terminal and run:

```bash
node -v        # must print v22 or higher
git --version
gh --version   # skip if you did not install it
```

::: tip Opening a terminal
**macOS** — press `⌘ + Space`, type `Terminal`, press Enter
**Windows** — press the Windows key, type `Terminal`, press Enter
**VS Code** — menu `Terminal` → `New Terminal`
:::

Command lines in this guide start with `$`. **That is the terminal's own prompt — do not type it.** Type only what follows.

## You do not need permission to contribute

Anyone with a GitHub account can propose a change immediately. Nobody has to add you to the project first.

GitHub creates your own copy of the project. You edit that copy and submit it for review. **The live site does not change until someone approves and deploys it**, so you cannot break it by accident.

Next — [Install and run](/start/install)
