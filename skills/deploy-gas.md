---
name: deploy-gas
description: Redeploy the slim Apps Script file (Drive upload + projects email). Required after any edit to appscript/prform.gs.
---

# Deploy Apps Script changes

After editing `appscript/prform.gs`, the change must be deployed to the
Google Apps Script project. The `/exec` URL doesn't change between deployments.

> Discord notifications moved OFF GAS to the Cloudflare Pages Function
> `/notify` (see `skills/cloudflare-notify-function.md`). `vssound.gs` was
> deleted (it was Discord-only) and `prform.gs` no longer has any Discord
> code — GAS now only does Drive uploads + the projects email.

## Which project to deploy to

Only `prform.gs` remains. Deploy to the PROD "prform" GAS project (the legacy
"prform_dev" / the whole "vssound" project are no longer used).

Prod `/exec` URL (set as `GAS_API_URL` in `src/js/config.js`):
- `https://script.google.com/macros/s/AKfycbw1iHE4ALCO6J7jPTFyiJx5B_9n7Dh7j67ksuWOQW40qkSikBGtVJR3aDPKWYOkm1BX/exec` (prform)

## Procedure — automated (preferred)

```bash
npm run deploy:gas
```

`tools/deploy-gas.mjs` does: pull the remote → **diff it against the repo** →
push → `create-version` → `update-deployment` on the EXISTING deployment →
probe the live `/exec` to prove the new code is serving.

Flags:

| flag | what it does |
|---|---|
| `--dry-run` | diff + report only; writes nothing |
| `--force` | proceed even though the remote has changes the repo does not |
| `--verify` | only probe the live endpoint (no auth or script id needed) |

### One-time setup (credentials — yours, not the agent's)

1. `npx clasp login` — opens a browser, writes `~/.clasprc.json`. **Never commit
   that file.** It is a Google OAuth credential for your whole account.
2. Turn on the Apps Script API for the *same* Google account:
   <https://script.google.com/home/usersettings> → "Apps Script API: ON".
   Without it every clasp call fails with *"User has not enabled the Apps Script
   API"*.
3. Add the script id to `.env.local` (gitignored):
   ```
   GAS_SCRIPT_ID=<Apps Script project → ⚙ Project Settings → IDs → Script ID>
   ```
   You do **not** need to set a deployment id: the script derives it from
   `GAS_API_URL` in `src/js/config.js`, whose path segment IS the deployment id.
   That matters here — this project has **three** deployments (one `@HEAD`, the
   live web app, and an old `@25` kept for rollback), so "pick the only non-HEAD
   one" would be ambiguous and rolling the wrong one looks exactly like the
   deploy having done nothing. Override only to deploy an endpoint config.js does
   not reference:
   ```
   GAS_DEPLOYMENT_ID=<Deploy → Manage deployments → the id in the URL>
   ```

### Why it works the way it does

- **It never runs `clasp deploy`.** That command (`create-deployment`) mints a
  NEW deployment with a NEW `/exec` URL. `GAS_API_URL` in `src/js/config.js` is
  hard-coded to the existing one, so a new deployment presents as "every upload
  silently fails". The script always does `create-version` +
  `update-deployment <same id>`, which is exactly the manual "Version: New
  version" step, so the URL never moves.
- **It diffs the remote first.** Anyone can edit the script in the browser.
  Pushing is a silent overwrite with no undo, so remote-only lines stop the
  deploy and print themselves; a full copy lands in `.gas-remote/` for
  `diff .gas-remote/<file> appscript/prform.gs`. `--force` proceeds.
- **It pushes from a staging dir (`.gas-build/`), not `appscript/`.** Two
  reasons: the manifest (`appsscript.json` — oauth scopes, web-app access,
  timezone) is round-tripped from the remote instead of being authored blind, so
  a deploy can't quietly change *who has access* or force every user to
  re-authorize; and the remote code file **keeps its existing name**, so pushing
  `prform.gs` into a project whose file is `Code.gs` doesn't delete and recreate
  it on every deploy.
- **It rolls the deployment named in `config.js`.** Same source of truth as the
  verification probe, so "what we deployed" and "what we tested" cannot diverge.
  It also checks that deployment actually belongs to `GAS_SCRIPT_ID`, so a stale
  config.js or wrong script id fails with a clear message instead of inside clasp.
- **It verifies over HTTP, not by trusting clasp.** See below.

### Rolling back

Versions are immutable, so a rollback is just pointing the deployment at an older
one:

```bash
cd .gas-build && npx clasp list-versions
npx clasp update-deployment <deploymentId> -V <oldVersion>
```

Then confirm with `npm run deploy:gas -- --verify` (which will now report OLD code
— that is the expected result of a deliberate rollback).

## Verifying the deploy worked

`npm run deploy:gas` does this automatically (retrying for ~15s, because GAS
takes a moment to swap the served version). To check by hand at any time:

```bash
npm run deploy:gas -- --verify
```

The canary is `uploadTeamFile` **with no `folderPath`** — the handler validates
its argument before touching Drive, so it proves the action exists while writing
nothing:

- `{"success":false,"message":"folderPath is required"}` → **NEW code is live**
- `{"success":false,"message":"Unknown action: uploadTeamFile"}` → **OLD code**;
  the version step didn't take

## Procedure — manual fallback

