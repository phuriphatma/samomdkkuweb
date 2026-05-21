// ==========================================
// CONFIGURATION สำหรับ VITAL SOUND
// ==========================================
const WEBHOOK_MAP = {
  "SE": "https://discordapp.com/api/webhooks/1500410490831241298/fT3gG0guAmtCOfEiaQ9bJoApU4eUoJs_BD4vJSKNW60JYLryhHl0rYfMqcEbZf-VJl0f",
  "อุปนายกฝ่ายบริหารองค์กร": "https://discordapp.com/api/webhooks/1500408821565358130/rOkqB6Ov7aBVtm1OeovIUXSPcNX0PLs0MxsVQpG3kuZ3TPvaDZ2vpmq65gAcxFo-kUcg",
  "อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร": "https://discordapp.com/api/webhooks/1500408826388811837/3FZLMgnz89iwkYL9iwHUCJOCCegTl3q0gmGZw10lngOugWKrMMM3CFnz2u0rRc9nViSr",
  "อุปนายกฝ่ายกิจการภายใน": "https://discordapp.com/api/webhooks/1500408834395738182/ih_3w50atGfZnwbIcsuOl9jTeNemdDOHM5_86pmutkZrPD92M52eh8OP2c_oVDl_-RB1",
  "อุปนายกฝ่ายกิจการภายนอก": "https://discordapp.com/api/webhooks/1500408839428636743/rJ-g-ChmVFJiLi0XJueoQZnvX9RPwvrprMakFuEbNMRad-X6AQWX3Htpt5kJvujfw8Ra",
  "อุปนายกฝ่ายกิจการมหาวิทยาลัย": "https://discordapp.com/api/webhooks/1500408850635817011/llxXROxVRFDRqA9lWyGA-YmrTuq_TqisutR59kutNzo67h5krUQrHq5th0xi8issOsWU",
  "อุปนายกฝ่ายวิชาการ": "https://discordapp.com/api/webhooks/1500408861486485614/c0oYEH7h9BchdNn3LNnWVVLGHo8p6thffF3sNLpg5PIK3uzAvy8nUTMWLvm6bNn8Vr1w",
  "อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร": "https://discordapp.com/api/webhooks/1500408866817441822/wocupVF1KymJM2bpsMPnaL8jsf5h1PmGbs2jAMvZprdZyPfztSOoVQ-RhmAIeBCaWPAK",
  "อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม": "https://discordapp.com/api/webhooks/1500408871892549673/pbmYacjplhIETAu4HEojR9Vgk-2RC1sROCuGkCtODyji8rD23FeoOyMCJ0fuH_PT0IpT",
  "อุปนายกฝ่ายเวชนิทัศน์": "https://discordapp.com/api/webhooks/1500408877185761280/EnghO2u1ptpZXEgxKGpTBA9hxXenk5B4xK1rZc4wG9GhmGtsFwGMTAtD060gs-BKEfvd",
  "อุปนายกฝ่ายรังสีเทคนิค": "https://discordapp.com/api/webhooks/1500408883313643590/hSAWQGiyP5WKNVdpFsF7UCj7w4qauEYPwv6aF6UAYWXX9lunXnijo1VUiLGBZrcpJ7a3"
};

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.action === 'verifyAccount') {
      return createJsonResponse(verifyAccount(payload));
    }
    else if (payload.action === 'submitVitalSound') {
      return createJsonResponse(handleVitalSoundSubmit(payload));
    } 
    else if (payload.action === 'trackVitalSound') {
      return createJsonResponse(handleVitalSoundTrack(payload));
    }
    else if (payload.action === 'getUserHistory') {
      return createJsonResponse(getUserHistory(payload));
    }
    else if (payload.action === 'verifyStaffLogin') {     // <--- [NEW] เพิ่ม Action เช็ครหัส Staff
      return createJsonResponse(verifyStaffLogin(payload));
    }
    else if (payload.action === 'getStaffTickets') {
      return createJsonResponse(getStaffTickets(payload));
    }
    else if (payload.action === 'updateTicket') {
      return createJsonResponse(updateTicket(payload));
    }
    else if (payload.action === 'addRemark') {
      return createJsonResponse(addRemark(payload));
    }

    throw new Error("Action ไม่ถูกต้อง");

  } catch (error) {
    return createJsonResponse({ success: false, message: error.toString() });
  }
}

