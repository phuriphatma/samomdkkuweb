const PR_SHEET_NAME = 'Submissions';
const ANN_SHEET_NAME = 'Announcements'; 
const DISCORD_WEBHOOK_URL = 'https://discordapp.com/api/webhooks/1499412227373928590/G10Tx8Hr-2bQN6mg4q2N9STuHN4lUG4zqZsJfF1gIHwQFNb-UKDfkZuWf_kU_sa9LzPN'; 

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // --- ANNOUNCEMENTS ---
    if (data.action === 'addAnnouncement') return handleAddAnnouncement(data);
    if (data.action === 'editAnnouncement') return handleEditAnnouncement(data);

    // --- PR TRACKING & STAFF ---
    if (data.action === 'trackPR') return handleTrackPR(data);
    if (data.action === 'getUserPRHistory') return handleGetUserPRHistory(data);
    if (data.action === 'verifyPRStaffLogin') return handleVerifyPRStaffLogin(data);
    if (data.action === 'getStaffPRTickets') return handleGetStaffPRTickets(data);
    if (data.action === 'updatePRTicket') return handleUpdatePRTicket(data);
    // --- STAFF MANAGEMENT ---
    if (data.action === 'getAgents') return handleGetAgents(data);
    if (data.action === 'saveAgents') return handleSaveAgents(data);

    // --- 🌟 NEW: อัปโหลดไฟล์ทีละรูป (Sequential Upload) ---
    if (data.action === 'uploadPRFile') return handleUploadPRFile(data);
    if (data.action === 'deletePRTicket') return handleDeletePRTicket(data);

    // --- DISCORD NOTIFY ONLY (Phase 2: ticket already in Supabase) ---
    // The frontend writes to Supabase directly, then asks GAS to fire the
    // webhook so the Discord URL stays out of the browser bundle.
    if (data.action === 'notifyPROnly') {
      try { sendDiscordNotification(data, data.ticketId); } catch (e) {}
      return createResponse({ success: true });
    }

    // --- SUBMIT PR FORM (Final Step — legacy path, kept for back-compat) ---
    return handlePRSubmission(data);
    
  } catch (error) {
    console.error("doPost Catch Error: " + error.toString());
    try {
      return createResponse({ success: false, message: 'Server Error: ' + error.toString() });
    } catch(e2) {
      console.error("createResponse failed: " + e2.toString());
      return ContentService.createTextOutput("Critical Server Error: " + error.toString());
    }
  }
}

function doGet(e) {
  if (e.parameter.action === 'getAnnouncements') {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ANN_SHEET_NAME);
    if (!sheet) return createResponse({ success: true, data: [] });
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return createResponse({ success: true, data: [] });

    const results = [];
    for (let i = 1; i < data.length; i++) {
      if (data[i][5] === 'Approved') {
        results.push({
          id: data[i][0].toString(),
          date: Utilities.formatDate(new Date(data[i][1]), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"),
          title: data[i][2], department: data[i][3], content: data[i][4],
          thumbnail: data[i][6] || '' // Column 7 (index 6) — empty for legacy rows
        });
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ success: true, data: results.reverse() })).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput("MDKKU SAMO API is running.");
}

