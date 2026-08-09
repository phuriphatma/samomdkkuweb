#!/usr/bin/env node
// ============================================================
// gas-delete-actions.mjs — prove the live Apps Script /exec serves the delete
// actions, and that each one still REFUSES what it must refuse.
//
// WHY BOTH DIRECTIONS. This endpoint is Execute-as-Me + Anyone and its URL ships
// inside the public bundle, so the ancestry check is the only thing between a
// caller and the owner's whole Drive. A probe that only asked "did deletePRFile
// answer?" could not tell a working guard from a service that answers
// everything — which is why the CONTROL cases matter more than the positive
// ones: an unknown action must still come back "Unknown action", or this script
// is measuring nothing at all (docs/mistakes/tooling-proofs.md).
//
// IT NEVER DELETES ANYTHING. Every case is chosen to be REFUSED before Drive is
// touched — a missing url, a non-Drive url, a file id that lives under the wrong
// tree. There is no "allow" case here because the only honest one would trash a
// real file.
//
// ⚠️ DO NOT REWRITE THIS WITH `curl -L`. A GAS /exec always 302s to
// script.googleusercontent.com, and curl turns POST into GET on a 302 unless
// `--post302` is passed — so the body is dropped and every probe comes back as
// Drive's "ไม่พบเพจ" HTML, which reads exactly like a broken deployment. (Same
// family as the sendBeacon-does-not-follow-redirects entry in
// docs/mistakes/integrations.md.) Node's fetch preserves the method.
//
//   node tools/gas-delete-actions.mjs
// ============================================================
import { readFileSync } from 'node:fs';

// The endpoint the APP uses, read from the same place the app reads it — not a
// copy pasted in here, which is how a probe ends up green-lighting a deployment
// nothing is actually talking to.
const config = readFileSync(new URL('../src/js/config.js', import.meta.url), 'utf8');
const GAS = (config.match(/https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/g) || []).pop();
if (!GAS) {
  console.error('could not find the GAS /exec url in src/js/config.js');
  process.exit(1);
}

const post = async (body) => {
  const r = await fetch(GAS, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  return (await r.text()).slice(0, 300);
};

// A real Drive id that lives under Team — used to prove the PR guard refuses a
// file from a NEIGHBOURING app tree, which is the interesting half. A random id
// would only prove it refuses nonsense.
const TEAM_FILE = 'https://drive.google.com/file/d/1mAp5pU2WaKwhCmzw7TMoeAlBSw9Zcjw8/view';
const JUNK = 'https://example.com/nope';

const CASES = [
  ['deletePRFile is a KNOWN action (was "Unknown action")',
    { action: 'deletePRFile' }, /fileUrl required/],
  ['deletePRFile REFUSES a file outside the PR tree',
    { action: 'deletePRFile', fileUrl: TEAM_FILE }, /not inside PR/],
  ['deletePRFile rejects a non-Drive url instead of reporting success',
    { action: 'deletePRFile', fileUrl: JUNK }, /unable to extract Drive id/],
  ['deleteTeamFile still guards its own tree',
    { action: 'deleteTeamFile', fileUrl: JUNK }, /unable to extract Drive id/],
  ['uploadTeamFile still allow-lists its path',
    { action: 'uploadTeamFile', folderPath: 'Shop/x' }, /must start with Team/],
  ['CONTROL — an unknown action still says so (proves this probe can FAIL)',
    { action: 'deleteNothingFile' }, /Unknown action/],
];

let pass = 0;
for (const [name, body, want] of CASES) {
  let out;
  try { out = await post(body); } catch (e) { out = `THREW ${e.message || e}`; }
  const ok = want.test(out);
  if (ok) pass += 1;
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  console.log(`    → ${out.replace(/\s+/g, ' ').slice(0, 130)}`);
}
console.log(`\n${pass}/${CASES.length} pass`);
process.exit(pass === CASES.length ? 0 : 1);
