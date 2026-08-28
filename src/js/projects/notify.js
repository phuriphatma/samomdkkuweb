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

import { GAS_API_URL, NOTIFY_FN_URL } from '../config.js';
import { ribbonLabel } from '../env-ribbon.js';
import { queueDiscord, callGAS } from '../discord-queue.js';
import {
  createNotification,
  getSettings,
  listProjectSeatUsers,
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
 * The recipient field (`settings.uni_staff_email`) is a single free-text box
 * but may hold SEVERAL addresses — admins separate them with commas, spaces,
 * semicolons, or newlines. MailApp's `to` accepts a comma-separated list, so
 * we normalise any of those separators down to a clean comma list and drop
 * anything that doesn't look like an email. Returns '' when nothing valid
 * remains (so the caller's truthiness gate skips the send instead of POSTing
 * an empty `to`). Exported so the manage UI's "send test" button and unit
 * tests share the exact same parsing.
 */
export function normalizeRecipients(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s))
    .filter((s, i, arr) => arr.indexOf(s) === i)
    .join(',');
}

/**
 * The ONE address any non-production build is allowed to email.
 *
 * Already a whole-address entry in the Apps Script allow-list, so nothing on
 * the GAS side needs changing. Overridable at build time for a second dev.
 */
export const DEV_TEST_INBOX = 'mdstuddata.beta@gmail.com';

/**
 * Who this build may actually email — the RULE, not a stored value.
 *
 * WHY THIS IS A FUNCTION AND NOT A SETTING. `samo-dev` is a full copy of
 * production, so `uni_staff_email` arrives holding a real `@kku.ac.th` staff
 * address, and dev + previews send through the SAME Apps Script deployment as
 * production. That was fixed once by UPDATE-ing the dev row — and a stored
 * value is not a guard: the next `dev:refresh` restores it, or somebody edits
 * it in the dev admin UI, and a test flow mails a real person a document
 * request that does not exist. Both failures are silent.
 *
 * So the rule lives at the TRANSPORT. Off production, the configured recipient
 * is IGNORED, whatever it says. `dev:refresh` step 7 still repoints the row —
 * belt and braces, and it keeps the dev UI honest about where mail goes — but
 * correctness no longer depends on it.
 *
 * This is the repo's own lesson from the Discord `@everyone` incident: a rule
 * enforced in every MESSAGE gets missed by the next message; enforced at the
 * transport, it cannot be.
 */
export function resolveRecipients(configured, envName, hostname) {
  const to = normalizeRecipients(configured);
  if (ribbonLabel(envName, hostname) === null) return to;   // production
  // Not production. Never the configured address — but still honour an
  // explicitly EMPTY setting, so "email off" stays off everywhere.
  return to ? DEV_TEST_INBOX : '';
}

/**
 * Mark a subject when the mail did NOT come from production.
 *
 * WHY. A preview and the dev database send through the SAME Apps Script
 * deployment as production — that is recorded as a known gap in STATE.md — so
 * a test notification lands in a real inbox looking exactly like a real one.
 * The env RIBBON solves this for the screen; nothing solved it for email, and
 * an unmarked test message asking someone to sign a document is worse than a
 * missing one, because they may act on it.
 *
 * It deliberately reuses `ribbonLabel` rather than testing the environment
 * again. Two implementations of one rule drift, and this repo has a whole
 * class of bugs from exactly that — the ribbon's polarity was argued out once
 * (an ABSENT variable marks nothing, so a forgotten var can never splash
 * PREVIEW across the live site) and that reasoning should not be re-derived
 * here, where the failure would be silent instead of visible.
 */
export function markSubject(subject, envName, hostname) {
  const label = ribbonLabel(envName, hostname);
  return label ? `[${label}] ${subject}` : subject;
}

