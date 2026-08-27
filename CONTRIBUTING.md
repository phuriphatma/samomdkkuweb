# Contributing — samomdkkuweb

Welcome! This page is for anyone (especially a new collaborator) who wants
to contribute UI/UX or feature work without breaking production.

## What this project is

MDKKU SAMO student-portal SPA. Vite + Vanilla JS + Bootstrap 5, backed by
Supabase (Postgres + Auth + RLS). Google Apps Script (`appscript/`) survives
as a thin proxy for Discord webhooks and Drive file uploads only.

Live URLs:
- **Production**: <https://samo.md.kku.ac.th> — the KKU VM, `main` branch.
- ⚠️ **`samomdkkuweb.pages.dev` and `refactorsamomdkkuweb.pages.dev` are
  RETIRED.** They still resolve and splash-redirect to the VM, so a check
  against them can look healthy while production is stale. **Never verify a
  deploy there.** Cloudflare Pages no longer builds this project, so there are
  no per-branch preview URLs either.
- **Pushing `main` does NOT deploy.** `server/deploy.sh` runs ON the VM and is
  triggered over ssh (needs the KKU VPN). Verify from the SERVED artifact on
  `samo.md.kku.ac.th`, not from your local build — the VM builds its own asset
  hashes, so find the bundle name in the served HTML first.

## Quick start

```bash
git clone https://github.com/phuriphatma/samomdkkuweb.git
cd samomdkkuweb
npm install
# Ask Phuri for .env.local with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev          # http://localhost:5174
npm run build        # production build (run before opening a PR)
```

## Branch model

⚠️ **`refactor/modular` was merged and is no longer the staging branch** — that
migration finished (see `docs/MERGE-CHECKLIST.md`, kept as history). `main` is
the only long-lived branch.

```
main                  ← production. The maintainer commits here directly.
   ├─ ui/<topic>      ← your branch — start here
   ├─ fix/<topic>
   └─ feat/<topic>
```

Workflow:

```bash
git checkout main
git pull origin main
git checkout -b ui/<short-topic>   # e.g. ui/home-hero-redesign

# edit, commit, push…
git add <files>
git commit -m "ui: bigger headline on home"
git push -u origin ui/<short-topic>
```

There is **no preview deploy** — Cloudflare Pages is retired, so nothing
comments a per-branch URL. Review visually by running `npm run dev` locally, and
say in the PR which widths you checked (390 / 820 / 1280 is the usual set).

When happy → open a PR against `main`. The maintainer deploys to the VM after
merging; pushing does not deploy.

## Touch zones — what's safe to merge solo, what to ask first

Self-merge to `main` without review:

| Zone | Examples |
|---|---|
| `src/html/*.html` | New tabs, modals, copy edits, layout |
| `src/css/*.css` | Colors, spacing, typography, new utility classes |
| `src/js/<feature>-form.js` | New form fields, visual conditionals |
| `src/js/main.js` *(window bindings only)* | Adding `window.X = Y` for a new `onclick` |
| `index.html` | Including a new HTML partial |
| `src/projects/*` | Per-project modules (when the multi-project refactor lands) |

Ping Phuri / open a PR with `@phuriphatma` review request before merging:

| Zone | Why |
|---|---|
| `src/js/auth.js` | Supabase auth has known sharp edges — see `docs/mistakes/supabase-client.md` |
| `src/js/db.js` | Client config + `dbRest` helper, load-bearing |
| `src/js/notify.js` | Discord proxy — wrong here = silent prod outage |
| `src/js/uploads.js` | Drive upload contract with GAS |
| Any new `db.from().update/delete/insert(...)` | Use `dbRest()` with `prefer:'return=representation'` instead — see `docs/mistakes/supabase-client.md` |
| Any new `innerHTML` with user-supplied text | Run it through `escHtml()` from `utils.js` first (XSS risk) |
| `supabase/migrations/*.sql` | Schema = source of truth for the live DB |
| `appscript/*.gs` | Discord webhook URLs live here; redeploys affect prod immediately |
| Anything that adds a real-money or third-party dependency | Coordinate first |

### ฝ่าย tool contributions — added 2026-08-27

There is **one workflow**: a ฝ่าย member uses this same pull-request pipeline,
unchanged. `.github/CODEOWNERS` carries the whole difference — see
`docs/DEPT-TOOLS.md` §0b, and `skills/onboard-a-contributor.md` for the
45-minute session that gets someone from nothing to a merged PR.

| Path | Approval |
|---|---|
| `public/embed/**` — a page in the sandbox frame | any collaborator |
| `src/data/tools.js` · `src/tools/` · `src/js/data/` | the owner |

⚠️ **Enabled 2026-08-27 and true now**: CI (`build`) must pass before a merge,
and `CODEOWNERS` **blocks** rather than merely requests. Before that date a pull
request with the whole suite red was mergeable, and any one collaborator could
approve a change to `auth.js`.

## How to test without spamming production

