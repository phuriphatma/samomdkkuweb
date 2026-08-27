#!/usr/bin/env node
// ============================================================
// notify-smoke.mjs — send ONE clearly-marked, SILENT test through every
// notification action, at a chosen host.
//
//   node tools/notify-smoke.mjs                       # production
//   node tools/notify-smoke.mjs --host https://<preview>.pages.dev
//   node tools/notify-smoke.mjs --vs-all              # every ฝ่าย, not just SE
//
// WHY THIS EXISTS. On 2026-08-27 hand-written test payloads were sent into live
// ฝ่าย channels and read as REAL incidents. The reason is in
// functions/_discord.js: every builder HARDCODES its own alarm text —
// `🚨 ส่งงาน PR ใหม่`, `🚨 แจ้งปัญหาใหม่ระบบ Vital Sound` — and ignores any
// `title` a caller passes. A test therefore looks exactly like the real thing
// unless the fields the builder DOES render are used to say otherwise.
//
// So this tool:
//   • sets the SILENT flag every builder supports (Discord suppresses the ping),
//   • writes the test marker into the fields that actually render — ticketId,
//     vsProblem, detail — not into `title`, which is discarded,
//   • prints the status per action.
//
// ⚠️ It DOES send. That is the point. To find out WHERE something would go
// without sending, use `npm run webhook:id`.
// ============================================================

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const HOST = opt('host', 'https://samo.md.kku.ac.th').replace(/\/$/, '');
const VS_ALL = args.includes('vs-all') || args.includes('--vs-all');

const MARK = 'ทดสอบระบบ — ไม่ใช่เรื่องจริง';
const NOTE = '⚠️ ข้อความทดสอบระบบแจ้งเตือนโดยทีม IT — ไม่ใช่เรื่องจริง ไม่ต้องดำเนินการ ลบทิ้งได้เลย';

const VS_DEPTS = [
  'SE', 'นายกสโม', 'อุปนายกฝ่ายกิจการภายนอก', 'อุปนายกฝ่ายกิจการภายใน',
  'อุปนายกฝ่ายกิจการมหาวิทยาลัย', 'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',
  'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร', 'อุปนายกฝ่ายบริหารองค์กร',
  'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร', 'อุปนายกฝ่ายรังสีเทคนิค',
  'อุปนายกฝ่ายวิชาการ', 'อุปนายกฝ่ายเวชนิทัศน์',
];

const cases = [
  ['notifyPROnly', { department: MARK, silentNotify: true, prTitle: MARK, detail: NOTE }],
  ['notifyProjectDiscord', { projectName: MARK, silentNotify: true, detail: NOTE }],
  ['notifyClaudeMonitor', { who: MARK, reason: NOTE, detail: NOTE }],
  ['notifyVSConsult', { notifyTo: 'SE', role: MARK, ticketId: MARK, vsSilentNotify: true, detail: NOTE }],
  ...(VS_ALL ? VS_DEPTS : ['SE']).map((d) => ['notifyVSOnly',
    { department: d, vsSilentNotify: true, ticketId: MARK, vsProblem: NOTE }, d]),
];

console.log(`host: ${HOST}`);
let ok = 0, bad = 0;
for (const [action, extra, label] of cases) {
  const r = await fetch(`${HOST}/notify`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action, ...extra }),
  });
  let j = {}; try { j = JSON.parse(await r.text()); } catch { /* non-JSON */ }
  const good = j.success === true;
  good ? ok++ : bad++;
  console.log(`  ${good ? '✓' : '✗'} ${action}${label ? ` [${label}]` : ''} → ${j.status ?? j.message ?? r.status}`);
}
console.log(`\n  delivered=${ok}  failed=${bad}  (all SILENT — no ping raised)`);
process.exit(bad ? 1 : 0);
