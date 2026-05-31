// ==============================================
// PROJECTS NOTIFY — fan out an event across channels
//
// Channels:
//   - In-app inbox (project_notifications row, gated by user role/prefs)
//   - Email to uni_staff via GAS MailApp (for VP-Admin → uni_staff events)
//   - Discord webhook for VP-Admin watchers (for uni_staff → VP-Admin events)
//
// All channels are best-effort: a failure on one doesn't stop the others
// and doesn't break the calling action.
// ==============================================

import { GAS_API_URL } from '../config.js';
import {
  createNotification,
  getSettings,
  listUsersByRole,
} from './api.js';

const PUBLIC_BASE_URL = (() => {
  try {
    if (typeof window === 'undefined') return '';
    return window.location.origin + window.location.pathname;
  } catch { return ''; }
})();

function deepLink({ projectId, documentId } = {}) {
  if (!PUBLIC_BASE_URL) return '';
  if (documentId && projectId) return `${PUBLIC_BASE_URL}#projects/${projectId}/doc/${documentId}`;
  if (projectId) return `${PUBLIC_BASE_URL}#projects/${projectId}`;
  return `${PUBLIC_BASE_URL}#projects`;
}

/**
 * Call a GAS action. Returns a promise that resolves to the parsed JSON
 * response or null on failure. Bounded by `timeoutMs` (default 10s) so
 * a wedged webhook can't block the user action indefinitely.
 *
 * Logging policy: any failure (timeout, network, non-2xx, action-level
 * `success:false`) logs a single warning so silent drops are debuggable
 * from the console. The previous fire-and-forget pattern with
 * `.catch(() => {})` was the reason "sometimes Discord doesn't fire"
 * went undetected for weeks — there was literally no surface.
 */
// ============================================================
// Discord-call queue
//
// JS click handlers are async but the event loop interleaves them: if
// the user clicks "เสร็จสิ้น" and then "คอมเมนต์" within a second,
// onDocStatusClick yields on its first await and onDocCommentClick
// starts running concurrently. Both reach `await callGAS(notifyProject
// Discord, …)` at roughly the same time → two parallel POSTs to the
// same Discord webhook → Discord rate-limits the second one with 429
// (per-webhook bucket is ~5 tokens / 2s and refills slowly), and even
// 3 GAS-side retries can't recover because the bucket stays exhausted
// the whole time.
//
// Serialise: queue all `notifyProjectDiscord` calls through a single
// promise chain and enforce a minimum spacing between the end of one
// call and the start of the next. The first call fires immediately;
// the second waits its turn. End-to-end the user still sees both
// notifications arrive; the second is just delayed by ~2s.
// ============================================================
let discordChain = Promise.resolve();
let lastDiscordEndedAt = 0;
// 6 seconds: Discord sits behind Cloudflare and the per-IP rate-limit
// (error code 1015) has a much longer cooldown than Discord's own
// webhook bucket (~2s). 2.2s spacing was enough for Discord's bucket
// but not for Cloudflare's IP filter — observed in the field as the
// FIRST action's 3 retries all returning HTTP 429 + body "error
// code: 1015", while the SECOND action (firing ~15s later) recovered
// on retry. Bumping spacing to 6s reduces the chance the next call
// even SEES the 1015 page in the first place.
const MIN_DISCORD_SPACING_MS = 6000;

function queueDiscord(fn) {
  const next = discordChain.then(async () => {
    const wait = Math.max(0, MIN_DISCORD_SPACING_MS - (Date.now() - lastDiscordEndedAt));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastDiscordEndedAt = Date.now();
    }
  });
  // Re-anchor the chain on a SWALLOWED variant so a failed call doesn't
  // poison every subsequent call's promise. The original `next` is what
  // the caller awaits and can observe failures from.
  discordChain = next.catch(() => {});
  return next;
}

