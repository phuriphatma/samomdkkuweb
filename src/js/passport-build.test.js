// ============================================================
// passport-build.test.js — passport must land at dist/passport/, and must not
// take the main app down with it.
//
// Since the 2026-09-04 repo merge `npm run build` is TWO vite passes: the main
// app into dist/, then passport into dist/passport/ using
// passport/vite.config.js. The second pass writes INSIDE the first one's output
// directory, which is a arrangement with exactly one catastrophic failure mode
// and several quiet ones. This pins the properties that keep it safe.
//
// It reads the CONFIG SOURCE rather than importing it: the config uses
// __dirname, which does not exist under vitest's ESM loader, so importing it
// would fail for a reason that has nothing to do with the thing being tested.
// It deliberately does NOT read dist/ — a test that only checks a built
// artifact passes vacuously on a clean checkout, which is the state CI starts in.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const CFG = readFileSync(join(ROOT, 'passport/vite.config.js'), 'utf8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('the passport build', () => {
  it('reads a config at all (a sweep that finds nothing must prove it looked)', () => {
    expect(CFG.length).toBeGreaterThan(400);
    expect(CFG).toContain('defineConfig');
  });

  it('⛔ never empties the output directory it shares with the main app', () => {
    expect(CFG, [
      'passport/vite.config.js must set `emptyOutDir: false`.',
      'It writes into dist/passport/, INSIDE the main build output. With',
      'emptyOutDir true (or absent, which vite may treat as "clean it"), the',
      'passport pass DELETES the app that was just built and the deploy',
      'publishes an empty site.',
    ].join('\n')).toMatch(/emptyOutDir:\s*false/);
  });

  it('writes to dist/passport, not over dist/', () => {
    expect(CFG, 'outDir must be ../dist/passport — anything else either misses the '
      + 'nginx root or lands on top of the main app').toMatch(/outDir:.*\.\.\/dist\/passport/);
  });

  it('is based at /passport/, which is what makes one origin work', () => {
    // If the base regresses to '/', every asset URL points at the site root and
    // 404s under /passport/ — the page loads with no CSS and no JS, which reads
    // as "passport is broken" rather than "the base is wrong".
    expect(CFG).toMatch(/base:\s*process\.env\.PASSPORT_BASE\s*\|\|\s*['"]\/passport\/['"]/);
  });

  it('builds all four entries — fixing one and leaving three is this repo\'s shape', () => {
    for (const entry of ['index.html', 'html/dashboard.html', 'html/admin.html', 'html/scan.html']) {
      expect(CFG, `passport/vite.config.js no longer builds ${entry}`).toContain(entry);
      expect(existsSync(join(ROOT, 'passport', entry)),
        `passport/${entry} is named by the config but missing from disk`).toBe(true);
    }
  });

  it('is actually invoked by the root build', () => {
    expect(PKG.scripts.build).toContain('build:passport');
    expect(PKG.scripts['build:passport']).toContain('passport/vite.config.js');
  });

  it('has no package.json of its own — one install, one dependency tree', () => {
    // Two lockfiles is how the two repos drifted. If this comes back, passport
    // can pin a different vite/supabase-js and diverge again inside one repo.
    expect(existsSync(join(ROOT, 'passport/package.json')),
      'passport/package.json is back — it builds against the ROOT dependencies now').toBe(false);
    expect(existsSync(join(ROOT, 'passport/package-lock.json'))).toBe(false);
  });

  it('the root still declares what passport imports', () => {
    // passport/js/app.js imports @supabase/supabase-js. With no package.json of
    // its own, the root is the only place that can provide it.
    const deps = { ...PKG.dependencies, ...PKG.devDependencies };
    expect(deps['@supabase/supabase-js'],
      'passport imports @supabase/supabase-js and nothing declares it').toBeTruthy();
    expect(deps.vite, 'both builds need vite').toBeTruthy();
  });
});
