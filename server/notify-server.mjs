// ==============================================
// notify-server.mjs — self-hosted replacement for the Cloudflare Pages
// Function that served `/notify`.
//
// When the app moved off Cloudflare Pages onto the KKU VM (static files
// served by Nginx), the `/notify` Pages Function disappeared — Nginx only
// serves files, it can't run functions/notify.js. Without a replacement,
// EVERY PR / Vital Sound / หนังสือโครงการ Discord notification silently
// no-ops (the client POSTs /notify, Nginx returns index.html, the client
// fails to parse it and swallows the error). See docs/SELF-HOST.md.
//
// This is a ~single-file Node http server that reuses the ALREADY-TESTED
// Cloudflare handler UNCHANGED: functions/notify.js `onRequestPost` only
// touches `context.request.text()`, `context.env`, and
// `context.waitUntil` — exactly what we synthesise below (the same shape
// the vitest suite feeds it). No fork of the notify logic, so the tests
// keep covering the real code path.
//
// Nginx reverse-proxies `POST /notify` here (127.0.0.1:8787). Run under
// systemd (server/samo-notify.service) with secrets in an env file
// (server/samo-notify.env.example). Discord webhook URLs are secrets and
// live ONLY in that env file (chmod 600) — never in the repo or the
// browser bundle (see .claude/rules/security.md).
// ==============================================

import http from 'node:http';
import { onRequestPost } from '../functions/notify.js';

const PORT = Number(process.env.NOTIFY_PORT) || 8787;
const HOST = process.env.NOTIFY_HOST || '127.0.0.1';
const MAX_BODY = 64 * 1024; // notify payloads are tiny; cap to shrug off abuse

const server = http.createServer((req, res) => {
  // Only POST /notify is served; a health probe on GET /notify returns 200.
  if (req.method === 'GET' && req.url === '/notify') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'samo-notify' }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/notify') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'not found' }));
    return;
  }

  let body = '';
  let aborted = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > MAX_BODY) {
      aborted = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'payload too large' }));
      req.destroy();
    }
  });

  req.on('end', async () => {
    if (aborted) return;
    // Best-effort background work (the notify_log write). onRequestPost
    // schedules it via waitUntil; hold the process' handle on it so it
    // finishes even though we respond first — mirrors Cloudflare's
    // waitUntil semantics.
    const pending = [];
    const context = {
      request: { text: async () => body },
      env: process.env,
      waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => {})),
    };
    try {
      const response = await onRequestPost(context);
      const text = await response.text();
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      res.end(text);
    } catch (e) {
      console.error('[samo-notify] handler threw:', e?.stack || e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'server error' }));
    } finally {
      // Let the log write drain; never let it crash the request.
      Promise.allSettled(pending);
    }
  });

  req.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'bad request' }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[samo-notify] listening on http://${HOST}:${PORT} (POST /notify)`);
});