async function callGAS(action, payload, { timeoutMs = 20000 } = {}) {
  // 20s default: GAS-side sendProjectDiscord can take up to ~8s when
  // it walks the full 3-attempt retry schedule on a wedged Discord
  // bucket; plus ~1s of GAS overhead + ~1s of network round-trip on
  // top means we need more than 10s to avoid spuriously timing out
  // a call that would have eventually succeeded inside GAS.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GAS_API_URL, {
      method: 'POST',
      // keepalive lets it survive a navigation when called fire-and-
      // forget; the awaited path doesn't strictly need it but it's
      // harmless and means the same helper covers both callers.
      keepalive: true,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) {
      console.warn(`[projects/notify] ${action} HTTP ${res.status}:`, text?.slice(0, 300) || '');
      return null;
    }
    if (parsed && parsed.success === false) {
      console.warn(`[projects/notify] ${action} returned success:false`, parsed);
      return parsed;
    }
    // GAS Cloud Logs are NOT recorded for our browser-fetch calls (the
    // Execute-as-Me + access-Anyone visibility rule). The only path to
    // see what Discord actually returned for runtime calls is to echo
    // the diagnostic data in the response body and log it here. Logs
    // on success ONLY when retries kicked in or final status is non-
    // 204 — successful first-shot calls stay silent to avoid noise.
    if (parsed && (parsed.retried || (parsed.attempts && parsed.attempts > 1))) {
      console.info(`[projects/notify] ${action} took ${parsed.attempts || '?'} attempt(s)`, parsed);
    }
    return parsed;
  } catch (e) {
    clearTimeout(timer);
    const aborted = e?.name === 'AbortError';
    console.warn(`[projects/notify] ${action} ${aborted ? 'timed out' : 'failed'}:`, e?.message || e);
    return null;
  }
}

/**
 * Send a "VP-Admin → uni_staff" event:
 *   - in-app row for the uni_staff user
 *   - email to settings.uni_staff_email (if enabled)
 */
export async function notifyUniStaff({ kind, project, document, body, subject } = {}) {
  const settings = await getSettings().catch(() => null);
  const recipients = await listUsersByRole('uni_staff').catch(() => []);

  // In-app
  if (settings?.notify_uni_in_app !== false) {
    for (const u of recipients) {
      await createNotification({
        user_id: u.id,
        project_id: project?.id || null,
        document_id: document?.id || null,
        kind,
        body: body || '',
      }).catch(() => {});
    }
  }

  // Email — fire-and-forget (email isn't time-sensitive and a slow
  // mail server shouldn't slow the user). callGAS logs failures so
  // the previously-silent "email didn't arrive" failure mode is now
  // debuggable from the console.
  if (settings?.notify_uni_email !== false && settings?.uni_staff_email) {
    const url = deepLink({ projectId: project?.id, documentId: document?.id });
    const sub = subject || (project?.name
      ? `[MDKKU SAMO] ${project.name} — ${kind}`
      : `[MDKKU SAMO] หนังสือโครงการ`);
    const html = buildEmailHtml({ kind, project, document, body, link: url });
    callGAS('notifyProjectEmail', {
      to: settings.uni_staff_email,
      subject: sub,
      htmlBody: html,
    }).catch(() => {});  // already logged inside callGAS
  }
}

/**
 * Send a "uni_staff → VP-Admin" event:
 *   - in-app row for each vp_admin user
 *   - Discord webhook fire to the SAMO admin channel
 */
