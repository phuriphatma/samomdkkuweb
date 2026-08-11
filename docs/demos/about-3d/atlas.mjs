// Bake one texture atlas of 398 person cards.
//
// WHY BAKE IN A BROWSER. Thai needs real shaping — vowels above and below the
// consonant, tone marks stacked on top of those. Canvas 2D uses the platform's
// own text engine, so drawing the card there and handing the pixels to WebGL
// gets correct Thai for free. Generating glyphs inside a shader does not.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const here = (f) => new URL(f, import.meta.url);
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9226;

const data = JSON.parse(readFileSync(here('./org-demo.json'), 'utf8'));
const urls = JSON.parse(readFileSync(here('./photo-urls.json'), 'utf8'));
const photos = urls.map((_, i) => 'data:image/jpeg;base64,'
  + readFileSync(here(`./photos/${i}.jpg`)).toString('base64'));

const TINTS = {
  admin: '#A17A60', digital: '#F2CB67', internal: '#E68FAA', external: '#7DB0CD',
  university: '#F49D5F', academic: '#2F5F9C', strategy: '#318D65',
  quality: '#8DC96C', media: '#2294BC', projects: '#8C6A47',
};

// Flatten to the card list the 3D view will draw, keeping ฝ่าย + ตำแหน่ง path.
const cards = [];
const walk = (node, root, path) => {
  for (const p of node.people) {
    cards.push({
      n: p.n, k: p.k, i: p.i, photo: p.p,
      role: node.name, dept: root.name, tint: root.tint,
      path: path.join(' › '),
    });
  }
  for (const kid of node.kids) walk(kid, root, [...path, node.name]);
};
for (const r of data.roots) walk(r, r, []);

const CELL_W = 128, CELL_H = 168, COLS = 30;
const rows = Math.ceil(cards.length / COLS);
const ATLAS_W = COLS * CELL_W, ATLAS_H = rows * CELL_H;

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/cdp-profile-atlas', '--no-first-run',
  'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2200);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) pending.get(m.id)(m); };
const send = (method, params = {}) => new Promise((res) => {
  const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};

const payload = JSON.stringify({ cards, photos, TINTS, CELL_W, CELL_H, COLS, ATLAS_W, ATLAS_H });

const out = await evaluate(`(async () => {
  const P = ${payload};
  const imgs = await Promise.all(P.photos.map((src) => new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  })));

  const c = document.createElement('canvas');
  c.width = P.ATLAS_W; c.height = P.ATLAS_H;
  const x = c.getContext('2d');
  x.fillStyle = '#EEF0EC';
  x.fillRect(0, 0, c.width, c.height);
  x.textBaseline = 'top';

  const FACE = '"Noto Sans Thai", "Sukhumvit Set", "Thonburi", -apple-system, system-ui, sans-serif';

  // Draw text clipped to the card, wrapping on Thai's own break opportunities
  // as the browser sees them — measureText per grapheme cluster is close enough
  // at this size and never splits a glyph from its vowel.
  const wrap = (text, maxW, maxLines) => {
    const seg = new Intl.Segmenter('th', { granularity: 'word' });
    const parts = [...seg.segment(text)].map((s) => s.segment);
    const lines = []; let cur = '';
    for (const part of parts) {
      const test = cur + part;
      if (x.measureText(test).width > maxW && cur) { lines.push(cur.trim()); cur = part; }
      else cur = test;
      if (lines.length >= maxLines) break;
    }
    if (cur && lines.length < maxLines) lines.push(cur.trim());
    return lines.slice(0, maxLines);
  };

  P.cards.forEach((card, i) => {
    const cx = (i % P.COLS) * P.CELL_W;
    const cy = Math.floor(i / P.COLS) * P.CELL_H;
    const pad = 6;
    const w = P.CELL_W - pad * 2, h = P.CELL_H - pad * 2;
    const tint = P.TINTS[card.tint] || '#8C6A47';

    // card face, inside a full ฝ่าย-coloured frame. A band on the top edge
    // alone disappears at the size a card actually gets on screen; a border on
    // all four sides is what makes one ฝ่าย separable from the next at a glance.
    x.fillStyle = tint;
    x.fillRect(cx + pad - 3, cy + pad - 3, w + 6, h + 6);
    x.fillStyle = '#FDFDFC';
    x.fillRect(cx + pad, cy + pad, w, h);
    x.fillStyle = tint;
    x.fillRect(cx + pad, cy + pad, w, 3);

    const imgH = 84;
    const iy = cy + pad + 4;
    const im = card.photo >= 0 ? imgs[card.photo] : null;
    if (im) {
      // cover-crop toward the top of the frame, where a face usually is
      const s = Math.max(w / im.width, imgH / im.height);
      const dw = im.width * s, dh = im.height * s;
      x.save();
      x.beginPath(); x.rect(cx + pad, iy, w, imgH); x.clip();
      x.drawImage(im, cx + pad + (w - dw) / 2, iy - dh * 0.06, dw, dh);
      x.restore();
    } else {
      // DEFAULT PROFILE PICTURE, not initials: only 10 of 398 people have
      // uploaded a photo, so this placeholder is what the wall mostly shows —
      // and a neutral silhouette reads as "no photo yet" where a letter tile
      // reads as a design choice. It is tinted by ฝ่าย so the wall still
      // carries the colour coding.
      x.fillStyle = tint + '1F';
      x.fillRect(cx + pad, iy, w, imgH);
      const mid = cx + P.CELL_W / 2;
      const base = iy + imgH;
      x.fillStyle = tint + '8C';
      x.beginPath();
      x.arc(mid, base - 52, 16, 0, Math.PI * 2);      // head
      x.fill();
      x.beginPath();
      x.moveTo(mid - 30, base - 2);                    // shoulders
      x.quadraticCurveTo(mid - 30, base - 30, mid, base - 30);
      x.quadraticCurveTo(mid + 30, base - 30, mid + 30, base - 2);
      x.closePath();
      x.fill();
    }

    x.textAlign = 'center';
    let ty = iy + imgH + 6;
    x.fillStyle = '#14201A';
    x.font = '700 13px ' + FACE;
    for (const line of wrap(card.n, w - 8, 2)) {
      x.fillText(line, cx + P.CELL_W / 2, ty); ty += 15;
    }
    if (card.k) {
      x.fillStyle = '#7C8A82';
      x.font = '400 11px ' + FACE;
      x.fillText(card.k, cx + P.CELL_W / 2, ty); ty += 13;
    }
    x.fillStyle = '#9AA69E';
    x.font = '400 10px ' + FACE;
    for (const line of wrap(card.role, w - 6, 2)) {
      if (ty > cy + P.CELL_H - 12) break;
      x.fillText(line, cx + P.CELL_W / 2, ty); ty += 11;
    }
  });

  return c.toDataURL('image/jpeg', 0.74);
})()`);

writeFileSync(here('./atlas.jpg.txt'), out);
writeFileSync(here('./cards.json'), JSON.stringify({
  cards: cards.map((c) => ({ n: c.n, k: c.k, role: c.role, dept: c.dept, tint: c.tint, path: c.path, photo: c.photo })),
  cell: { w: CELL_W, h: CELL_H, cols: COLS, rows, aw: ATLAS_W, ah: ATLAS_H },
}));
console.log('cards', cards.length, 'atlas', ATLAS_W + 'x' + ATLAS_H,
  'jpeg', (out.length / 1024 / 1024).toFixed(2), 'MB (data uri)');
ws.close(); chrome.kill(); process.exit(0);
