// ==============================================
// _discord.js — pure Discord payload builders + webhook router + poster
//
// Imported by the `functions/notify.js` Cloudflare Pages Function. The
// leading underscore keeps Pages from routing this file as an endpoint.
// Everything here is framework-free and unit-testable (see
// functions/notify.test.js) — no `env`, no Request/Response, just data in
// → Discord payload / delivery result out.
//
// This replaces the Discord half of the two GAS deployments (prform.gs
// `sendDiscordNotification`/`sendProjectDiscord`, vssound.gs
// `sendDiscordNotification`/`sendConsultDiscord`). The embed shapes are
// ported verbatim so the messages land identical to the GAS era.
//
// Webhook URLs come from Pages env vars (never hardcoded — see
// .claude/rules/security.md):
//   DISCORD_PR_WEBHOOK        — PR-team channel
//   DISCORD_PROJECTS_WEBHOOK  — หนังสือโครงการ / VP-Admin channel
//   DISCORD_VS_WEBHOOKS       — JSON map { "<dept>": "<webhook url>", ... }
//                               incl. "SE" (the default/routing fallback)
// ==============================================

const DISCORD_BLUE = 3447003;
const VS_DEFAULT_DEPT = 'SE';

/** Strip the Quill HTML the VS form stores down to Discord-ready text. */
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<p>/g, '')
    .replace(/<\/p>/g, '\n')
    .replace(/<br>/g, '\n')
    .replace(/<[^>]*>?/gm, '')
    .trim();
}

const isTruthyFlag = (v) => v === true || v === 'true';

// ---- payload builders (one per GAS action) ----

export function buildPrPayload(data = {}) {
  const isRush = data.deadlineMode === 'Rush PR Review';

  let links = '';
  if (Array.isArray(data.uploadedUrls) && data.uploadedUrls.length > 0) {
    data.uploadedUrls.forEach((url, i) => { links += `[📸 ภาพที่ ${i + 1}](${url})\n`; });
  }
  if (data.largeFileLink) links += `[🔗 ลิงก์ G-Drive เพิ่มเติม](${data.largeFileLink})`;
  if (!links) links = '-';

  const fields = [
    { name: 'Ticket ID', value: String(data.ticketId || '-'), inline: true },
    { name: 'ประเภทงาน', value: data.jobType || '-', inline: true },
    { name: 'กำหนดการ', value: isRush ? '⚡ ด่วน' : '📅 ปกติ', inline: true },
    { name: 'ติดต่อ', value: data.contact || '-', inline: true },
    { name: 'ไฟล์แนบ', value: links, inline: false },
  ];

  const otherPlat = Array.isArray(data.otherPlatform) ? data.otherPlatform : [];
  if (otherPlat.length > 0) {
    fields.push({ name: 'Other Platform', value: otherPlat.join(', '), inline: false });
    if (data.otherPlatformReason) {
      fields.push({ name: 'เหตุผลที่ต้องการ PR', value: data.otherPlatformReason, inline: false });
    }
  }

  const payload = {
    content: `🚨 ส่งงาน PR ใหม่ จาก **${data.department}**!`,
    embeds: [{ title: data.content, color: isRush ? 16711680 : DISCORD_BLUE, fields }],
  };
  if (isTruthyFlag(data.silentNotify)) payload.flags = 4096;
  return payload;
}

export function buildVsPayload(data = {}) {
  const silent = isTruthyFlag(data.vsSilentNotify);
  const emergency = isTruthyFlag(data.isEmergency);

  let content = silent
    ? '🚨 **แจ้งปัญหาใหม่ระบบ Vital Sound**'
    : '🚨 @here **แจ้งปัญหาใหม่ระบบ Vital Sound**';
  let color = 15548997;
  if (emergency) {
    content = silent
      ? '‼️ **แจ้งปัญหาฉุกเฉิน (ส่งตรงถึงอุปนายก)!!**'
      : '‼️ @here **แจ้งปัญหาฉุกเฉิน (ส่งตรงถึงอุปนายก)!!**';
    color = 16711680;
  }

  let problem = htmlToText(data.vsProblem);
  if (!problem) problem = '*(ไม่มีข้อความ: มีการแนบรูปภาพหรือสื่อ)*';

  let note = '';
  if (!emergency && data.requestedDept && data.requestedDept !== VS_DEFAULT_DEPT) {
    note = `\n\n📌 **ผู้แจ้งปัญหาระบุว่าต้องการส่งถึง: ${data.requestedDept}**\n*(SE กรุณาพิจารณาและโอนย้ายหากเหมาะสม)*`;
  }

  const displayDept = data.department || VS_DEFAULT_DEPT;
  const payload = {
    content,
    embeds: [{
      title: `Ticket: ${data.ticketId} [${displayDept}]`,
      description: (problem + note).substring(0, 2048),
      color,
    }],
  };
  if (silent) payload.flags = 4096;
  return payload;
}

