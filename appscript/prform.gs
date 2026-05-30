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

    if (data.action === 'uploadPRFile')      return handleUploadPRFile(data);
    if (data.action === 'uploadShopFile')    return handleUploadShopFile(data);
    if (data.action === 'deleteShopFile')    return handleDeleteShopFile(data);
    if (data.action === 'uploadProjectFile') return handleUploadProjectFile(data);

    if (data.action === 'notifyPROnly') {
      try { sendDiscordNotification(data, data.ticketId); } catch (err) { console.error('notifyPROnly: ' + err); }
      return createResponse({ success: true });
    }

    if (data.action === 'notifyProjectEmail') {
      try { sendProjectEmail(data); } catch (err) { console.error('notifyProjectEmail: ' + err); }
      return createResponse({ success: true });
    }

    if (data.action === 'notifyProjectDiscord') {
      try { sendProjectDiscord(data); } catch (err) { console.error('notifyProjectDiscord: ' + err); }
      return createResponse({ success: true });
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

    var folder = getOrCreateFolderPath_(path);
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

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
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
