// ============================================================
// prform.gs — Discord notify + Drive file upload only
//
// Post-Supabase-migration, GAS serves just two actions:
//   - uploadPRFile  : upload an image to Drive (chosen over Supabase
//                     Storage for the 2 TB quota)
//   - notifyPROnly  : fire the PR-team Discord webhook
//
// Everything else (PR submit, tracking, staff dashboard, announcements,
// agents) is now handled directly by Supabase from the frontend.
// ============================================================

const DISCORD_WEBHOOK_URL = 'https://discordapp.com/api/webhooks/1499412227373928590/G10Tx8Hr-2bQN6mg4q2N9STuHN4lUG4zqZsJfF1gIHwQFNb-UKDfkZuWf_kU_sa9LzPN';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'uploadPRFile') return handleUploadPRFile(data);

    if (data.action === 'notifyPROnly') {
      try { sendDiscordNotification(data, data.ticketId); } catch (err) { console.error('notifyPROnly: ' + err); }
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
