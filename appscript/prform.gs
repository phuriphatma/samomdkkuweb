// ============================================================
// prform.gs — Drive file upload + projects email only
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
//   - notifyProjectEmail   : send an email via MailApp to the receiver
//                            (free, no SMTP needed) when a document is
//                            sent or a file is replaced.
//
// Discord notifications (PR / Vital Sound / หนังสือโครงการ) moved OFF GAS to
// the Cloudflare Pages Function `/notify` (functions/notify.js). Everything
// else (PR submit, tracking, staff dashboard, announcements, agents) is
// handled directly by Supabase from the frontend.
//
// EVERY folder this script touches lives under `My Drive / IT Database`
// (see APP_ROOT_FOLDER_NAME below) — the frontend still passes root-relative
// logical paths like `SAMO_Shop/Slips/2026-05`, and the resolution happens
// here so no client needs to know where the tree is mounted.
// ============================================================

// ============================================================
// App root — `My Drive / IT Database`
//
// Historically every top-level folder (PR_Submissions, Projects, SAMO_Shop,
// SAMO_Team) was created directly in My Drive root, which made the SAMO
// Drive unbrowsable. They now live under a single container folder.
//
// getOrCreateTopFolder_ MIGRATES lazily: if the folder is already under
// IT Database it is reused; if it is still sitting at My Drive root (the
// pre-migration state) it is MOVED in. A Drive move preserves the folder id
// and every file id inside it, so all URLs already stored in Postgres keep
// resolving — nothing to backfill. Creating a fresh empty folder instead
// would orphan every existing file (the same trap the by-code project
// folder walker below exists to avoid).
// ============================================================

var APP_ROOT_FOLDER_NAME = 'IT Database';

/** Get-or-create `My Drive / IT Database`. */
function getAppRoot_() {
  var myDrive = DriveApp.getRootFolder();
  var iter = myDrive.getFoldersByName(APP_ROOT_FOLDER_NAME);
  return iter.hasNext() ? iter.next() : myDrive.createFolder(APP_ROOT_FOLDER_NAME);
}

/** Resolve a top-level app folder (PR_Submissions / Projects / SAMO_Shop /
 *  SAMO_Team) under the app root, creating it if absent and adopting a
 *  legacy My-Drive-root folder of the same name by moving it in. */
function getOrCreateTopFolder_(name) {
  var root = getAppRoot_();
  var here = root.getFoldersByName(name);
  if (here.hasNext()) {
    var found = here.next();
    // SPLIT check: a same-named folder still at My Drive root means older
    // files live somewhere no future upload will look. Never merge or move
    // automatically on a user's upload path — just make the state loud, and
    // let `inspectDriveLayout` / `migrateDriveLayout` handle it deliberately.
    if (DriveApp.getRootFolder().getFoldersByName(name).hasNext()) {
      console.warn('Drive layout SPLIT: "' + name + '" exists in both ' +
                   APP_ROOT_FOLDER_NAME + ' and My Drive root. Run inspectDriveLayout().');
    }
    return found;
  }

  var legacy = DriveApp.getRootFolder().getFoldersByName(name);
  if (legacy.hasNext()) {
    var f = legacy.next();
    f.moveTo(root);   // id preserved → stored file URLs unaffected
    return f;
  }
  return root.createFolder(name);
}

/** Non-creating twin of getOrCreateTopFolder_, for delete paths — never
 *  materialise a folder just to find out it isn't there. Returns null. */
function findTopFolder_(name) {
  var myDrive = DriveApp.getRootFolder();
  var rootIter = myDrive.getFoldersByName(APP_ROOT_FOLDER_NAME);
  if (rootIter.hasNext()) {
    var here = rootIter.next().getFoldersByName(name);
    if (here.hasNext()) return here.next();
  }
  var legacy = myDrive.getFoldersByName(name);
  return legacy.hasNext() ? legacy.next() : null;
}