// ----------------------------------------------------
// 🌟 NEW: ฟังก์ชันรับไฟล์ทีละรูปเข้า Google Drive
// ----------------------------------------------------
function handleUploadPRFile(data) {
  try {
    const folders = DriveApp.getFoldersByName('PR_Submissions');
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('PR_Submissions');
    const base64Data = data.fileData.split(',')[1]; 
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), data.mimeType, data.fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    return createResponse({ success: true, fileUrl: file.getUrl() });
  } catch(e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// ----------------------------------------------------
// PR FORM CORE FUNCTIONS
// ----------------------------------------------------

function handlePRSubmission(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PR_SHEET_NAME);
  
  // 🌟 จัดการรวม URL ทั้งหมดที่เว็บส่งมา
  let fileLinks = [];
  if (data.uploadedUrls && data.uploadedUrls.length > 0) {
    fileLinks = fileLinks.concat(data.uploadedUrls);
  }
  if (data.largeFileLink) {
    fileLinks.push(`ลิงก์เสริม: ${data.largeFileLink}`);
  }
  
  // เชื่อม URL แต่ละรูปด้วยการขึ้นบรรทัดใหม่ (\n)
  const finalFileUrl = fileLinks.length > 0 ? fileLinks.join('\n') : 'ไม่มีไฟล์แนบ';

  const timestamp = new Date();
  const ticketId = 'PR-' + Math.random().toString(36).substr(2, 6).toUpperCase();
  const platforms = Array.isArray(data.platform) ? data.platform.join(', ') : (data.platform || '-');
  const otherPlatforms = Array.isArray(data.otherPlatform) ? data.otherPlatform.join(', ') : (data.otherPlatform || '-');
  const otherPlatformReason = data.otherPlatformReason || '-';
  const deadlineStatus = data.deadlineMode === 'Rush PR Review' ? 'ด่วน (PR Review)' : 'ปกติ';
  
  // Handle projectFormat as array (multi-select checkboxes for โครงการ)
  let projectFormatValue = '-';
  if (data.projectFormat) {
    if (Array.isArray(data.projectFormat) && data.projectFormat.length > 0) {
      projectFormatValue = data.projectFormat.join(', ');
    } else if (typeof data.projectFormat === 'string' && data.projectFormat) {
      projectFormatValue = data.projectFormat;
    }
  }
  
  // แปลง publishDate จาก datetime-local (yyyy-MM-ddTHH:mm) เป็น dd/MM/yyyy HH:mm
  let publishDateClean = '-';
  if (data.publishDate) {
    const pd = new Date(data.publishDate);
    if (!isNaN(pd.getTime())) {
      const dd = String(pd.getDate()).padStart(2, '0');
      const mm = String(pd.getMonth() + 1).padStart(2, '0');
      const yyyy = pd.getFullYear();
      const hh = String(pd.getHours()).padStart(2, '0');
      const min = String(pd.getMinutes()).padStart(2, '0');
      publishDateClean = `${dd}/${mm}/${yyyy} ${hh}:${min}`;
    } else {
      publishDateClean = data.publishDate.replace('T', ' ');
    }
  }
  const submitterEmail = data.prSubmitterEmail || 'Guest';
  const initialStatus = 'รอ PR รับเรื่อง';
  const emptyRemarks = '[]';

  sheet.appendRow([
    ticketId, timestamp, data.department, data.contact || '-', data.content, data.jobType,
    platforms, data.postingChannel || projectFormatValue || '-', publishDateClean, deadlineStatus, 
    data.rushReason || '-', data.brief || '-', data.caption || '-', finalFileUrl, 
    data.silentNotify ? 'Silent' : 'Normal', data.projectAccount || '-', data.copostWith || '-',
    submitterEmail, initialStatus, emptyRemarks, 
    JSON.stringify([]), // 🟢 เพิ่มคอลัมน์ที่ 21 (Index 20) สำหรับเก็บ Assignees เริ่มต้นเป็น []
    otherPlatforms, otherPlatformReason // 🟢 คอลัมน์ 22-23: Other platform + เหตุผล
  ]);

  // skipDiscord = dev-only flag: when true, suppress the webhook so test
  // submissions don't spam the team. The ticket is still recorded.
  if (data.skipDiscord !== true && data.skipDiscord !== 'true') {
    sendDiscordNotification(data, ticketId);
  }
  return createResponse({ success: true, message: 'บันทึกสำเร็จ!', ticketId: ticketId });
}

// ----------------------------------------------------
// PR TRACKING & STAFF FUNCTIONS (ใช้ของเดิมได้เลย)
// ----------------------------------------------------
function parsePRTicketRow(row) {
  const sheetTimeZone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  let pubDate = row[8];
  if (pubDate instanceof Date) {
    pubDate = Utilities.formatDate(pubDate, sheetTimeZone, "dd/MM/yyyy HH:mm");
  } else if (pubDate && typeof pubDate === 'string') {
    // ถ้าเป็นรูปแบบ yyyy-MM-dd HH:mm (ข้อมูลเก่า) ให้แปลงเป็น dd/MM/yyyy HH:mm
    const oldMatch = pubDate.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/);
    if (oldMatch) {
      pubDate = `${oldMatch[3]}/${oldMatch[2]}/${oldMatch[1]} ${oldMatch[4]}`;
    } else {
      pubDate = pubDate.replace('T', ' ');
      if(pubDate.length > 16) pubDate = pubDate.substring(0, 16);
    }
  }

  let submitDate = row[1];
  if (submitDate instanceof Date) {
    submitDate = Utilities.formatDate(submitDate, sheetTimeZone, "dd/MM/yyyy HH:mm");
  }

  // 🚨 ADDED TRY-CATCH BLOCKS HERE
  let parsedRemarks = [];
  try { if (row[19]) parsedRemarks = JSON.parse(row[19]); } catch(e) {}
  
  let parsedAssignees = [];
  try { if (row[20]) parsedAssignees = JSON.parse(row[20]); } catch(e) {}

  return {
    id: row[0], date: submitDate || row[1],
    dept: row[2], contact: row[3], contentName: row[4], jobType: row[5], platforms: row[6],
    postingChannel: row[7], publishDate: pubDate || '-', deadline: row[9],
    rushReason: row[10], brief: row[11], caption: row[12], fileUrl: row[13], 
    projectAccount: row[15] || '-', 
    copostWith: row[16] || '-',      
    submitter: row[17], status: row[18],
    remarks: parsedRemarks,
    assignees: parsedAssignees,
    otherPlatforms: row[21] || '-',
    otherPlatformReason: row[22] || '-'
  };
}

