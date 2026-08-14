// org-face.js — the ONE way a person's face is drawn on the ทีม SAMO page.
//
// Extracted because there are now THREE surfaces over the same dataset
// (รายการ, แผนผัง, ผังรวม) and the first two shared this code only by sitting in
// the same file. `.claude/rules/mistakes.md` class 6 is "two implementations of
// one rule drift"; a second copy of the srcset/initials logic in org-graph.js
// would have been exactly that, and the drift would have been silent — a wrong
// `sizes` hint just downloads the wrong file.
//
// Initials are ALWAYS rendered, with the photo layered over them. A Drive link
// can rot (file unshared, moved, deleted) and an <img alt=""> that fails to load
// draws nothing — so without this a broken photo would leave an empty box.
// Layering means it degrades to the same initials as someone who never uploaded
// one, with no error handler to wire up.
import { escHtml } from './utils.js';
import {
  portraitSrc, portraitSrcSet, focusToObjectPosition, PORTRAIT_RATIO,
} from './uploads.js';

/** Initials for the no-photo state. Thai names have no case, so take the first
 *  glyph of the first two words — enough to differentiate at a glance without
 *  pretending to be a monogram. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] || '') + (parts[1] ? parts[1][0] : '');
}

// The shapes a face appears in, and the exact widths lh3 is asked for.
//
// This split is the whole point of the srcset: a tree avatar renders at up to
// 130 CSS px and a ผังรวม avatar at 34, so handing the small one the big file
// would waste ~35 KB × 400 people. Widths cover 1x through 3x; the browser
// downloads exactly one per image using the `sizes` hint.

/** รายการ / แผนผัง — same portrait card as the board grid, smaller. The tree
 *  uses ONE visual language with the grid — portrait over name over ตำแหน่ง —
 *  rather than a separate avatar treatment, so a person looks like the same kind
 *  of object wherever they appear. */
export const TREE_SHAPE = {
  cls: 'org-face',
  ratio: PORTRAIT_RATIO,
  widths: [130, 200, 260, 390],
  sizes: '(max-width: 560px) 28vw, 130px',
  base: 260,
};

/** ผังรวม — the d3 chart's node cards. A fixed 34px thumbnail beside the name,
 *  never fluid, because the card is laid out in SVG user units at a known width.
 *  A fixed `sizes` is correct here for the same reason. */
export const GRAPH_SHAPE = {
  cls: 'org-face',
  ratio: PORTRAIT_RATIO,
  widths: [34, 68, 102],
  sizes: '34px',
  base: 68,
};

/**
 * `focus` decides HOW the 3:4 crop happens: 'center' lets lh3 crop server-side
 * (half the bytes), 'top'/'bottom' fetch the uncropped frame and crop in CSS,
 * because lh3 has no focal-point option and a centre crop of a landscape studio
 * shot can slice the head.
 */
export function faceHtml(m, shape) {
  const { cls, ratio, widths, sizes, base } = shape;
  const photo = m.photo_url || '';
  const focus = m.photo_focus || 'center';
  const inner = `<span class="${cls}-initials" aria-hidden="true">${escHtml(initials(m.name))}</span>`;
  if (!photo) return inner;
  const set = portraitSrcSet(photo, widths, focus, ratio);
  const pos = focusToObjectPosition(focus);
  return `${inner}<img class="${cls}-img" src="${escHtml(portraitSrc(photo, base, focus, ratio))}"${
    set ? ` srcset="${escHtml(set)}" sizes="${sizes}"` : ''
  } alt="" loading="lazy" decoding="async"${
    focus === 'center' ? '' : ` style="object-position:${pos}"`
  } />`;
}