/** The top-level folders this script owns. */
var APP_TOP_FOLDERS = ['PR_Submissions', 'Projects', 'SAMO_Shop', 'SAMO_Team'];

/** Immediate child counts — cheap fingerprint used to prove a move changed
 *  nothing but the parent. Not recursive: `Projects/` has one subfolder per
 *  โครงการ, and a deep walk would blow the 6-minute execution cap. */
function folderFingerprint_(folder) {
  var files = 0, folders = 0;
  var fi = folder.getFiles();    while (fi.hasNext())  { fi.next();  files++; }
  var fo = folder.getFolders();  while (fo.hasNext())  { fo.next();  folders++; }
  return { id: folder.getId(), files: files, folders: folders };
}

/**
 * READ-ONLY inventory. Run this FIRST from the Apps Script editor
 * (Run ▸ inspectDriveLayout) — it touches nothing and tells you exactly what
 * migrateDriveLayout would do, including any SPLIT (same name existing in
 * both places), which is the one case that needs a human decision.
 */
function inspectDriveLayout() {
  var myDrive = DriveApp.getRootFolder();
  var rootIter = myDrive.getFoldersByName(APP_ROOT_FOLDER_NAME);
  var appRoot = rootIter.hasNext() ? rootIter.next() : null;
  var lines = [APP_ROOT_FOLDER_NAME + ': ' + (appRoot ? 'exists (' + appRoot.getId() + ')' : 'does not exist yet')];

  for (var i = 0; i < APP_TOP_FOLDERS.length; i++) {
    var name = APP_TOP_FOLDERS[i];
    var inPlace = appRoot ? appRoot.getFoldersByName(name) : null;
    var here = (inPlace && inPlace.hasNext()) ? inPlace.next() : null;
    var legacyIter = myDrive.getFoldersByName(name);
    var legacy = legacyIter.hasNext() ? legacyIter.next() : null;

    if (here && legacy) {
      lines.push('!! ' + name + ': SPLIT — exists in BOTH ' + APP_ROOT_FOLDER_NAME +
                 ' (' + JSON.stringify(folderFingerprint_(here)) + ') and My Drive root (' +
                 JSON.stringify(folderFingerprint_(legacy)) + '). migrateDriveLayout will REFUSE. ' +
                 'Merge them by hand in Drive, then re-run.');
    } else if (here) {
      lines.push('   ' + name + ': already in place ' + JSON.stringify(folderFingerprint_(here)));
    } else if (legacy) {
      lines.push('-> ' + name + ': at My Drive root ' + JSON.stringify(folderFingerprint_(legacy)) +
                 ' — will be MOVED (same id, same contents)');
    } else {
      lines.push('   ' + name + ': not found anywhere — nothing to do (will NOT be created)');
    }
  }
  var out = lines.join('\n');
  console.log(out);
  return out;
}

/**
 * ONE-SHOT tidy-up: move every legacy top-level folder into `IT Database`
 * right now, instead of waiting for each one's next upload to adopt it.
 *
 * Run it by hand from the Apps Script editor (Run ▸ migrateDriveLayout)
 * after `inspectDriveLayout`. Not reachable over HTTP — doPost has no route
 * to it.
 *
 * CANNOT LOSE DATA, by construction:
 *   - It only ever calls Folder.moveTo(). Nothing is created, copied,
 *     renamed, trashed or deleted — a Drive move re-parents ONE folder and
 *     preserves its id and every file id inside it, so URLs already stored
 *     in Postgres keep resolving with no backfill.
 *   - It verifies the child counts are identical before and after the move
 *     and reports a mismatch rather than reporting success.
 *   - A folder that exists in BOTH places is a SPLIT: it refuses and asks
 *     for a manual merge, because silently picking one would strand the
 *     other's files where no future upload would look.
 *   - A folder that exists nowhere is skipped, not created.
 * Idempotent: re-running after a successful pass reports "already in place".
 */
