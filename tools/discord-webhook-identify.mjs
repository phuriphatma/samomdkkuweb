#!/usr/bin/env node
// ============================================================
// discord-webhook-identify.mjs — WHERE would this webhook post?
//
//   node tools/discord-webhook-identify.mjs <url> [<url> ...]
//   printf '%s\n' "$URL" | node tools/discord-webhook-identify.mjs
//
// WHY THIS EXISTS. On 2026-08-27 two real messages were sent into a live ฝ่าย
// channel while testing whether a preview build was isolated. Both times the
// question was "does this send somewhere safe?" and both times it was answered
// BY SENDING.
//
// A GET on a webhook URL returns its name and channel_id and delivers NOTHING.
// That is the whole tool. Identify first; send never, unless you mean it.
//
// The companion check is tools/notify-exposure.mjs, which asks the Cloudflare
// API which deployments have a webhook BAKED IN — because env vars are frozen
// at deploy time, so what a project is configured with today tells you nothing
// about what an existing deployment will do.
// ============================================================

const urls = process.argv.slice(2);
if (!urls.length) {
  const stdin = await new Promise((r) => {
    let b = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { b += c; }); process.stdin.on('end', () => r(b));
  });
  urls.push(...stdin.split(/\s+/).filter(Boolean));
}
if (!urls.length) {
  console.error('usage: node tools/discord-webhook-identify.mjs <webhook-url> [...]');
  process.exit(1);
}

let bad = 0;
for (const u of urls) {
  if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]+/.test(u)) {
    console.log(`✗ not a webhook URL: ${u.slice(0, 40)}…`); bad += 1; continue;
  }
  try {
    // GET, never POST. This is the point of the tool.
    const r = await fetch(u);
    if (!r.ok) {
      const t = await r.text();
      console.log(`✗ ${u.replace(/\/[\w-]{20,}$/, '/…')} → HTTP ${r.status} ${t.slice(0, 60)}`);
      bad += 1; continue;
    }
    const d = await r.json();
    console.log(`✓ id=${d.id}  name=${d.name}  channel_id=${d.channel_id}`);
  } catch (e) {
    console.log(`✗ ${u.slice(0, 40)}… → ${e.message.slice(0, 60)}`); bad += 1;
  }
}
process.exit(bad ? 1 : 0);
