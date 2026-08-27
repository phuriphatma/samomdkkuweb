#!/usr/bin/env node
// ============================================================
// discord-webhooks-provision.mjs — create one webhook per channel, and print
// the map ready to install.
//
//   export DISCORD_BOT_TOKEN=...            (needs MANAGE_WEBHOOKS)
//   node tools/discord-webhooks-provision.mjs --guild <id> --match vitalsound
//   node tools/discord-webhooks-provision.mjs --guild <id> --match vitalsound --apply
//
// WHY. Discord will not let you regenerate a webhook's token in the UI when a
// bot created it — the owner has to DELETE and RECREATE each one by hand, which
// is minutes per channel and error-prone across a dozen channels.
//
// ⛔ DRY RUN BY DEFAULT. Nothing is created without --apply. On 2026-08-27 two
// real messages reached a live ฝ่าย channel because an action was taken to find
// out what it would do. This tool tells you what it WOULD do first.
//
// It never POSTs a message. It only lists channels, creates webhooks, and reads
// them back to confirm where each points.
// ============================================================

const API = 'https://discord.com/api/v10';
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = opt('guild');
const MATCH = (opt('match') || '').toLowerCase();
const NAME = opt('name', 'samoweb');
const APPLY = has('apply');

if (!TOKEN) {
  console.error('DISCORD_BOT_TOKEN is not set.');
  console.error('  A BOT token (not a webhook URL), from the Discord developer portal,');
  console.error('  for a bot that is in the server and has MANAGE_WEBHOOKS.');
  process.exit(1);
}
if (!GUILD) { console.error('--guild <server id> is required (right-click the server → Copy Server ID).'); process.exit(1); }

const dget = async (path, init = {}) => {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${body.slice(0, 160)}`);
  return body ? JSON.parse(body) : null;
};

const channels = await dget(`/guilds/${GUILD}/channels`);
// type 0 = text channel; anything else cannot take a webhook.
const targets = channels
  .filter((c) => c.type === 0)
  .filter((c) => !MATCH || c.name.toLowerCase().includes(MATCH))
  .sort((a, b) => a.name.localeCompare(b.name));

if (!targets.length) {
  console.log(`no text channels matching "${MATCH}" — nothing to do.`);
  console.log('channels available:', channels.filter((c) => c.type === 0).map((c) => c.name).join(', ').slice(0, 400));
  process.exit(1);
}

console.log(`${targets.length} channel(s) match "${MATCH || '*'}":`);
for (const c of targets) console.log(`  #${c.name}  (${c.id})`);

if (!APPLY) {
  console.log(`\nDRY RUN — nothing created. Re-run with --apply to create a "${NAME}" webhook in each.`);
  process.exit(0);
}

const map = {};
for (const c of targets) {
  const w = await dget(`/channels/${c.id}/webhooks`, {
    method: 'POST', body: JSON.stringify({ name: NAME }),
  });
  const url = `https://discord.com/api/webhooks/${w.id}/${w.token}`;
  // Read it back: confirm where it points BEFORE anyone relies on it.
  const back = await dget(`/webhooks/${w.id}`);
  console.log(`  created in #${c.name}: id=${w.id} → channel_id=${back.channel_id} ${back.channel_id === c.id ? '✓' : '✗ MISMATCH'}`);
  map[c.name] = url;
}

console.log('\n--- webhook map (install as DISCORD_VS_WEBHOOKS, keys must match the ฝ่าย names the app sends) ---');
console.log(JSON.stringify(map, null, 2));
console.log('\nThe KEYS must be the department strings the app sends (see the VS map already');
console.log('on the VM). Channel names are used here only as a starting point — rename them');
console.log('to the ฝ่าย keys before installing, or VS falls back to the default dept.');
