// ============================================================
// vssound.gs — Discord notify only
//
// Post-Supabase-migration, GAS serves just two actions:
//   - notifyVSOnly     : fire the routed-dept Discord webhook for a
//                        new VS ticket (SE for normal, the selected
//                        อุปนายก for emergencies).
//   - notifyVSConsult  : fire a cross-dept consult/transfer ping.
//
// Everything else (VS submit, tracking, staff dashboard, account
// management) is handled directly by Supabase from the frontend.
//
// (Edge Function equivalent is in supabase/functions/notify-vs/ but the
// Supabase deploy is currently returning 502 — GAS stays as the
// backend for now.)
// ============================================================

const WEBHOOK_MAP = {
  'SE': 'https://discordapp.com/api/webhooks/1500410490831241298/fT3gG0guAmtCOfEiaQ9bJoApU4eUoJs_BD4vJSKNW60JYLryhHl0rYfMqcEbZf-VJl0f',
  'อุปนายกฝ่ายบริหารองค์กร': 'https://discordapp.com/api/webhooks/1500408821565358130/rOkqB6Ov7aBVtm1OeovIUXSPcNX0PLs0MxsVQpG3kuZ3TPvaDZ2vpmq65gAcxFo-kUcg',
  'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร': 'https://discordapp.com/api/webhooks/1500408826388811837/3FZLMgnz89iwkYL9iwHUCJOCCegTl3q0gmGZw10lngOugWKrMMM3CFnz2u0rRc9nViSr',
  'อุปนายกฝ่ายกิจการภายใน': 'https://discordapp.com/api/webhooks/1500408834395738182/ih_3w50atGfZnwbIcsuOl9jTeNemdDOHM5_86pmutkZrPD92M52eh8OP2c_oVDl_-RB1',
  'อุปนายกฝ่ายกิจการภายนอก': 'https://discordapp.com/api/webhooks/1500408839428636743/rJ-g-ChmVFJiLi0XJueoQZnvX9RPwvrprMakFuEbNMRad-X6AQWX3Htpt5kJvujfw8Ra',
  'อุปนายกฝ่ายกิจการมหาวิทยาลัย': 'https://discordapp.com/api/webhooks/1500408850635817011/llxXROxVRFDRqA9lWyGA-YmrTuq_TqisutR59kutNzo67h5krUQrHq5th0xi8issOsWU',
  'อุปนายกฝ่ายวิชาการ': 'https://discordapp.com/api/webhooks/1500408861486485614/c0oYEH7h9BchdNn3LNnWVVLGHo8p6thffF3sNLpg5PIK3uzAvy8nUTMWLvm6bNn8Vr1w',
  'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร': 'https://discordapp.com/api/webhooks/1500408866817441822/wocupVF1KymJM2bpsMPnaL8jsf5h1PmGbs2jAMvZprdZyPfztSOoVQ-RhmAIeBCaWPAK',
  'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม': 'https://discordapp.com/api/webhooks/1500408871892549673/pbmYacjplhIETAu4HEojR9Vgk-2RC1sROCuGkCtODyji8rD23FeoOyMCJ0fuH_PT0IpT',
  'อุปนายกฝ่ายเวชนิทัศน์': 'https://discordapp.com/api/webhooks/1500408877185761280/EnghO2u1ptpZXEgxKGpTBA9hxXenk5B4xK1rZc4wG9GhmGtsFwGMTAtD060gs-BKEfvd',
  'อุปนายกฝ่ายรังสีเทคนิค': 'https://discordapp.com/api/webhooks/1500408883313643590/hSAWQGiyP5WKNVdpFsF7UCj7w4qauEYPwv6aF6UAYWXX9lunXnijo1VUiLGBZrcpJ7a3',
};

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.action === 'notifyVSOnly') {
      try {
        sendDiscordNotification(
          payload.ticketId,
          payload.vsProblem,
          payload.department,
          payload.isEmergency,
          payload.vsSilentNotify,
          payload.requestedDept
        );
      } catch (err) { console.error('notifyVSOnly: ' + err); }
      return createJsonResponse({ success: true });
    }

    if (payload.action === 'notifyVSConsult') {
      try { sendConsultDiscord(payload); }
      catch (err) { console.error('notifyVSConsult: ' + err); }
      return createJsonResponse({ success: true });
    }

    return createJsonResponse({ success: false, message: 'Unknown action: ' + payload.action });
  } catch (error) {
    return createJsonResponse({ success: false, message: error.toString() });
  }
}

