// ==============================================
// /notify — Cloudflare Pages Function: one Discord proxy for the whole app
//
// Replaces the GAS Discord path for PR, Vital Sign, and หนังสือโครงการ.
// Why a Pages Function instead of GAS:
//   - Runs on Cloudflare's egress (NOT GAS's heavily-shared IP) so the
//     Cloudflare per-IP 1015 rate limit that plagued the GAS path
//     effectively goes away for our volume.
//   - Real logs (GAS Cloud Logs are invisible for public-fetch calls).
//   - Webhook URLs live in Pages env vars, never in the bundle.
//
// GAS still owns Drive uploads + the projects email — only Discord moved.
//
// Contract (mirrors the old GAS createResponse): always HTTP 200 with a
// `success` boolean for app-level outcomes; 400 only for an unparseable
// body. The frontend `callGAS` in discord-queue.js already reads this
// shape (success:false / non-2xx both log).
//
// Request:  POST /notify   body = { action, ...payload }   (text/plain ok)
// Actions:  notifyPROnly | notifyVSOnly | notifyVSConsult | notifyProjectDiscord
// ==============================================

import { resolveTarget, postToDiscord } from './_discord.js';

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    // The frontend sends Content-Type: text/plain (a CORS "simple
    // request"); read raw text and parse so content-type doesn't matter.
    data = JSON.parse(await request.text());
  } catch {
    return json({ success: false, message: 'invalid JSON body' }, 400);
  }

  const action = data && data.action;
  const { url, payload, error } = resolveTarget(action, data, env);
  if (error) return json({ success: false, message: error });
  if (!url) {
    console.warn(`[notify] no webhook configured for action "${action}" (dept="${data.department || data.notifyTo || ''}")`);
    return json({ success: false, message: `no webhook configured for action "${action}"` });
  }

  const res = await postToDiscord(url, payload);
  if (!res.ok) {
    console.warn(`[notify] ${action} → Discord HTTP ${res.status} after ${res.attempts} attempt(s)`, res.body || '');
    return json({
      success: false,
      message: `discord HTTP ${res.status}`,
      status: res.status,
      body: res.body,
      attempts: res.attempts,
      firstStatus: res.firstStatus || null,
      retried: !!res.retried,
    });
  }
  if (res.retried) {
    console.info(`[notify] ${action} delivered after ${res.attempts} attempt(s) (first status ${res.firstStatus})`);
  }
  return json({
    success: true,
    status: res.status,
    attempts: res.attempts,
    retried: !!res.retried,
    firstStatus: res.firstStatus || null,
  });
}