function handleTrackPR(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PR_SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  for(let i=1; i<rows.length; i++) {
    if(rows[i][0].toString().toUpperCase() === data.ticketId.toUpperCase()) {
      return createResponse({ success: true, ticket: parsePRTicketRow(rows[i]) });
    }
  }
  return createResponse({ success: false, message: 'ไม่พบ Ticket ID นี้ในระบบ' });
}

function handleGetUserPRHistory(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PR_SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  let tickets = [];
  for(let i=1; i<rows.length; i++) {
    if(rows[i][17] === data.email) tickets.push(parsePRTicketRow(rows[i]));
  }
  return createResponse({ success: true, tickets: tickets.reverse() });
}

function handleVerifyPRStaffLogin(data) {
  if(data.username === 'samomdkkupr' && data.password === 'samo69pr') return createResponse({ success: true });
  return createResponse({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
}

function handleGetStaffPRTickets(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PR_SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  let tickets = [];
  for(let i=1; i<rows.length; i++) {
    tickets.push(parsePRTicketRow(rows[i]));
  }
  return createResponse({ success: true, tickets: tickets.reverse() });
}

function handleUpdatePRTicket(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PR_SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  
  console.log("handleUpdatePRTicket: Started for ticketId " + data.ticketId);
  for(let i=1; i<rows.length; i++) {
    if(rows[i][0].toString() === data.ticketId) {
      console.log("handleUpdatePRTicket: Found ticket at row " + (i + 1));
      const rowNum = i + 1;
      
      try {
        if(data.newStatus) {
          console.log("Updating Status");
          sheet.getRange(rowNum, 19).setValue(data.newStatus);
        }
        if(data.newPublishDate) {
          console.log("Updating Publish Date");
          let cleanDate = data.newPublishDate.replace('T', ' ');
          const dtMatch = cleanDate.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/);
          if (dtMatch) {
            cleanDate = `${dtMatch[3]}/${dtMatch[2]}/${dtMatch[1]} ${dtMatch[4]}`;
          }
          sheet.getRange(rowNum, 9).setValue(cleanDate);
        }
        if(data.newDeadlineStatus) {
          console.log("Updating Deadline Status");
          sheet.getRange(rowNum, 10).setValue(data.newDeadlineStatus);
        }
        
        console.log("Parsing existing remarks");
        let remarks = rows[i][19] ? JSON.parse(rows[i][19]) : [];
        const timeStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yy HH:mm");
        
        if (data.autoLogs && data.autoLogs.length > 0) {
          console.log("Adding auto logs");
          data.autoLogs.forEach(logText => {
            remarks.push({ time: timeStr, by: 'ระบบ', text: logText, type: 'log' });
          });
        }
        if (data.assignees) {
          console.log("Updating Assignees");
          sheet.getRange(rowNum, 21).setValue(JSON.stringify(data.assignees));
        }

        if(data.remark) {
          console.log("Adding remark");
          remarks.push({ time: timeStr, by: 'ทีม PR', text: data.remark });
        }
        
        if ((data.autoLogs && data.autoLogs.length > 0) || data.remark) {
          console.log("Updating remarks column");
          sheet.getRange(rowNum, 20).setValue(JSON.stringify(remarks));
        }

        console.log("handleUpdatePRTicket: Successfully updated all fields");
        return createResponse({ success: true });
      } catch (err) {
        console.error("Error during setValue in handleUpdatePRTicket: " + err.toString());
        throw err;
      }
    }
  }
  console.log("handleUpdatePRTicket: Ticket not found");
  return createResponse({ success: false, message: 'Ticket not found' });
}

// ----------------------------------------------------
// ANNOUNCEMENTS FUNCTIONS (ใช้ของเดิมได้เลย)
// ----------------------------------------------------
function handleAddAnnouncement(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ANN_SHEET_NAME);
  const id = new Date().getTime().toString();
  // Column 7 (index 6) = thumbnail URL. Empty string when not provided.
  sheet.appendRow([id, new Date(), data.title, data.department, data.content, 'Approved', data.thumbnail || '']);
  return createResponse({ success: true, message: 'เผยแพร่ประกาศสำเร็จ!' });
}

