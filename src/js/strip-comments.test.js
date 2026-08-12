// strip-comments.test.js — the instrument the other guards read through.
//
// Four ratchets used to carry their own `/\/\*[\s\S]*?\*\//` and every one of
// them was blind wherever a source file contained `'image/*'`: the "comment"
// opened inside the string and ran to the next `*​/` in the file. This file
// exists because a shared instrument is a single point of failure for every
// guard that reads through it — if this is wrong, they all report green.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './strip-comments.js';

describe('stripComments — the bug that motivated it', () => {
  it('does not treat `image/*` in a string as a comment opener', () => {
    const src = [
      "input.accept = 'image/*';",
      'window.samoShowSigninScreen = pick;',
      '/* a real comment */',
      'const after = 1;',
    ].join('\n');
    const out = stripComments(src);
    expect(out).toContain('window.samoShowSigninScreen');
    expect(out).toContain('const after = 1;');
    expect(out).not.toContain('a real comment');
  });

  it('does not let an apostrophe in a comment swallow the next line', () => {
    // "don't" inside a line comment opened a string for a naive stripper.
    const src = ["// don't do this", "confirm('really?');"].join('\n');
    const out = stripComments(src);
    expect(out).toContain('confirm(');
    expect(out).not.toContain('do this');
  });
});

describe('stripComments — comments go, code stays', () => {
  it('removes block and line comments', () => {
    expect(stripComments('a; /* x */ b;')).not.toContain('x');
    expect(stripComments('a; // x\nb;')).not.toContain('x');
    expect(stripComments('a; // x\nb;')).toContain('b;');
  });

  it('leaves comment-looking text inside strings alone', () => {
    expect(stripComments("const u = 'https://a.example/b';")).toContain('https://a.example/b');
    expect(stripComments('const s = "/* not a comment */";')).toContain('not a comment');
  });

  it('does not read `/*` inside a regex literal as a comment', () => {
    const src = 'const re = /[/*]/; const after = 1;';
    expect(stripComments(src)).toContain('const after = 1;');
  });

  it('preserves line numbers, so a reported offset still points at the source', () => {
    const src = 'a;\n/* two\nlines */\nb;';
    expect(stripComments(src).split('\n').length).toBe(src.split('\n').length);
  });

  it('blanks string CONTENTS on request but keeps the quotes', () => {
    const out = stripComments("alert('confirm(');", { keepStrings: false });
    expect(out).toContain('alert(');
    expect(out).not.toContain("confirm('");
  });
});

describe('stripComments — against every module in the repo', () => {
  // RECURSIVE. The first version of this test read the top level only, so
  // `house/my-house.js` — the file whose multi-line template put the scanner
  // out of phase — was never in the sample.
  const SRC = new URL('.', import.meta.url).pathname;
  const files = [];
  (function walk(dir, prefix = '') {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${prefix}${e.name}/`);
      else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) {
        files.push([`${prefix}${e.name}`, join(dir, e.name)]);
      }
    }
  }(SRC));

  it('has a sample worth testing, including the phase-error file (the control)', () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files.map(([name]) => name)).toContain('house/my-house.js');
    // If the `image/*` literal ever leaves the repo, the motivating hazard is
    // gone and these tests are guarding a museum piece — say so out loud.
    const carriers = files.filter(([, p]) => readFileSync(p, 'utf8').includes("'image/*'"));
    expect(carriers.length).toBeGreaterThan(0);
  });

  it('leaves NO comment marker behind — the property a phase error violates', () => {
    // With strings blanked, a correct scan cannot leave `/*`, `*/` or `//`
    // anywhere: comments are gone and string contents are spaces. When the
    // scanner loses phase it starts treating comments as string content and
    // they survive verbatim — which is exactly how the template-interpolation
    // bug showed itself.
    //
    // Regex literals are blanked too, because a PATTERN can legitimately
    // contain `*​/` — `/^บรรทัด \d+:\s*/` in house/index.js does — and that is
    // a false positive, which is the thing that gets a guard switched off.
    for (const [name, path] of files) {
      const out = stripComments(readFileSync(path, 'utf8'),
        { keepStrings: false, keepRegex: false });
      expect(out.includes('/*'), `${name}: block comment survived the strip`).toBe(false);
      expect(out.includes('*/'), `${name}: block comment survived the strip`).toBe(false);
      expect(out.includes('//'), `${name}: line comment survived the strip`).toBe(false);
    }
  });

  it('never changes a line that has no comment on it', () => {
    for (const [name, path] of files) {
      const raw = readFileSync(path, 'utf8');
      const out = stripComments(raw);
      expect(out.length, `${name} changed length`).toBe(raw.length);
      const rawLines = raw.split('\n');
      const outLines = out.split('\n');
      rawLines.forEach((line, i) => {
        const t = line.trim();
        if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
        if (t.includes('//') || t.includes('/*') || t.includes('*/')) return;
        expect(outLines[i], `${name}:${i + 1}`).toBe(line);
      });
    }
  });
});
