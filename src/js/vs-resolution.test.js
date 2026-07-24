// Pure-function tests for the shared VS resolution vocab (migration 0073).
//
// Locks the close-reason set so the DB CHECK constraint
// (vs_tickets_resolution_check) and the UI stay in sync — every key here must
// exist in that constraint, and every reason must carry the labels/flags both
// the staff picker and the student outcome card rely on.

import { describe, it, expect } from 'vitest';
import { VS_RESOLUTIONS, vsResolution } from './vs-resolution.js';

describe('VS_RESOLUTIONS vocab', () => {
  it('has exactly the four constrained keys', () => {
    expect(VS_RESOLUTIONS.map((r) => r.key)).toEqual([
      'fixed', 'forwarded', 'wont_do', 'duplicate',
    ]);
  });

  it('every reason carries staff + student labels, an icon and a badge', () => {
    for (const r of VS_RESOLUTIONS) {
      expect(r.staff, r.key).toBeTruthy();
      expect(r.student, r.key).toBeTruthy();
      expect(r.icon, r.key).toMatch(/^bi-/);
      expect(r.badge, r.key).toBeTruthy();
      expect(typeof r.noteRequired).toBe('boolean');
    }
  });

  it('only wont_do requires a note', () => {
    expect(vsResolution('wont_do').noteRequired).toBe(true);
    for (const k of ['fixed', 'forwarded', 'duplicate']) {
      expect(vsResolution(k).noteRequired, k).toBe(false);
    }
  });
});

describe('vsResolution lookup', () => {
  it('resolves a known key', () => {
    expect(vsResolution('fixed').student).toBe('ดำเนินการแก้ไขเรียบร้อยแล้ว');
  });
  it('returns null for empty / unknown', () => {
    expect(vsResolution('')).toBeNull();
    expect(vsResolution(null)).toBeNull();
    expect(vsResolution('nope')).toBeNull();
  });
});
