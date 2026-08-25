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

  it('a REPEAT failure stops offering the retry that already failed', () => {
    // The owner pressed โหลดใหม่ on an iPad and got the same bar back. The bar
    // was re-offering a fix that had just been proved not to work, which reads
    // as the fix being broken too. A reload only helps when the HTML named a
    // bundle that is gone; if `_r=` is already in the URL, it did not.
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).toMatch(/RETRIED\s*=\s*\/\[\?&\]_r=\//);
    expect(bar).toContain('if (!RETRIED)');
    expect(bar).toContain('ยังโหลดไม่สำเร็จ');
  });

  it('it captures WHY, not just THAT — the device has to be able to tell us', () => {
    // The first version knew only "did not boot", which is not actionable: it
    // cannot distinguish a 404 from a parse error from a module-scope throw,
    // and those need three different fixes.
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).toContain('unhandledrejection');     // a rejected top-level promise
    expect(bar).toMatch(/e\.message/);               // a thrown error
    expect(bar).toContain('script failed');          // a resource that never arrived
    // …and hands it over in one tap, with the two facts that identify the build
    // and the device.
    expect(bar).toContain('navigator.userAgent');
    expect(bar).toMatch(/bundle: /);
    expect(bar).toContain('คัดลอกรายละเอียด');
  });

  it('the diagnostic keeps the FILENAME, which is the whole point of it', () => {
    // It used to report `String(e.filename).split('/').pop()`. On a document URL
    // that returns the QUERY STRING and discards which file the error was in —
    // so the owner's report said "@?_r=1787676475017&…:74" and could not
    // distinguish an inline script from the bundle from a CDN script. The
    // basename trick is lossy exactly where it matters. Cost a full round trip.
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).not.toMatch(/e\.filename\)\.split\('\/'\)\.pop\(\)/);
    expect(bar).toContain('e.colno');
    expect(bar).toMatch(/e\.error && e\.error\.stack/);
  });

  it('it inventories the page\'s scripts, so an INJECTED one is visible', () => {
    // The reported SyntaxError pointed at the DOCUMENT while the served
    // document parses cleanly from here — which means something in the reader's
    // browser is changing the page. A list of what scripts are actually present
    // turns that from a theory into an observation.
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).toContain('function scriptInventory()');
    expect(bar).toContain("querySelectorAll('script')");
    expect(bar).toContain('scripts: ');
  });

  it('it names an EXTENSION when the page carries scripts we did not ship', () => {
    // Confirmed from a real report: an extension had appended five scripts
    // (one with a syntax error) and the stack named `webkit-masked-url://
    // hidden/`. "Did not load fully" is not actionable; "an extension is
    // injecting code, turn it off for this site" is.
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).toContain('function foreignScripts()');
    expect(bar).toContain('extension');
    expect(bar).toContain('Content Blocker');
    // Counted by IDENTIFYING ours, never by a hardcoded total — a fifth script
    // of our own would otherwise read as an injection.
    expect(bar).toContain("src.indexOf('/assets/') === 0");
    // MARKED, never sniffed: content-sniffing our own inline scripts reported
    // a false positive on a clean page, because the redirect script contains
    // `pages\.dev` escaped. An attribute we write cannot be wrong.
    expect(bar).toContain("hasAttribute('data-samo')");
    expect(H).toContain('<script data-samo="boot">');
    expect(H).toContain('<script data-samo="redirect">');
  });

  it('the retry does not stack `_r=` forever', () => {
    // Nine of them turned up in one report.
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).toMatch(/replace\(\/\[\?&\]_r=/);
  });

  it('the clipboard path has a fallback', () => {
    // navigator.clipboard is absent on older iOS in contexts the browser does
    // not consider secure-and-granted, and a copy button that silently does
    // nothing is the same class of bug this whole file exists for.
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).toContain('fallback');
    expect(bar).toContain('pre.select()');
  });

  it('a SLOW load is not a failed load — it waits for a DEFINITE signal', () => {
    // The first version fired on a bare 8-second timer. Measured on WebKit with
    // the bundle delayed 11 s and allowed to ARRIVE: the app booted fine and the
    // bar appeared anyway. On a phone with bad wifi that repeats on every load,
    // which is what the owner hit — and it made the retry button look broken.
    //
    // The definite signals are the script's own error event (it will never
    // arrive) and window `load` (every resource has settled, so a module that
    // still has not reported has errored or thrown). The timer is a backstop
    // for a `load` that never comes, not the primary trigger.
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).toMatch(/addEventListener\('load'/);
    expect(bar).toContain("document.readyState === 'complete'");
    // The backstop must be generous — a cold 3G load of the entry bundle is
    // seconds, not milliseconds.
    const hard = Number(/HARD\s*=\s*(\d+)/.exec(bar)?.[1]);
    expect(hard).toBeGreaterThanOrEqual(20000);
  });

  it('the warning is REVERSIBLE — a late boot takes it away', () => {
    // Nothing here may be a one-way door. The bar outliving a module that
    // simply arrived late is the same false alarm, just delayed, and no reload
    // can clear it because the next load repeats it.
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    expect(bar).toContain('function dismiss()');
    expect(bar).toMatch(/if \(booted\(\)\) \{ dismiss\(\); return; \}/);
    // …and the poll keeps running AFTER the bar is shown, or a late arrival
    // would never be noticed.
    expect(bar).toMatch(/tell\(\);\s*\n\s*if \(waited < GIVE_UP\) setTimeout\(check/);
  });

  it('it listens for the script error AND has a deadline', () => {
    const bar = H.slice(H.indexOf('__samoBooted'), H.indexOf('</script>', H.indexOf('__samoBooted')));
    // Two triggers because neither is reliable alone: some failures never fire
    // an error event, and a deadline alone leaves the reader waiting.
    expect(bar).toContain("addEventListener('error'");
    expect(bar).toContain('setTimeout(check');
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