Both branches hit the same Supabase project and the same Discord channels.
**For UI-only edits this is fine**. If your change involves submitting a
form or writing to the DB, suppress the Discord ping:

- **PR form**: tick the "ส่ง Discord แบบเงียบ" / "ข้าม Discord" checkbox
  (skipDiscord) before submitting.
- **VS form**: tick "ส่งเงียบไม่ ping" (vsSilentNotify) before submitting.
- **Or sign in as the dev test account** Phuri gave you — submissions from
  that account by convention go through the silent path.

After testing: ask Phuri to delete the `TEST-` / test rows. Don't leave
test data sitting in the kanban.

## Hard "don'ts"

These all come from real bugs already paid for. The write-ups are in
`docs/mistakes/*.md` (`grep -rin "<symptom>" docs/mistakes/`); the index and the
recurring classes are in `.claude/rules/mistakes.md`. Highlights:

1. **Don't put async supabase calls inside `db.auth.onAuthStateChange`** —
   it deadlocks every subsequent supabase call. Wrap the body in
   `setTimeout(0)` instead (already done in `auth.js`).
2. **Don't use `navigator.sendBeacon` for GAS endpoints** — sendBeacon
   doesn't follow redirects, GAS always 302-redirects. Use `fetch(url, { keepalive: true })`.
3. **Don't re-enable `autoRefreshToken` in the supabase client** — it stalls
   submissions. We refresh on a 25-min interval instead.
4. **Don't trust `db.from().update().eq()` to fail loudly when blocked by RLS** —
   it returns `{data:null, error:null}` silently. Use `dbRest()` with
   `prefer:'return=representation'` and check `data.length > 0`.
5. **Don't interpolate user-text into innerHTML** — wrap it with
   `escHtml()` from `utils.js`. URL fields use `safeUrl()`.
6. **Don't call `form.reset()` without re-populating hidden submitter
   inputs and `fileInput.value = ''`** — they don't reset cleanly.

## Commit / PR style

- Branch names: `ui/<topic>`, `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
- Commit messages: present tense, lowercase prefix.
  - `ui: bigger headline on home`
  - `fix: announcement delete confirms before deleting`
  - `feat: add status filter to PR kanban`
- One concern per PR if possible. Smaller PRs = faster reviews.
- Run `npm test && npm run build` locally before pushing. CI runs both;
  doing it locally first catches typos faster.

### Tests

`npm test` runs the whole Vitest suite — it prints the count, and this page
deliberately does not, because the last number written here went ~600 tests out
of date before anyone noticed. It is two different things:

1. **Unit tests** for pure helpers — `src/js/utils.js` (escaping, URL sanitizer,
   JWT decode), the Drive-URL normalizer, `study-year.js`, name splitting. If you
   add a pure helper, add a few cases next to it.
2. **Ratchets** — sweeps that read the whole codebase and fail when a known-bad
   SHAPE reappears: a `confirm()`/`prompt()` used as control flow, an upload site
   with no answer for the file it replaces, a `DELETE` that cannot tell "blocked"
   from "done", a SECURITY DEFINER function that refuses people on a role list
   alone, an identifier read but bound nowhere. Each exists because the same bug
   was paid for twice. **If one fails, do not weaken the assertion** — the
   allow-lists inside them are meant to shrink, never grow.

So we DO test markup and behaviour now, statically: several ratchets read
`src/html/*.html` and assert structure and copy rules that were reported by
users. `skills/write-a-guard.md` is required reading before adding one.

### Live proofs — `npm run proofs`

Some invariants only exist in the database (RLS policies, SECURITY DEFINER
functions, column guards). Those are checked by SQL/Node proofs that run against
the real project inside a rolled-back transaction, and `npm run proofs` runs all
of them and prints one verdict each.

**Run it if you touched a migration, a policy, or a definer function.** It needs
`SUPABASE_ACCESS_TOKEN` in `.env.local`, so CI does not run it — a maintainer
does, before deploying. Output it cannot interpret is reported as UNKNOWN and
exits non-zero, so a green line means green.

## Where to learn more

- **`STATE.md`** — what's currently in flight, what just shipped
- **`CLAUDE.md`** — project router for AI agents (you can read it too)
- **`docs/CONTEXT.md`** — architecture, schema, RLS policies, deploy plumbing
- **`docs/MERGE-CHECKLIST.md`** — HISTORICAL: the `refactor/modular` → `main` cutover, already done
- **`docs/PROJECT-ARCHITECTURE.md`** — proposed (deferred) multi-project engine design
- **`docs/mistakes/*.md`** — every bug we've already fixed, with the *why*.
  Nine files by area; `.claude/rules/mistakes.md` indexes them and states the
  recurring classes

## Need help?

- Ping Phuri in Discord or open a draft PR with `[help]` in the title.
- For anything that touches the "ask first" zone, draft a one-paragraph
  description in the PR body — what you want to change and why — before
  writing code. Much faster than re-doing the work after.
