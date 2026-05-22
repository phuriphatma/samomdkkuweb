// supabase/functions/notify-pr/index.ts
//
// Fires the PR-team Discord webhook when a new PR ticket is submitted.
// Called from the frontend via:
//   db.functions.invoke('notify-pr', { body: {...} })
//
// Deployment:
//   supabase functions deploy notify-pr --no-verify-jwt
// Set the webhook URL:
//   supabase secrets set PR_DISCORD_WEBHOOK_URL=https://discordapp.com/...

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const PR_WEBHOOK = Deno.env.get('PR_DISCORD_WEBHOOK_URL');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  try {
    return await handle(req);
  } catch (e: any) {
    console.error('[notify-pr] unhandled:', e?.stack || e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!PR_WEBHOOK) {
    console.error('[notify-pr] missing PR_DISCORD_WEBHOOK_URL secret');
    return new Response(
      JSON.stringify({ ok: false, error: 'PR_DISCORD_WEBHOOK_URL secret not set' }),
      { status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' } },
    );
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const {
    ticketId, department, content, contact, jobType, deadlineMode,
    uploadedUrls = [], largeFileLink, otherPlatform = [], otherPlatformReason,
    silentNotify, skipDiscord,
  } = body || {};

  if (skipDiscord === true || skipDiscord === 'true') {
    return new Response(JSON.stringify({ ok: true, skipped: true }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const isRush = deadlineMode === 'Rush PR Review';

  let discordLinks = '';
  if (Array.isArray(uploadedUrls) && uploadedUrls.length > 0) {
    uploadedUrls.forEach((url: string, i: number) => {
      discordLinks += `[📸 ภาพที่ ${i + 1}](${url})\n`;
    });
  }
  if (largeFileLink) discordLinks += `[🔗 ลิงก์ G-Drive เพิ่มเติม](${largeFileLink})`;
  if (!discordLinks) discordLinks = '-';

  const fields: any[] = [
    { name: 'Ticket ID', value: ticketId || '-', inline: true },
    { name: 'ประเภทงาน', value: jobType || '-', inline: true },
    { name: 'กำหนดการ', value: isRush ? '⚡ ด่วน' : '📅 ปกติ', inline: true },
    { name: 'ติดต่อ', value: contact || '-', inline: true },
    { name: 'ไฟล์แนบ', value: discordLinks, inline: false },
  ];

  if (Array.isArray(otherPlatform) && otherPlatform.length > 0) {
    fields.push({ name: 'Other Platform', value: otherPlatform.join(', '), inline: false });
    if (otherPlatformReason) {
      fields.push({ name: 'เหตุผลที่ต้องการ PR', value: otherPlatformReason, inline: false });
    }
  }

  const payload: any = {
    content: `🚨 ส่งงาน PR ใหม่ จาก **${department || '-'}**!`,
    embeds: [{ title: content || '(ไม่มีชื่องาน)', color: isRush ? 16711680 : 3447003, fields }],
  };
  if (silentNotify === true || silentNotify === 'true') payload.flags = 4096;

  try {
    const r = await fetch(PR_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      return new Response(JSON.stringify({ ok: false, status: r.status }), {
        status: 502, headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 502, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
