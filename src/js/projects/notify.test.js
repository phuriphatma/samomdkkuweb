// Tests for the projects email-recipient normaliser. The full notify fan-out
// is integration-level (GAS / Supabase); this covers the one pure helper that
// decides WHETHER an email goes out and to WHOM — the exact logic that, when
// it returned a falsy value, made "email doesn't work" look like a bug.

import { describe, it, expect } from 'vitest';
import { normalizeRecipients } from './notify.js';

describe('normalizeRecipients', () => {
  it('returns "" for empty / nullish / whitespace input', () => {
    expect(normalizeRecipients('')).toBe('');
    expect(normalizeRecipients(null)).toBe('');
    expect(normalizeRecipients(undefined)).toBe('');
    expect(normalizeRecipients('   ')).toBe('');
  });

  it('passes a single valid address through, trimmed', () => {
    expect(normalizeRecipients('  a@kku.ac.th ')).toBe('a@kku.ac.th');
  });

  it('splits on commas, spaces, semicolons, and newlines into one comma list', () => {
    expect(normalizeRecipients('a@x.com, b@x.com')).toBe('a@x.com,b@x.com');
    expect(normalizeRecipients('a@x.com b@x.com')).toBe('a@x.com,b@x.com');
    expect(normalizeRecipients('a@x.com;b@x.com')).toBe('a@x.com,b@x.com');
    expect(normalizeRecipients('a@x.com\nb@x.com')).toBe('a@x.com,b@x.com');
  });

  it('drops entries that are not email-shaped', () => {
    expect(normalizeRecipients('a@x.com, notanemail, b@x.com')).toBe('a@x.com,b@x.com');
    expect(normalizeRecipients('nope')).toBe('');
    expect(normalizeRecipients('missing@tld')).toBe('');
  });

  it('de-dupes repeated addresses', () => {
    expect(normalizeRecipients('a@x.com, a@x.com, b@x.com')).toBe('a@x.com,b@x.com');
  });
});
