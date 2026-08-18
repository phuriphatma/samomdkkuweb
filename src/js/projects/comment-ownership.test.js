// ==============================================
// comment-ownership.test.js — who may edit or delete a comment.
//
// WHY THIS EXISTS. `canManageComment` is the only thing that renders the
// แก้ไข / ลบ controls on a comment, and it is four one-line branches that were
// each wrong at some point:
//
//   - the ROLE fallback was PROMISED by the surrounding comment for years and
//     was not in the code, so an entry with no `by` was stranded forever;
//   - the `by` comparison silently broke for 42 of the 43 comments in the
//     system when the shared logins were deleted and their uids stayed in the
//     JSONB timelines (fixed as DATA, in migration 0166 — this file asserts
//     the UI does NOT try to paper over that, because a browser cannot tell a
//     deleted account from a stranger);
//   - `role === 'dev'` must not hand controls to a signed-OUT reader, and the
//     public mirror has no session at all.
// ==============================================
import { describe, it, expect } from 'vitest';
import { canManageComment } from './inbox.js';

const ME = 'uid-me';
const SOMEONE = 'uid-someone-else';

describe('canManageComment', () => {
  it('gives the author the controls', () => {
    expect(canManageComment({ by: ME, role: 'vp_admin' }, ME, 'vp_admin')).toBe(true);
  });

  it('does NOT give them to someone else who happens to hold the same role', () => {
    // Two people can hold the vpa seat now that the shared login is gone.
    expect(canManageComment({ by: SOMEONE, role: 'vp_admin' }, ME, 'vp_admin')).toBe(false);
  });

  it('falls back to the ROLE only when there is no `by` at all', () => {
    // The write is `by: user?.id || null`. Without this branch such a comment
    // can never be edited or deleted by anyone but a dev.
    expect(canManageComment({ by: null, role: 'uni_staff' }, ME, 'uni_staff')).toBe(true);
    expect(canManageComment({ role: 'uni_staff' }, ME, 'uni_staff')).toBe(true);
    expect(canManageComment({ by: null, role: 'uni_staff' }, ME, 'vp_admin')).toBe(false);
  });

  it('does not treat an UNKNOWN `by` as unattributed — that is a data repair, not a UI guess', () => {
    // REGRESSION GUARD for the 0166 shape. A uid naming a deleted account is
    // still a uid: the browser has no way to tell it from a stranger's, and a
    // UI that "falls back" here would hand every comment to whoever is looking.
    const stranded = { by: '2f84f268-c5f8-425b-b492-b5a7cf4299aa', role: 'uni_staff' };
    expect(canManageComment(stranded, ME, 'uni_staff')).toBe(false);
  });

  it('gives dev everything, but only with a session', () => {
    expect(canManageComment({ by: SOMEONE, role: 'vp_admin' }, ME, 'dev')).toBe(true);
    expect(canManageComment({ by: SOMEONE, role: 'vp_admin' }, null, 'dev')).toBe(false);
  });

  it('gives a signed-out reader nothing — the public mirror has no identity', () => {
    expect(canManageComment({ by: ME, role: 'vp_admin' }, null, 'customer')).toBe(false);
    expect(canManageComment({ by: null, role: 'customer' }, null, 'customer')).toBe(false);
  });

  it('never throws on a malformed entry', () => {
    expect(canManageComment(null, ME, 'vp_admin')).toBe(false);
    expect(canManageComment({}, ME, 'vp_admin')).toBe(false);
    expect(canManageComment(undefined, null, undefined)).toBe(false);
  });
});
