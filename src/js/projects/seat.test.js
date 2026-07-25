import { describe, it, expect } from 'vitest';
import { projectSeatRole } from './index.js';

// projectSeatRole is what turns a SAMO Team seat into the role string the
// whole projects UI branches on (migration 0086). Getting it wrong is the
// difference between a working seat and a tab with no controls.
describe('projectSeatRole', () => {
  it('lets a real role win — the shared accounts are untouched', () => {
    expect(projectSeatRole({ role: 'vp_admin' })).toBe('vp_admin');
    expect(projectSeatRole({ role: 'uni_staff' })).toBe('uni_staff');
    expect(projectSeatRole({ role: 'sa_prof' })).toBe('sa_prof');
    expect(projectSeatRole({ role: 'dev' })).toBe('dev');
    // even if a seat is also granted, the role stays authoritative
    expect(projectSeatRole({ role: 'uni_staff', managedProjectSeats: ['prof'] })).toBe('uni_staff');
  });

  it('maps each tree seat onto its workflow role', () => {
    expect(projectSeatRole({ role: 'user', managedProjectSeats: ['vpa'] })).toBe('vp_admin');
    expect(projectSeatRole({ role: 'user', managedProjectSeats: ['staff'] })).toBe('uni_staff');
    expect(projectSeatRole({ role: 'user', managedProjectSeats: ['prof'] })).toBe('sa_prof');
  });

  it('resolves multiple seats by widest-first precedence', () => {
    expect(projectSeatRole({ role: 'user', managedProjectSeats: ['prof', 'vpa'] })).toBe('vp_admin');
    expect(projectSeatRole({ role: 'user', managedProjectSeats: ['prof', 'staff'] })).toBe('uni_staff');
  });

  it('leaves a plain user alone', () => {
    expect(projectSeatRole({ role: 'user' })).toBe('user');
    expect(projectSeatRole({ role: 'user', managedProjectSeats: [] })).toBe('user');
    expect(projectSeatRole({ role: 'user', managedProjectSeats: ['bogus'] })).toBe('user');
  });

  it('tolerates missing / malformed input', () => {
    expect(projectSeatRole(null)).toBe(null);
    expect(projectSeatRole({})).toBe(null);
    expect(projectSeatRole({ role: 'user', managedProjectSeats: 'staff' })).toBe('user');
  });
});
