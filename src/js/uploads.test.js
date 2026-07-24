// Pure-function tests for the Drive-URL normalizer. The actual upload
// function (uploadImageToDrive) hits GAS over the network; not unit-
// testable without mocking — leave it to manual smoke testing.

import { describe, it, expect } from 'vitest';
import { convertDriveUrl } from './uploads.js';

describe('convertDriveUrl', () => {
  // We emit the direct lh3 CDN form (no drive.google.com/thumbnail redirect,
  // which fails on iOS Safari). Default size is w1200.
  const cdn = (id, size = 1200) => `https://lh3.googleusercontent.com/d/${id}=w${size}`;

  it('rewrites /file/d/<id>/view to the lh3 CDN URL', () => {
    expect(convertDriveUrl('https://drive.google.com/file/d/ABC123/view'))
      .toBe(cdn('ABC123'));
  });

  it('rewrites /file/d/<id> WITHOUT trailing slash (no view part)', () => {
    // Regression test for the convertDriveUrl regex tightening — earlier
    // version required a trailing / which dropped these URLs.
    expect(convertDriveUrl('https://drive.google.com/file/d/ABC123'))
      .toBe(cdn('ABC123'));
  });

  it('rewrites /file/d/<id>?usp=sharing (no slash, query suffix)', () => {
    expect(convertDriveUrl('https://drive.google.com/file/d/ABC123?usp=sharing'))
      .toBe(cdn('ABC123'));
  });

  it('rewrites the ?id= and &id= patterns (uc, open)', () => {
    expect(convertDriveUrl('https://drive.google.com/uc?id=XYZ&export=view'))
      .toBe(cdn('XYZ'));
    expect(convertDriveUrl('https://drive.google.com/open?id=XYZ'))
      .toBe(cdn('XYZ'));
    expect(convertDriveUrl('https://drive.google.com/foo?bar=1&id=ZZZ'))
      .toBe(cdn('ZZZ'));
  });

  it('CONVERTS legacy drive.google.com/thumbnail URLs (already in the DB) to lh3', () => {
    // These are the URLs stored by the old convertDriveUrl. convertDriveUrl now
    // runs at render time too, so it MUST rewrite them (not pass them through)
    // or existing rows keep the iOS-broken redirect URL.
    expect(convertDriveUrl('https://drive.google.com/thumbnail?id=XYZ&sz=w2000'))
      .toBe(cdn('XYZ'));
  });

  it('honors an explicit size argument', () => {
    expect(convertDriveUrl('https://drive.google.com/file/d/ABC123/view', 800))
      .toBe(cdn('ABC123', 800));
  });

  it('passes already-lh3 CDN URLs through unchanged (idempotent)', () => {
    const u = cdn('XYZ');
    expect(convertDriveUrl(u)).toBe(u);
  });

  it('passes Supabase Storage URLs through unchanged', () => {
    const u = 'https://abc.supabase.co/storage/v1/object/public/img/x.png';
    expect(convertDriveUrl(u)).toBe(u);
  });

  it('returns falsy inputs unchanged', () => {
    expect(convertDriveUrl('')).toBe('');
    expect(convertDriveUrl(null)).toBe(null);
    expect(convertDriveUrl(undefined)).toBe(undefined);
  });

  it('passes non-Drive URLs through unchanged', () => {
    expect(convertDriveUrl('https://example.com/image.jpg'))
      .toBe('https://example.com/image.jpg');
  });
});
