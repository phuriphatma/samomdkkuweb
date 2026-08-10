// ==============================================
// EVERY PORTRAIT UPLOAD NAMES THE PERSON, AND FALLS BACK WHEN IT CANNOT.
//
// REPORTED: "why somepeople got name like 00-พุธิตา สร้อยสุข.jpg,
// 00-วรภัทร จงชูวณิชย์.jpg … and some people got name like 00-member.jpg,
// 00-member.jpg".
//
// `uploadTeamPhoto(file, { name })` builds the Drive filename as
// `<order>-<safeFileName(name, 'member')>.<ext>`, so an empty `name` is not an
// error — it silently becomes the literal word "member", and the folder loses
// the one thing it exists for. `my-seat.js` passed `body.full_name`, which that
// file only assigns when at least one name box is non-empty; a legacy
// combined-name row (pre-0135, both boxes blank) therefore uploaded as
// "00-member.jpg" every single time. `team/index.js` had the fallback chain
// already — boxes, then the stored full_name, then the literal.
//
// THIS IS THE THIRD TIME THE PORTRAIT WRITERS HAVE DIVERGED. First the cleanup
// (`photoToRetire`, my-seat.js had none), then this. The rule that keeps being
// rediscovered is that there are FOUR call sites and they are edited one at a
// time, so a test is the only thing that makes the fourth one notice.
//
// WHAT IS ASSERTED, AND WHY IT IS SHAPED THIS WAY. Not "the name must be
// correct" — a static test cannot know that. What it can know is that the
// argument is not a single unguarded expression that can be undefined. A `||`
// chain (or a literal) is the evidence that somebody thought about the empty
// case. Same for `order`: a hardcoded 0 files every portrait as "00-" and was
// the reason EVERY example in that report started with 00-.
//
// Adding an uploadTeamPhoto call site fails this test until it does both.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new URL('.', import.meta.url);

function jsFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) jsFiles(u, out);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(u);
  }
  return out;
}

const rel = (u) => fileURLToPath(u).replace(/.*\/src\/js\//, '');

/** The `{ ... }` options object of each uploadTeamPhoto(...) call in a file. */
function callOptions(src) {
  const out = [];
  let i = 0;
  for (;;) {
    const at = src.indexOf('uploadTeamPhoto(', i);
    if (at === -1) break;
    i = at + 1;
    // Skip the declaration itself.
    if (/export\s+async\s+function\s+$/.test(src.slice(Math.max(0, at - 30), at))) continue;
    const brace = src.indexOf('{', at);
    if (brace === -1) continue;
    let depth = 0;
    let end = brace;
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}') { depth--; if (depth === 0) break; }
    }
    out.push(src.slice(brace, end + 1));
  }
  return out;
}

/** The raw text of one key's value inside an options object literal. */
function valueOf(opts, key) {
  const m = new RegExp(`(^|[,{\\s])${key}\\s*:`).exec(opts);
  if (!m) return null;
  let i = m.index + m[0].length;
  let depth = 0;
  let out = '';
  for (; i < opts.length; i++) {
    const c = opts[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    else if (c === ',' && depth === 0) break;
    out += c;
  }
  return out.trim();
}

const CALLS = jsFiles()
  .flatMap((u) => callOptions(readFileSync(u, 'utf8')).map((opts) => ({ file: rel(u), opts })));

describe('every uploadTeamPhoto call site', () => {
  it('has call sites to check at all (the instrument works)', () => {
    // A sweep that finds nothing is not evidence of nothing — mistakes.md #7.
    expect(CALLS.length).toBeGreaterThanOrEqual(3);
  });

  it('passes a `name`', () => {
    for (const { file, opts } of CALLS) {
      expect(valueOf(opts, 'name'), `${file}: uploadTeamPhoto without a name → "00-member"`)
        .toBeTruthy();
    }
  });

  it('guards `name` against being empty', () => {
    for (const { file, opts } of CALLS) {
      const v = valueOf(opts, 'name') || '';
      // Either a fallback chain, or a literal that cannot be empty.
      const guarded = v.includes('||') || v.includes('??') || /^['"`]/.test(v);
      expect(guarded, `${file}: name is \`${v}\` — one unguarded expression. `
        + 'If it is ever empty the file is filed as "00-member.jpg" and the person '
        + 'is unfindable in Drive. Add a `|| <stored name> || \'member\'` chain, '
        + 'as team/index.js and my-seat.js do.').toBe(true);
    }
  });

  it('does not hardcode `order` to a constant', () => {
    for (const { file, opts } of CALLS) {
      const v = valueOf(opts, 'order');
      if (v === null) continue;                 // absent → uploadTeamPhoto defaults
      expect(/^\d+$/.test(v),
        `${file}: order is the literal \`${v}\`, so every portrait from this `
        + 'surface is filed under the same numeric prefix and the prefix stops '
        + 'meaning anything. Pass the member\'s own position.').toBe(false);
    }
  });
});
