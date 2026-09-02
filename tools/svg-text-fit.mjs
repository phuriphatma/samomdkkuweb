#!/usr/bin/env node
// ==============================================
// Does every <text> in a diagram FIT the <rect> it sits in?
//
// THE BUG THIS EXISTS FOR. `docs/diagrams/dependent-features.svg` had a label
// centred perfectly on its box and 80px wider than it, so the sentence hung out
// of both ends of the orange highlight. Reported as "the orange highlight box is
// not aligned" — and it was not an alignment error at all: x was correct, the
// box was too small. Nothing catches this, because an SVG with overflowing text
// is still valid SVG and still renders.
//
// ⚠️ THIS IS AN ESTIMATE, NOT A LAYOUT ENGINE. There is no font metric here, so
// it measures with a per-character width table and leaves a margin. It is built
// to be WRONG IN THE SAFE DIRECTION: it over-estimates Latin text slightly, so a
// label it passes has room. It cannot replace looking at the rendered picture —
// what it replaces is shipping a diagram nobody looked at.
// ==============================================
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '..', 'docs', 'diagrams');

/**
 * Width of one character as a multiple of font-size.
 *
 * Thai is the reason this is a table and not one number: Noto Sans Thai renders
 * consonants at roughly Latin lowercase width, but the vowels and tone marks
 * that sit ABOVE and BELOW the line (ิ ี ึ ื ั ่ ้ ๊ ๋ ็ ์ ู ุ) advance nothing at
 * all. Counting them would over-estimate a Thai label by a third and push every
 * box wider than it needs to be.
 */
const ZERO_WIDTH_THAI = /[ัิ-ฺ็-๎]/;
export function textWidth(s, fontSize) {
  let units = 0;
  for (const ch of s) {
    if (ZERO_WIDTH_THAI.test(ch)) continue;
    if (ch === ' ') units += 0.28;
    else if (/[iljI.,;:'`!|()\[\]]/.test(ch)) units += 0.30;
    else if (/[A-Z0-9]/.test(ch)) units += 0.62;
    else if (/[mwMW—…]/.test(ch)) units += 0.90;
    else if (/[฀-๿]/.test(ch)) units += 0.58;
    else units += 0.55;
  }
  return units * fontSize;
}

const numAttr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([-\\d.]+)"`));
  return m ? Number(m[1]) : null;
};
const strAttr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};

/** Every `<rect>` that could be a label chip, and every `<text>`. */
export function boxesAndLabels(svg) {
  const rects = [...svg.matchAll(/<rect\b[^>]*>/g)].map((m) => ({
    x: numAttr(m[0], 'x'), y: numAttr(m[0], 'y'),
    w: numAttr(m[0], 'width'), h: numAttr(m[0], 'height'),
  })).filter((r) => r.x != null && r.w != null);

  const texts = [...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map((m) => ({
    x: numAttr(`<text${m[1]}>`, 'x'), y: numAttr(`<text${m[1]}>`, 'y'),
    size: numAttr(`<text${m[1]}>`, 'font-size') ?? 12,
    anchor: strAttr(`<text${m[1]}>`, 'text-anchor') ?? 'start',
    // Entities are one glyph each, so they must not be counted as five.
    text: m[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim(),
  })).filter((t) => t.x != null && t.text);

  return { rects, texts };
}

/** The horizontal span a label occupies, given its anchor. */
export function span(t) {
  const w = textWidth(t.text, t.size);
  if (t.anchor === 'middle') return [t.x - w / 2, t.x + w / 2];
  if (t.anchor === 'end') return [t.x - w, t.x];
  return [t.x, t.x + w];
}

/**
 * A label OVERFLOWS when it sits inside a box vertically and pokes out
 * horizontally. Labels that belong to no box (free-standing captions) are
 * checked against the diagram frame instead — the outermost rect.
 */
export function overflows(svg) {
  const { rects, texts } = boxesAndLabels(svg);
  if (!rects.length) return [];
  const frame = rects.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
  const out = [];

  for (const t of texts) {
    const [l, r] = span(t);
    // The smallest box whose vertical band contains this label's baseline —
    // the chip it was drawn for, not the frame that contains everything.
    const host = rects
      .filter((k) => k !== frame && t.y > k.y && t.y < k.y + k.h && t.x >= k.x && t.x <= k.x + k.w)
      .sort((a, b) => a.w * a.h - b.w * b.h)[0] || frame;
    if (l < host.x - 0.5 || r > host.x + host.w + 0.5) {
      out.push({
        text: t.text,
        need: Math.ceil(r - l),
        have: host.w,
        box: `x=${host.x} w=${host.w}`,
        kind: host === frame ? 'runs past the diagram edge' : 'wider than its box',
      });
    }
  }
  return out;
}

if (import.meta.filename === process.argv[1]) {
  let bad = 0;
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.svg')).sort()) {
    const hits = overflows(readFileSync(join(DIR, f), 'utf8'));
    if (!hits.length) { console.log(`✔ ${f}`); continue; }
    bad += hits.length;
    console.log(`✘ ${f}`);
    for (const h of hits) {
      console.log(`    ${h.kind}: needs ~${h.need}px, box is ${h.have}px  [${h.box}]`);
      console.log(`      “${h.text}”`);
    }
  }
  process.exit(bad ? 1 : 0);
}