If clasp is unavailable (no auth, API toggle off, someone else's machine):

1. Open the "prform" Apps Script project at <https://script.google.com>
2. Open the main code file (usually `Code.gs` or similar)
3. ⌘A to select all → delete
4. Open `appscript/prform.gs` in this repo → ⌘A → ⌘C
5. Paste into Apps Script editor
6. ⌘S to save
7. **Deploy → Manage deployments → click pencil icon next to existing
   "API executable" / "Web app" deployment → Version: New version →
   Description (optional) → Deploy**
8. The "Deployment URL" remains the same. Verify with `--verify` above — step 7
   is the one people skip, and skipping it leaves the editor showing new code
   while `/exec` runs the old.

## Where the folders live: `My Drive / IT Database`

Every folder the script touches is mounted under a single container folder,
`IT Database` (`APP_ROOT_FOLDER_NAME` in `prform.gs`) — previously they were
created straight in My Drive root and made the SAMO Drive unbrowsable:

```
My Drive/
  IT Database/
    PR_Submissions/
    Projects/<slug>_PRJ-XXXX/<slug>_DOC-XXXXX/
    SAMO_Shop/{Slips,Products,Banners,QR}/
    SAMO_Team/<ปีการศึกษา>/<ฝ่าย>/
```

The frontend still passes root-relative logical paths (`SAMO_Shop/Slips/2026-05`);
the mount point is resolved server-side by `getOrCreateTopFolder_`, so no client
knows about `IT Database` and no stored URL changed.

**Migration is lazy + self-healing.** A top-level folder still sitting at My Drive
root is *moved* in on next touch, never recreated — a Drive move preserves the
folder id and every file id inside it, so URLs already in Postgres keep resolving.
To do all four at once instead of waiting for the next upload, run
`migrateDriveLayout` by hand from the Apps Script editor (Run ▸ migrateDriveLayout);
it is idempotent, is not routed through `doPost`, and creates nothing that doesn't
already exist.

Delete paths use `findTopFolder_` (non-creating) so trashing never materialises a
tree first. If you add a new top-level folder, resolve it through
`getOrCreateTopFolder_` — never `DriveApp.getRootFolder()` directly.

`badges/` and `certificates/` at My Drive root come from the **passport** repo
(`gas/Upload.gs`), not this one; that script already supports a `FOLDER_ID`
constant to relocate them.

## What `prform.gs` exposes

- `uploadPRFile`    action — base64-uploads an image to Drive `PR_Submissions/`
- `uploadTeamFile`  action — base64-uploads to `SAMO_Team/<nested path>`
  (allow-listed; lazily creates folders). ทีม SAMO member portraits, filed
  `SAMO_Team/<ปีการศึกษา>/<ฝ่าย>/<ลำดับ>-<ชื่อ>.webp`. Doubles as the deploy canary.
- `uploadShopFile`  action — base64-uploads to `SAMO_Shop/<nested path>`
  (allow-listed; lazily creates folders). Used by the SAMO Shop module
  for slips, product photos, and the PromptPay QR.
- `uploadProjectFile` / `deleteProjectFile` / `deleteProjectFolder` /
  `getProjectFolderInfo` — Drive ops for หนังสือโครงการ attachments
- `notifyProjectEmail` action — `MailApp.sendEmail` to uni_staff
- All Discord actions removed (moved to the `/notify` Cloudflare Function);
  all legacy actions removed (`submitPR`, `trackPR`, etc. — Supabase handles those)

## Verifying the deploy worked

In browser DevTools console after the deploy — a deliberately bad action
proves the new code is live without side effects:

```js
fetch('https://script.google.com/macros/s/AKfycbw1.../exec', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'notifyPROnly' })  // a removed action
}).then(r => r.text()).then(console.log);
```

- Returns `{"success":false,"message":"Unknown action: notifyPROnly"}`
  → NEW code is live (the Discord action is gone, as expected)
- Returns `{"success":true}` → OLD code still deployed (you forgot the
  "New version" step; the deleted Discord handler is still running)

## Where the logs DO and DON'T appear (read this before chasing "empty Logs")

`Logger.log` / `console.log` from `doPost` are **invisible** when the
Web App is called from an unauthenticated client — i.e. our frontend
`fetch(GAS_API_URL, { method: 'POST' })` calls without an `Authorization:
Bearer` header. The GAS "Executions" panel will list the run (with
duration + status) but the Cloud Logs section will say
*"No logs are available for this execution"* permanently — not a
propagation delay, the logs are never recorded.

This is a documented GAS rule for Web Apps deployed as
*Execute as: Me + Who has access: Anyone*:

| Caller is logged into Google? | GAS project shared with caller? | Logs visible? |
|---|---|---|
| No | No | ❌ |
| No | Yes | ❌ |
| Yes | No | ❌ |
| Yes | Yes | ✅ |

Or, for script/curl callers: logs appear only if an OAuth access token
is passed. The browser fetch with no Authorization header falls in
the "❌" rows.

**Workarounds when you need to debug:**

1. **Run the function manually from the Editor** (e.g.
   `testProjectDiscord()` in `prform.gs`) — Editor runs are owner-
   authenticated, so logs always appear.
2. **Add a temporary debug echo** — make the GAS handler return the
   debug data in the HTTP response. The frontend `dbRest` / `callGAS`
   logs the response body on failure, so the data lands in the
   browser console instead of GAS's hidden Cloud Logs.
3. **Link the GAS project to GCP** (Project Settings → Google Cloud
   Platform → Change project) — once linked, Stackdriver records
   every execution's logs regardless of who called. One-time setup.
   Not currently done for this project; worth doing if Discord /
   email reliability needs deeper diagnostics next time.

**Don't waste time** redeploying repeatedly to "make the logs appear"
when calls are coming from the public frontend. They won't.

## When NOT to redeploy

Don't redeploy during business hours / active campaign cycles unless the
change is critical. There's no rolling deploy — the old code is replaced
atomically.

## Why we don't `clasp push` the slim files

Apps Script's clasp CLI works but adds another auth surface to maintain.
For the size of edit traffic this project gets (~weekly tops), copy-paste
is honest.
