// ============================================================
// prform.gs — Discord notify + Drive file upload only
//
// Post-Supabase-migration, GAS serves these actions:
//   - uploadPRFile         : upload an image to Drive `PR_Submissions/`
//                            (chosen over Supabase Storage for the 2 TB quota)
//   - uploadShopFile       : upload a file to a nested Drive folder path
//                            (e.g. 'SAMO_Shop/Slips/2026-05'). Used by the
//                            shop module for slips, product photos, QR images.
//                            Folders are created lazily as needed.
//   - uploadProjectFile    : same shape as uploadShopFile but allow-listed to
//                            `Projects/...`. Used by the project-tracking
//                            module for หนังสือโครงการ attachments.
//   - notifyPROnly         : fire the PR-team Discord webhook
//   - notifyProjectEmail   : send an email via MailApp to the receiver
//                            (free, no SMTP needed) when a document is
//                            sent or a file is replaced.
//   - notifyProjectDiscord : fire the SAMO admin Discord webhook (URL in
//                            Script Properties as PROJECT_DISCORD_WEBHOOK_URL)
//                            when the receiver updates status / leaves
//                            a comment / returns a document.
//
// Everything else (PR submit, tracking, staff dashboard, announcements,
// agents) is now handled directly by Supabase from the frontend.
// ============================================================

const DISCORD_WEBHOOK_URL = 'https://discordapp.com/api/webhooks/1499412227373928590/G10Tx8Hr-2bQN6mg4q2N9STuHN4lUG4zqZsJfF1gIHwQFNb-UKDfkZuWf_kU_sa9LzPN';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    // Loud start-of-request log. The previous Discord-only console.log
    // was inside sendProjectDiscord; if it didn't appear in execution
    // logs the user couldn't tell whether the deploy was stale or
    // the code wasn't being entered. This line is the absolute floor:
    // if you see N "doPost: action=..." entries but only M visible
    // Discord messages where N > M, the gap is on Discord's side or
    // inside our retry path — and the next log lines tell which.
    console.log('doPost: action=' + (data && data.action ? data.action : '(unknown)'));

    if (data.action === 'uploadPRFile')      return handleUploadPRFile(data);
    if (data.action === 'uploadShopFile')    return handleUploadShopFile(data);
    if (data.action === 'deleteShopFile')    return handleDeleteShopFile(data);
    if (data.action === 'uploadProjectFile')   return handleUploadProjectFile(data);
    if (data.action === 'deleteProjectFile')   return handleDeleteProjectFile(data);
    if (data.action === 'deleteProjectFolder') return handleDeleteProjectFolder(data);
    if (data.action === 'getProjectFolderInfo') return handleGetProjectFolderInfo(data);

    if (data.action === 'notifyPROnly') {
      try { sendDiscordNotification(data, data.ticketId); } catch (err) { console.error('notifyPROnly: ' + err); }
      return createResponse({ success: true });
    }

    if (data.action === 'notifyProjectEmail') {
      try { sendProjectEmail(data); }
      catch (err) {
        console.error('notifyProjectEmail: ' + err);
        return createResponse({ success: false, message: String(err) });
      }
      return createResponse({ success: true });
    }

    if (data.action === 'notifyProjectDiscord') {
      // Echo every diagnostic detail back to the frontend via the
      // response body. GAS Cloud Logs are NOT recorded for browser-
      // fetch calls (Execute-as-Me + access-Anyone restriction —
      // see skills/deploy-gas.md), so this is the only path that
      // surfaces what Discord actually returned. callGAS in
      // src/js/projects/notify.js logs the response when retried or
      // failed, so the data lands in the browser console.
      try {
        var res = sendProjectDiscord(data);
        if (res && res.ok === false) {
          return createResponse({
            success: false,
            message: 'discord HTTP ' + res.status,
            status: res.status,
            body: res.body,
            attempts: res.attempts || 1,
            firstStatus: res.firstStatus || null,
            retried: res.retried || false,
          });
        }
        return createResponse({
          success: true,
          status: res ? res.status : null,
          attempts: res && res.attempts ? res.attempts : 1,
          firstStatus: res && res.firstStatus ? res.firstStatus : null,
          retried: res && res.retried ? true : false,
        });
      } catch (err) {
        return createResponse({ success: false, message: String(err) });
      }
    }

    return createResponse({ success: false, message: 'Unknown action: ' + data.action });
  } catch (error) {
    console.error('doPost error: ' + error.toString());
    return createResponse({ success: false, message: 'Server error: ' + error.toString() });
  }
}

