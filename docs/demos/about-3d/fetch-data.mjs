// Step 1 of the demo build: pull the real org chart + the portraits it links to.
//
// Everything this writes is GENERATED and gitignored — the repo is public, and
// a baked atlas of 398 students' names beside their photos does not belong in
// it. Re-run this and the rest of the pipeline reproduces the demo exactly.
import { writeFileSync, mkdirSync } from 'node:fs';

const here = (f) => new URL(f, import.meta.url);
const SITE = 'https://samo.md.kku.ac.th';

// The anon key is public by design (RLS gates everything), and it is already in
// the served bundle — read it from there rather than keeping a copy that rots.
const html = await (await fetch(SITE + '/')).text();
const chunks = [...html.matchAll(/\/assets\/[A-Za-z0-9._-]+\.js/g)].map((m) => m[0]);
let url = '', key = '';
for (const c of chunks) {
  const js = await (await fetch(SITE + c)).text();
  url ||= (js.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [''])[0];
  key ||= (js.match(/eyJ[A-Za-z0-9._-]{60,}/) || [''])[0];
  if (url && key) break;
}
if (!url || !key) throw new Error('could not find the Supabase endpoint in the served bundle');

const res = await fetch(`${url}/rest/v1/rpc/get_public_team_chart`, {
  method: 'POST',
  headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: '{}',
});
if (!res.ok) throw new Error(`RPC ${res.status}`);
const chart = await res.json();
writeFileSync(here('./chart-raw.json'), JSON.stringify(chart));

// lh3 encodes the size in the PATH. Appending `?sz=` or `=w320` to a URL that
// already carries one silently returns the original — see docs/mistakes.
const urls = [...new Set(
  chart.members.filter((m) => m.photo_url).map((m) => m.photo_url.replace(/=w\d+.*$/, '=w320')),
)];
writeFileSync(here('./photo-urls.json'), JSON.stringify(urls));

mkdirSync(here('./photos'), { recursive: true });
await Promise.all(urls.map(async (u, i) => {
  const r = await fetch(u);
  writeFileSync(here(`./photos/${i}.jpg`), Buffer.from(await r.arrayBuffer()));
}));

console.log(`year ${chart.year} · ${chart.nodes.length} nodes · ${chart.members.length} members`);
console.log(`${urls.length} distinct portraits (of ${chart.members.filter((m) => m.photo_url).length} members with one)`);
