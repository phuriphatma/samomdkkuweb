// ============================================================
// boot-watchdog.test.js — the app must not be able to die silently.
//
// REPORTED from an iPad: *"i press สร้างบัญชีและเข้าสู่ระบบด้วย google and
// button do nothing, like when i click on อุปบริหาร on ฝ่าย it also do nothing
// on safari, but on google app it works"*.
//
// Reproduced on WebKit at iPad size by 404ing the entry module. Bootstrap is a
// classic <script> from a CDN and keeps working, so every menu still opens;
// ~90 controls in src/html are inline `onclick="someGlobal(...)"` against
// globals the module defines, so all ninety die at once — with nothing on
// screen saying so.
//
// The watchdog is the only thing standing between that and a person concluding
// the site is broken. It has two halves in two files, and either half alone is
// useless, which is exactly the shape that rots.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from './strip-comments.js';

const html = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const js = (p) => stripComments(readFileSync(new URL(p, import.meta.url), 'utf8'));

const ENTRIES = [
  ['../../index.html', './main.js', 'public'],
  ['../../admin/index.html', './admin-main.js', 'admin'],
];

describe.each(ENTRIES)('%s boots visibly or complains', (page, mod, name) => {
  const H = html(page);
  const M = js(mod);

  it('the watchdog is a CLASSIC script, not a module', () => {
    // The whole point: it has to run in the world where the module does not.
    // A `type="module"` watchdog would die of the same cause it exists to
    // report, which is the "its CONTROL finds nothing either" failure.
    const i = H.indexOf('__samoBooted');
    expect(i, `${name}: no watchdog`).toBeGreaterThan(-1);
    const open = H.lastIndexOf('<script', i);
    expect(H.slice(open, i)).not.toContain('type="module"');
  });

  it('it runs BEFORE the entry module is requested', () => {
    // Otherwise the module error event fires before anyone is listening.
    expect(H.indexOf('__samoBooted')).toBeLessThan(H.indexOf('type="module"'));
  });

  it('the module clears the flag, and only AFTER its imports', () => {
    // After the imports on purpose: a module that fails to load a DEPENDENCY is
    // just as dead as one that 404s, and must report the same way.
    const set = M.indexOf('__samoBooted = true');
    expect(set, `${name}: module never reports booting`).toBeGreaterThan(-1);
    const lastImport = M.lastIndexOf('\nimport ');
    expect(set).toBeGreaterThan(lastImport);
  });

  it('the reader is told in Thai, and given an action', () => {
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).toMatch(/โหลด/);
    expect(bar).toContain('โหลดใหม่');
  });

  it('the retry BUSTS THE CACHE rather than reloading', () => {
    // location.reload() on iOS can re-serve the very HTML that named the
    // missing bundle, which would make the button appear to do nothing — the
    // same symptom, now on the fix.
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).toContain('_r=');
    expect(bar).not.toMatch(/location\.reload\(\)/);
  });

  it('it listens for the script error AND has a deadline', () => {
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    // Two triggers because neither is reliable alone: some failures never fire
    // an error event, and a deadline alone leaves the reader waiting.
    expect(bar).toContain("addEventListener('error'");
    expect(bar).toContain('setTimeout(tell');
  });
});

describe('why the watchdog is load-bearing', () => {
  it('the partials really do depend on module globals via inline onclick', () => {
    // If this ever drops to zero the app has stopped being able to fail this
    // way and the watchdog could be reconsidered. Until then it is ~90 controls.
    const all = ['tab-home.html', 'navbar.html', 'modal-signin.html']
      .map((f) => readFileSync(new URL(`../html/${f}`, import.meta.url), 'utf8')).join('');
    expect((all.match(/onclick="/g) || []).length).toBeGreaterThan(5);
  });
});
