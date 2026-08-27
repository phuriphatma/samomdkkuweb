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
