// ============================================================
// env-ribbon.test.js — the ribbon appears on every non-production build and
// NEVER on production.
//
// The polarity is the whole test. docs/TEAM-WORKFLOW.md §1 describes the
// opposite default (production is the special case), which would paint
// "PREVIEW" across the live site the first time someone rebuilt the VM without
// the env var. Here an ABSENT var paints nothing, and the host check still
// catches every real preview.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ribbonLabel } from './env-ribbon.js';

describe('the non-production ribbon', () => {
  it('never appears on production, however it is reached', () => {
    // The var is absent on the VM build today. That must stay harmless.
    expect(ribbonLabel(undefined, 'samo.md.kku.ac.th')).toBe(null);
    expect(ribbonLabel('', 'samo.md.kku.ac.th')).toBe(null);
    expect(ribbonLabel('production', 'samo.md.kku.ac.th')).toBe(null);
    // Belt and braces: even if someone sets the var on the VM, 'production' wins.
    expect(ribbonLabel('production', 'samomdkkuweb.pages.dev')).toBe(null);
  });

  it('appears on a preview host even with no env var set', () => {
    // This is the signal that cannot be forgotten when a box is rebuilt.
    expect(ribbonLabel(undefined, '262aead8.samomdkkuweb.pages.dev')).toBe('PREVIEW');
    expect(ribbonLabel(undefined, 'anything.pages.dev')).toBe('PREVIEW');
  });

  it('appears when the env var names any non-production environment', () => {
    expect(ribbonLabel('preview', 'localhost')).toBe('PREVIEW');
    expect(ribbonLabel('staging', 'localhost')).toBe('STAGING');
  });

  it('stays quiet on a plain local dev server', () => {
    // A developer running `npm run dev` knows where they are; a permanent
    // banner there is noise that trains people to ignore the banner.
    expect(ribbonLabel(undefined, 'localhost')).toBe(null);
    expect(ribbonLabel(undefined, '127.0.0.1')).toBe(null);
  });

  it('survives a hostname it cannot parse', () => {
    expect(ribbonLabel(undefined, undefined)).toBe(null);
    expect(ribbonLabel(undefined, null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// WHAT A PREVIEW MAY CLAIM ABOUT THE DATA. Paid for on 2026-08-31.
//
// The Google-unavailable message on a preview told the user
// "ข้อมูลที่นี่ไม่ใช่ของจริง" — the data here is not real — while this module
// said the true thing (edits do not reach production) about the same idea. Two
// homes, one correct. `samo-dev` is an UNMASKED copy (D1), so the false version
// invites a reasonable person to screenshot or forward real student PII.
//
// The assertion is on the PROPERTY, swept across src/: no shipped string may
// tell anyone the data is not real. Asserting "auth.js imports the constant"
// alone would pass the moment someone writes the claim somewhere new.
// ---------------------------------------------------------------------------
describe('a preview never claims the data is fake', () => {
  const SRC = join(new URL('../../', import.meta.url).pathname, 'src');
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|html)$/.test(e.name) && !/\.test\.js$/.test(e.name)) files.push(p);
    }
  }(SRC));

  it('sweeps real files (a sweep that finds nothing must prove it looked)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('no shipped string says the data is not real', () => {
    // dev holds production data as it is — docs/TEAM-WORKFLOW.md D1.
    const bad = files.filter((f) => readFileSync(f, 'utf8').includes('ไม่ใช่ของจริง')
      && !readFileSync(f, 'utf8').includes('ไม่มีผลกับของจริง'));
    expect(bad.map((f) => f.replace(SRC, 'src')), [
      'A user-facing string claims the data is not real. It IS real: samo-dev is',
      'an unmasked copy of production (D1). Say what is actually true — that edits',
      'here do not reach production — using PREVIEW_SCOPE_NOTE from env-ribbon.js.',
    ].join('\n')).toEqual([]);
  });

  it('both messages read from the one constant', () => {
    const auth = readFileSync(join(SRC, 'js/auth.js'), 'utf8');
    expect(auth).toContain('PREVIEW_SCOPE_NOTE');
    const ribbon = readFileSync(join(SRC, 'js/env-ribbon.js'), 'utf8');
    expect(ribbon).toContain('${PREVIEW_SCOPE_NOTE}');
  });
});
