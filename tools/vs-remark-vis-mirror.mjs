// Differential test: public.vs_remark_vis() (SQL) vs remarkVis() (JS, utils.js).
//
// The 0096 visibility ladder is implemented TWICE — once as the server-side
// boundary and once in the client for rendering. STATE.md calls them "mirrors,
// keep them in step"; this is what actually keeps them in step. It runs every
// input shape the remarks array can legally hold (the array is client-written,
// so malformed and hostile values are reachable) through both and diffs.
//
// Direction matters: SQL saying `staff` while JS says `ticket` is SAFE (the
// server strips the entry and the client never sees it). The reverse — JS
// believing an entry is staff-only when the server ships it — would render a
// staff note to a submitter. Any mismatch is a bug; that one is a leak.
//
// First run found 't' / '1' / 1 accepted by the SQL and rejected by the JS.
//
// Read-only: one SELECT, no writes, no transaction needed.
import { readFileSync } from 'node:fs';
import { remarkVis } from '../src/js/utils.js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,'')]; }));
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)[1];

const CASES = [
  {}, {vis:'staff'}, {vis:'ticket'}, {vis:'thread'}, {vis:'public'},
  {internal:true}, {internal:false}, {internal:'true'}, {internal:'TRUE'},
  {internal:'t'}, {internal:'1'}, {internal:'yes'}, {internal:null},
  {vis:'public',internal:true}, {vis:'staff',internal:true},
  {vis:'PUBLIC'}, {vis:'everyone'}, {vis:''}, {vis:null}, {vis:42},
  {vis:'ticket',internal:true}, {by:'SE',text:'hi'},
  {vis:['public']}, {vis:{a:1}}, {internal:1}, {internal:0},
];

const sql = `select idx, public.vs_remark_vis(e) as vis from (values ${
  CASES.map((c,i)=>`(${i}, '${JSON.stringify(c).replace(/'/g,"''")}'::jsonb)`).join(',')
}) as t(idx, e) order by idx;`;

const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method:'POST',
  headers:{ Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type':'application/json' },
  body: JSON.stringify({ query: sql }),
});
const rows = await r.json();
if (!r.ok) { console.error(rows); process.exit(1); }

let bad = 0;
console.log('project', REF, '\u2014 vs_remark_vis mirror (SQL vs JS)\n');
for (const row of rows) {
  const c = CASES[row.idx];
  const js = remarkVis(c);
  const ok = js === row.vis;
  if (!ok) bad++;
  console.log(`${ok?'  ok ':'MISMATCH'}  ${JSON.stringify(c).padEnd(34)} sql=${String(row.vis).padEnd(7)} js=${js}`);
}
console.log(bad ? `\n${bad} MISMATCHES` : `\nall ${rows.length} inputs agree`);
process.exit(bad ? 1 : 0);
