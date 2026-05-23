// Pure-function tests for utils.js. No DOM, no network — safe to run
// under plain Vitest with no jsdom env. The renderTimeline helper isn't
// covered here because it writes to a DOM container; smoke-test it in a
// browser instead.

import { describe, it, expect } from 'vitest';
import { escHtml, safeUrl, formatThaiDate, decodeJwtResponse } from './utils.js';

describe('escHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escHtml(`<img src=x onerror=alert(1)>`))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escHtml(`"&'<>`)).toBe('&quot;&amp;&#39;&lt;&gt;');
  });

  it('returns empty string for null and undefined', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });

  it('coerces non-strings safely', () => {
    expect(escHtml(42)).toBe('42');
    expect(escHtml(true)).toBe('true');
  });

  it('leaves benign text alone', () => {
    expect(escHtml('hello world')).toBe('hello world');
  });
});

describe('safeUrl', () => {
  it('allows http and https URLs through', () => {
    expect(safeUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(safeUrl('https://drive.google.com/file/d/X/view')).toBe('https://drive.google.com/file/d/X/view');
  });

  it('allows mailto and tel', () => {
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeUrl('tel:+66891234567')).toBe('tel:+66891234567');
  });

  it('blocks javascript: scheme', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('  javascript:alert(1)')).toBe('#');
    expect(safeUrl('JAVASCRIPT:alert(1)')).toBe('#');
  });

  it('blocks data: scheme', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
  });

  it('blocks attribute-injection payloads', () => {
    // Without quotes for context — this is what an attacker would put
    // in a free-text "url" field hoping it lands inside href="${url}".
    // Either the safeUrl rejects it, or escHtml neutralizes the quote.
    // We test both layers behave defensively.
    expect(safeUrl('" onclick=alert(1) "')).toBe('#');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('#');
  });

  it('returns # for empty / null / undefined', () => {
    expect(safeUrl('')).toBe('#');
    expect(safeUrl(null)).toBe('#');
    expect(safeUrl(undefined)).toBe('#');
  });
});

describe('formatThaiDate', () => {
  it('formats an ISO date to dd/MM/yyyy HH:mm:ss', () => {
    // Force a stable UTC date — the function uses local time getters,
    // so we pass a date with a fixed local-time interpretation.
    const iso = '2026-05-23T14:30:00';
    const out = formatThaiDate(iso);
    expect(out).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
  });

  it('passes already-slash-formatted strings through', () => {
    expect(formatThaiDate('23/05/2026 14:30:00')).toBe('23/05/2026 14:30:00');
  });

  it('returns "-" for null / undefined / empty', () => {
    expect(formatThaiDate(null)).toBe('-');
    expect(formatThaiDate(undefined)).toBe('-');
    expect(formatThaiDate('')).toBe('-');
  });

  it('returns the input as a string for unparseable values', () => {
    expect(formatThaiDate('not a date')).toBe('not a date');
  });
});

describe('decodeJwtResponse', () => {
  // Build a minimal valid JWT: header.payload.signature, payload is
  // base64url-encoded JSON. Signature is decorative for decode tests.
  function makeJwt(payload) {
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `header.${b64(payload)}.sig`;
  }

  it('decodes a well-formed token', () => {
    const token = makeJwt({ sub: 'abc', email: 'a@b.com' });
    expect(decodeJwtResponse(token)).toEqual({ sub: 'abc', email: 'a@b.com' });
  });

  it('throws on non-string input', () => {
    expect(() => decodeJwtResponse(null)).toThrow(/string/i);
    expect(() => decodeJwtResponse(undefined)).toThrow(/string/i);
    expect(() => decodeJwtResponse(42)).toThrow(/string/i);
  });

  it('throws on wrong segment count', () => {
    expect(() => decodeJwtResponse('only.two')).toThrow(/segments/);
    expect(() => decodeJwtResponse('one.two.three.four')).toThrow(/segments/);
  });

  it('throws on malformed base64 payload', () => {
    expect(() => decodeJwtResponse('header.!!!.sig')).toThrow(/decode failed/);
  });
});
