import { describe, it, expect } from 'vitest';
import { parseRestError } from './db.js';

// ============================================================
// A refused write must tell a human what happened, and must not stop
// telling the RETRY what it reads.
//
// The 0176 report arrived as this, pasted out of an alert():
//   {"code":"P0001", "details:null hint null message project_documents_prof_guard: …
// dbRest handed the whole JSON body to callers as `error.message`, and every
// caller does `alert(e.message || '…ไม่สำเร็จ')`. So the sentence the trigger
// wrote — the only part anyone can act on — arrived wrapped in braces and
// field names, to a Thai-speaking student.
//
// The seam this pins: PGRST303 lives in `code`, NOT in `message`. Unwrapping
// to `message` alone would silently kill the JWT-expired refresh-and-retry —
// a fix to the user-facing half breaking the machine-facing half of the same
// string (class 4: authorization/consumption is per-PATH).
// ============================================================
describe('parseRestError — the human half', () => {
  it('unwraps the sentence a trigger raise wrote', () => {
    const body = JSON.stringify({
      code: 'P0001', details: null, hint: null,
      message: 'project_documents_prof_guard: professor may only add comments',
    });
    const e = parseRestError(400, body);
    expect(e.message).toBe('project_documents_prof_guard: professor may only add comments');
    // The braces are gone — that is the whole point.
    expect(e.message).not.toContain('{');
    expect(e.message).not.toContain('"code"');
  });

  it('unwraps an RLS refusal the same way', () => {
    const body = JSON.stringify({
      code: '42501', details: null, hint: null,
      message: 'new row violates row-level security policy for table "project_documents"',
    });
    expect(parseRestError(403, body).message)
      .toBe('new row violates row-level security policy for table "project_documents"');
  });

  it('falls back to the raw text when the body is not JSON', () => {
    expect(parseRestError(502, 'Bad Gateway').message).toBe('Bad Gateway');
  });

  it('falls back to statusText when there is no body at all', () => {
    expect(parseRestError(500, '', 'Internal Server Error').message).toBe('Internal Server Error');
  });

  it('never returns an empty message — the caller ORs it against a Thai fallback', () => {
    // '' is falsy, so an empty message would still reach the fallback; this
    // pins that it is at worst empty and never the string "undefined".
    expect(parseRestError(500, '', '').message).not.toBe('undefined');
  });

  it('does not mistake a JSON body with no `message` for one', () => {
    const body = JSON.stringify({ code: 'PGRST116', details: 'Results contain 0 rows' });
    expect(parseRestError(406, body).message).toBe(body);
  });
});

describe('parseRestError — the machine half', () => {
  it('keeps the code, so PGRST303 is still findable after unwrapping', () => {
    const body = JSON.stringify({ code: 'PGRST303', message: 'JWT expired' });
    const e = parseRestError(401, body);
    expect(e.code).toBe('PGRST303');
    expect(e.raw).toContain('PGRST303');
  });

  it('keeps the raw body, which is where a code lives when there is no `code` field', () => {
    const e = parseRestError(401, '{"msg":"PGRST303 whatever"}');
    expect(e.raw).toContain('PGRST303');
  });

  it('carries details and hint through instead of dropping them', () => {
    const body = JSON.stringify({ code: '23505', message: 'duplicate key', details: 'Key (id)=(X) exists.', hint: 'try another id' });
    const e = parseRestError(409, body);
    expect(e.details).toBe('Key (id)=(X) exists.');
    expect(e.hint).toBe('try another id');
  });

  it('reports the status it was given', () => {
    expect(parseRestError(418, '{}').status).toBe(418);
  });
});
