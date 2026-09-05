// Guards for the Vaultwarden mount at /vault/.
//
// These assert PROPERTIES, not a copy of the config — a guard written from the
// same list as the code passes a wrong list (.claude/rules/mistakes.md class 7).
// The property that matters: the subpath is stated in TWO homes (the nginx
// location and Vaultwarden's DOMAIN) and they must agree, because disagreement
// produces a web vault that LOADS while every API call 404s — which reads as a
// Vaultwarden bug, not a config drift.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const nginx = readFileSync(join(here, '../nginx-samo.conf'), 'utf8');
const envExample = readFileSync(join(here, 'vaultwarden.env.example'), 'utf8');

describe('vaultwarden nginx mount', () => {
  it('serves the vault at a location with a trailing slash', () => {
    expect(nginx).toMatch(/^\s*location \/vault\/ \{/m);
  });

  it('proxy_pass carries NO URI part — else the /vault prefix is stripped', () => {
    // `proxy_pass http://host;`  -> nginx forwards the ORIGINAL path (correct).
    // `proxy_pass http://host/;` -> nginx REPLACES /vault/ with / (breaks the API
    // while the web vault still loads, which is the confusing failure).
    const block = nginx.match(/location \/vault\/ \{[\s\S]*?\n {4}\}/);
    expect(block, 'no /vault/ location block found').toBeTruthy();
    const pass = block[0].match(/proxy_pass\s+(\S+);/);
    expect(pass, 'no proxy_pass in /vault/ block').toBeTruthy();
    expect(pass[1]).toMatch(/^http:\/\/[^/]+$/);
  });

  it('declares the websocket map at http level, outside the server block', () => {
    // A `map` inside `server {}` is a config error and nginx -t refuses to
    // start — so this catches it before it reaches the box that serves the app.
    const mapAt = nginx.indexOf('map $http_upgrade $connection_upgrade');
    const serverAt = nginx.indexOf('\nserver {');
    expect(mapAt, 'websocket map missing').toBeGreaterThan(-1);
    expect(mapAt).toBeLessThan(serverAt);
  });

  it('adds NO blanket Cache-Control — the app sets its own per route', () => {
    // The previous version of this test asserted the OPPOSITE: that the block
    // set `no-store`. It was written from the same idea as the code rather than
    // from the property that mattered, so it locked in the bug. nginx's
    // add_header APPENDS, so a blanket header does not replace Vaultwarden's
    // correct per-route ones — it produces two Cache-Control headers, the
    // browser takes the strictest, and the whole web vault re-downloads every
    // load.
    const block = nginx.match(/location \/vault\/ \{[\s\S]*?\n {4}\}/)[0];
    const directives = block
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    expect(directives).not.toMatch(/add_header\s+Cache-Control/i);
  });
});

describe('compression is actually configured, not just switched on', () => {
  // `gzip on` alone compresses text/html only, and nginx does not compress
  // PROXIED responses without gzip_proxied — so the vault, which is proxied,
  // stays raw however good the type list is. Both were missing and cost 8.26 MB
  // on a cold load. Assert the two directives that make `gzip on` mean anything.
  it('compresses javascript, not just html', () => {
    expect(nginx).toMatch(/gzip_types[\s\S]{0,400}application\/javascript/);
  });

  it('compresses proxied responses — /vault/ and /notify are proxied', () => {
    expect(nginx).toMatch(/^\s*gzip_proxied\s+\w+;/m);
  });
});

describe('vaultwarden DOMAIN agrees with the nginx mount', () => {
  it('DOMAIN carries the same subpath the nginx location serves', () => {
    const domain = envExample.match(/^DOMAIN=(\S+)/m);
    expect(domain, 'DOMAIN not set in vaultwarden.env.example').toBeTruthy();
    const path = new URL(domain[1]).pathname.replace(/\/+$/, '/');
    // The nginx location and Vaultwarden's own idea of its prefix are the two
    // homes of one fact. This is the assertion that fails when one moves.
    expect(nginx).toContain(`location ${path} {`);
  });
});

describe('vaultwarden access model', () => {
  it('self-registration is closed', () => {
    // The entire access model is "you are invited, you cannot walk in".
    expect(envExample).toMatch(/^SIGNUPS_ALLOWED=false$/m);
  });

  it('ships no real admin token or SMTP password', () => {
    // Assert on real ASSIGNMENTS, never the raw text. The file's comments
    // legitimately contain the string `$argon2id$` (they tell you what to
    // paste), and a guard that greps the whole file goes red on the
    // documentation it depends on — the mirror of confirm-modal.test.js
    // being satisfied by a comment.
    const assigned = Object.fromEntries(
      envExample
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    // Control: if the parse ever stops finding assignments, the emptiness must
    // fail rather than vacuously pass every check below.
    expect(Object.keys(assigned).length).toBeGreaterThan(5);
    expect(assigned.ADMIN_TOKEN).toBe('');
    expect(assigned.SMTP_PASSWORD).toBe('');
    for (const [k, v] of Object.entries(assigned)) {
      expect(v, `${k} looks like a real secret`).not.toMatch(/\$argon2|xkeysib-/);
    }
  });
});
