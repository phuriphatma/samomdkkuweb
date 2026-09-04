# Install and run

One-time setup, about 15 minutes. Do the steps in order — each one assumes the one before it.

## 1. Sign in to GitHub

```bash
gh auth login
```

Answer the questions: **GitHub.com** → **HTTPS** → **Login with a web browser**. It prints a short code, opens your browser, and you paste the code there.

No `gh`? Skip this step. Step 2 has a plain-git alternative.

## 2. Get the project onto your machine

First move to wherever you keep projects — your Documents folder is fine:

```bash
cd ~/Documents
```

Then copy the project down:

```bash
gh repo clone samomdkku/samomdkkuweb
```

**You should see** a progress line ending in something like `Receiving objects: 100%`, and then your prompt back.

::: warning If it says `Repository not found` or `permission denied`
That means you have not been invited to the project yet. Nothing is wrong with your setup — take your own copy instead, which needs nobody's permission:

```bash
gh repo fork samomdkku/samomdkkuweb --clone
```

You can open pull requests either way. The one difference: **a fork does not get an automatic preview site**, because GitHub will not hand a fork the project's secrets. Ask a maintainer to invite you when you get a chance, then re-clone; previews are worth it.
:::

::: tip No `gh`?
```bash
git clone https://github.com/samomdkku/samomdkkuweb.git
```
:::

::: tip What just happened
A folder named `samomdkkuweb` now exists inside the folder you were in. It contains the whole project **and its entire history** — every change anyone has ever made. That is what git is: not just the current files, but how they got that way.
:::

## 3. Go into the folder and install the dependencies

```bash
cd samomdkkuweb
npm ci
```

`npm ci` downloads the exact library versions recorded in `package-lock.json`. It takes a minute or two and prints a lot.

**You should see** it end with something like this — and yes, it mentions vulnerabilities:

```
added 312 packages, and audited 313 packages in 47s

145 packages are looking for funding
  run `npm fund` for details

11 vulnerabilities (9 moderate, 2 high)

To address issues that do not require attention, run:
  npm audit fix
```

::: tip That vulnerability count is not a problem, and you should not fix it
This is the single most alarming-looking thing in the whole setup, and it is
normal. Almost every JavaScript project prints it. The warnings are about
build-time tools, not about anything a student's browser ever runs.

⛔ **Do not run `npm audit fix`.** It rewrites `package-lock.json` — the file
whose entire job is pinning exact versions so everyone builds the same thing —
and you would be submitting a change nobody asked for that is hard to review.

**The only word that means failure here is `ERR!`.** If you do not see `ERR!`,
the install worked, whatever the numbers above say.
:::

Use `npm ci`, not `npm install` — `ci` installs the exact versions CI uses, so "works on my machine" means something.

From here on, **every command on these pages is run from inside this folder.** If a command says "not found" or "no such file", check where you are with `pwd` first.

## 4. Add the database credentials

This is the step people get stuck on, so it is spelled out in full.

### 4a. What the file is

You are creating one file called **`.env.local`**, directly inside `samomdkkuweb/` — the same folder that contains `package.json`. Not in `src/`, not in `docs/`.

The leading dot matters. A filename starting with `.` is hidden by default on both macOS and Windows, which is why you may not see it in Finder or Explorer afterwards. That is normal.

### 4b. Create it

The project ships an example with the right names already in it. Copy that, from the terminal, in the project folder:

```bash
cp .env.local.example .env.local     # macOS / Linux
```

```powershell
Copy-Item .env.local.example .env.local    # Windows PowerShell
```

Then open your new file in an editor:

```bash
code .env.local         # VS Code
open -e .env.local      # macOS TextEdit
notepad .env.local      # Windows
```

### 4c. Replace the placeholders with what a maintainer sent you

The file you copied already has the four names in it, each with an obvious placeholder value. Replace the values, keeping the names exactly as they are:

- `SUPABASE_DEV_URL` — the address of the development database
- `SUPABASE_DEV_ANON_KEY` — the public key the browser uses
- `SUPABASE_DEV_ACCESS_TOKEN` — used by the migration tools
- `SUPABASE_DEV_DB_URL` — the direct database connection

One `NAME=value` per line. **No spaces around the `=`, and no quotation marks** — a value in quotes is read as a value that includes the quotes. Save the file. Nothing else has to be told about it — the project reads it automatically the next time it starts.