// ------------------------------------------
// [NEW] ตรวจสอบบัญชี Staff (ดึงรหัสลงมาซ่อนไว้ที่นี่)
// ------------------------------------------
function verifyStaffLogin(data) {
  // ตั้งค่ารหัสผ่านเจ้าหน้าที่ไว้ที่นี่
  const STAFF_USER = "samomdkkuvssound";
  const STAFF_PASS = "samo69vssound";

  const user = data.username ? data.username.toString().trim() : "";
  const pass = data.password ? data.password.toString().trim() : "";

  if (user === STAFF_USER && pass === STAFF_PASS) {
    return { success: true, message: "เข้าสู่ระบบสำเร็จ" };
  } else {
    return { success: false, message: "Username หรือ Password สำหรับเจ้าหน้าที่ไม่ถูกต้อง" };
  }
}

// ------------------------------------------
// 0. ตรวจสอบบัญชีตอนกรอกฟอร์ม
// ------------------------------------------
function verifyAccount(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Tickets");
  if(!sheet) {
    if(data.mode === 'create') return { success: true };
    return { success: false, message: "ยังไม่มีระบบฐานข้อมูล" };
  }

  const rows = sheet.getDataRange().getValues();
  const user = data.username.toString().trim();
  const pass = data.password.toString().trim();

  if(data.mode === 'create') {
     for(let i=1; i<rows.length; i++) {
       if(rows[i][4] && rows[i][4].toString().trim() === user) {
         return { success: false, message: "Username นี้มีผู้ใช้งานแล้ว กรุณาตั้งชื่ออื่น" };
       }
     }
     return { success: true };
  } 
  else if(data.mode === 'login') {
     for(let i=1; i<rows.length; i++) {
       const dbUser = rows[i][4] ? rows[i][4].toString().trim() : "";
       const dbPass = rows[i][5] ? rows[i][5].toString().trim() : "";
       if(dbUser === user) {
         if(dbPass === pass) return { success: true };
         else return { success: false, message: "รหัสผ่านไม่ถูกต้อง" };
       }
     }
     return { success: false, message: "ไม่พบบัญชีผู้ใช้นี้ กรุณาสร้างบัญชีใหม่" };
  }
  return { success: false, message: "Mode ไม่ถูกต้อง" };
}

function handleVitalSoundSubmit(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Tickets");
  
  if (!sheet) {
    sheet = ss.insertSheet("Tickets");
    sheet.appendRow(["Ticket ID", "Timestamp", "Name", "Year", "Username", "Password", "Problem", "Target Department", "Status", "Remarks", "Requested Department"]);
    sheet.getRange("A1:K1").setFontWeight("bold").setBackground("#fbcfe8");
  }

  const mode = data.vsAccountMode;
  const ticketId = "VS-" + Utilities.formatDate(new Date(), "GMT+7", "yyMMdd-HHmm");
  const timestamp = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");

  const isEmergency = data.vsEmergency === true || data.vsEmergency === "true";
  const customerRequestedDept = data.vsDepartment || 'SE';

  // ถ้าฉุกเฉิน → ส่งตรงถึงอุปนายกที่เลือก
  // ถ้าปกติ → ส่ง SE ก่อนเสมอ ไม่ว่าจะเลือกฝ่ายอะไร
  const responsibleDept = isEmergency ? customerRequestedDept : 'SE';
  const initialStatus = isEmergency ? "กำลังรออุปนายกพิจารณา (ด่วน)" : "รอ SE รับเรื่อง";

  const rowData = [
    ticketId,
    timestamp,
    data.vsName || 'Anonymous',
    data.vsYear || '-',
    (mode === 'create' || mode === 'login') ? data.vsUsername : '',
    (mode === 'create' || mode === 'login') ? data.vsPassword : '',
    data.vsProblem,
    responsibleDept,   // Column H: ฝ่ายที่รับผิดชอบจริง (SE เสมอ ยกเว้นฉุกเฉิน)
    initialStatus,
    "[]",
    customerRequestedDept  // Column K: ฝ่ายที่ผู้ใช้ขอ (เพื่อให้ SE รู้ว่าต้องส่งต่อไปไหน)
  ];

  sheet.appendRow(rowData);

  // แจ้ง SE เสมอ (ยกเว้นฉุกเฉิน แจ้งอุปที่เลือก)
  // ส่ง customerRequestedDept เข้าไปด้วย เพื่อแสดงในข้อความ Discord
  sendDiscordNotification(
    ticketId, 
    data.vsProblem, 
    responsibleDept,        // webhook ของใคร (SE หรืออุปฯ กรณีฉุกเฉิน)
    isEmergency, 
    data.vsSilentNotify,
    customerRequestedDept   // ฝ่ายที่ผู้ใช้ขอ (แสดงในข้อความแจ้งเตือน)
  );

  return { success: true, message: `ระบบบันทึกปัญหาของคุณเรียบร้อยแล้ว\nTicket ID: ${ticketId}`, ticketId: ticketId };
}

