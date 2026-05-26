---
name: deploy-gas
description: Redeploy the slim Apps Script files (Discord notify + Drive upload). Required after any edit to appscript/*.gs.
---

# Deploy Apps Script changes

After editing `appscript/prform.gs` or `appscript/vssound.gs`, the changes
must be deployed to the Google Apps Script project. The `/exec` URL doesn't
change between deployments.

## Which projects to deploy to

There are TWO sets of GAS projects:

| | `prform.gs` lives in | `vssound.gs` lives in |
|---|---|---|
| Production (used by both main + refactor branches now) | "prform" GAS project | "vssound" GAS project |
| Dev (legacy, no longer used) | "prform_dev" | "vssound_dev" |

Since the Supabase cutover, both Cloudflare projects point at PROD GAS for
file uploads + Discord notify. Deploy to PROD only.

Prod `/exec` URLs (set in `src/js/config.js`):
- `https://script.google.com/macros/s/AKfycbw1iHE4ALCO6J7jPTFyiJx5B_9n7Dh7j67ksuWOQW40qkSikBGtVJR3aDPKWYOkm1BX/exec` (prform)
- `https://script.google.com/macros/s/AKfycbzOd7Yp1AHkCL8gApEoZcfVQzP1m6mpQyCLlvNIYaJGTFnH7HqnuIdJTT9JBWw9c0uR/exec` (vssound)

## Procedure

For each `.gs` file that changed:

1. Open the corresponding Apps Script project at <https://script.google.com>
2. Open the main code file (usually `Code.gs` or similar)
3. ⌘A to select all → delete
4. Open `appscript/prform.gs` (or `vssound.gs`) in this repo → ⌘A → ⌘C
5. Paste into Apps Script editor
6. ⌘S to save
7. **Deploy → Manage deployments → click pencil icon next to existing
   "API executable" / "Web app" deployment → Version: New version →
   Description (optional) → Deploy**
8. The "Deployment URL" remains the same.

## What the slim .gs files expose

`prform.gs`:
- `uploadPRFile`   action — base64-uploads an image to Drive `PR_Submissions/`
- `uploadShopFile` action — base64-uploads to `SAMO_Shop/<nested path>`
  (allow-listed; lazily creates folders). Used by the SAMO Shop module
  for slips, product photos, and the PromptPay QR.
- `notifyPROnly`   action — fires the PR-team Discord webhook
- All legacy actions removed (`submitPR`, `trackPR`, etc. — Supabase handles those)

`vssound.gs` (154 lines):
- `notifyVSOnly` action — new-ticket Discord ping
- `notifyVSConsult` action — staff cross-dept consult/transfer ping
- All legacy actions removed

## Verifying the deploy worked

In browser DevTools console after the deploy:

```js
fetch('https://script.google.com/macros/s/AKfycbw1.../exec', {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({
    action: 'notifyPROnly',
    ticketId: 'PR-TEST',
    department: 'Test',
    content: 'test',
    deadlineMode: 'Normal',
  })
}).then(r => r.text()).then(console.log);
```

- Returns `{"success":true}` AND Discord pings → working
- Returns `Unknown action: notifyPROnly` → old code is still deployed
  (you forgot the "New version" step)

## When NOT to redeploy

Don't redeploy during business hours / active campaign cycles unless the
change is critical. There's no rolling deploy — the old code is replaced
atomically.

## Why we don't `clasp push` the slim files

Apps Script's clasp CLI works but adds another auth surface to maintain.
For the size of edit traffic this project gets (~weekly tops), copy-paste
is honest.
