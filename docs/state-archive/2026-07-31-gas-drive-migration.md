# Archived from STATE.md 2026-07-31 — the GAS + Drive migration, in full

Kept because the sequencing is the reusable part. Summary lives in STATE.md;
the bug classes are in `.claude/rules/mistakes.md`.

## APPS SCRIPT — automated deploys (new)

`npm run deploy:gas` (`tools/deploy-gas.mjs`). Live state: script `179DfoS1…`,
deployment `AKfycbw1iHE4…` **@51**, `/exec` URL unchanged.

- Setup already done on this Mac: `npx clasp login` (as
  `mdstuddata.beta@gmail.com`), Apps Script API enabled, `GAS_SCRIPT_ID` in
  `.env.local`.
- **Never runs `clasp deploy`** — that mints a NEW deployment with a NEW `/exec`
  URL while `GAS_API_URL` stays hard-coded, which presents as "every upload
  silently fails". It does `create-version` + `update-deployment` on the same id.
- The deployment id is derived from `GAS_API_URL` in `src/js/config.js` (its path
  segment IS the id). That matters: this script has **THREE** deployments (one
  `@HEAD`, the live web app, an old `@25` kept for rollback), so "pick the only
  non-HEAD one" is ambiguous.
- Diffs the remote before overwriting and refuses if the remote has lines the
  repo doesn't (someone edited in the browser); `--force` overrides,
  `--dry-run` reports only, `--verify` probes the live endpoint.
- Canary: `POST {action:'uploadTeamFile'}` with no `folderPath` → the handler
  validates before touching Drive, so it proves the new code is serving while
  writing nothing. `folderPath is required` = new, `Unknown action` = old.
- Rollback: `cd .gas-build && npx clasp update-deployment AKfycbw1iHE4… -V 50`.

### Drive layout: `My Drive / IT Database` + canonical names (@49, DONE)

```
My Drive/IT Database/
├── PR/        (was PR_Submissions, id 19eMp-bjx7…, 200 children)
├── Projects/  (id 1_Gm-XvN…, 22 children)
├── Shop/      (was SAMO_Shop)
├── Team/      (was SAMO_Team)
└── Passport/  ← badges/ + certificates/, written by the PASSPORT script
```

The `SAMO_` prefixes existed to namespace folders sitting loose in My Drive
root; the container does that now, so they were dropped and the casing made
uniform. **Verified live: every folder kept its original id** — the resolver
only moves/renames, so no stored URL changed and nothing was backfilled.

- **Shipped expand-then-contract, GAS first.** @49 teaches `TOP_FOLDER_CANON`
  (both the rename map AND the transition allow-list — either spelling
  resolves), then the frontend switched to the canonical names. The reverse
  order would have failed every upload on the allow-list. Legacy keys stay
  until no deployed bundle can send them.
- **`fileLivesUnderTop_` is the trap to remember**: the ancestry guards match
  BY NAME and gate DELETION, so a rename would have silently made every
  slip/file delete refuse. They canonicalise through the same map now.
- `migrateDriveLayout` / `inspectDriveLayout` are editor-only (no `doPost`
  route); they only move/rename, verify child counts before+after, REFUSE a
  split, and never create a folder that doesn't exist.
