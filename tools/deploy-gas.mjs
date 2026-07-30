#!/usr/bin/env node
// ============================================================
// deploy-gas.mjs — push appscript/prform.gs to the live Apps Script project and
// roll the EXISTING web-app deployment onto a new version.
//
// Replaces the copy-paste procedure in skills/deploy-gas.md, which had two ways
// to go wrong that nobody notices until a user hits the broken path: forgetting
// the "New version" step (the editor shows your code, the /exec URL still runs
// the old one), and clobbering an edit somebody made in the GAS editor.
//
// ── THE THING THIS MUST NEVER DO ────────────────────────────────────────────
// `clasp deploy` (create-deployment) mints a NEW deployment with a NEW /exec
// URL. GAS_API_URL in src/js/config.js is hard-coded to the existing one, so a
// new deployment reads as "every upload silently 404s". We always
// create-version + update-deployment against the SAME deployment id.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────
// Pulls the remote first and diffs it against the repo. If someone edited the
// script in the browser, that shows up here and the deploy stops unless you pass
// --force. Pushing is otherwise a silent overwrite of work you cannot recover.
//
// Pushes from a STAGING directory rather than appscript/, so:
//   * the remote manifest (appsscript.json — oauth scopes, webapp access,
//     timezone) is round-tripped from the remote instead of authored blind. A
//     wrong manifest can change "who has access" or force every user to
//     re-authorize.
//   * the remote file KEEPS ITS NAME. If the project's code lives in `Code.gs`,
//     pushing `prform.gs` would delete Code.gs and create prform.gs — harmless
//     in effect, noisy in the revision history, and confusing next time someone
//     opens the editor.
//
// ── SETUP (one-time, yours — these are credentials) ─────────────────────────
//   1. npx clasp login
//        Opens a browser. Writes ~/.clasprc.json. NEVER commit that file.
//   2. Enable the Apps Script API for the same Google account:
//        https://script.google.com/home/usersettings  → "Apps Script API: ON"
//        (clasp fails with "User has not enabled the Apps Script API" without it.)
//   3. Put the script id in .env.local (gitignored):
//        GAS_SCRIPT_ID=<from the GAS project's Project Settings → IDs>
//      Optional, skips a lookup and removes all ambiguity:
//        GAS_DEPLOYMENT_ID=<from Deploy → Manage deployments, in the URL>
//
// ── RUN ─────────────────────────────────────────────────────────────────────
//   npm run deploy:gas                 # diff, push, version, redeploy, verify
//   npm run deploy:gas -- --dry-run    # diff + report only, no writes
//   npm run deploy:gas -- --force      # proceed even if the remote has drifted
//   npm run deploy:gas -- --verify     # only probe the live endpoint
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'appscript', 'prform.gs');
const STAGE = join(ROOT, '.gas-build');
const PULLED = join(ROOT, '.gas-remote');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const DRY = has('--dry-run');
const FORCE = has('--force');
const VERIFY_ONLY = has('--verify');

// ---- tiny .env.local parser (same shape as apply-migration.mjs) ----
function env() {
  const p = join(ROOT, '.env.local');
  if (!existsSync(p)) return {};
  return Object.fromEntries(
    readFileSync(p, 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }));
}
const ENV = env();

