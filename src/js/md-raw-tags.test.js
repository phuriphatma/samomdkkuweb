// Guards the instrument AND sweeps docs/ with it. See md-raw-tags.js for why
// the fixtures below are the ones that matter.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findRawTags, findTornSpans, stripCodeAndLinks } from '../../tools/md-raw-tags.mjs';

const ROOT = join(import.meta.dirname, '..', '..');
const DOCS = join(ROOT, 'docs');

function mdFiles(dir = DOCS, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === '.vitepress' || n === 'node_modules') continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) mdFiles(f, out);
    else if (n.endsWith('.md')) out.push(f);
  }
  return out;
}

describe('the instrument itself', () => {
  it('finds a placeholder a renderer would delete (control)', () => {
    // The exact sentence GitHub was silently truncating. If this stops
    // matching, the sweep below is vacuous and reports green over the bug.
    const found = findRawTags('A full-screen "ย้ายไป <kkumail>" block.');
    expect(found.map((f) => f.text)).toEqual(['<kkumail>']);
  });

  it('does NOT flag a placeholder inside a multi-line inline code span', () => {
    // Miss #1. Reported 20 false hits across the bug write-ups, and acting on
    // them would have rewritten SQL in five files for no reason.
    const md = 'Run `alter table X add constraint X_<col>_fkey foreign key (<col>)\n'
      + 'references Y (id);` and then re-check.';
    expect(findRawTags(md)).toEqual([]);
  });

  it('does NOT flag a fenced block nested in a blockquote', () => {
    // Miss #2. A "fix" applied to one of these put stray backticks INSIDE a
    // code block in docs/state-archive/2026-08-27-state-split.md.
    const md = '> Re-check with:\n>\n> ```bash\n> git diff --stat <DEPLOYED-SHA>..HEAD -- src/\n> ```\n>\n> done.';
    expect(findRawTags(md)).toEqual([]);
  });

  it('leaves autolinks, link definitions and escaped placeholders alone', () => {
    expect(findRawTags('See <https://samo.md.kku.ac.th> for the live site.')).toEqual([]);
    expect(findRawTags('[image1]: <data:image/png;base64,AAAA>')).toEqual([]);
    expect(findRawTags('Paste your <AppID\\> into the form.')).toEqual([]);
  });

  it('keeps real HTML that the docs actually use', () => {
    expect(findRawTags('<img src="x.png" alt="y">')).toEqual([]);
    expect(findRawTags('<table><tr><td>a</td></tr></table>')).toEqual([]);
  });

  it('still flags an inline <svg> diagram — the tempting wrong fix', () => {
    // The first doc with a diagram makes this sweep go red, and the obvious
    // remedy is to add the SVG element names to RENDERED_HTML. That would be
    // wrong, and quietly: measured against GitHub's renderer on 2026-08-31
    // (`gh api -X POST /markdown`), an inline <svg> has its shell stripped and
    // its <text> children KEPT as a bare paragraph — the diagram becomes a
    // scatter of stray label words mid-prose. Allowlisting the tags would make
    // the instrument report green over exactly that.
    //
    // Diagrams go in docs/diagrams/*.svg and are referenced relatively;
    // docs/STEP-BY-STEP.md is the worked example. This fixture is what stops
    // the shortcut, so it asserts the CONSEQUENCE (the sweep still sees it),
    // not one spelling of the match.
    const md = '<svg viewBox="0 0 90 20">\n<rect x="1" y="1" width="88" height="18"/>\n'
      + '<text x="45" y="14">main</text>\n</svg>';
    expect(findRawTags(md).length,
      'inline SVG is no longer flagged — if RENDERED_HTML grew svg tags, revert it '
      + 'and put the diagram in docs/diagrams/ instead').toBeGreaterThan(0);
  });

  it('leaves a diagram REFERENCED as a file alone (the supported shape)', () => {
    // The control for the rule above: the sweep must not object to the thing it
    // is steering people towards, or the guidance is unusable.
    expect(findRawTags('![ภาพรวม](./diagrams/journey.svg)')).toEqual([]);
    expect(findTornSpans('![ภาพรวม](./diagrams/journey.svg)')).toEqual([]);
  });

  it('catches a code span torn in half by a line-leading HTML tag', () => {
    // The third miss, and the one findRawTags CANNOT see: it strips the span
    // the author intended, while the renderer never forms that span at all.
    // Verified against GitHub — it emits a literal backtick and an empty table.
    const md = 'never `select *` or `returns setof\n<table>`, so a future `alter table` widens it.';
    expect(findRawTags(md)).toEqual([]);                       // blind, by construction
    expect(findTornSpans(md).map((t) => t.line)).toEqual([2]);  // caught here instead
  });

  it('does not flag real HTML that carries no code span', () => {
    expect(findTornSpans('<img src="shot.png" alt="the panel">')).toEqual([]);
    expect(findTornSpans('```\n<table>`x`\n```')).toEqual([]);
  });

  it('strips a fence before an inline span, not after', () => {
    // Order matters: a lone backtick inside a fenced block would otherwise
    // open a span that swallows the rest of the file — the same shape as the
    // comment-stripping bug that blanked 13,839 characters (frontend-ui.md).
    const md = '```sh\necho "it\'s fine"\n```\n\nThen <handle> is raw.';
    expect(stripCodeAndLinks(md)).toMatch(/Then <handle> is raw\./);
    expect(findRawTags(md).map((f) => f.text)).toEqual(['<handle>']);
  });
});

describe('docs/ contains no placeholder a renderer would eat', () => {
  const files = mdFiles();

  it('finds files to sweep at all', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const f of files) {
    const rel = relative(ROOT, f);
    it(rel, () => {
      const text = readFileSync(f, 'utf8');
      const hits = findRawTags(text);
      expect(hits, `${rel} — wrap these in backticks; GitHub deletes them and `
        + `VitePress refuses to build: ${JSON.stringify(hits)}`).toEqual([]);
      const torn = findTornSpans(text);
      expect(torn, `${rel} — a code span is broken by a line-leading HTML tag; `
        + `keep the span on one line: ${JSON.stringify(torn)}`).toEqual([]);
    });
  }
});