export function buildVsConsultPayload(data = {}) {
  const silent = isTruthyFlag(data.isSilent);
  const mention = silent ? '' : '@here ';
  const content = `💬 ${mention}**${data.role}** มีการอัปเดตใน Ticket **${data.ticketId}**`;
  let desc = `**ฝ่ายที่ดูแล:** ${data.displayDept || '-'}\n**สถานะ:** ${data.displayStatus || '-'}\n\n`;
  desc += data.remark ? `**ข้อความ:**\n${data.remark}` : '*(ไม่มีข้อความแนบ)*';

  const payload = {
    content,
    embeds: [{ title: `อัปเดต Ticket: ${data.ticketId}`, description: desc.substring(0, 2048), color: DISCORD_BLUE }],
  };
  if (silent) payload.flags = 4096;
  return payload;
}

export function buildProjectPayload(data = {}) {
  // projects/notify.js already builds the embed and sends title/
  // description/color/fields (or a full `payload`). Mirror the GAS
  // sendProjectDiscord normalisation.
  if (data.payload && typeof data.payload === 'object') return data.payload;
  const fields = Array.isArray(data.fields) ? data.fields : [];
  return {
    content: String(data.content || ''),
    embeds: [{
      title: String(data.title || 'อัปเดตหนังสือโครงการ'),
      description: String(data.description || ''),
      color: typeof data.color === 'number' ? data.color : DISCORD_BLUE,
      fields,
    }],
  };
}

/** Parse the VS dept→webhook JSON map from env (tolerant of bad JSON). */
export function parseVsWebhooks(env = {}) {
  try { return JSON.parse(env.DISCORD_VS_WEBHOOKS || '{}'); }
  catch { return {}; }
}

/**
 * Resolve an action+payload to a concrete { url, payload }. Returns
 * { error } for an unknown action, { url: undefined } when the action is
 * known but no webhook is configured (caller surfaces that distinctly).
 */
export function resolveTarget(action, data = {}, env = {}) {
  switch (action) {
    case 'notifyPROnly':
      return { url: env.DISCORD_PR_WEBHOOK, payload: buildPrPayload(data) };
    case 'notifyProjectDiscord':
      return { url: env.DISCORD_PROJECTS_WEBHOOK, payload: buildProjectPayload(data) };
    case 'notifyVSOnly': {
      const map = parseVsWebhooks(env);
      return { url: map[data.department] || map[VS_DEFAULT_DEPT], payload: buildVsPayload(data) };
    }
    case 'notifyVSConsult': {
      const map = parseVsWebhooks(env);
      return { url: map[data.notifyTo], payload: buildVsConsultPayload(data) };
    }
    default:
      return { error: `unknown action: ${action}` };
  }
}

// ---- delivery with retry (ported from GAS sendProjectDiscord) ----

const MAX_ATTEMPTS = 3;
const FALLBACK_SLEEPS_MS = [1200, 2500, 4000];
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postOnce(url, payload, fetchImpl) {
  try {
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const code = resp.status;
    if (code >= 200 && code < 300) return { ok: true, status: code };
    const raHeader = resp.headers?.get?.('Retry-After') || resp.headers?.get?.('retry-after') || '0';
    const ra = parseFloat(raHeader);
    const body = (typeof resp.text === 'function' ? await resp.text().catch(() => '') : '').slice(0, 500);
    return { ok: false, status: code, body, retryAfter: isFinite(ra) ? ra : 0 };
  } catch (e) {
    return { ok: false, threw: true, status: 0, body: String(e), retryAfter: 0 };
  }
}

/**
 * Deliver a payload to a Discord webhook with up to 3 attempts. Retries
 * only the transient modes (429 / transport throw), honours Retry-After
 * (clamped), and bails immediately on a Cloudflare-1015 body. fetch +
 * sleep are injectable so tests run instantly and offline.
 */
export async function postToDiscord(url, payload, { fetchImpl = fetch, sleep = defaultSleep } = {}) {
  let firstStatus = null;
  let last = null;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const result = await postOnce(url, payload, fetchImpl);
    if (result.ok) {
      return i === 0
        ? { ok: true, status: result.status, attempts: 1 }
        : { ok: true, status: result.status, retried: true, attempts: i + 1, firstStatus };
    }
    if (i === 0) firstStatus = result.status;
    last = result;

    const transient = result.status === 429 || result.threw;
    if (!transient) break;                 // 400/401/404 won't recover — bail
    if (i === MAX_ATTEMPTS - 1) break;      // last attempt, no point sleeping

    let sleepMs = FALLBACK_SLEEPS_MS[i] || 4000;
    if (result.status === 429 && result.retryAfter > 0) {
      sleepMs = Math.min(Math.max(Math.floor(result.retryAfter * 1000), 400), 9000);
    }
    // Cloudflare per-IP 1015 cooldown is minutes — retrying in-window is
    // futile. (Far less likely from Cloudflare's own egress than from
    // GAS's shared IP, but cheap to guard.)
    if (result.body && result.body.indexOf('1015') !== -1) break;
    await sleep(sleepMs);
  }
  return {
    ok: false,
    status: last ? last.status : 0,
    body: last ? last.body : '',
    retried: true,
    attempts: MAX_ATTEMPTS,
    firstStatus,
  };
}