// ============================================================
// New-ticket Discord notification (notifyVSOnly)
// ============================================================

function sendDiscordNotification(ticketId, problemHTML, department, isEmergency, isSilent, requestedDept) {
  const targetWebhookUrl = WEBHOOK_MAP[department] || WEBHOOK_MAP['SE'];
  if (!targetWebhookUrl) return;

  const silentFlag = (isSilent === true || isSilent === 'true');
  const emergencyFlag = (isEmergency === true || isEmergency === 'true');

  let contentMsg = silentFlag
    ? '🚨 **แจ้งปัญหาใหม่ระบบ Vital Sound**'
    : '🚨 @here **แจ้งปัญหาใหม่ระบบ Vital Sound**';

  let embedColor = 15548997;

  if (emergencyFlag) {
    contentMsg = silentFlag
      ? '‼️ **แจ้งปัญหาฉุกเฉิน (ส่งตรงถึงอุปนายก)!!**'
      : '‼️ @here **แจ้งปัญหาฉุกเฉิน (ส่งตรงถึงอุปนายก)!!**';
    embedColor = 16711680;
  }

  let cleanProblem = '';
  if (problemHTML) {
    cleanProblem = problemHTML
      .replace(/<p>/g, '').replace(/<\/p>/g, '\n')
      .replace(/<br>/g, '\n').replace(/<[^>]*>?/gm, '').trim();
  }
  if (!cleanProblem) cleanProblem = '*(ไม่มีข้อความ: มีการแนบรูปภาพหรือสื่อ)*';

  let requestNote = '';
  if (!emergencyFlag && requestedDept && requestedDept !== 'SE') {
    requestNote = `\n\n📌 **ผู้แจ้งปัญหาระบุว่าต้องการส่งถึง: ${requestedDept}**\n*(SE กรุณาพิจารณาและโอนย้ายหากเหมาะสม)*`;
  }

  const displayDept = department || 'SE';

  const payload = {
    content: contentMsg,
    embeds: [{
      title: `Ticket: ${ticketId} [${displayDept}]`,
      description: (cleanProblem + requestNote).substring(0, 2048),
      color: embedColor,
    }],
  };

  if (silentFlag) payload.flags = 4096;

  try {
    UrlFetchApp.fetch(targetWebhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (e) {
    console.error('Discord webhook failed: ' + e);
  }
}

// ============================================================
// Cross-dept consult/transfer notification (notifyVSConsult)
// ============================================================

function sendConsultDiscord(payload) {
  const url = WEBHOOK_MAP[payload.notifyTo];
  if (!url) return;

  const silent = (payload.isSilent === true || payload.isSilent === 'true');
  const mention = silent ? '' : '@here ';
  const content = `💬 ${mention}**${payload.role}** มีการอัปเดตใน Ticket **${payload.ticketId}**`;
  let desc = `**ฝ่ายที่ดูแล:** ${payload.displayDept || '-'}\n**สถานะ:** ${payload.displayStatus || '-'}\n\n`;
  desc += payload.remark ? `**ข้อความ:**\n${payload.remark}` : `*(ไม่มีข้อความแนบ)*`;

  const body = {
    content: content,
    embeds: [{ title: `อัปเดต Ticket: ${payload.ticketId}`, description: desc.substring(0, 2048), color: 3447003 }],
  };
  if (silent) body.flags = 4096;

  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
