import { describe, it, expect } from 'vitest';
import { permTicked } from './index.js';

// Regression: a SCOPED grant stores no blanket permission key (0083 vs,
// 0087 passport) — the binding IS the grant. If the modal's checkbox restore
// misses that, the row reads as "no grant" and the next save writes
// vs_dept/passport_dept_id = null, silently wiping it.
describe('permTicked — scoped grants keep their box ticked', () => {
  const own = (...keys) => new Set(keys);

  it('ticks passport for a department-scoped grant with no blanket key', () => {
    expect(permTicked('passport', own(), { permissions: [], passport_dept_id: 5 })).toBe(true);
  });

  it('ticks passport for a sub-department-scoped grant', () => {
    expect(permTicked('passport', own(), { passport_dept_id: 5, passport_sub_dept_id: 3 })).toBe(true);
  });

  it('ticks passport for the blanket grant', () => {
    expect(permTicked('passport', own('passport'), {})).toBe(true);
  });

  it('ticks vs for a dept-scoped VitalSound grant', () => {
    expect(permTicked('vs', own(), { vs_dept: 'อุปนายกฝ่ายวิชาการ' })).toBe(true);
    expect(permTicked('vs', own('vs'), {})).toBe(true);
  });

  it('does not tick a key that was never granted', () => {
    expect(permTicked('passport', own(), { permissions: [] })).toBe(false);
    expect(permTicked('vs', own(), {})).toBe(false);
    expect(permTicked('pr', own(), { passport_dept_id: 5 })).toBe(false);
  });

  it('treats department id 0 as a real binding, not falsy', () => {
    expect(permTicked('passport', own(), { passport_dept_id: 0 })).toBe(true);
  });

  it('passes plain keys straight through, and tolerates a missing row', () => {
    expect(permTicked('pr', own('pr'), {})).toBe(true);
    expect(permTicked('passport', own(), undefined)).toBe(false);
    expect(permTicked('vs', own(), null)).toBe(false);
  });
});
