#!/usr/bin/env node
// ============================================================
// gas-team-delete-probe.mjs — live round-trip proof for the `deleteTeamFile`
// Apps Script action. Run after any redeploy of appscript/prform.gs.
//
//   node tools/gas-team-delete-probe.mjs "<the /exec url from src/js/config.js>"
//
// WHY BOTH DIRECTIONS: a probe that only asserts "denied" cannot tell a working
// guard from a broken service — that is exactly how the session-gate failure on
// 2026-07-31 stayed invisible for an hour (UrlFetchApp was throwing on a missing
// OAuth scope, and the catch reported it as a refusal). So this uploads a real
// throwaway file INSIDE Team and asserts it is trashed, AND uploads one into
// Shop and asserts the ancestry guard refuses it.
//
// It uploads into the BARE `Team` / `Shop` folders, never a new sub-path: a
// "safe probe" is only inert up to its first guard, and passing a folderPath
// that does not exist would create junk folders as a side effect.
//
// Every file it creates it deletes again. Verified 7/7 against version 10.
// ============================================================
const URL_ = process.argv[2];
if (!URL_) {
  console.error('usage: node tools/gas-team-delete-probe.mjs "<exec url>"');
  process.exit(1);
}
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const post = (body) => fetch(URL_, {
  method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify(body),
}).then((r) => r.json());

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

// 1. a real file INSIDE Team must be deletable (the ALLOW path)
const up = await post({ action: 'uploadTeamFile', folderPath: 'Team',
  fileName: '_delete-probe.png', mimeType: 'image/png', fileData: PIXEL });
check('probe uploaded into Team', !!up.success && !!up.fileUrl, up.message || '');
if (up.fileUrl) {
  const del = await post({ action: 'deleteTeamFile', fileUrl: up.fileUrl });
  check('deleteTeamFile TRASHES a file inside Team', del.success === true, JSON.stringify(del));
}

// 2. a real file OUTSIDE Team must be refused (the DENY path)
const shop = await post({ action: 'uploadShopFile', folderPath: 'Shop',
  fileName: '_delete-probe.png', mimeType: 'image/png', fileData: PIXEL });
check('probe uploaded into Shop', !!shop.success && !!shop.fileUrl, shop.message || '');
if (shop.fileUrl) {
  const bad = await post({ action: 'deleteTeamFile', fileUrl: shop.fileUrl });
  check('deleteTeamFile REFUSES a file outside Team',
    bad.success === false && /not inside Team/.test(bad.message || ''), JSON.stringify(bad));
  const cleanup = await post({ action: 'deleteShopFile', fileUrl: shop.fileUrl });
  check('shop probe cleaned up', cleanup.success === true, JSON.stringify(cleanup));
}

// 3. missing / unknown input must not explode
const none = await post({ action: 'deleteTeamFile' });
check('no fileUrl is refused', none.success === false, JSON.stringify(none));
const gone = await post({ action: 'deleteTeamFile', fileUrl: 'https://drive.google.com/file/d/THIS_ID_DOES_NOT_EXIST/view' });
check('unknown id reports alreadyGone (no retry loop)', gone.success === true && gone.alreadyGone === true, JSON.stringify(gone));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
