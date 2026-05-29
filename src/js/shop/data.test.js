// Pure-function tests for shop/data.js.

import { describe, it, expect } from 'vitest';
import { sanitizeOrderCode, genOrderId, STAGES_META, ISSUE_STATUSES } from './data.js';

describe('sanitizeOrderCode', () => {
  it('uppercases + strips non-alnum + caps at 5', () => {
    expect(sanitizeOrderCode('sh')).toBe('SH');
    expect(sanitizeOrderCode('Sh-01!')).toBe('SH01');
    expect(sanitizeOrderCode('Polo123456')).toBe('POLO1');
    expect(sanitizeOrderCode('   ')).toBe('SH');
    expect(sanitizeOrderCode('!@#$')).toBe('SH');
  });

  it('falls back to "SH" for null / undefined / empty', () => {
    expect(sanitizeOrderCode(null)).toBe('SH');
    expect(sanitizeOrderCode(undefined)).toBe('SH');
    expect(sanitizeOrderCode('')).toBe('SH');
  });
});

describe('genOrderId', () => {
  it('uses the supplied code as prefix', () => {
    for (let i = 0; i < 50; i++) {
      const id = genOrderId('TS');
      expect(id.startsWith('TS')).toBe(true);
      expect(id).toMatch(/^TS\d{4}$/);
    }
  });

  it('falls back to "SH" when no code is supplied', () => {
    expect(genOrderId()).toMatch(/^SH\d{4}$/);
    expect(genOrderId('')).toMatch(/^SH\d{4}$/);
    expect(genOrderId(null)).toMatch(/^SH\d{4}$/);
  });

  it('emits a 4-digit suffix (no leading 0; range 1000..9999)', () => {
    for (let i = 0; i < 50; i++) {
      const id = genOrderId('SH');
      const n = Number(id.slice(2));
      expect(n).toBeGreaterThanOrEqual(1000);
      expect(n).toBeLessThanOrEqual(9999);
    }
  });

  it('sanitises bad codes the same way sanitizeOrderCode does', () => {
    expect(genOrderId('sh!@#')).toMatch(/^SH\d{4}$/);
    expect(genOrderId('Polo123456')).toMatch(/^POLO1\d{4}$/);
  });
});

describe('STAGES_META + ISSUE_STATUSES', () => {
  it('every entry tagged issue:true is listed in ISSUE_STATUSES (single source of truth)', () => {
    const tagged = Object.entries(STAGES_META)
      .filter(([, m]) => m.issue)
      .map(([k]) => k);
    expect(ISSUE_STATUSES).toEqual(tagged);
  });

  it('every issue status carries a tone for chip colouring', () => {
    for (const s of ISSUE_STATUSES) {
      expect(STAGES_META[s].tone).toBeTruthy();
      expect(['warning', 'info', 'neutral', 'danger']).toContain(STAGES_META[s].tone);
    }
  });
});