// ------------------------------------------
// 2. ผู้ใช้ค้นหาด้วย Ticket ID
// ------------------------------------------
function handleVitalSoundTrack(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Tickets");
  if(!sheet) return { success: false, message: "ยังไม่มีข้อมูลในระบบ" };

  const rows = sheet.getDataRange().getValues();
  const reqTicketId = data.ticketId.trim();
  
  for(let i = 1; i < rows.length; i++) {
    if(rows[i][0].toString().trim() === reqTicketId) {
      let remarksArr = [];
      try { if(rows[i][9]) remarksArr = JSON.parse(rows[i][9]); } catch(e) { }
      return { 
        success: true, 
        isOwner: false, // ค้นหาด้วย ID พิมพ์ตอบไม่ได้
        ticket: { 
          id: rows[i][0], date: rows[i][1], problem: rows[i][6], 
          dept: rows[i][7], status: rows[i][8], remarks: remarksArr
        } 
      };
    }
  }
  return { success: false, message: 'ไม่พบหมายเลข Ticket นี้' };
}

// ------------------------------------------
// 2.1 ผู้ใช้ Login เพื่อดูประวัติทั้งหมด
// ------------------------------------------
function getUserHistory(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Tickets");
  if(!sheet) return { success: false, message: "ยังไม่มีข้อมูลในระบบ" };

  const rows = sheet.getDataRange().getValues();
  const reqUser = data.username.trim();
  const reqPass = data.password.trim();
  
  let tickets = [];
  let isLoginValid = false;

  for(let i = 1; i < rows.length; i++) {
    const dbUser = rows[i][4] ? rows[i][4].toString().trim() : "";
    const dbPass = rows[i][5] ? rows[i][5].toString().trim() : "";
    
    // ตรวจสอบเจอว่ามีชื่อและรหัสนี้ในระบบ (อย่างน้อย 1 ครั้ง) จะถือว่าล็อกอินผ่าน
    if(dbUser === reqUser && dbPass === reqPass) {
       isLoginValid = true;
       
       let remarksArr = [];
       try { if(rows[i][9]) remarksArr = JSON.parse(rows[i][9]); } catch(e) { }

       tickets.push({
          id: rows[i][0], date: rows[i][1], problem: rows[i][6], 
          dept: rows[i][7], status: rows[i][8], remarks: remarksArr
       });
    } else if (dbUser === reqUser && dbPass !== reqPass) {
       // ถ้ารหัสผิดให้คืนค่า error ทันที
       return { success: false, message: "รหัสผ่านไม่ถูกต้อง" };
    }
  }

  if(isLoginValid) {
    tickets.reverse(); // เอาอันใหม่ขึ้นก่อน
    return { success: true, tickets: tickets };
  } else {
    return { success: false, message: "ไม่พบบัญชีผู้ใช้นี้ หรือรหัสผ่านไม่ถูกต้อง" };
  }
}