function migrateDriveLayout() {
  var myDrive = DriveApp.getRootFolder();
  var root = getAppRoot_();
  var report = [];

  for (var i = 0; i < APP_TOP_FOLDERS.length; i++) {
    var name = APP_TOP_FOLDERS[i];
    var hereIter = root.getFoldersByName(name);
    var here = hereIter.hasNext() ? hereIter.next() : null;
    var legacyIter = myDrive.getFoldersByName(name);
    var legacy = legacyIter.hasNext() ? legacyIter.next() : null;

    if (here && legacy) {
      report.push('!! ' + name + ': REFUSED — exists in both places. Merge by hand, then re-run.');
      continue;
    }
    if (here)    { report.push('   ' + name + ': already in place'); continue; }
    if (!legacy) { report.push('   ' + name + ': not found (nothing to move)'); continue; }

    var before = folderFingerprint_(legacy);
    legacy.moveTo(root);
    var after = folderFingerprint_(legacy);
    var intact = before.id === after.id && before.files === after.files && before.folders === after.folders;
    report.push((intact ? '-> ' : '!! ') + name + ': MOVED into ' + APP_ROOT_FOLDER_NAME +
                ' — ' + (intact ? 'verified intact ' : 'COUNT MISMATCH ') +
                JSON.stringify(before) + ' -> ' + JSON.stringify(after));
  }
  var out = report.join('\n');
  console.log(out);
  return out;
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    console.log('doPost: action=' + (data && data.action ? data.action : '(unknown)'));

    if (data.action === 'uploadPRFile')      return handleUploadPRFile(data);
    if (data.action === 'uploadShopFile')    return handleUploadShopFile(data);
    if (data.action === 'uploadTeamFile')    return handleUploadTeamFile(data);
    if (data.action === 'deleteShopFile')    return handleDeleteShopFile(data);
    if (data.action === 'uploadProjectFile')   return handleUploadProjectFile(data);
    if (data.action === 'deleteProjectFile')   return handleDeleteProjectFile(data);
    if (data.action === 'deleteProjectFolder') return handleDeleteProjectFolder(data);
    if (data.action === 'getProjectFolderInfo') return handleGetProjectFolderInfo(data);
    if (data.action === 'getProjectFileData')   return handleGetProjectFileData(data);

    if (data.action === 'notifyProjectEmail') {
      try { sendProjectEmail(data); }
      catch (err) {
        console.error('notifyProjectEmail: ' + err);
        return createResponse({ success: false, message: String(err) });
      }
      return createResponse({ success: true });
    }

    // NOTE: Discord notifications (notifyPROnly / notifyProjectDiscord /
    // the Vital Sound actions) moved to the Cloudflare Pages Function
    // `/notify` — see functions/notify.js + skills/cloudflare-notify-function.md.
    // GAS now only does Drive uploads + the projects email.

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
    const folder = getOrCreateTopFolder_('PR_Submissions');
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

// ============================================================
// uploadTeamFile — ทีม SAMO member portraits, filed by ปีการศึกษา
//
// Same shape as uploadShopFile but allow-listed to 'SAMO_Team/...' so the
// two features cannot write into each other's tree. The frontend builds
//   SAMO_Team/<ปีการศึกษา>/<ฝ่าย>/<ลำดับ>-<ชื่อ-สกุล>.webp
// which makes the Drive folder browsable by a human looking for "the 2569
// อุปนายก photos" without needing the app.
//
// The FILENAME is for humans only. The app addresses the photo by Drive
// file id (the returned URL), so renaming a file in Drive later — fixing a
// misspelling, say — never breaks the page. Do not build any lookup that
// depends on the name.
// ============================================================

function handleUploadTeamFile(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath is required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (path.indexOf('SAMO_Team') !== 0) {
      return createResponse({ success: false, message: 'folderPath must start with SAMO_Team' });
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
 * Walk a slash-separated folder path under the app root (`IT Database`),
 * creating any missing folders as we go. Returns the leaf folder.
 *
 * The FIRST segment is resolved with getOrCreateTopFolder_ so a legacy
 * My-Drive-root folder is adopted rather than duplicated; deeper segments
 * are plain get-or-create under their parent.
 */
function getOrCreateFolderPath_(path) {
  var parts = path.split('/').filter(function (p) { return p && p.length; });
  if (!parts.length) return getAppRoot_();
  var parent = getOrCreateTopFolder_(parts[0]);
  for (var i = 1; i < parts.length; i++) {
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
  // Top-level "Projects" folder: exact-name match (no code), under the
  // app root, adopting a legacy My-Drive-root folder if that's where it is.
  var parent = getOrCreateTopFolder_('Projects');
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

// ============================================================
// getProjectFileData — return a Drive file's bytes as base64 by id.
// Used by the in-browser e-sign flow: the browser can't fetch the raw
// bytes from a Drive viewer URL (CORS), so it round-trips through GAS.
// Allow-listed to files under `Projects/` only.
// ============================================================
function handleGetProjectFileData(data) {
  try {
    var id = String(data.fileId || '').trim();
    if (!id) return createResponse({ success: false, message: 'fileId required' });
    var file;
    try { file = DriveApp.getFileById(id); }
    catch (e) { return createResponse({ success: false, message: 'file not found' }); }
    if (!fileLivesUnderProjects_(file)) {
      return createResponse({ success: false, message: 'file is not inside Projects' });
    }
    var blob = file.getBlob();
    return createResponse({
      success: true,
      base64: Utilities.base64Encode(blob.getBytes()),
      mimeType: blob.getContentType(),
      fileName: file.getName(),
      sizeBytes: file.getSize(),
    });
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
    // Non-creating lookup: a delete must never materialise the tree it is
    // about to trash. Checks IT Database first, then the legacy root spot.
    var parent = findTopFolder_('Projects');
    if (!parent) {
      return createResponse({ success: true, alreadyGone: true });
    }
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
// sendMigrationVerifyEmails — one-off: verify the guessed kkumail
// addresses for the 5 gmail→kkumail passport migrations (migration
// 0064). Each student scanned SAMO Passport with a personal gmail
// before the @kkumail.com-only gate; their data was carried to a
// kkumail address DERIVED from their name (not confirmed). This
// emails each student's KNOWN gmail (guaranteed deliverable) asking
// them to confirm the kkumail is theirs.
//
// Correction channel = reply to the email (replyTo below). Replies
// land in the SAMO Gmail; a wrong address → re-run a corrected 0064.
//
// HOW TO RUN (do NOT wire this into doPost — it's a manual one-off):
//   1. Open the GAS editor, select sendMigrationVerifyEmails, Run.
//      Editor runs are owner-authenticated → MailApp sends AND
//      Logger output appears (public /exec fetches log nothing —
//      see skills/deploy-gas.md).
//   2. DRY_RUN=true (default) sends all 5 to REPLY_TO only, each
//      prefixed [DRY], so you preview the real per-student body.
//   3. When the previews look right, set DRY_RUN=false and Run again
//      to send to the students' gmail for real.
// ============================================================

function sendMigrationVerifyEmails() {
  var DRY_RUN   = true;                              // ← flip to false to send for real
  var REPLY_TO  = 'mdstuddata.beta@gmail.com';       // the GAS owner Gmail; replies + dry-run recipient land here
  var LINK      = 'https://samo.md.kku.ac.th/passport/';

  // From migration 0064. gmail = where they actually scanned (known-good).
  // kkumail = derived from name (UNCONFIRMED — the whole point of this email).
  var MOVES = [
    { gmail: 'wariikung@gmail.com',         kkumail: 'ingwer.s@kkumail.com' },
    { gmail: 'phuri8980@gmail.com',         kkumail: 'phurichaya.bo@kkumail.com' },
    { gmail: 'kenkunchai50@gmail.com',      kkumail: 'kenkunchai.ch@kkumail.com' },
    { gmail: 'sirikanrayamasena@gmail.com', kkumail: 'sirikanraya.m@kkumail.com' },
    { gmail: 'kedsaraporn2007@gmail.com',   kkumail: 'kedsaraporn.t@kkumail.com' },
  ];

  var sent = 0;
  for (var i = 0; i < MOVES.length; i++) {
    var m   = MOVES[i];
    var to  = DRY_RUN ? REPLY_TO : m.gmail;
    var tag = DRY_RUN ? '[DRY → ' + m.gmail + '] ' : '';
    MailApp.sendEmail({
      to: to,
      replyTo: REPLY_TO,
      name: 'MDKKU SAMO',
      subject: tag + '[SAMO Passport] ยืนยันอีเมล @kkumail.com ของคุณ',
      htmlBody: migrationVerifyHtml_(m.gmail, m.kkumail, LINK),
    });
    sent++;
    Logger.log('sent to ' + to + '  (kkumail=' + m.kkumail + ')');
  }
  Logger.log('DONE. DRY_RUN=' + DRY_RUN + '  sent=' + sent);
  return { dryRun: DRY_RUN, sent: sent };
}

function migrationVerifyHtml_(gmail, kkumail, link) {
  return '' +
    '<div style="font-family:system-ui,-apple-system,\'Noto Sans Thai\',Segoe UI,sans-serif;' +
    'max-width:520px;margin:0 auto;color:#1b2733;line-height:1.7;font-size:15px">' +
      '<p>สวัสดีค่ะ/ครับ 🛂</p>' +
      '<p>ก่อนหน้านี้คุณสแกนสะสมคะแนน <b>SAMO Passport</b> ด้วยบัญชี ' +
        '<span style="word-break:break-all">' + gmail + '</span></p>' +
      '<p>ขณะนี้ SAMO Passport รองรับเฉพาะบัญชี <b>@kkumail.com</b> เท่านั้น ' +
        'เราจึงได้ <b>ย้ายคะแนน กิจกรรม แสตมป์ และเกียรติบัตร</b> ของคุณไปยังบัญชี:</p>' +
      '<p style="text-align:center;font-size:17px;font-weight:700;background:#eafaf2;' +
        'border:1px solid #b7e6ce;border-radius:12px;padding:14px;word-break:break-all">' +
        kkumail + '</p>' +
      '<p><b>กรุณาช่วยตรวจสอบ:</b> เข้าสู่ระบบที่ลิงก์ด้านล่างด้วยบัญชี kkumail นี้</p>' +
      '<p style="text-align:center;margin:22px 0">' +
        '<a href="' + link + '" style="display:inline-block;background:#2f9e78;color:#fff;' +
        'text-decoration:none;padding:13px 26px;border-radius:12px;font-weight:600">' +
        'เปิด SAMO Passport</a></p>' +
      '<p style="background:#f4f7f9;border-radius:10px;padding:14px 16px">' +
        '✅ <b>ถ้าเข้าสู่ระบบแล้วเห็นคะแนนของคุณครบ</b> — กรุณาส่งอีเมลมาที่ ' +
        '<b>mdstuddata.beta@gmail.com</b> ว่า <b>&ldquo;เห็นครบแล้ว&rdquo;</b> เพื่อยืนยัน<br><br>' +
        '❌ <b>ถ้า ' + kkumail + ' ไม่ใช่อีเมล @kkumail.com ของคุณ</b> ' +
        'หรือเข้าสู่ระบบแล้วคะแนนไม่ครบ — กรุณาส่งอีเมลมาที่ <b>mdstuddata.beta@gmail.com</b> ' +
        'พร้อมแจ้งอีเมล @kkumail.com ที่ถูกต้องของคุณ แล้วเราจะย้ายข้อมูลให้ใหม่</p>' +
      '<p style="color:#7a8896;font-size:13px;margin-top:24px">— ทีมงาน SAMO MDKKU</p>' +
    '</div>';
}

function createResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
