# Contributing — samomdkkuweb

Welcome! This page is for anyone (especially a new collaborator) who wants
to contribute UI/UX or feature work without breaking production.

## What this project is

MDKKU SAMO student-portal SPA. Vite + Vanilla JS + Bootstrap 5, backed by
Supabase (Postgres + Auth + RLS). Google Apps Script (`appscript/`) survives
as a thin proxy for Discord webhooks and Drive file uploads only.

Live URLs:
- **Production**: <https://samomdkkuweb.pages.dev> ← `main` branch
- **Preview / staging**: <https://refactorsamomdkkuweb.pages.dev> ← `refactor/modular` branch
- Cloudflare Pages also generates a per-branch preview URL for any branch you push.

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

```
main                  ← production. Touched only via PR + review.
└─ refactor/modular   ← staging. Direct merges from feature branches OK.
   ├─ ui/<topic>      ← your branch — start here
   ├─ fix/<topic>
   └─ feat/<topic>
```

Workflow:

```bash
git checkout refactor/modular
git pull origin refactor/modular
git checkout -b ui/<short-topic>   # e.g. ui/home-hero-redesign

# edit, commit, push…
git add <files>
git commit -m "ui: bigger headline on home"
git push -u origin ui/<short-topic>
```

Cloudflare Pages will comment a per-branch preview URL on the GitHub PR
or commit. Use that URL to review the change visually before merging.

When happy → merge your branch into `refactor/modular` (preview deploy updates).
After a day or two of stability → PR `refactor/modular` → `main`.

## Touch zones — what's safe to merge solo, what to ask first

Self-merge to `refactor/modular` without review:

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
| `src/js/auth.js` | Supabase auth has known sharp edges — see `.claude/rules/mistakes.md` |
| `src/js/db.js` | Client config + `dbRest` helper, load-bearing |
| `src/js/notify.js` | Discord proxy — wrong here = silent prod outage |
| `src/js/uploads.js` | Drive upload contract with GAS |
| Any new `db.from().update/delete/insert(...)` | Use `dbRest()` with `prefer:'return=representation'` instead — see `mistakes.md` |
| Any new `innerHTML` with user-supplied text | Run it through `escHtml()` from `utils.js` first (XSS risk) |
| `supabase/migrations/*.sql` | Schema = source of truth for the live DB |
| `appscript/*.gs` | Discord webhook URLs live here; redeploys affect prod immediately |
| Anything that adds a real-money or third-party dependency | Coordinate first |

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

These all come from real bugs already paid for. Read `.claude/rules/mistakes.md`
for the full list and the *why*. Highlights:

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

We have a small Vitest suite covering the pure helpers in
`src/js/utils.js` and the Drive-URL normalizer in `src/js/uploads.js`
(escape functions, URL sanitizer, JWT decode). Run with `npm test`.

If you add a new pure helper in `utils.js`, please add a few test cases
to `src/js/utils.test.js`. We don't test DOM-touching code (too painful
for the value) — visual review on the preview deploy covers that.

## Where to learn more

- **`STATE.md`** — what's currently in flight, what just shipped
- **`CLAUDE.md`** — project router for AI agents (you can read it too)
- **`docs/CONTEXT.md`** — architecture, schema, RLS policies, deploy plumbing
- **`docs/MERGE-CHECKLIST.md`** — steps to follow when merging `refactor/modular` → `main`
- **`docs/PROJECT-ARCHITECTURE.md`** — proposed (deferred) multi-project engine design
- **`.claude/rules/mistakes.md`** — every bug we've already fixed, with the *why*

## Need help?

- Ping Phuri in Discord or open a draft PR with `[help]` in the title.
- For anything that touches the "ask first" zone, draft a one-paragraph
  description in the PR body — what you want to change and why — before
  writing code. Much faster than re-doing the work after.