// ------------------------------------------
// 3. เจ้าหน้าที่ (SE/VP) ดึงรายการ Ticket
// ------------------------------------------
function getStaffTickets(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Tickets");
  if (!sheet) return { success: true, tickets: [] };

  const rows = sheet.getDataRange().getValues();
  let tickets = [];
  const role = data.role;

  for (let i = 1; i < rows.length; i++) {
    let tDept     = rows[i][7];
    let tStatus   = rows[i][8];
    let isEmerg   = tStatus.includes('(ด่วน)') || tStatus.includes('ฉุกเฉิน');

    let shouldInclude = false;
    if (role === 'SE' && !isEmerg)   shouldInclude = true;
    if (role !== 'SE' && tDept === role) shouldInclude = true;

    if (shouldInclude) {
      let remarksArr = [];
      try { if (rows[i][9]) remarksArr = JSON.parse(rows[i][9]); } catch (e) {}

      tickets.push({
        id: rows[i][0], date: rows[i][1], problem: rows[i][6],
        dept: rows[i][7], status: rows[i][8],
        remarks: remarksArr   // ← NEW: include remarks
      });
    }
  }

  tickets.reverse();
  return { success: true, tickets: tickets };
}

// ------------------------------------------
// 4. เจ้าหน้าที่ อัปเดตสถานะ/โอนย้าย & Consult
// ------------------------------------------
function updateTicket(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Tickets");
  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === data.ticketId) {

      const oldStatus = rows[i][8];
      const oldDept   = rows[i][7];
      let displayStatus = data.newStatus || oldStatus;
      let displayDept   = data.newDept   || oldDept;

      if (data.newStatus) sheet.getRange(i + 1, 9).setValue(data.newStatus);
      if (data.newDept)   sheet.getRange(i + 1, 8).setValue(data.newDept);

      // Load existing remarks
      let remarks = [];
      try { if (rows[i][9]) remarks = JSON.parse(rows[i][9]); } catch (e) {}

      const now = Utilities.formatDate(new Date(), "GMT+7", "dd/MM HH:mm");

      // Auto-log status change
      if (data.newStatus && data.newStatus !== oldStatus) {
        remarks.push({
          type: "log",
          by: data.role,
          time: now,
          text: `เปลี่ยนสถานะ: "${oldStatus}" → "${data.newStatus}"`
        });
      }

      // Auto-log department transfer
      if (data.newDept && data.newDept !== oldDept) {
        remarks.push({
          type: "log",
          by: data.role,
          time: now,
          text: `โอนย้ายฝ่าย: "${oldDept}" → "${data.newDept}"`
        });
      }

      // [NEW] Auto-log Discord Notify ลง Timeline
      if (data.notifyTo) {
        remarks.push({
          type: "log",
          by: data.role,
          time: now,
          text: `ส่งแจ้งเตือน/ปรึกษา ไปที่ Discord ฝ่าย: "${data.notifyTo}"`
        });
      }

      // Manual remark (message)
      if (data.remark) {
        remarks.push({
          type: "remark",
          by: data.role,
          time: now,
          text: data.remark
        });
      }

      sheet.getRange(i + 1, 10).setValue(JSON.stringify(remarks));

      // Discord notify execution
      if (data.notifyTo) {
        const targetWebhookUrl = WEBHOOK_MAP[data.notifyTo];
        if (targetWebhookUrl) {
          let mention = (data.isSilent === true || data.isSilent === 'true') ? "" : "@here ";
          let msg  = `💬 ${mention}**${data.role}** มีการอัปเดตใน Ticket **${data.ticketId}**`;
          let desc = `**ฝ่ายที่ดูแล:** ${displayDept}\n**สถานะ:** ${displayStatus}\n\n`;
          desc += data.remark
            ? `**ข้อความ:**\n${data.remark}`
            : `*(ไม่มีข้อความแนบ)*`;

          const discordPayload = {
            content: msg,
            embeds: [{ title: `อัปเดต Ticket: ${data.ticketId}`, description: desc.substring(0, 2048), color: 3447003 }]
          };
          if (data.isSilent === true || data.isSilent === 'true') discordPayload.flags = 4096;

          try {
            UrlFetchApp.fetch(targetWebhookUrl, {
              method: "post", contentType: "application/json",
              payload: JSON.stringify(discordPayload), muteHttpExceptions: true
            });
          } catch (e) { console.error(e); }
        }
      }

      return { success: true, message: 'อัปเดตสำเร็จ' };
    }
  }
  return { success: false, message: 'ไม่พบ Ticket' };
}
// ------------------------------------------
// 5. ผู้ใช้ พิมพ์ตอบข้อความ
// ------------------------------------------
function addRemark(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Tickets");
  const rows = sheet.getDataRange().getValues();

  for(let i=1; i<rows.length; i++) {
    if(rows[i][0] === data.ticketId) {
      let remarks = [];
      try { if(rows[i][9]) remarks = JSON.parse(rows[i][9]); } catch(e){}
      
      remarks.push({ 
        by: "ผู้แจ้งปัญหา", 
        time: Utilities.formatDate(new Date(), "GMT+7", "dd/MM HH:mm"), 
        text: data.remark 
      });
      sheet.getRange(i+1, 10).setValue(JSON.stringify(remarks));
      return { success: true };
    }
  }
  return { success: false };
}

