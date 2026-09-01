// ============================================================
// embed-fs.mjs — read a ฝ่าย tool folder off disk.
//
// Its own file because BOTH the CLI (tools/check-embeds.mjs) and the CI test
// (src/js/tool-frame.test.js) need it, and importing the CLI from a test runs
// the CLI — `process.exit(0)` inside a Vitest worker fails the whole file.
// It is under tools/ rather than src/ because it imports node:fs, which has no
// business anywhere the browser bundle can reach.
// ============================================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read a tool folder into { 'relative/name': contents }, at ANY DEPTH.
 *
 * ⚠️ Depth matters: the boundary check permits `public/embed/<slug>/**`, so a
 * scanner that only read the top level would leave `img/evil.js` permitted and
 * unexamined — a blind spot exactly the shape of the permission. Binary assets
 * are skipped by extension; they are not code and reading them as UTF-8 would
 * produce garbage for the regexes to match on.
 */
const BINARY = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|pdf|mp4|webm|zip)$/i;

export function readEmbedFolder(dir, prefix = '') {
  const files = {};
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      Object.assign(files, readEmbedFolder(full, rel));
    } else if (!BINARY.test(entry)) {
      files[rel] = readFileSync(full, 'utf8');
    }
  }
  return files;
}
