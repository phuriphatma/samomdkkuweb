// ============================================================
// dev-server-join.test.js — one `npm run dev`, one address, both apps.
//
// Until 2026-09-04 `npm run dev` served the portal only, and /passport/
// answered 200 with the PORTAL'S OWN HTML: the wrong app wearing the right URL,
// with no error anywhere. Anyone sent to fix something in Passport opened
// /passport/ and saw the portal. The merge had joined the two apps at BUILD
// time only, so development disagreed with production about a URL people use.
//
// This pins the pieces that make them agree. It cannot start a server, so it
// asserts the WIRING — the four things that, if any one is removed, silently
// restore the old behaviour.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const CFG = readFileSync(join(ROOT, 'vite.config.js'), 'utf8');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('the development server serves both apps', () => {
  it('`npm run dev` starts both, not just the portal', () => {
    expect(PKG.scripts.dev, '`npm run dev` no longer starts the pair — /passport/ '
      + 'would fall back to the portal with no error').toContain('dev-all');
    expect(existsSync(join(ROOT, 'tools/dev-all.mjs'))).toBe(true);
  });

  it('keeps a way to run each alone', () => {
    expect(PKG.scripts['dev:web']).toBeTruthy();
    expect(PKG.scripts['dev:passport']).toBeTruthy();
  });

  it('proxies /passport to the passport dev server', () => {
    expect(CFG, 'the /passport proxy is gone').toMatch(/proxy:[\s\S]{0,200}'\/passport'/);
    expect(CFG, 'the proxy must target passport\'s dev port').toMatch(/localhost:5173/);
  });

  it('normalises directory and extensionless URLs BEFORE the SPA fallback', () => {
    // The proxy alone is not enough and this is the part that looks redundant:
    // Vite's history fallback claims anything ending in "/" and rewrites it to
    // the root index.html before the proxy sees it. Assets have an extension so
    // they were never claimed — which is why "the proxy works" was true while
    // /passport/ still showed the portal.
    // ⚠️ Assert it is REGISTERED, not merely defined. The first version of this
    // test checked that the string 'samo-passport-dir-index' appeared anywhere
    // in the file — so deleting it from the plugins array left the definition
    // behind and the test passed while /passport/ served the portal again.
    // Caught by reintroducing the bug, which is the only reason it is not still
    // written that way.
    expect(CFG, 'the pre-middleware is defined but no longer in `plugins:` — it will '
      + 'never run, and /passport/ silently serves the PORTAL again')
      .toMatch(/plugins:\s*\[[^\]]*passportDirIndex/);
    expect(CFG, 'the plugin definition itself is gone').toContain('samo-passport-dir-index');
    expect(CFG, 'extensionless deep links like /passport/html/dashboard must get .html, '
      + 'the same rule nginx applies in production').toMatch(/\$\{path\}\.html/);
  });

  it('never rewrites Vite internals — that breaks HMR with no obvious cause', () => {
    expect(CFG).toMatch(/\/@/);
    expect(CFG).toContain('node_modules/');
  });
});
