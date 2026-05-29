// Pure-function tests for ticket-ids.js.
//
// These exist to lock down the contract the user copies from the
// success card matches what the DB lookup regex accepts. If anyone
// ever changes the generator format without updating the regex (or
// vice versa), CI fails before the change ships.

import { describe, it, expect, vi } from 'vitest';
import {
  generatePRTicketId,
  generateVSTicketId,
  PR_TICKET_ID_REGEX,
  VS_TICKET_ID_REGEX,
} from './ticket-ids.js';

describe('generatePRTicketId', () => {
  it('produces the documented PR-XXXXXX format', () => {
    const id = generatePRTicketId();
    expect(id).toMatch(PR_TICKET_ID_REGEX);
    expect(id).toHaveLength('PR-XXXXXX'.length); // 9
    expect(id.startsWith('PR-')).toBe(true);
  });

  it('uses only the documented alphabet (A-Z + 0-9, no lowercase, no symbols)', () => {
    for (let i = 0; i < 50; i++) {
      const id = generatePRTicketId();
      expect(id.slice(3)).toMatch(/^[A-Z0-9]{6}$/);
    }
  });

  it('returns a different id on consecutive calls (random suffix is doing work)', () => {
    // With 36^6 = 2.1B possible suffixes, two collisions in 50 calls
    // would be astronomically unlikely — if this ever fails, the RNG
    // is broken or Math.random was stubbed.
    const seen = new Set();
    for (let i = 0; i < 50; i++) seen.add(generatePRTicketId());
    expect(seen.size).toBe(50);
  });
});

describe('generateVSTicketId', () => {
  it('produces the documented VS-YYMMDD-HHMM-XXX format', () => {
    const id = generateVSTicketId();
    expect(id).toMatch(VS_TICKET_ID_REGEX);
    expect(id).toHaveLength('VS-YYMMDD-HHMM-XXX'.length); // 18
  });

  it('embeds the supplied clock time in the stem', () => {
    // Frozen time → deterministic stem
    const d = new Date('2026-03-09T14:07:23Z');
    // Read the LOCAL time the way the generator does — guards against
    // running this test in a different timezone.
    const yy = String(d.getFullYear() % 100).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const expectedStem = `VS-${yy}${mm}${dd}-${hh}${mi}-`;
    const id = generateVSTicketId(d);
    expect(id.startsWith(expectedStem)).toBe(true);
    expect(id.slice(expectedStem.length)).toMatch(/^[A-Z0-9]{3}$/);
  });

  it('applies the random suffix when called within the same minute', () => {
    // Two submitters landing in the same minute used to collide before
    // the random suffix was added — the bug from mistakes.md. Proving
    // "the suffix is wired" by mocking Math.random with a known
    // sequence is deterministic; relying on real randomness over N=50
    // with a 3-char×36-alphabet pool flakes at ~2.7% (birthday).
    const fixed = new Date('2026-03-09T14:07:23Z');
    let i = 0;
    const seq = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => seq[i++ % seq.length]);
    try {
      const a = generateVSTicketId(fixed);
      const b = generateVSTicketId(fixed);
      expect(a).not.toBe(b);
      // Stem (date+minute) is identical; only the trailing 3 chars differ.
      expect(a.slice(0, -3)).toBe(b.slice(0, -3));
    } finally {
      spy.mockRestore();
    }
  });

  it('defaults to the current time when called with no argument', () => {
    const before = Date.now();
    const id = generateVSTicketId();
    const after = Date.now();
    // The minute embedded in the id should match the minute of
    // wall-clock time at call time (allow a 1-minute fudge for the
    // boundary where `before` and `after` straddle a minute change).
    const beforeMin = new Date(before);
    const afterMin = new Date(after);
    const minStr = (d) =>
      `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const idMin = id.slice(10, 14); // VS-YYMMDD-HHMM-XXX, positions 10..14
    expect([minStr(beforeMin), minStr(afterMin)]).toContain(idMin);
  });
});

describe('regex contracts', () => {
  it('PR_TICKET_ID_REGEX rejects malformed ids', () => {
    expect(PR_TICKET_ID_REGEX.test('pr-ABC123')).toBe(false); // lowercase prefix
    expect(PR_TICKET_ID_REGEX.test('PR-abc123')).toBe(false); // lowercase suffix
    expect(PR_TICKET_ID_REGEX.test('PR-ABC12')).toBe(false);  // too short
    expect(PR_TICKET_ID_REGEX.test('PR-ABC1234')).toBe(false); // too long
    expect(PR_TICKET_ID_REGEX.test('PR_ABC123')).toBe(false); // wrong separator
    expect(PR_TICKET_ID_REGEX.test('VS-ABC123')).toBe(false); // wrong prefix
    expect(PR_TICKET_ID_REGEX.test('')).toBe(false);
  });

  it('VS_TICKET_ID_REGEX rejects malformed ids', () => {
    expect(VS_TICKET_ID_REGEX.test('vs-260309-1407-XYZ')).toBe(false); // lowercase
    expect(VS_TICKET_ID_REGEX.test('VS-260309-1407-xyz')).toBe(false); // lowercase suffix
    expect(VS_TICKET_ID_REGEX.test('VS-26039-1407-XYZ')).toBe(false);  // 5-digit date
    expect(VS_TICKET_ID_REGEX.test('VS-260309-1407-XY')).toBe(false);  // 2-char suffix
    expect(VS_TICKET_ID_REGEX.test('VS-260309 1407-XYZ')).toBe(false); // space
    expect(VS_TICKET_ID_REGEX.test('VS260309-1407-XYZ')).toBe(false);  // missing dash
    expect(VS_TICKET_ID_REGEX.test('PR-260309-1407-XYZ')).toBe(false); // wrong prefix
    expect(VS_TICKET_ID_REGEX.test('')).toBe(false);
  });
});

describe('generator ↔ regex round trip (the contract the user cares about)', () => {
  // What the user pastes into the tracking search must match what the
  // generator produced. If these ever diverge, the tracking lookup
  // would silently return "ไม่พบ" for legitimate ids — the original
  // bug we just spent the session fixing.

  it('every PR id the generator emits passes PR_TICKET_ID_REGEX', () => {
    for (let i = 0; i < 200; i++) {
      const id = generatePRTicketId();
      expect(id).toMatch(PR_TICKET_ID_REGEX);
    }
  });

  it('every VS id the generator emits passes VS_TICKET_ID_REGEX', () => {
    // Cover several dates so a leap-day / DST boundary doesn't slip
    // through.
    const samples = [
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-03-09T14:07:23Z'),
      new Date('2026-12-31T23:59:59Z'),
      new Date('2028-02-29T12:00:00Z'), // leap day
    ];
    for (const d of samples) {
      for (let i = 0; i < 50; i++) {
        const id = generateVSTicketId(d);
        expect(id).toMatch(VS_TICKET_ID_REGEX);
      }
    }
  });
});
