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

## Procedure

1. Open the "prform" Apps Script project at <https://script.google.com>
2. Open the main code file (usually `Code.gs` or similar)
3. ⌘A to select all → delete
4. Open `appscript/prform.gs` in this repo → ⌘A → ⌘C
5. Paste into Apps Script editor
6. ⌘S to save
7. **Deploy → Manage deployments → click pencil icon next to existing
   "API executable" / "Web app" deployment → Version: New version →
   Description (optional) → Deploy**
8. The "Deployment URL" remains the same.

## What `prform.gs` exposes

- `uploadPRFile`    action — base64-uploads an image to Drive `PR_Submissions/`
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