// ============================================================
// uploadPRFile — accept a base64-encoded image and write to Drive
// ============================================================

function handleUploadPRFile(data) {
  try {
    const folders = DriveApp.getFoldersByName('PR_Submissions');
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('PR_Submissions');
    const base64Data = data.fileData.split(',')[1];
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), data.mimeType, data.fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return createResponse({ success: true, fileUrl: file.getUrl() });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// ============================================================
// uploadShopFile — accept a base64-encoded file + a nested folder path
//
// The frontend passes a logical path like `SAMO_Shop/Slips/2026-05`. We
// walk that path under My Drive, creating any missing folders as we go,
// then drop the file in the leaf. This keeps the 2 TB Drive tidy enough
// to browse manually (one folder per month for slips, one per product,
// etc.) and well below Drive's per-folder file cap.
//
// Allow-list the top-level prefix so a misuse can't write to arbitrary
// places. Currently only 'SAMO_Shop/...' is permitted.
// ============================================================

function handleUploadShopFile(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath is required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (path.indexOf('SAMO_Shop') !== 0) {
      return createResponse({ success: false, message: 'folderPath must start with SAMO_Shop' });
    }

    var folder = getOrCreateFolderPath_(path);
    var base64Data = data.fileData.split(',')[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), data.mimeType, data.fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return createResponse({ success: true, fileUrl: file.getUrl() });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

/**
 * Trash a Drive file by URL. Safety-gated to files that live somewhere
 * under "SAMO_Shop" so a stray call can't nuke unrelated Drive content.
 * Used when admin deletes a shop order — the attached slip image should
 * not orphan in Drive after the row is gone.
 *
 * Trash (vs purge): keeps a 30-day undo window in Drive. Good enough.
 */
function handleDeleteShopFile(data) {
  try {
    var url = String(data.fileUrl || '').trim();
    if (!url) return createResponse({ success: false, message: 'fileUrl required' });
    var id = extractDriveId_(url);
    if (!id) return createResponse({ success: false, message: 'unable to extract Drive id from url' });
    var file;
    try { file = DriveApp.getFileById(id); }
    catch (e) {
      // File already gone — treat as success so callers don't retry forever.
      return createResponse({ success: true, alreadyGone: true });
    }
    if (!fileLivesUnderSamoShop_(file)) {
      return createResponse({ success: false, message: 'file is not inside SAMO_Shop' });
    }
    file.setTrashed(true);
    return createResponse({ success: true });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

/** Pull a Drive file id out of a viewer/thumbnail/uc url. */
function extractDriveId_(url) {
  var m;
  m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}

/** Walk parent chain looking for a folder named SAMO_Shop. Drive files
 *  can have multiple parents (shortcuts); we only need ONE ancestry
 *  path that contains SAMO_Shop. */
function fileLivesUnderSamoShop_(file) {
  var stack = [];
  var parents = file.getParents();
  while (parents.hasNext()) stack.push(parents.next());
  var seen = {};
  while (stack.length) {
    var f = stack.pop();
    var fid = f.getId();
    if (seen[fid]) continue;
    seen[fid] = true;
    if (f.getName() === 'SAMO_Shop') return true;
    var ups = f.getParents();
    while (ups.hasNext()) stack.push(ups.next());
  }
  return false;
}

/**
 * Walk a slash-separated folder path under My Drive root, creating any
 * missing folders as we go. Returns the leaf folder.
 */
function getOrCreateFolderPath_(path) {
  var parts = path.split('/').filter(function (p) { return p && p.length; });
  var parent = DriveApp.getRootFolder();
  for (var i = 0; i < parts.length; i++) {
    var name = parts[i];
    var iter = parent.getFoldersByName(name);
    parent = iter.hasNext() ? iter.next() : parent.createFolder(name);
  }
  return parent;
}

// ============================================================
// Project-tree path walking with by-CODE folder matching.
//
// The frontend names project folders `<slug(name)>_PRJ-XXXX` and doc
// folders `<slug(title)>_DOC-XXXXX`. When VPA renames a project or
// หนังสือ in the app, the `<slug(...)>` part of the desired path
// changes, but the existing Drive folder still has the old name.
//
// Exact-name matching (getOrCreateFolderPath_) would miss the old
// folder, create a NEW empty one with the new name, and orphan all
// the existing files. The walker below instead:
//
//   1. Tries an EXACT-NAME match first (fast path, common case).
//   2. Falls back to scanning the parent for any folder whose name
//      contains the PRJ-XXXX / DOC-XXXXX code. If found, RENAMES it
//      to the desired name (self-healing rename) and reuses it.
//   3. Only if neither match exists does it create a fresh folder.
//
// So a rename in the app propagates to Drive transparently on the
// next upload / QR / explicit rename hook — no separate "move files"
// step needed.
// ============================================================

/** Extract the PRJ-/DOC- code from a folder name. Returns '' when no
 *  code is found (legacy folders / handwritten names). */
function extractProjectCode_(name) {
  var s = String(name || '');
  // Match the FIRST PRJ-/DOC- code in the name — handles both
  // `<slug>_PRJ-XXXX` (new) and `PRJ-XXXX_<slug>` (legacy).
  var m = s.match(/(PRJ|DOC)-[A-Z0-9]+/);
  return m ? m[0] : '';
}

/** Find or create a folder under `parent` whose name matches the
 *  desired name; if a folder with the same code already exists with
 *  a different name, RENAME it to the desired name and return it. */
function getOrCreateProjectSubfolderByCode_(parent, desiredName, code) {
  // Fast path: exact name match.
  var exact = parent.getFoldersByName(desiredName);
  if (exact.hasNext()) return exact.next();
  // By-code rename path: scan parent, rename the first folder whose
  // name carries this code. `code` is something like PRJ-K3X7 — long
  // enough that an accidental substring collision is vanishingly
  // unlikely under a Projects/ tree.
  if (code) {
    var iter = parent.getFolders();
    while (iter.hasNext()) {
      var f = iter.next();
      if (f.getName().indexOf(code) !== -1) {
        // Don't rename if Drive has the right name already (catches
        // the case where the user reverted the name in the app).
        if (f.getName() !== desiredName) f.setName(desiredName);
        return f;
      }
    }
  }
  // Not found at all: create with the desired name.
  return parent.createFolder(desiredName);
}

/** Walk a `Projects/<projectFolder>[/<docFolder>]` path. The first
 *  segment after `Projects/` matches by PRJ-code; the second by
 *  DOC-code. Self-renames stale folders to the current desired name. */
function walkProjectsPathByCode_(path) {
  var parts = path.split('/').filter(function (p) { return p && p.length; });
  if (parts.length === 0 || parts[0] !== 'Projects') {
    throw new Error('walkProjectsPathByCode_ requires a Projects/... path');
  }
  var parent = DriveApp.getRootFolder();
  // Top-level "Projects" folder: exact-name match (no code).
  var pIter = parent.getFoldersByName('Projects');
  parent = pIter.hasNext() ? pIter.next() : parent.createFolder('Projects');
  // Walk each remaining segment with by-code matching.
  for (var i = 1; i < parts.length; i++) {
    var name = parts[i];
    var code = extractProjectCode_(name);
    parent = getOrCreateProjectSubfolderByCode_(parent, name, code);
  }
  return parent;
}

// ============================================================
// uploadProjectFile — same lazy-nested-folder pattern as
// uploadShopFile, but allow-listed to `Projects/...`. The
// frontend passes a logical path like
// `Projects/PRJ-2605-0001_<slug>/DOC-260526-1430-XXXX_<type>`
// and we walk/create it under My Drive.
// ============================================================

function handleUploadProjectFile(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath is required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (path.indexOf('Projects') !== 0) {
      return createResponse({ success: false, message: 'folderPath must start with Projects' });
    }

    // walkProjectsPathByCode_ self-renames stale project/doc folders
    // to the current desiredName from the path — so a file uploaded
    // AFTER a rename lands in the correctly-named folder even if the
    // app skipped firing the explicit rename hook.
    var folder = walkProjectsPathByCode_(path);
    var base64Data = data.fileData.split(',')[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), data.mimeType, data.fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return createResponse({
      success: true,
      fileUrl: file.getUrl(),
      fileId: file.getId(),
      sizeBytes: file.getSize(),
      mimeType: file.getMimeType(),
    });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// ============================================================
// deleteProjectFile — trash a single Drive file (by viewer URL)
// that lives under `Projects/`. Used by the project-tracking
// frontend when VPA removes a single file attached to a หนังสือ.
// Mirrors handleDeleteShopFile but allow-listed to the Projects/
// folder tree.
// ============================================================

function handleDeleteProjectFile(data) {
  try {
    var url = String(data.fileUrl || '').trim();
    if (!url) return createResponse({ success: false, message: 'fileUrl required' });
    var id = extractDriveId_(url);
    if (!id) return createResponse({ success: false, message: 'unable to extract Drive id from url' });
    var file;
    try { file = DriveApp.getFileById(id); }
    catch (e) {
      return createResponse({ success: true, alreadyGone: true });
    }
    if (!fileLivesUnderProjects_(file)) {
      return createResponse({ success: false, message: 'file is not inside Projects' });
    }
    file.setTrashed(true);
    return createResponse({ success: true });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

function fileLivesUnderProjects_(file) {
  var stack = [];
  var parents = file.getParents();
  while (parents.hasNext()) stack.push(parents.next());
  var seen = {};
  while (stack.length) {
    var f = stack.pop();
    var fid = f.getId();
    if (seen[fid]) continue;
    seen[fid] = true;
    if (f.getName() === 'Projects') return true;
    var ups = f.getParents();
    while (ups.hasNext()) stack.push(ups.next());
  }
  return false;
}

// ============================================================
// deleteProjectFolder — trash a folder (and everything inside)
// under `Projects/...`. Called by the frontend when a โครงการ or
// หนังสือ is deleted, so the Drive side doesn't accumulate orphans.
//
// Allow-listed to paths under `Projects/` only. Trashing (vs purge)
// keeps a 30-day Drive recovery window — same convention as
// deleteShopFile.
// ============================================================

// ============================================================
// getProjectFolderInfo — return the Drive folder id + viewer URL
// for a logical `Projects/...` path, creating any missing folders
// along the way. Used by the per-project QR feature so a user can
// share the whole project folder (containing one subfolder per
// หนังสือ, each with its own files) by scanning a single code.
//
// Sharing: sets ANYONE_WITH_LINK + VIEW on the folder itself, so
// anyone who scans the QR can browse + open files. Individual
// files are already shared the same way at upload time, so the
// only thing folder-sharing changes is making the list of files
// browsable from the link. The action is allow-listed to paths
// under `Projects/` to keep the same blast radius as the other
// project-folder helpers.
//
// Idempotent: re-calling for the same path returns the same id /
// url and re-asserts the sharing setting (no-op if already set).
// ============================================================

function handleGetProjectFolderInfo(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath is required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (path.indexOf('Projects/') !== 0) {
      return createResponse({ success: false, message: 'folderPath must start with Projects/' });
    }
    // Refuse the root — sharing it would expose every project on this
    // Drive. Sub-paths only.
    if (path === 'Projects' || path === 'Projects/') {
      return createResponse({ success: false, message: 'refuse to operate on the root Projects folder' });
    }
    // By-code walk: a rename-hook call after the user edits a project
    // or doc title finds the existing folder via its PRJ-/DOC- code
    // and self-renames it to the new desiredName from the path. No
    // separate "rename" action needed.
    var folder = walkProjectsPathByCode_(path);
    // Sharing is OPT-IN — the QR flow asks for it (so a scan can
    // open the folder), the rename hook doesn't (so we don't quietly
    // make a freshly-renamed folder public on every edit).
    if (data.share === true) {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
    return createResponse({
      success: true,
      folderId:  folder.getId(),
      folderUrl: folder.getUrl(),
      folderName: folder.getName(),
    });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

function handleDeleteProjectFolder(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (path !== 'Projects' && path.indexOf('Projects/') !== 0) {
      return createResponse({ success: false, message: 'folderPath must start with Projects/' });
    }
    // Refuse to trash the root Projects/ folder — it's the container for
    // everything; deleting it would nuke every other project on the
    // same Drive. Only allow sub-paths.
    if (path === 'Projects' || path === 'Projects/') {
      return createResponse({ success: false, message: 'refuse to trash the root Projects folder' });
    }
    // Mirror upload's by-code walk so a rename in the app between the
    // last upload and the delete doesn't strand the folder. Each
    // segment under Projects/ matches by PRJ-/DOC- code, not by exact
    // name. If a segment can't be found AND can't be created (e.g.,
    // a non-existent code), bail with alreadyGone:true (idempotent).
    var parts = path.split('/').filter(function (p) { return p && p.length; });
    if (parts.length === 0 || parts[0] !== 'Projects') {
      return createResponse({ success: false, message: 'folderPath must start with Projects' });
    }
    var parent = DriveApp.getRootFolder();
    var projectsIter = parent.getFoldersByName('Projects');
    if (!projectsIter.hasNext()) {
      return createResponse({ success: true, alreadyGone: true });
    }
    parent = projectsIter.next();
    for (var i = 1; i < parts.length; i++) {
      var name = parts[i];
      var code = extractProjectCode_(name);
      var found = null;
      var exactIter = parent.getFoldersByName(name);
      if (exactIter.hasNext()) {
        found = exactIter.next();
      } else if (code) {
        var scan = parent.getFolders();
        while (scan.hasNext()) {
          var f = scan.next();
          if (f.getName().indexOf(code) !== -1) { found = f; break; }
        }
      }
      if (!found) return createResponse({ success: true, alreadyGone: true });
      parent = found;
    }
    parent.setTrashed(true);
    return createResponse({ success: true });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// ============================================================
// notifyProjectEmail — MailApp.sendEmail to the receiver.
//
// Free, no SMTP setup, uses the GAS owner's Gmail quota
// (~100 emails/day on consumer accounts — well above our
// project-tracking volume). The frontend passes the recipient
// email (curated in project_settings.uni_staff_email so it's
// editable without a redeploy).
// ============================================================

function sendProjectEmail(data) {
  var to = String(data.to || '').trim();
  if (!to) throw new Error('notifyProjectEmail: missing "to"');
  MailApp.sendEmail({
    to: to,
    subject: String(data.subject || 'MDKKU SAMO: แจ้งเตือนหนังสือโครงการ'),
    htmlBody: String(data.htmlBody || data.body || ''),
    name: 'MDKKU SAMO',
    noReply: true,
  });
}

// ============================================================
// notifyProjectDiscord — fire the SAMO admin channel webhook
// whenever the receiver acts (status update / comment / return).
//
// The webhook URL lives in Script Properties as
// PROJECT_DISCORD_WEBHOOK_URL so it can be rotated without a
// code change. Set via Apps Script editor → Project Settings
// → Script Properties.
// ============================================================

function sendProjectDiscord(data) {
  var url = PropertiesService.getScriptProperties().getProperty('PROJECT_DISCORD_WEBHOOK_URL');
  if (!url) throw new Error('PROJECT_DISCORD_WEBHOOK_URL not set in Script Properties');

  var payload;
  if (data.payload && typeof data.payload === 'object') {
    payload = data.payload;
  } else {
    var fields = Array.isArray(data.fields) ? data.fields : [];
    payload = {
      content: String(data.content || ''),
      embeds: [{
        title: String(data.title || 'อัปเดตหนังสือโครงการ'),
        description: String(data.description || ''),
        color: typeof data.color === 'number' ? data.color : 3447003,
        fields: fields,
      }],
    };
  }

  var body = JSON.stringify(payload);
  var fetchOpts = {
    method: 'post',
    contentType: 'application/json',
    payload: body,
    muteHttpExceptions: true,
  };

  // Diagnostic — confirms that Discord's HTTP response and what the
  // user sees in the channel actually agree. Empty execution logs +
  // no Discord message is the symptom of a webhook URL that points
  // somewhere unexpected (wrong server / deleted channel) — Discord
  // 204s the POST regardless and we'd have no way to tell without
  // this line. Hostname-only (not the full URL) so the log doesn't
  // leak the webhook secret if pasted publicly.
  var urlHost = '';
  try { urlHost = url.replace(/^https?:\/\//, '').split('/')[0]; } catch (e) {}

  // Up to 3 attempts total. Two rapid notifications (status change →
  // comment within ~5s) consistently produce ONE Discord message + ONE
  // dropped — single-retry-on-429 wasn't enough to recover the dropped
  // one. Backoff respects Discord's Retry-After when present, falls
  // back to a progressive 1.2s / 2.5s / 4s schedule for transport-
  // level errors. Worst case: ~8s wait inside GAS, fits comfortably
  // inside the frontend callGAS 10s timeout.
  var MAX_ATTEMPTS = 3;
  var FALLBACK_SLEEPS_MS = [1200, 2500, 4000];
  var firstStatus = null;
  var lastResult = null;
  for (var i = 0; i < MAX_ATTEMPTS; i++) {
    var result = postOnce_(url, fetchOpts);
    var label = (i === 0 ? 'first' : i === 1 ? 'second' : 'third') + ' attempt';
    console.log('notifyProjectDiscord: ' + label + ' → HTTP ' + result.status + ' (' + urlHost + ')');
    if (result.ok) {
      return i === 0
        ? { ok: true, status: result.status }
        : { ok: true, status: result.status, retried: true, attempts: i + 1, firstStatus: firstStatus };
    }
    if (i === 0) firstStatus = result.status;
    lastResult = result;
    // Only the two transient failure modes warrant a retry. 4xx other
    // than 429 (400 malformed payload, 401 bad token, 404 deleted
    // webhook) won't recover by retrying — bail immediately so we
    // don't waste GAS quota on guaranteed-failed second attempts.
    var transient = result.status === 429 || result.threw;
    if (!transient) break;
    if (i === MAX_ATTEMPTS - 1) break;   // last attempt failed; no point sleeping
    var sleepMs = FALLBACK_SLEEPS_MS[i] || 4000;
    if (result.status === 429 && result.retryAfter > 0) {
      // Honour Retry-After but clamp so a misconfigured header can't
      // burn the GAS quota or exceed the frontend timeout.
      sleepMs = Math.min(Math.max(Math.floor(result.retryAfter * 1000), 400), 5000);
    }
    Utilities.sleep(sleepMs);
  }
  return {
    ok: false,
    status: lastResult ? lastResult.status : 0,
    body: lastResult ? lastResult.body : '',
    retried: true,
    attempts: MAX_ATTEMPTS,
    firstStatus: firstStatus,
  };
}

/**
 * Manual diagnostic — select this function in the GAS editor and click
 * Run. It sends a clearly-labelled test message to whatever URL is in
 * Script Properties' PROJECT_DISCORD_WEBHOOK_URL and prints the full
 * response (status code, body, headers) to the execution log.
 *
 * Use when normal runtime sends silently disappear: if you see "HTTP
 * 204" in the log AND the channel you're watching, the webhook URL +
 * channel match. If you see HTTP 204 but the channel is empty, the
 * URL is pointed at a different channel (most likely cause of the
 * "GAS ran but no Discord ping" symptom).
 */
function testProjectDiscord() {
  var url = PropertiesService.getScriptProperties().getProperty('PROJECT_DISCORD_WEBHOOK_URL');
  if (!url) {
    console.error('testProjectDiscord: PROJECT_DISCORD_WEBHOOK_URL not set in Script Properties');
    return;
  }
  var urlHost = '';
  try { urlHost = url.replace(/^https?:\/\//, '').split('/')[0]; } catch (e) {}
  var payload = {
    content: '',
    embeds: [{
      title: '🧪 Test from prform.gs testProjectDiscord()',
      description: 'If you see this in a Discord channel, the webhook URL is correct. Timestamp: ' + (new Date()).toISOString(),
      color: 15844367,
    }],
  };
  var resp;
  try {
    resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (e) {
    console.error('testProjectDiscord: transport-level error talking to ' + urlHost + ': ' + e);
    return;
  }
  var code = resp.getResponseCode();
  var body = resp.getContentText() || '';
  console.log('testProjectDiscord: HTTP ' + code + ' from ' + urlHost);
  console.log('testProjectDiscord: response body = ' + (body.slice(0, 500) || '(empty)'));
  if (code >= 200 && code < 300) {
    console.log('✅ Discord accepted the POST. If the test message is NOT in the channel you expect, the webhook URL points to a different channel — check Discord → Server Settings → Integrations → Webhooks.');
  } else {
    console.warn('❌ Discord rejected the POST. Common causes: 401 = invalid token, 404 = webhook deleted, 400 = malformed payload, 429 = rate limit.');
  }
}

/** One-shot Discord POST. Normalises both HTTP failures and transport
 *  exceptions into the same `{ ok, status, body, threw, retryAfter }`
 *  shape so the retry logic above doesn't have to special-case the
 *  `try`/`catch` boundary. */
function postOnce_(url, fetchOpts) {
  try {
    var resp = UrlFetchApp.fetch(url, fetchOpts);
    var code = resp.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true, status: code };
    // Pull Retry-After (lowercase per Discord's response). GAS
    // getHeaders() is a case-sensitive object so check both spellings.
    var headers = resp.getAllHeaders ? resp.getAllHeaders() : resp.getHeaders();
    var ra = parseFloat((headers && (headers['Retry-After'] || headers['retry-after'])) || '0');
    return {
      ok: false,
      status: code,
      body: (resp.getContentText() || '').slice(0, 500),
      retryAfter: isFinite(ra) ? ra : 0,
    };
  } catch (e) {
    return { ok: false, threw: true, status: 0, body: String(e), retryAfter: 0 };
  }
}

// ============================================================
// Discord webhook
// ============================================================

function sendDiscordNotification(data, ticketId) {
  const isRush = data.deadlineMode === 'Rush PR Review';

  let discordLinks = '';
  if (data.uploadedUrls && data.uploadedUrls.length > 0) {
    data.uploadedUrls.forEach(function (url, i) { discordLinks += `[📸 ภาพที่ ${i + 1}](${url})\n`; });
  }
  if (data.largeFileLink) discordLinks += `[🔗 ลิงก์ G-Drive เพิ่มเติม](${data.largeFileLink})`;
  if (!discordLinks) discordLinks = '-';

  const fields = [
    { name: 'Ticket ID', value: ticketId, inline: true },
    { name: 'ประเภทงาน', value: data.jobType || '-', inline: true },
    { name: 'กำหนดการ', value: isRush ? '⚡ ด่วน' : '📅 ปกติ', inline: true },
    { name: 'ติดต่อ', value: data.contact || '-', inline: true },
    { name: 'ไฟล์แนบ', value: discordLinks, inline: false },
  ];

  const otherPlatArr = Array.isArray(data.otherPlatform) ? data.otherPlatform : [];
  if (otherPlatArr.length > 0) {
    fields.push({ name: 'Other Platform', value: otherPlatArr.join(', '), inline: false });
    if (data.otherPlatformReason) fields.push({ name: 'เหตุผลที่ต้องการ PR', value: data.otherPlatformReason, inline: false });
  }

  const payload = {
    content: `🚨 ส่งงาน PR ใหม่ จาก **${data.department}**!`,
    embeds: [{ title: data.content, color: isRush ? 16711680 : 3447003, fields: fields }],
  };
  // Accept both boolean (Supabase frontend) and string (legacy) for the
  // silent flag. Without the boolean check, Discord always @here pings.
  if (data.silentNotify === true || data.silentNotify === 'true') payload.flags = 4096;

  try {
    UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (e) {
    console.error('Discord webhook failed: ' + e);
  }
}

function createResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