// The Discord-call queue + logged GAS caller now live in the shared
// `discord-queue.js` core (imported above) so PR, Vital Sign, and
// หนังสือโครงการ all serialise through ONE global chain — see that file
// for the per-IP / Cloudflare-1015 rationale. This module just builds the
// project-specific embeds/emails and hands them to callGAS / queueDiscord.

/**
 * Send a "VP-Admin → uni_staff" event:
 *   - in-app row for the uni_staff user
 *   - email to settings.uni_staff_email (if enabled)
 */
export async function notifyUniStaff({ kind, project, document, body, subject } = {}) {
  const settings = await getSettings().catch(() => null);
  const recipients = await listProjectSeatUsers('staff').catch(() => []);

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
  const to = resolveRecipients(
    settings?.uni_staff_email,
    import.meta.env.VITE_ENV_NAME,
    typeof location !== 'undefined' ? location.hostname : '');
  if (settings?.notify_uni_email !== false && to) {
    const url = deepLink({ projectId: project?.id, documentId: document?.id });
    const sub = markSubject(
      subject || (project?.name
        ? `[MDKKU SAMO] ${project.name} — ${kind}`
        : `[MDKKU SAMO] หนังสือโครงการ`),
      import.meta.env.VITE_ENV_NAME,
      typeof location !== 'undefined' ? location.hostname : '');
    const html = buildEmailHtml({ kind, project, document, body, link: url });
    callGAS(GAS_API_URL, 'notifyProjectEmail', {
      to,
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
  const recipients = await listProjectSeatUsers('vpa').catch(() => []);

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

    await queueDiscord(() => callGAS(NOTIFY_FN_URL, 'notifyProjectDiscord', {
      title: title || `อัปเดตหนังสือ — ${kind}`,
      description: '',
      color,
      fields,
    }));
  }
}

/**
 * Send a "→ professor" event:
 *   - in-app row for every professor seat
 *   - email to settings.prof_email (if enabled)
 * Used when sastaff sends a หนังสือ for signing, and (per the spec) when a
 * file is added/replaced/removed on a หนังสือ that's been shown to the prof.
 *
 * Recipients come from listProjectSeatUsers('prof') — role `sa_prof` PLUS anyone
 * holding the ทีม SAMO `prof` seat (0086/0092). The role-only `users` read this
 * replaced meant a tree-granted อาจารย์ could be SENT a document (the picker was
 * fixed) and then never told about it: the sign request landed, the bell stayed
 * silent. Role-only lookups on the notify path fail exactly this quietly, and
 * since 0147 there is no table read to fall back to at all.
 */
export async function notifyProf({ kind, project, document, body, subject } = {}) {
  const settings = await getSettings().catch(() => null);
  const recipients = await listProjectSeatUsers('prof').catch(() => []);

  // In-app
  if (settings?.notify_prof_in_app !== false) {
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

  // Email — fire-and-forget (mirrors the uni_staff email path), and through
  // the SAME transport guard. This path was missed when the guard was written
  // for uni_staff alone: a preview would have emailed a real อาจารย์ a signing
  // request. Check the SECOND twin — it is the shape this repo repeats most.
  const to = resolveRecipients(
    settings?.prof_email,
    import.meta.env.VITE_ENV_NAME,
    typeof location !== 'undefined' ? location.hostname : '');
  if (settings?.notify_prof_email !== false && to) {
    const url = deepLink({ projectId: project?.id, documentId: document?.id });
    const sub = markSubject(
      subject || (project?.name
        ? `[MDKKU SAMO] ${project.name} — ${kind}`
        : `[MDKKU SAMO] หนังสือโครงการ — ลงนาม`),
      import.meta.env.VITE_ENV_NAME,
      typeof location !== 'undefined' ? location.hostname : '');
    const html = buildEmailHtml({ kind, project, document, body, link: url });
    callGAS(GAS_API_URL, 'notifyProjectEmail', {
      to,
      subject: sub,
      htmlBody: html,
    }).catch(() => {});
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
