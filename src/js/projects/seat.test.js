import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

  // Since migration 0092 the server normally sends exactly ONE seat — an
  // explicit pick replaces what the ตำแหน่ง would inherit. Widest-first now only
  // breaks a genuine tie: two team_members rows (two postings) naming different
  // seats. It must NOT be what decides an ordinary grant, which is the bug that
  // made "เจ้าหน้าที่คณะ" resolve to vp_admin under a `vpa` ตำแหน่ง.
  it('resolves genuinely-multiple seats by widest-first precedence', () => {
    expect(projectSeatRole({ role: 'user', managedProjectSeats: ['prof', 'vpa'] })).toBe('vp_admin');
    expect(projectSeatRole({ role: 'user', managedProjectSeats: ['prof', 'staff'] })).toBe('uni_staff');
  });

  it('takes a single resolved seat at face value (the 0092 shape)', () => {
    expect(projectSeatRole({ role: 'user', managedProjectSeats: ['staff'] })).toBe('uni_staff');
    expect(projectSeatRole({ role: 'user', managedProjectSeats: ['prof'] })).toBe('sa_prof');
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

// ============================================================
// master (migration 0111) — REPORTED 2026-08-18
//
// "when i select permission as master, i cant select sub of the หนังสือโครงการ
//  as ผู้ส่งหนังสือ … so my friend has to tick manually like 7 tickcheckbox"
//
// The DATABASE folds master into all three seats; this module read the raw
// `managed_project_seats` column, which the ทีม SAMO editor stores as NULL for
// a master row. 36 of 41 master holders opened หนังสือโครงการ onto a blank pane.
//
// These assertions are DIFFERENTIAL on purpose: the expected seats are parsed
// out of the migration that defines the SQL side, never retyped here. A guard
// written from the same list as the code cannot catch the two drifting apart —
// which is exactly how `tools/master0111-grant.mjs` stayed green through this
// bug (it asserts all three seats, but it asks the DATABASE, so it could not
// see the frontend at all).
// ============================================================
describe('projectSeatRole honours master (0111)', () => {
  const SQL = readFileSync(
    new URL('../../../supabase/migrations/0111_master_grant.sql', import.meta.url), 'utf8',
  );

  /** The seats the SQL fold hands a master holder, read from the migration. */
  const sqlMasterSeats = (() => {
    const fn = SQL.slice(SQL.indexOf('function public.current_user_project_seats'));
    const arr = /current_user_has_permission\('master'\)\s*then\s*array\[([^\]]+)\]/.exec(fn);
    if (!arr) throw new Error('could not find the master fold in 0111 — did the SQL change shape?');
    return arr[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  })();

  it('reads the SQL fold, so this test breaks if the migration changes', () => {
    expect(sqlMasterSeats).toEqual(['vpa', 'staff', 'prof']);
  });

  it('gives a master holder the WIDEST seat the SQL grants — both channels', () => {
    // Widest-first is this module's own precedence, so derive the expected role
    // from the SQL list rather than naming 'vp_admin' twice.
    const widest = ['vpa', 'staff', 'prof'].find((s) => sqlMasterSeats.includes(s));
    const expected = { vpa: 'vp_admin', staff: 'uni_staff', prof: 'sa_prof' }[widest];
    expect(projectSeatRole({ role: 'user', permissions: ['master'], managedProjectSeats: [] }))
      .toBe(expected);
    // Tree-granted master is the SAME grant — 26 of the 29 rows that carry it
    // are ตำแหน่ง, so reading only `permissions` would miss almost everyone.
    expect(projectSeatRole({ role: 'user', managedPermissions: ['master'], managedProjectSeats: [] }))
      .toBe(expected);
  });

  it('is a FLOOR, not an override — an explicit seat still decides the desk', () => {
    // master says "you may do everything"; the seat says "this is your desk".
    // A master who was deliberately made เจ้าหน้าที่คณะ must get that screen,
    // not the sender's, or the editor's pick would be decorative.
    expect(projectSeatRole({ role: 'user', permissions: ['master'], managedProjectSeats: ['staff'] }))
      .toBe('uni_staff');
    expect(projectSeatRole({ role: 'user', permissions: ['master'], managedProjectSeats: ['prof'] }))
      .toBe('sa_prof');
  });

  it('does not strand a master whose stored seat is unrecognised', () => {
    // A value outside the vocabulary must not read as "has a seat" and cancel
    // the fold — that would put them back on the blank pane this fixes.
    expect(projectSeatRole({ role: 'user', permissions: ['master'], managedProjectSeats: ['bogus'] }))
      .toBe('vp_admin');
  });

  it('changes nothing for an account without master', () => {
    expect(projectSeatRole({ role: 'user', permissions: ['projects'], managedProjectSeats: [] }))
      .toBe('user');
    expect(projectSeatRole({ role: 'user', managedPermissions: ['pr', 'vs'], managedProjectSeats: [] }))
      .toBe('user');
  });
});