- **DONE — passport now has clasp tooling too.** `passport/tools/deploy-gas.mjs`
  (port of this repo's; reads `VITE_GAS_UPLOAD_URL`, inert `{action:'ping'}`
  canary, needs `GAS_SCRIPT_ID` in that repo's `.env.local`). `gas/Upload.gs`
  deployed as **v5**, live-verified `{"ok":true,"layout":"IT Database/Passport"}`.
- **PENDING (one click, no urgency)**: `badges`/`certificates` are still at My
  Drive root. Run ▸ `migrateDriveLayout` in the `samopassport` editor to move
  them now, or leave it — the next real badge upload adopts them automatically.
- **DONE**: the Apps Script projects are Drive files too, and now live in
  `IT Database/_Scripts/` — `prformweb` (the Sheet this script is bound to) and
  `samopassport`. `Uploadbadgesamopassport` (dead prototype) is trashed,
  recoverable ~30 days. Done by a run-once `tidyScriptFiles()` in @50, removed
  again in @51. **Moving the container Sheet did NOT disturb the deployment** —
  proven by the @51 deploy + live probe afterwards.
- **PENDING (setup, yours)**: `clasp run` — see `skills/deploy-gas.md`. Needs a
  standard GCP project attached to the script, a Desktop OAuth client, and an
  **API Executable** deployment. That extra deployment does NOT touch the web
  app `/exec` URL (different entry-point type) but does make
  `list-deployments` show four. Bounded by discipline, not technically: the
  `scripts.run` token carries the script's Drive scope.

### DONE — prformweb → standalone `samoweb` (code side complete)

Why: a container-bound script is stored INSIDE its container, so trashing the
unused `prformweb` spreadsheet would have taken the script AND every deployment
with it — killing PR/shop/projects/team uploads and the projects email at once,
with no obvious cause. That is a single point of failure behind a file that
looks like junk.

- New STANDALONE script **`samoweb`** = `1lENmMdToG_PTrIo1ytJbalhN5EviIiVuAU8o3yiOQlgvGJN6tcFDCVVp`
  Code verified **byte-identical** to `appscript/prform.gs`; manifest copied
  verbatim from the old project so `executeAs`/`access` could not drift.
- Deployment `AKfycbwomKii…` @1, owner-authorized, live-verified.
- `src/js/config.js` now points at it; built bundle carries the new URL.
- **The OLD script + deployment are deliberately STILL LIVE** so bundles cached
  before this change keep working. Both run identical code under the same
  account and resolve the SAME Drive folders, so the overlap is behaviourally
  indistinguishable and NO data moves.

- **DEPLOYED** to the VM 2026-07-31. Verified in the SERVED bundle:
  `/assets/analytics-BpK2gflv.js` carries the NEW deployment id and **zero**
  occurrences of the old one, from both `/` and `/admin/`.
- `.env.local` `GAS_SCRIPT_ID` repointed, so `npm run deploy:gas` now targets
  `samoweb`; a `--dry-run` confirms remote == repo.
- Old vs new endpoints proven behaviourally identical: **6/6** probes match
  (validation, unknown action, legacy folder name, wrong-tree rejection,
  root-ref rejection, path traversal).

**ONLY REMAINING — in ~2 weeks**, once the old endpoint sees no traffic: delete
deployment `AKfycbw1iHE4…`, then `prformweb` and its Sheet. Nothing depends on
them; they exist purely so bundles cached before this deploy keep working.

Rollback: revert the one line in `config.js` and redeploy. The old endpoint has
not been touched.

### Drive layout — FINAL, verified

```
My Drive/IT Database/
├── _Scripts/   prformweb [sheet], samopassport [script], samoweb [script]
├── PR/         301 children      (was PR_Submissions)
├── Projects/    22 โครงการ
├── Shop/        Banners, Products, QR, Slips
├── Team/        2569/
└── Passport/    badges/ 15, certificates/ 10
```

Nothing of ours is left in My Drive root. Every folder kept its original id
through the move+rename, so no stored URL changed and nothing was backfilled.

### GAS security review 2026-07-31 — two live holes closed, one accepted

Prompted by "scan for every bug thoroughly". Both were years old and neither
was introduced by the Drive move; both are in `.claude/rules/mistakes.md`.

- **CLOSED — passport `handleDelete_` trashed ANY fileId.** Anonymous endpoint,
  `/exec` URL public in the shipped admin bundle ⇒ unauthenticated "trash any
  file this account owns". Now requires the file to live under the app's own
  folder, matched by folder **ID** so a rename can't widen or break it.
  Verified both ways: a real file outside `Passport/` survives the attack, and
  upload+delete of a badge still works (count back to 15).
- **CLOSED — samoweb `notifyProjectEmail` was an OPEN RELAY.** Arbitrary
  recipient/subject/body from the SAMO account as "MDKKU SAMO". Now a domain
  allow-list (`kku.ac.th`, `kkumail.com`), overridable via the
  `EMAIL_DOMAIN_ALLOWLIST` script property. EVERY recipient checked, exact
  match. Verified: gmail / `kku.ac.th.evil.com` / `notkku.ac.th` / a smuggled
  second recipient all rejected; a real `kku.ac.th` still sends. Live recipient
  `woratho@kku.ac.th` unaffected.
- **IN PROGRESS — caller identity on the destructive actions.** Scope alone is
  not authorization; being closed the same day (see below). **This repo is
  PUBLIC: never write still-open vulnerability detail into it.**
- **PERF**: `warnIfSplit_` was 3 Drive round-trips on every upload (~half of
  folder-resolution time). Clean results cached 6h, dirty never cached.
  Resolution ~2.7s cold → ~0.7s warm.

### The three Apps Script projects (they are NOT one)

| project | type | serves | live |
|---|---|---|---|
| `prformweb` | **bound to a Google Sheet** in root | samoweb Drive + email | `AKfycbw1iHE4…` @49 |
| `samopassport` | standalone | passport badges/certs (`gas/Upload.gs`) | `AKfycbwJgkPTcr9G…` @v3 |
| `Uploadbadgesamopassport` | standalone | **nothing — dead prototype** | orphan, to trash |

`prform.gs` has ZERO `SpreadsheetApp` references — the Sheet binding is
vestigial, from when the PR form wrote rows. It **cannot be unbound**:
converting to standalone mints a new project and a new `/exec` URL, and
`GAS_API_URL` is hard-coded, so it would present as "every upload silently
fails". Move the Sheet, don't try to detach it.

**Deliberately NOT merged** with the passport script: one URL would have to
change (in the repo with no GAS tooling), the blast radius would couple, and
prform's `MailApp` scope would extend to passport uploads. Quotas are per
ACCOUNT, not per script, so there is no quota argument either. If it is ever
merged, fold passport INTO prform — prform has the good pipeline.