function handleEditAnnouncement(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ANN_SHEET_NAME);
  const records = sheet.getDataRange().getValues();
  for (let i = 1; i < records.length; i++) {
    if (records[i][0].toString() === data.id.toString()) {
      sheet.getRange(i+1, 3).setValue(data.title);
      sheet.getRange(i+1, 4).setValue(data.department);
      sheet.getRange(i+1, 5).setValue(data.content);
      // Column 7 (index 6 / 1-based 7) = thumbnail URL.
      sheet.getRange(i+1, 7).setValue(data.thumbnail || '');
      return createResponse({ success: true, message: 'อัปเดตประกาศสำเร็จ!' });
    }
  }
  return createResponse({ success: false, message: 'Not found' });
}

// ----------------------------------------------------
// UTILS & DISCORD
// ----------------------------------------------------
function createResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sendDiscordNotification(data, ticketId) {
  const isRush = data.deadlineMode === 'Rush PR Review';
  
  // 🌟 จัดเรียงลิงก์รูปให้สวยงามบน Discord
  let discordLinks = '';
  if (data.uploadedUrls && data.uploadedUrls.length > 0) {
    data.uploadedUrls.forEach((url, i) => {
      discordLinks += `[📸 ภาพที่ ${i+1}](${url})\n`;
    });
  }
  if (data.largeFileLink) discordLinks += `[🔗 ลิงก์ G-Drive เพิ่มเติม](${data.largeFileLink})`;
  if (!discordLinks) discordLinks = '-';

  let fields = [
    { name: 'Ticket ID', value: ticketId, inline: true },
    { name: 'ประเภทงาน', value: data.jobType || '-', inline: true },
    { name: 'กำหนดการ', value: isRush ? '⚡ ด่วน' : '📅 ปกติ', inline: true },
    { name: 'ติดต่อ', value: data.contact || '-', inline: true },
    { name: 'ไฟล์แนบ', value: discordLinks, inline: false }
  ];

  // เพิ่ม Other platform ถ้ามี
  const otherPlatArr = Array.isArray(data.otherPlatform) ? data.otherPlatform : [];
  if (otherPlatArr.length > 0) {
    fields.push({ name: 'Other Platform', value: otherPlatArr.join(', '), inline: false });
    if (data.otherPlatformReason) fields.push({ name: 'เหตุผลที่ต้องการ PR', value: data.otherPlatformReason, inline: false });
  }

  const payload = {
    content: `🚨 ส่งงาน PR ใหม่ จาก **${data.department}**!`,
    embeds: [{ title: data.content, color: isRush ? 16711680 : 3447003, fields: fields }]
  };
  // Accept both boolean true (new Supabase frontend) and string 'true'
  // (legacy form submissions). Without the boolean check, Discord
  // notifications always @here even when the user picked "Silent".
  if (data.silentNotify === true || data.silentNotify === 'true') payload.flags = 4096;

  try { UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }); } catch (e) {}
}

// โหลดรายชื่อจาก Script Properties
function handleGetAgents(data) {
  try {
    const props = PropertiesService.getScriptProperties();
    const agentsRaw = props.getProperty('PR_AGENTS');
    const agents = agentsRaw ? JSON.parse(agentsRaw) : [];
    return createResponse({ success: true, agents: agents });
  } catch(e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// เซฟรายชื่อลง Script Properties
function handleSaveAgents(data) {
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('PR_AGENTS', JSON.stringify(data.agents || []));
    return createResponse({ success: true });
  } catch(e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

function handleDeletePRTicket(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PR_SHEET_NAME);
  const rows = sheet.getDataRange().getValues();
  for(let i=1; i<rows.length; i++) {
    if(rows[i][0].toString() === data.ticketId) {
      sheet.deleteRow(i + 1); // +1 because sheet rows are 1-indexed
      return createResponse({ success: true, message: 'ลบงาน PR เรียบร้อย' });
    }
  }
  return createResponse({ success: false, message: 'ไม่พบ Ticket ที่ต้องการลบ' });
}