export async function notifyVpAdmin({ kind, project, document, body, title } = {}) {
  const settings = await getSettings().catch(() => null);
  const recipients = await listUsersByRole('vp_admin').catch(() => []);

  // In-app
  if (settings?.notify_vp_in_app !== false) {
    for (const u of recipients) {
      await createNotification({
        user_id: u.id,
        project_id: project?.id || null,
        document_id: document?.id || null,
        kind,
        body: body || '',
      }).catch(() => {});
    }
  }

  // Discord — AWAITED and SERIALISED via queueDiscord. Discord is the
  // ONLY out-of-app channel VPA gets (no email fallback like uni_staff
  // has), and the user flagged that two rapid actions (status + comment
  // within a second) consistently produced only one Discord ping — the
  // second was getting silently rate-limited by Discord's per-webhook
  // bucket because both click handlers fired their POSTs in parallel.
  // The queue holds the second call until ~2.2s after the first ended,
  // which is past Discord's bucket-refill window. The user still sees
  // both pings, just spaced out by a couple of seconds.
  if (settings?.notify_vp_discord !== false) {
    const url = deepLink({ projectId: project?.id, documentId: document?.id });
    const color = kindToDiscordColor(kind);
    const fields = [];
    if (project?.id)      fields.push({ name: 'โครงการ',  value: `${project.name || ''} (${project.id})`, inline: false });
    if (document?.id)     fields.push({ name: 'หนังสือ',  value: `${document.title || ''} (${document.id})`, inline: false });
    if (body)             fields.push({ name: 'รายละเอียด', value: body.slice(0, 1000), inline: false });
    if (url)              fields.push({ name: 'ลิงก์',      value: url, inline: false });

    await queueDiscord(() => callGAS('notifyProjectDiscord', {
      title: title || `อัปเดตหนังสือ — ${kind}`,
      description: '',
      color,
      fields,
    }));
  }
}

function kindToDiscordColor(kind) {
  switch (kind) {
    case 'received':      return 3447003;  // blue
    case 'status':        return 3447003;
    case 'returned':      return 15158332; // red
    case 'completed':     return 3066993;  // green
    case 'comment':       return 9807270;  // grey-violet
    case 'file_replaced': return 15844367; // amber
    default:              return 3447003;
  }
}

function buildEmailHtml({ kind, project, document, body, link }) {
  const projectName = (project?.name || '').replace(/</g, '&lt;');
  const docTitle    = (document?.title || '').replace(/</g, '&lt;');
  const safeBody    = (body || '').replace(/</g, '&lt;');
  const safeLink    = link ? link.replace(/"/g, '%22') : '';
  return `
    <div style="font-family: 'Noto Sans Thai', sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
      <div style="background: linear-gradient(135deg,#105922,#0d4a1c); color: #fff; padding: 16px 20px; border-radius: 12px 12px 0 0;">
        <div style="font-weight: 700; font-size: 14px; letter-spacing: 0.5px; opacity: 0.85;">MDKKU SAMO</div>
        <div style="font-weight: 700; font-size: 18px; margin-top: 2px;">แจ้งเตือนหนังสือโครงการ</div>
      </div>
      <div style="background: #ffffff; padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        ${projectName ? `<div style="margin-bottom: 8px;"><b>โครงการ:</b> ${projectName}${project?.id ? ` <span style="color:#6b7280;">(${project.id})</span>` : ''}</div>` : ''}
        ${docTitle ? `<div style="margin-bottom: 8px;"><b>หนังสือ:</b> ${docTitle}${document?.id ? ` <span style="color:#6b7280;">(${document.id})</span>` : ''}</div>` : ''}
        ${safeBody ? `<div style="margin: 16px 0; padding: 12px 14px; background: #f9fafb; border-left: 3px solid #FF6F30; border-radius: 6px;">${safeBody}</div>` : ''}
        ${safeLink ? `<div style="margin-top: 20px; text-align: center;">
          <a href="${safeLink}" style="display: inline-block; background: #105922; color: #fff; padding: 10px 22px; border-radius: 8px; text-decoration: none; font-weight: 600;">เปิดดูในระบบ</a>
        </div>` : ''}
        <div style="margin-top: 24px; font-size: 12px; color: #9ca3af; text-align: center;">
          อีเมลนี้ส่งโดยอัตโนมัติจากระบบ MDKKU SAMO — กรุณาอย่าตอบกลับ
        </div>
      </div>
    </div>
  `;
}
