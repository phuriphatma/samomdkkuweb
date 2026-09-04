// ============================================================
// qr-compat.test.js — a printed QR poster cannot be re-pointed.
//
// passport/js/admin-page.js builds a poster URL from the admin's own origin:
//     `${window.location.origin}${ROUTES.SCAN}?aid=…&tk=…`
// and that string is then printed onto paper and stuck to a wall. Measured
// 2026-09-04: 31 of 38 activities (82%) carry posters whose URL names the
// retired Cloudflare host, with 94 scans in the preceding 30 days.
//
// So the scan ROUTE and the redirect that rescues old hosts are not ordinary
// code — they are a contract with physical objects nobody can recall. This
// file is the tripwire for changes that would quietly break them. Every failure
// here looks the same to a student: they scan, a page opens, and no points
// arrive. No error, nothing to report.
//
// Full context and the retirement plan: docs/PASSPORT-MONOREPO.md §3.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const ROUTES = readFileSync(join(ROOT, 'passport/js/routes.js'), 'utf8');
const SCAN_HTML = readFileSync(join(ROOT, 'passport/html/scan.html'), 'utf8');
const ADMIN_JS = readFileSync(join(ROOT, 'passport/js/admin-page.js'), 'utf8');

describe('printed QR posters keep working', () => {
  it('read the sources (a sweep that finds nothing must prove it looked)', () => {
    expect(ROUTES).toContain('ROUTES');
    expect(SCAN_HTML).toContain('location.hostname');
    expect(ADMIN_JS).toContain('currentQrUrl');
  });

  it('the scan route is still html/scan.html — the path burned into 31 posters', () => {
    expect(ROUTES, [
      'ROUTES.SCAN no longer resolves to html/scan.html.',
      'That path is printed inside every QR poster already on a wall. Moving it',
      'does not break the build, does not break a link anywhere in the app, and',
      'silently kills every existing poster. If it genuinely must move, keep a',
      'redirect at the old path and re-print the posters listed in',
      'docs/PASSPORT-MONOREPO.md §3 first.',
    ].join('\n')).toMatch(/SCAN:\s*BASE\s*\+\s*['"]html\/scan\.html['"]/);
  });

  it('the poster URL is still built from origin + ROUTES.SCAN + aid & tk', () => {
    // If the query parameter names change, stamp_scan gets nulls and raises
    // INVALID_TOKEN — every old poster starts failing at once.
    expect(ADMIN_JS).toMatch(/\$\{window\.location\.origin\}\$\{ROUTES\.SCAN\}\?aid=/);
    expect(ADMIN_JS).toContain('&tk=');
  });

  it('re-printing REUSES the token, so an old poster is never invalidated', () => {
    // generateStaticQR must only mint a token when one is absent. If it ever
    // rotates on every render, re-printing a poster silently kills the copies
    // already on walls — and re-printing is the migration path in §3.
    const fn = ADMIN_JS.slice(ADMIN_JS.indexOf('async function generateStaticQR'));
    expect(fn.slice(0, 1200), [
      'generateStaticQR no longer guards token creation with `if (!staticToken)`.',
      'Rotating the token on every poster render invalidates every copy already',
      'printed — and makes the re-print migration in §3 destructive instead of safe.',
    ].join('\n')).toMatch(/if\s*\(\s*!\s*staticToken\s*\)/);
  });

  it('a scan on a retired host goes STRAIGHT to the VM, never to the splash', () => {
    // scan.html is transactional: an interstitial with a countdown loses the
    // scan. The other three entries correctly use /moved.html; this one must not.
    const guard = SCAN_HTML.slice(SCAN_HTML.indexOf('location.hostname'), SCAN_HTML.indexOf('</script>'));
    expect(guard, 'scan.html forwards to the /moved.html splash — a scan is an action, '
      + 'not a bookmark, and the interstitial loses it').not.toContain('moved.html');
    expect(guard, 'scan.html no longer forwards to the production VM').toContain('samo.md.kku.ac.th/passport');
  });

  it('a scan refused for a CLOSED season says so, in Thai, and does not read as broken', () => {
    // 0180 made an activity's QR stop working when its quarter ends. That is the
    // one refusal here that is nobody's mistake and cannot be fixed by the
    // student, so it must not fall through to the generic "System Error:
    // <postgres message>" branch — which would read as a broken QR and send them
    // to ask IT about a working system.
    const SCAN = readFileSync(join(ROOT, 'passport/js/scanning.js'), 'utf8');
    expect(SCAN, 'scanning.js does not handle SEASON_CLOSED — a student whose QR '
      + 'expired would see a raw database error').toContain('SEASON_CLOSED');
    expect(SCAN, 'NO_OPEN_SEASON is unhandled — that happens during a rollover gap')
      .toContain('NO_OPEN_SEASON');
    // The message must say the km already earned is safe. Losing points is the
    // first thing a student will assume, and it is not what happened.
    const i = SCAN.indexOf('SEASON_CLOSED');
    expect(SCAN.slice(i, i + 700), 'the SEASON_CLOSED message must reassure that '
      + 'previously-earned km are unaffected').toMatch(/ยังอยู่ครบ|ไม่ได้หายไป/);
  });

  it('the forward PRESERVES the query string — aid and tk are the whole payload', () => {
    const guard = SCAN_HTML.slice(SCAN_HTML.indexOf('location.hostname'), SCAN_HTML.indexOf('</script>'));
    expect(guard, [
      'The retired-host forward drops location.search.',
      'aid and tk live there, so the scan page opens with no activity and no token:',
      'the student sees a page, not an error, and no points are awarded.',
    ].join('\n')).toContain('location.search');
  });
});
