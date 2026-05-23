// Pure-function tests for the Drive-URL normalizer. The actual upload
// function (uploadImageToDrive) hits GAS over the network; not unit-
// testable without mocking — leave it to manual smoke testing.

import { describe, it, expect } from 'vitest';
import { convertDriveUrl } from './uploads.js';

describe('convertDriveUrl', () => {
  const THUMB = 'https://drive.google.com/thumbnail';

  it('rewrites /file/d/<id>/view to a thumbnail URL', () => {
    expect(convertDriveUrl('https://drive.google.com/file/d/ABC123/view'))
      .toBe(`${THUMB}?id=ABC123&sz=w2000`);
  });

  it('rewrites /file/d/<id> WITHOUT trailing slash (no view part)', () => {
    // Regression test for the convertDriveUrl regex tightening — earlier
    // version required a trailing / which dropped these URLs.
    expect(convertDriveUrl('https://drive.google.com/file/d/ABC123'))
      .toBe(`${THUMB}?id=ABC123&sz=w2000`);
  });

  it('rewrites /file/d/<id>?usp=sharing (no slash, query suffix)', () => {
    expect(convertDriveUrl('https://drive.google.com/file/d/ABC123?usp=sharing'))
      .toBe(`${THUMB}?id=ABC123&sz=w2000`);
  });

  it('rewrites the ?id= and &id= patterns (uc, open)', () => {
    expect(convertDriveUrl('https://drive.google.com/uc?id=XYZ&export=view'))
      .toBe(`${THUMB}?id=XYZ&sz=w2000`);
    expect(convertDriveUrl('https://drive.google.com/open?id=XYZ'))
      .toBe(`${THUMB}?id=XYZ&sz=w2000`);
    expect(convertDriveUrl('https://drive.google.com/foo?bar=1&id=ZZZ'))
      .toBe(`${THUMB}?id=ZZZ&sz=w2000`);
  });

  it('passes already-thumbnail URLs through unchanged', () => {
    const u = `${THUMB}?id=XYZ&sz=w2000`;
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
