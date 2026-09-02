// ==============================================
// THE VISUAL EDITOR IS ADMIN-ONLY, LAZY, AND ITS OUTPUT IS SELF-CONTAINED.
//
// GrapesJS is 1.15 MB (measured from the build). Three properties keep that
// affordable, and every one of them is easy to lose in a refactor that looks
// harmless:
//
//   1. it is reached only from a dynamic import, so nobody downloads it before
//      pressing the button;
//   2. it never enters the PUBLIC entry, which is what a student's phone loads;
//   3. its output carries its own CSS, because the sandboxed frame it lands in
//      is a BLANK document — no Bootstrap, no site stylesheet, no fonts.
//
// (3) is the one that would have shipped broken. A block built from Bootstrap
// classes looks perfect in the editor — which is inside the styled admin page —
// and completely unstyled on the real ฝ่าย page, and only a screenshot of the
// PUBLIC page would ever show it.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { wrapDocument, unwrapDocument, BLOCKS } from './dept-visual-editor.js';

const ROOT = join(import.meta.dirname, '..', '..');
const SRC = readFileSync(join(ROOT, 'src', 'js', 'dept-visual-editor.js'), 'utf8');
const ADMIN = readFileSync(join(ROOT, 'src', 'js', 'dept-page-admin.js'), 'utf8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('the 1.15 MB stays where it belongs', () => {
  it('grapesjs is reached ONLY through a dynamic import', () => {
    // A static `import grapesjs from 'grapesjs'` anywhere folds it into
    // whichever entry bundle imports that module — silently, with no error.
    expect(SRC, 'grapesjs is imported statically — it would enter a bundle')
      .not.toMatch(/^import .* from ['"]grapesjs/m);
    expect(SRC).toMatch(/import\(\s*['"]grapesjs['"]\s*\)/);
  });

  it('its CSS is dynamic too', () => {
    // A static CSS import is extracted into the entry's stylesheet, so the
    // 60 KB would ship to everyone even though the JS did not.
    expect(SRC).toMatch(/import\(\s*['"]grapesjs\/dist\/css/);
  });

  it('is pinned to an exact version — it is pre-1.0', () => {
    expect(PKG.dependencies.grapesjs, 'grapesjs is on a floating range; its API '
      + 'moves between 0.x minors').toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is imported by the ADMIN surface only, never a public module', () => {
    const importers = readdirSync(join(ROOT, 'src', 'js'))
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .filter((f) => f !== 'dept-visual-editor.js')
      .filter((f) => /from '\.\/dept-visual-editor\.js'/
        .test(readFileSync(join(ROOT, 'src', 'js', f), 'utf8')));
    expect(importers.sort(), 'a module outside the หน้าฝ่าย editor imports the '
      + 'visual editor — check it is not on a public path')
      .toEqual(['dept-page-admin.js']);
  });
});

describe('the output survives a BLANK document', () => {
  it('carries its own <style>, because the sandbox has no stylesheet', () => {
    const out = wrapDocument('<p>hi</p>', '');
    expect(out).toMatch(/<style>/);
    expect(out, 'no font is declared, so Thai falls back to a serif default')
      .toMatch(/Noto Sans Thai/);
  });

  it('reports its height from BODY, never documentElement', () => {
    // Inside an iframe `documentElement` IS the frame, so measuring it asks the
    // host how tall the host made it and the block can never shrink. That bug
    // already shipped once on the tool frame.
    expect(SRC).toMatch(/document\.body\.getBoundingClientRect/);
    expect(SRC, 'it measures documentElement — the frame can never shrink')
      .not.toMatch(/documentElement\.scrollHeight/);
    expect(wrapDocument('<p>hi</p>', '')).toMatch(/samo-embed-height/);
  });

  it('round-trips: what it wraps, it can unwrap', () => {
    // Otherwise re-opening the editor shows the wrapper as content, and each
    // open nests another copy of the base stylesheet inside the last.
    const authored = '<p>สวัสดี</p>';
    const back = unwrapDocument(wrapDocument(authored, ''));
    expect(back).toBe(authored);
  });

  it('leaves hand-written HTML alone', () => {
    // The PR road and the GUI road share one column. A block this editor did
    // not write must come back byte-for-byte, or opening the editor on someone
    // else's markup would eat their <style>.
    const hand = '<style>.a{color:red}</style><div class="a">มือเขียน</div>';
    expect(unwrapDocument(hand)).toBe(hand);
  });
});

describe('the blocks cannot produce a laptop-only layout', () => {
  it('has blocks at all (control)', () => {
    expect(BLOCKS.length).toBeGreaterThan(4);
  });

  it('uses no media query — columns stack by flex-wrap', () => {
    // A breakpoint is a thing a non-designer gets wrong. `flex: 1 1 260px`
    // wraps on its own when there is no room, with nothing to configure.
    const html = BLOCKS.map((b) => (typeof b.content === 'string' ? b.content : '')).join('');
    expect(html, 'a block carries a media query').not.toMatch(/@media/);
    expect(html, 'no block declares a wrapping flex basis, so columns would be '
      + 'fixed and overflow a phone').toMatch(/flex:\s*1 1 \d+px/);
    expect(html).toMatch(/flex-wrap:\s*wrap/);
  });

  it('styles inline, never with Bootstrap classes', () => {
    // Bootstrap does not exist in the sandboxed frame. A `class="row"` block
    // looks right in this editor and unstyled on the real page.
    const html = BLOCKS.map((b) => (typeof b.content === 'string' ? b.content : '')).join('');
    for (const cls of ['class="row"', 'class="col', 'class="btn', 'class="card']) {
      expect(html, `a block uses ${cls} — Bootstrap is not loaded in the frame`)
        .not.toContain(cls);
    }
  });
});

describe('it adds no second way to save', () => {
  it('performs no database write of its own', () => {
    // The whole point of the spike's shape: it writes into the textarea and the
    // existing บันทึก path persists it. A write here would be a second writer
    // to one row — the drift class this repo pays for most.
    expect(SRC, 'the visual editor writes to the database directly')
      .not.toMatch(/dbRest|supabase/);
  });

  it('the caller puts the result in the textarea the save path already reads', () => {
    expect(ADMIN).toMatch(/data-dpa-field="html"/);
    const handler = ADMIN.slice(ADMIN.indexOf("data-dpa-visual]"));
    expect(handler.slice(0, 900)).toMatch(/ta\.value = html/);
  });

  it('never autosaves into localStorage', () => {
    // GrapesJS defaults to a localStorage StorageManager, which would make the
    // editor's idea of the page outlive and silently override the database.
    expect(SRC).toMatch(/storageManager:\s*false/);
  });

  it('opens on the PHONE width, because that is most of the traffic', () => {
    // GrapesJS opens on the first device in the list, so the order is the rule.
    const dm = SRC.slice(SRC.indexOf('deviceManager'));
    const first = dm.slice(0, dm.indexOf(']'));
    expect(first.indexOf("id: 'mobile'"), 'the editor no longer opens at phone width')
      .toBeLessThan(first.indexOf("id: 'desktop'"));
  });
});