::: danger Two rules, both non-negotiable
**`.env.local` is already listed in `.gitignore`, so git ignores it. Never change that**, and never move these values into a file that is tracked. A key committed once stays in the history for ever, and this repository is public.

**`samo-dev` is a copy of real student data, not fake data.** Click, submit, and delete freely — that is what it is for. But never publish its URL, never copy records out of it, and never paste its contents into a chat or an issue.
:::

### 4d. Check it worked

```bash
npm run env:check
```

**You should see:**

```
✓ all four SUPABASE_DEV_* values are present and filled in
✓ the development database answered

You are set up. Run `npm run dev` and open the address it prints.
```

Anything else names the problem and what to do about it. The three that actually happen: the file is in the wrong folder, one line got wrapped in two when you pasted it, or one value is still the placeholder because you pasted three of the four.

::: warning Not `npm run dev:check`
That is a different command, for maintainers. It compares the development database against **production**, so it needs production credentials that you do not have and should not be sent — and it fails with `✗ PRODUCTION: URL or anon key missing`, which looks like your keys are wrong when they are fine.
:::

### 4e. If you do not have the credentials yet

`npm run dev` still starts and the site still loads. You will get the layout, the styling and the navigation, and **empty lists wherever data would be**, sometimes with an error in the browser console. That is enough for a pure CSS or copy change. It is not enough to test a form, a login, or anything that saves.

## 5. Run it

```bash
npm run dev
```

It prints something like:

```
  VITE v6.3.5  ready in 412 ms

  ➜  Local:   http://localhost:5174/
```

**Always open the address it printed**, not one you remember. Your browser usually opens it for you.

You should get this — the real site, running on your own machine:

![The portal running at localhost:5174](/start/local-running.png)

::: tip Passport is at `/passport/`, on the same address
`npm run dev` starts **both** apps and serves them under one address, the same
way the real site does:

- `http://localhost:5174/` — the portal
- `http://localhost:5174/passport/` — SAMO Passport

![SAMO Passport running under the same dev address](/start/local-passport.png)

You do not need a second command or a second port. Under the hood it runs two
Vite servers and proxies `/passport` to the second one — passport needs its own
build settings — but that is an implementation detail you can ignore.

⚠️ **This changed on 2026-09-04.** Before that, `npm run dev` served the portal
only and `/passport/` answered **200 with the portal's own page** — the wrong
app wearing the right URL, with nothing to tell you. If you find a guide or a
note anywhere saying Passport is unavailable in development, it is out of date.

`npm run dev:web` still starts the portal alone, and `npm run dev:passport`
starts Passport alone, if you ever want one without the other.
:::

::: warning The port is 5174 — until it is not
`5174` is the port the project asks for. If something else on your machine is already using it — most often a second copy of this same project, left running in another terminal window — **Vite quietly moves to the next free port** and tells you:

```
Port 5174 is in use, trying another one...
➜  Local:   http://localhost:5175/
```

Everything works exactly the same on 5175. Read the address off the terminal each time and you will never be caught by this.

To use 5174 instead, find the other process and stop it. The usual fix is to press `Ctrl + C` in whichever terminal window is still running it. If you cannot find it:

```bash
lsof -ti:5174 | xargs kill      # macOS / Linux
```

```powershell
netstat -ano | findstr :5174    # Windows — note the PID, then:
taskkill /PID <the-pid> /F
```
:::

**If the SAMO site loads, you are done.** Edit any file under `src/` and the page updates by itself — no rebuild, no refresh. Press `Ctrl + C` in the terminal to stop the server.

::: tip Two terminal windows is the comfortable setup
Leave `npm run dev` running in one window and type everything else in a second. Otherwise you are stopping and restarting the server all day.
:::

## Commands you will use

| Command | What it does |
|---|---|
| `npm run dev` | Runs the site on your machine, usually at `localhost:5174` |
| `npm test` | Runs the test suite. CI runs this exact one on your pull request |
| `npm run build` | Builds the production files — proves nothing is broken before you push |
| `npm run env:check` | Checks your `.env.local` credentials work |
| `npm run preview:url` | Prints the preview address for the branch you are on |

## Where things live

| To change | Edit |
|---|---|
| Pages, tabs, dialogs | `src/html/` |
| Colours, spacing, layout | `src/css/` |
| Behaviour, buttons, forms | `src/js/` |
| Text of the release notes | `src/data/changelog.js` |

Next — [Where the site runs](/start/where-it-runs)
