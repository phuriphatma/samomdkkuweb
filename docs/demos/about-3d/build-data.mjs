// Compact the real prod chart into the shape the demo frames need.
import { readFileSync, writeFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync(new URL('./chart-raw.json', import.meta.url), 'utf8'));

const DEPT_TINT = [
  [/สำนักนายก/, 'admin'], [/บริหารองค์กร/, 'admin'],
  [/ดิจิทัล|สื่อสารองค์กร/, 'digital'], [/กิจการภายใน/, 'internal'],
  [/กิจการภายนอก/, 'external'], [/กิจการมหาวิทยาลัย/, 'university'],
  [/วิชาการ/, 'academic'], [/ยุทธศาสตร์|พัฒนาองค์กร/, 'strategy'],
  [/คุณภาพชีวิต|สิ่งแวดล้อม/, 'quality'], [/เวชนิทัศน์/, 'media'],
  [/รังสีเทคนิค/, 'projects'],
];
const tintFor = (n) => (DEPT_TINT.find(([re]) => re.test(n || '')) || [])[1] || 'projects';
const PHOTOS = JSON.parse(readFileSync(new URL('./photo-urls.json', import.meta.url), 'utf8'));
const photoIdx = (u) => {
  if (!u) return -1;
  return PHOTOS.indexOf(String(u).replace(/=w\d+.*$/, '=w320'));
};
const initials = (name) => {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  return !p.length ? '—' : (p[0][0] || '') + (p[1] ? p[1][0] : '');
};

const byParent = new Map();
for (const n of raw.nodes) {
  const k = n.parent_id || '';
  if (!byParent.has(k)) byParent.set(k, []);
  byParent.get(k).push(n);
}
const membersOf = new Map();
for (const m of raw.members) {
  if (!membersOf.has(m.node_id)) membersOf.set(m.node_id, []);
  membersOf.get(m.node_id).push(m);
}
const sortP = (a, b) => (a.position ?? 0) - (b.position ?? 0);

function build(node) {
  const kids = (byParent.get(node.id) || []).sort(sortP).map(build);
  const people = (membersOf.get(node.id) || []).sort(sortP).map((m) => ({
    n: m.name || '', k: m.nickname || '', i: initials(m.name), p: photoIdx(m.photo_url),
  }));
  return { name: node.name || '', people, kids };
}

// Drop the obvious test rows so the demo reads like the real page.
const roots = (byParent.get('') || [])
  .sort(sortP)
  .filter((n) => !/testing|^ung/i.test(n.name || ''))
  .map((n) => ({ ...build(n), tint: tintFor(n.name) }));

const count = (n) => n.people.length + n.kids.reduce((s, k) => s + count(k), 0);
const nodes = (n) => 1 + n.kids.reduce((s, k) => s + nodes(k), 0);

writeFileSync(new URL('./org-demo.json', import.meta.url), JSON.stringify({
  year: raw.year, roots,
}));
console.log('roots', roots.length,
  'people', roots.reduce((s, r) => s + count(r), 0),
  'nodes', roots.reduce((s, r) => s + nodes(r), 0),
  'bytes', JSON.stringify({ year: raw.year, roots }).length);
for (const r of roots) console.log(' ', r.name, '·', count(r), 'คน ·', nodes(r), 'ตำแหน่ง');
