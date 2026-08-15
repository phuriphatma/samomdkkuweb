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
/**
 * จองโควตา Claude (migration 0154).
 *
 * Reports a claim on the shared Claude Pro subscription: who, which ฝ่าย and
 * ตำแหน่ง, the block, the session percent it consumes, and what is left in both
 * pools. The two "เหลือ" numbers are the point — a booking notice that does not
 * say what remains makes everyone open the board to find out.
 *
 * The identity here is already a projection (get_claude_board names its
 * columns); nothing on this path can reach an email or a รหัสนักศึกษา.
 */
export function buildClaudeBookingPayload(data = {}) {
  const fields = [
    { name: 'ฝ่าย', value: data.dept || '-', inline: true },
    { name: 'ตำแหน่ง', value: data.roles || '-', inline: true },
    { name: 'ช่วงเวลา', value: `${data.when || '-'} (${data.duration || '-'})`, inline: false },
    { name: 'ใช้โควตาเซสชัน', value: `${data.pct ?? '-'}%`, inline: true },
    { name: 'เหลือในเซสชันนี้', value: `${data.sessionLeft ?? '-'}%`, inline: true },
    { name: 'จองไปทำอะไร', value: data.purpose || '-', inline: false },
    {
      name: 'โควตาสัปดาห์',
      value: `${data.weekUsed ?? '-'} / ${data.weekPool ?? '-'}%`
        + ` · เหลือ ${(data.weekPool ?? 0) - (data.weekUsed ?? 0)}%`,
      inline: false,
    },
  ];
  return {
    content: `จองโควตา Claude — **${data.who || 'ไม่ทราบชื่อ'}**`,
    embeds: [{ title: 'จองโควตา Claude แล้ว', color: 1071394, fields }],
  };
}

/**
 * The Claude usage reporter needs help (migration 0154).
 *
 * A monitor that fails silently is worse than no monitor: the board would keep
 * showing the last sample, quietly ageing, and the first sign of trouble would
 * be someone noticing the number looked wrong days later. The reporter's one
 * real failure mode is the OAuth refresh token expiring — which only happens if
 * the timer has been dead for ~12 days — and the fix is a human running
 * `claude login` on the VM, so it has to reach a human.
 */
export function buildClaudeAlertPayload(data = {}) {
  return {
    content: `**ตัวรายงานการใช้งาน Claude มีปัญหา** — ${data.reason || 'ไม่ทราบสาเหตุ'}`,
    embeds: [{
      title: 'ต้องเข้าสู่ระบบใหม่บนเซิร์ฟเวอร์',
      color: 11815192,
      fields: [
        { name: 'อาการ', value: String(data.detail || '-').slice(0, 1000), inline: false },
        {
          name: 'วิธีแก้',
          value: 'ssh เข้าเครื่องเซิร์ฟเวอร์ แล้วรัน `claude login` '
            + 'ด้วยบัญชี Claude ของสโม จากนั้นตัวรายงานจะต่ออายุตัวเองได้อีกครั้ง',
          inline: false,
        },
      ],
    }],
  };
}

export function resolveTarget(action, data = {}, env = {}) {
  switch (action) {
    case 'notifyPROnly':
      return { url: env.DISCORD_PR_WEBHOOK, payload: buildPrPayload(data) };
    case 'notifyClaudeBooking':
      return { url: env.DISCORD_CLAUDE_WEBHOOK, payload: buildClaudeBookingPayload(data) };
    case 'notifyClaudeAlert':
      return { url: env.DISCORD_CLAUDE_WEBHOOK, payload: buildClaudeAlertPayload(data) };
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

// ---- durable outcome logging (best-effort → Supabase notify_log) ----

/**
 * Append one delivery outcome to `public.notify_log` (migration 0055) so
 * dropped notifications are diagnosable after the fact — the Function's
 * console logs are NOT retained (live tail only), so without this a drop
 * leaves no trace anywhere.
 *
 * BEST-EFFORT by contract: this must never throw and never affect notify
 * delivery. It returns `{ logged: boolean, skipped?, status? }` purely so
 * the unit tests can assert behaviour.
 *
 * Gated on env: if SUPABASE_URL / SUPABASE_ANON_KEY are unset it no-ops
 * (skipped:true), so the Function keeps working on deploys that haven't
 * added the env vars yet. The anon key is the same public-but-RLS-gated
 * key the frontend bundles; the notify_log insert policy is append-only.
 */
export async function logNotifyOutcome(env = {}, record = {}, { fetchImpl = fetch } = {}) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY;
  if (!base || !key) return { logged: false, skipped: 'no-supabase-env' };

  const row = {
    system: record.system ?? null,
    action: record.action ?? null,
    ticket_id: record.ticketId ?? null,
    dept: record.dept ?? null,
    ok: !!record.ok,
    discord_status: record.status ?? null,
    first_status: record.firstStatus ?? null,
    attempts: record.attempts ?? null,
    retried: !!record.retried,
    // keep the failure snippet short — the column is for triage, not storage
    error: record.error ? String(record.error).slice(0, 500) : null,
  };

  try {
    const res = await fetchImpl(`${base.replace(/\/+$/, '')}/rest/v1/notify_log`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    const code = res.status;
    if (!(code >= 200 && code < 300)) {
      const body = (typeof res.text === 'function' ? await res.text().catch(() => '') : '').slice(0, 200);
      console.warn(`[notify-log] insert failed HTTP ${code}: ${body}`);
      return { logged: false, status: code };
    }
    return { logged: true, status: code };
  } catch (e) {
    // Swallow — logging must never break the notify path.
    console.warn('[notify-log] insert threw:', e?.message || e);
    return { logged: false, threw: true };
  }
}