// ------------------------------------------
// UTILITIES
// ------------------------------------------
function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function sendDiscordNotification(ticketId, problemHTML, department, isEmergency, isSilent, requestedDept) {
  const targetWebhookUrl = WEBHOOK_MAP[department] || WEBHOOK_MAP["SE"];
  if (!targetWebhookUrl) return;

  const silentFlag = (isSilent === true || isSilent === 'true');
  const emergencyFlag = (isEmergency === true || isEmergency === 'true');

  let contentMsg = silentFlag
    ? "🚨 **แจ้งปัญหาใหม่ระบบ Vital Sound**"
    : "🚨 @here **แจ้งปัญหาใหม่ระบบ Vital Sound**";

  let embedColor = 15548997; // ชมพูแดง = ปกติ

  if (emergencyFlag) {
    contentMsg = silentFlag
      ? "‼️ **แจ้งปัญหาฉุกเฉิน (ส่งตรงถึงอุปนายก)!!**"
      : "‼️ @here **แจ้งปัญหาฉุกเฉิน (ส่งตรงถึงอุปนายก)!!**";
    embedColor = 16711680; // แดงสด = ฉุกเฉิน
  }

  let cleanProblem = "";
  if (problemHTML) {
    cleanProblem = problemHTML
      .replace(/<p>/g, "").replace(/<\/p>/g, "\n")
      .replace(/<br>/g, "\n").replace(/<[^>]*>?/gm, '').trim();
  }
  if (!cleanProblem || cleanProblem.length === 0) {
    cleanProblem = "*(ไม่มีข้อความ: มีการแนบรูปภาพหรือสื่อ)*";
  }

  // แสดงว่าผู้ใช้ขอส่งถึงฝ่ายไหน (ถ้าไม่ใช่ SE และไม่ใช่ฉุกเฉิน)
  let requestNote = "";
  if (!emergencyFlag && requestedDept && requestedDept !== 'SE') {
    requestNote = `\n\n📌 **ผู้แจ้งปัญหาระบุว่าต้องการส่งถึง: ${requestedDept}**\n*(SE กรุณาพิจารณาและโอนย้ายหากเหมาะสม)*`;
  }

  const displayDept = department || 'SE';

  const payload = {
    "content": contentMsg,
    "embeds": [{
      "title": `Ticket: ${ticketId} [${displayDept}]`,
      "description": (cleanProblem + requestNote).substring(0, 2048),
      "color": embedColor
    }]
  };

  if (silentFlag) {
    payload.flags = 4096;
  }

  try {
    const response = UrlFetchApp.fetch(targetWebhookUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    console.log("Discord response code: " + response.getResponseCode());
  } catch (e) {
    console.error("Discord webhook failed: " + e);
  }
}