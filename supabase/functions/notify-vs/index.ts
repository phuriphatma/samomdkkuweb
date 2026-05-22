// supabase/functions/notify-vs/index.ts
//
// Fires the appropriate VitalSound Discord webhook for either a new
// ticket or a staff consult/transfer message.
//
// Called from the frontend:
//   db.functions.invoke('notify-vs', { body: { mode: 'submit'|'consult', ... } })
//
// Deployment:
//   supabase functions deploy notify-vs --no-verify-jwt
//
// Set the webhook URLs (one per department). The function looks them
// up by department key with this fallback chain:
//
//   1. Per-dept secret: VS_WEBHOOK_<DEPT_KEY> (sanitized)
//   2. VS_WEBHOOK_DEFAULT (catches anything not configured)
//
// Department keys:
//   SE
//   ADMIN     → อุปนายกฝ่ายบริหารองค์กร
//   DIGITAL   → อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร
//   INTERNAL  → อุปนายกฝ่ายกิจการภายใน
//   EXTERNAL  → อุปนายกฝ่ายกิจการภายนอก
//   UNIVERSITY → อุปนายกฝ่ายกิจการมหาวิทยาลัย
//   ACADEMIC  → อุปนายกฝ่ายวิชาการ
//   STRATEGY  → อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร
//   QUALITY   → อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม
//   MEDIA     → อุปนายกฝ่ายเวชนิทัศน์
//   RADIOLOGY → อุปนายกฝ่ายรังสีเทคนิค
//
// Set with: supabase secrets set VS_WEBHOOK_SE=https://discordapp.com/...

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const DEPT_KEY: Record<string, string> = {
  'SE': 'SE',
  'อุปนายกฝ่ายบริหารองค์กร': 'ADMIN',
  'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร': 'DIGITAL',
  'อุปนายกฝ่ายกิจการภายใน': 'INTERNAL',
  'อุปนายกฝ่ายกิจการภายนอก': 'EXTERNAL',
  'อุปนายกฝ่ายกิจการมหาวิทยาลัย': 'UNIVERSITY',
  'อุปนายกฝ่ายวิชาการ': 'ACADEMIC',
  'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร': 'STRATEGY',
  'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม': 'QUALITY',
  'อุปนายกฝ่ายเวชนิทัศน์': 'MEDIA',
  'อุปนายกฝ่ายรังสีเทคนิค': 'RADIOLOGY',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function getWebhookForDept(deptThai: string): string | null {
  const key = DEPT_KEY[deptThai];
  if (key) {
    const url = Deno.env.get(`VS_WEBHOOK_${key}`);
    if (url) return url;
  }
  return Deno.env.get('VS_WEBHOOK_DEFAULT') || null;
}

function stripHtml(html: string): string {
  return (html || '')
    .replace(/<p>/g, '').replace(/<\/p>/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '').trim();
}

serve(async (req) => {
  try {
    return await handle(req);
  } catch (e: any) {
    console.error('[notify-vs] unhandled:', e?.stack || e?.message || e);
    return new Response(JSON.stringify({ ok: false, error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'invalid JSON' }), {
      status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const mode = body.mode || 'submit';
  const silent = body.silent === true || body.silent === 'true';

  // ============ SUBMIT — new ticket announcement ============
  if (mode === 'submit') {
    const { ticketId, problem, department, isEmergency, requestedDept, skipDiscord } = body;
    if (skipDiscord) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }
    const url = getWebhookForDept(department);
    if (!url) {
      return new Response(JSON.stringify({ ok: false, error: 'no webhook configured for ' + department }), {
        status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const emergency = isEmergency === true || isEmergency === 'true';
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

    let desc = stripHtml(problem) || '*(ไม่มีข้อความ: มีการแนบรูปภาพหรือสื่อ)*';
    if (!emergency && requestedDept && requestedDept !== 'SE') {
      desc += `\n\n📌 **ผู้แจ้งปัญหาระบุว่าต้องการส่งถึง: ${requestedDept}**\n*(SE กรุณาพิจารณาและโอนย้ายหากเหมาะสม)*`;
    }

    const payload: any = {
      content,
      embeds: [{
        title: `Ticket: ${ticketId} [${department || 'SE'}]`,
        description: desc.substring(0, 2048),
        color,
      }],
    };
    if (silent) payload.flags = 4096;

    try {
      const r = await fetch(url, {
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

  // ============ CONSULT — staff cross-dept transfer/consult ============
  if (mode === 'consult') {
    const { ticketId, role, notifyTo, remark, displayDept, displayStatus } = body;
    const url = getWebhookForDept(notifyTo);
    if (!url) {
      return new Response(JSON.stringify({ ok: false, error: 'no webhook configured for ' + notifyTo }), {
        status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const mention = silent ? '' : '@here ';
    const content = `💬 ${mention}**${role}** มีการอัปเดตใน Ticket **${ticketId}**`;
    let desc = `**ฝ่ายที่ดูแล:** ${displayDept || '-'}\n**สถานะ:** ${displayStatus || '-'}\n\n`;
    desc += remark ? `**ข้อความ:**\n${remark}` : `*(ไม่มีข้อความแนบ)*`;

    const payload: any = {
      content,
      embeds: [{ title: `อัปเดต Ticket: ${ticketId}`, description: desc.substring(0, 2048), color: 3447003 }],
    };
    if (silent) payload.flags = 4096;

    try {
      const r = await fetch(url, {
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

  return new Response(JSON.stringify({ ok: false, error: 'unknown mode: ' + mode }), {
    status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
