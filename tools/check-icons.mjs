#!/usr/bin/env node
// ==============================================
// check-icons.mjs — every `bi-*` class in the repo must exist in the
// bootstrap-icons version this app actually loads.
//
//   npm run check:icons
//
// WHY THIS EXISTS
// A Bootstrap icon name that does not exist renders as NOTHING — an empty box,
// no console error, no failed request, because the glyph is just a missing
// codepoint in a font that loaded fine. So a typo, or (much more often) an icon
// added in a LATER bootstrap-icons release than the one pinned in index.html,
// ships silently and is only caught by someone happening to look at that pixel.
//
// Found three live instances on its first run, one of them months old:
//   bi-passport / bi-passport-fill  (added in 1.11; we pin 1.10.5)
//   bi-envelope-arrow-up            (added in 1.11)
//
// NOT part of `npm test` on purpose: it fetches the pinned stylesheet over the
// network, and a unit-test suite that needs the internet is a suite that fails
// on a plane. Run it when adding icons, and in CI if that is ever wired up.
// ==============================================

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The version is read from index.html rather than hardcoded, so bumping the CDN
// link is enough and this file never becomes the stale one.
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const m = /bootstrap-icons@([\d.]+)\/font\/bootstrap-icons\.css/.exec(html);
if (!m) {
  console.error('could not find the bootstrap-icons <link> in index.html');
  process.exit(1);
}
const version = m[1];
const url = `https://cdn.jsdelivr.net/npm/bootstrap-icons@${version}/font/bootstrap-icons.css`;

const css = await fetch(url).then((r) => {
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
});
const known = new Set([...css.matchAll(/\.(bi-[a-z0-9-]+)::before/g)].map((x) => x[1]));

/**
 * Strip comments before scanning.
 *
 * Without this the tool flags its own documentation: `projects/data.js` carries
 * a comment naming `bi-send-arrow-up-fill` precisely to record that it does not
 * exist in 1.10.5. A checker that punishes you for writing down the bug it
 * found is a checker people turn off.
 */
function stripComments(text, file) {
  if (file.endsWith('.html')) return text.replace(/<!--[\s\S]*?-->/g, ' ');
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // block
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 '); // line (the [^:] keeps https:// intact)
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', 'coverage'].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

const bad = new Map();
for (const file of walk(ROOT)) {
  const text = stripComments(readFileSync(file, 'utf8'), file);
  for (const hit of text.matchAll(/\bbi-[a-z0-9-]+/g)) {
    const name = hit[0];
    // `bi-chevron-${dir}` and friends: a template hole leaves a trailing dash,
    // and the real name is only known at runtime. Skip rather than false-alarm.
    if (name.endsWith('-')) continue;
    if (known.has(name)) continue;
    if (!bad.has(name)) bad.set(name, new Set());
    bad.get(name).add(file.replace(`${ROOT}/`, ''));
  }
}

console.log(`bootstrap-icons@${version} — ${known.size} icons available`);

if (!bad.size) {
  console.log('ok — every bi-* class in the repo exists');
  process.exit(0);
}

console.error(`\n${bad.size} icon name(s) do not exist and will render as an empty box:\n`);
for (const [name, files] of bad) console.error(`  ${name}\n      ${[...files].join('\n      ')}`);
console.error(`\nEither pick a name that exists in ${version}, or bump the CDN link in index.html`);
console.error('(and admin/index.html) — but check the rest of the app still renders after a bump.\n');
process.exit(1);
