# Install and run

One-time setup, about 10 minutes.

## 1. Sign in to GitHub

```bash
gh auth login      # choose GitHub.com → HTTPS → Login with a web browser
```

## 2. Get the project

Pick one, depending on whether you have been invited to the project.

```bash
# Option A — you are already a collaborator
gh repo clone phuriphatma/samomdkkuweb

# Option B — you are not (this is the default, and needs nobody's permission)
gh repo fork phuriphatma/samomdkkuweb --clone
```

Both options let you open pull requests here. There is one difference: **option B does not get an automatic preview site**, because GitHub does not give forks access to the project's secrets. If you expect to contribute often, ask a maintainer to invite you as a collaborator and use option A.

## 3. Install dependencies

```bash
cd samomdkkuweb
npm ci
```

`npm ci` installs the exact versions recorded in `package-lock.json`. It is slightly slower than `npm install`, and it gives you the same packages that CI uses.

## 4. Add the database credentials

Ask a maintainer for the `SUPABASE_DEV_*` block, then create a `.env.local` file in the top folder of the project.

::: danger Two rules that matter
`.env.local` is already in `.gitignore`. **Do not change that.**

`samo-dev` is a **copy of real student data**, not fake data. Click and submit freely, but never publish its URL and never copy data out of it.
:::

## 5. Run it

```bash
npm run dev
```

Open `http://localhost:5174` in a browser. **If the SAMO site loads, you are done.**

The page reloads automatically when you edit a file. Press `Ctrl + C` in the terminal to stop the server.

## Commands you will use

| Command | What it does |
|---|---|
| `npm run dev` | Runs the site locally at `localhost:5174` |
| `npm test` | Runs the test suite — CI runs the same one on every pull request |
| `npm run build` | Produces the production files; use it to check nothing is broken |
| `npm run preview:url` | Prints the preview address for the branch you are on |

## Where things live

| To change | Edit |
|---|---|
| Pages, tabs, dialogs | `src/html/` |
| Colours, spacing, layout | `src/css/` |
| Behaviour, buttons, forms | `src/js/` |

Next — [Your first change](/start/first-change)