function die(msg, hint) {
  console.error(`\n✗ ${msg}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
}

/** Run clasp in `cwd`. Returns stdout; throws with stderr attached on failure. */
function clasp(args, cwd, { quiet = false } = {}) {
  try {
    const out = execFileSync('npx', ['clasp', ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!quiet) process.stdout.write(out);
    return out;
  } catch (e) {
    const detail = `${e.stdout || ''}${e.stderr || ''}`.trim();
    const err = new Error(detail || e.message);
    err.detail = detail;
    throw err;
  }
}

function writeClaspJson(dir, scriptId) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.clasp.json'),
    `${JSON.stringify({ scriptId, rootDir: '.' }, null, 2)}\n`);
}

// ---- the live endpoint probe -----------------------------------------------
//
// `uploadTeamFile` with no folderPath is the ideal canary: the handler validates
// the argument BEFORE touching Drive, so it proves the action exists while
// writing nothing.
//   new code -> {"success":false,"message":"folderPath is required"}
//   old code -> {"success":false,"message":"Unknown action: uploadTeamFile"}
async function probeLive() {
  const cfg = readFileSync(join(ROOT, 'src', 'js', 'config.js'), 'utf8');
  const m = cfg.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/);
  if (!m) return { ok: false, reason: 'could not find GAS_API_URL in src/js/config.js' };
  const url = m[0];
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'uploadTeamFile' }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await r.text();
    if (/folderPath is required/.test(body)) return { ok: true, url, body };
    if (/Unknown action/.test(body)) return { ok: false, url, body, stale: true };
    return { ok: false, url, body, reason: 'unrecognised response' };
  } catch (e) {
    return { ok: false, url, reason: String(e.message || e) };
  }
}

async function main() {
  if (VERIFY_ONLY) {
    const v = await probeLive();
    console.log(v.ok
      ? `✓ live endpoint runs the NEW code\n  ${v.url}\n  ${v.body}`
      : `✗ ${v.stale ? 'live endpoint still runs the OLD code' : 'probe failed'}\n  ${v.body || v.reason}`);
    process.exit(v.ok ? 0 : 1);
  }

  const scriptId = ENV.GAS_SCRIPT_ID;
  if (!scriptId) {
    die('GAS_SCRIPT_ID is not set in .env.local',
      'Get it from the Apps Script project → ⚙ Project Settings → IDs → Script ID,\n'
      + 'then add to .env.local (gitignored):\n\n  GAS_SCRIPT_ID=1AbC...\n');
  }
  if (!existsSync(SRC)) die(`missing ${SRC}`);

  // ---- auth preflight, so failures name the fix instead of dumping a stack ---
  try {
    clasp(['show-authorized-user'], ROOT, { quiet: true });
  } catch (e) {
    die('clasp is not logged in',
      `Run:  npx clasp login\n\nThen enable the Apps Script API for the SAME account:\n`
      + `  https://script.google.com/home/usersettings\n\n(${String(e.detail || e.message).slice(0, 200)})`);
  }
  console.log(`→ script: ${scriptId}`);

  // ---- 1. pull the remote and diff -----------------------------------------
  rmSync(PULLED, { recursive: true, force: true });
  writeClaspJson(PULLED, scriptId);
  try {
    clasp(['pull'], PULLED, { quiet: true });
  } catch (e) {
    const d = String(e.detail || e.message);
    if (/Apps Script API/i.test(d)) {
      die('the Apps Script API is not enabled for this account',
        'Turn it on (one toggle, takes effect immediately):\n'
        + '  https://script.google.com/home/usersettings');
    }
    die(`clasp pull failed:\n${d.slice(0, 600)}`);
  }

  const remoteFiles = readdirSync(PULLED).filter((f) => f !== '.clasp.json');
  const remoteCode = remoteFiles.filter((f) => /\.(gs|js)$/.test(f));
  if (remoteCode.length !== 1) {
    die(`expected exactly one code file in the remote project, found: ${remoteCode.join(', ') || '(none)'}`,
      'This tool assumes the slim single-file project described in skills/deploy-gas.md.\n'
      + 'Reconcile the project by hand before automating it.');
  }
  const mainName = remoteCode[0];
  const remoteSrc = readFileSync(join(PULLED, mainName), 'utf8');
  const localSrc = readFileSync(SRC, 'utf8');

  const norm = (s) => s.replace(/\r\n/g, '\n').trimEnd();
  const drifted = norm(remoteSrc) !== norm(localSrc);
  console.log(`→ remote file: ${mainName} (${remoteSrc.length} bytes)`);
  console.log(`→ local  file: appscript/prform.gs (${localSrc.length} bytes)`);

  if (!drifted) {
    console.log('→ remote code already matches the repo (only the deployment may be stale)');
  } else {
    // Only the remote-only lines matter: local-only lines are what we are about
    // to push, and reporting both drowns the signal.
    const localLines = new Set(norm(localSrc).split('\n'));
    const onlyRemote = norm(remoteSrc).split('\n')
      .filter((l) => l.trim() && !localLines.has(l));
    console.log(`\n⚠ remote differs from the repo — ${onlyRemote.length} line(s) exist only on the remote:`);
    onlyRemote.slice(0, 25).forEach((l) => console.log(`    ${l.slice(0, 120)}`));
    if (onlyRemote.length > 25) console.log(`    … and ${onlyRemote.length - 25} more`);
    console.log(`\n  A copy of the remote is in .gas-remote/ — diff it properly with:`);
    console.log(`    diff .gas-remote/${mainName} appscript/prform.gs\n`);
    if (onlyRemote.length && !FORCE && !DRY) {
      die('refusing to overwrite remote-only changes',
        'If those lines are stale, re-run with --force.\n'
        + 'If they are real, copy them into appscript/prform.gs first.');
    }
  }

  if (DRY) {
    console.log('\n(--dry-run) stopping before any write.');
    const v = await probeLive();
    console.log(v.ok ? '  live endpoint: NEW code' : `  live endpoint: ${v.stale ? 'OLD code' : v.reason}`);
    return;
  }

  // ---- 2. stage ------------------------------------------------------------
  // The manifest is round-tripped from the remote so we never invent oauthScopes
  // or webapp access settings we cannot see.
  rmSync(STAGE, { recursive: true, force: true });
  writeClaspJson(STAGE, scriptId);
  const manifestPath = join(PULLED, 'appsscript.json');
  if (!existsSync(manifestPath)) {
    die('the remote project has no appsscript.json',
      'Refusing to synthesise one — it controls oauth scopes and web-app access.');
  }
  writeFileSync(join(STAGE, 'appsscript.json'), readFileSync(manifestPath, 'utf8'));
  writeFileSync(join(STAGE, mainName), localSrc);

  // ---- 3. push -------------------------------------------------------------
  console.log('\n→ pushing…');
  clasp(['push', '-f'], STAGE);

  // ---- 4. new immutable version -------------------------------------------
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const desc = `repo deploy ${stamp}`;
  console.log('\n→ creating version…');
  const versionOut = clasp(['create-version', desc], STAGE);
  const vm = versionOut.match(/(\d+)/);
  if (!vm) die(`could not read the new version number from clasp output:\n${versionOut}`);
  const version = vm[1];
  console.log(`→ version ${version}`);

  // ---- 5. roll the EXISTING deployment ------------------------------------
  let deploymentId = ENV.GAS_DEPLOYMENT_ID;
  if (!deploymentId) {
    const list = clasp(['list-deployments'], STAGE, { quiet: true });
    // "- <id> @HEAD" is the always-live dev deployment, not the published web
    // app; rolling it would do nothing for the /exec URL users hit.
    const ids = [...list.matchAll(/^-?\s*([A-Za-z0-9_-]{20,})\s+@(\d+|HEAD)/gm)]
      .filter((m) => m[2] !== 'HEAD').map((m) => m[1]);
    const unique = [...new Set(ids)];
    if (unique.length !== 1) {
      die(`could not pick the web-app deployment automatically (found ${unique.length})`,
        `clasp list-deployments said:\n${list}\n`
        + 'Set the right one explicitly in .env.local:\n\n  GAS_DEPLOYMENT_ID=AKfycb...\n');
    }
    [deploymentId] = unique;
  }
  console.log(`\n→ updating deployment ${deploymentId} → version ${version}`);
  clasp(['update-deployment', deploymentId, '-V', version, '-d', desc], STAGE);

  // ---- 6. prove it ---------------------------------------------------------
  // GAS can take a moment to swap the served version; a single immediate probe
  // produces a false "still old".
  console.log('\n→ verifying the live endpoint…');
  let v = null;
  for (let i = 0; i < 5; i++) {
    v = await probeLive();
    if (v.ok) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!v?.ok) {
    die(`deployed, but the live endpoint does not report the new code:\n  ${v?.body || v?.reason}`,
      'Check Deploy → Manage deployments in the editor: the web-app deployment\n'
      + `should now point at version ${version}.`);
  }
  console.log(`✓ live: ${v.body}`);
  console.log(`✓ ${v.url}`);
  console.log('\nDone. The /exec URL is unchanged.');
}

main().catch((e) => { console.error(e); process.exit(1); });
