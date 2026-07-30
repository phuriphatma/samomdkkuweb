// Pure-function tests for the Drive-URL normalizer. The actual upload
// function (uploadImageToDrive) hits GAS over the network; not unit-
// testable without mocking — leave it to manual smoke testing.

import { describe, it, expect } from 'vitest';
import {
  convertDriveUrl, portraitSrc, portraitSrcSet, focusToObjectPosition, AVATAR_RATIO,
} from './uploads.js';
import { fitWithin } from './image-resize.js';

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

// ---------------------------------------------------------------------------
// Portrait delivery (0104). These build the lh3 option strings that decide how
// many bytes the ทีม SAMO page downloads, and the values were verified against
// a live Drive file before they were written:
//   =w320            320px JPEG   28.6 KB
//   =w320-rw         320px WebP   16.9 KB
//   =w520-h693-c-rw  520x694 WebP 37.6 KB   (vs 77.6 KB uncropped at =w1040)
// A regression here is silent — the image still renders, just 2-5x heavier or
// at the wrong aspect — so the exact suffixes are pinned.
// ---------------------------------------------------------------------------
describe('portraitSrc / portraitSrcSet', () => {
  const DRIVE = 'https://drive.google.com/file/d/ABC123/view';
  const LH3 = 'https://lh3.googleusercontent.com/d/ABC123=w2000';

  it('server-crops to 3:4 and asks for WebP when focus is center', () => {
    expect(portraitSrc(DRIVE, 520)).toBe(
      'https://lh3.googleusercontent.com/d/ABC123=w520-h693-c-rw');
  });

  it('defaults to center when focus is null/undefined', () => {
    expect(portraitSrc(DRIVE, 520, null)).toBe(portraitSrc(DRIVE, 520, 'center'));
  });

  it('drops the crop for top/bottom, since lh3 has no focal point', () => {
    // The CSS object-position does the cropping instead — costs bytes, but a
    // centre crop of a landscape studio shot can slice the head off.
    expect(portraitSrc(DRIVE, 520, 'top')).toBe(
      'https://lh3.googleusercontent.com/d/ABC123=w520-rw');
    expect(portraitSrc(DRIVE, 520, 'bottom')).toBe(
      'https://lh3.googleusercontent.com/d/ABC123=w520-rw');
  });

  it('crops square for the 1:1 shape, not 3:4', () => {
    expect(portraitSrc(DRIVE, 88, 'center', AVATAR_RATIO)).toBe(
      'https://lh3.googleusercontent.com/d/ABC123=w88-h88-c-rw');
  });

  it('re-derives from a URL that is already lh3 (with an old size suffix)', () => {
    expect(portraitSrc(LH3, 260)).toBe(
      'https://lh3.googleusercontent.com/d/ABC123=w260-h347-c-rw');
  });

  it('passes non-Drive URLs through untouched', () => {
    const other = 'https://example.com/a.jpg';
    expect(portraitSrc(other, 520)).toBe(other);
    // …and emits NO srcset, so the browser is not handed candidates that all
    // resolve to the same unresized file.
    expect(portraitSrcSet(other, [260, 520])).toBe('');
  });

  it('returns empty string, not "undefined", for a missing url', () => {
    expect(portraitSrc(null, 520)).toBe('');
    expect(portraitSrcSet(undefined, [260])).toBe('');
  });

  it('emits one w-descriptor per width', () => {
    expect(portraitSrcSet(DRIVE, [260, 520])).toBe(
      'https://lh3.googleusercontent.com/d/ABC123=w260-h347-c-rw 260w, '
      + 'https://lh3.googleusercontent.com/d/ABC123=w520-h693-c-rw 520w');
  });
});

describe('focusToObjectPosition', () => {
  it('maps the three DB tokens and nothing else', () => {
    expect(focusToObjectPosition('top')).toBe('50% 12%');
    expect(focusToObjectPosition('bottom')).toBe('50% 85%');
    expect(focusToObjectPosition('center')).toBe('50% 50%');
  });

  it('falls back to centre for anything unrecognised', () => {
    // The column is CHECK-constrained to the three tokens, but this map is the
    // only path from a DB value to CSS — so an unexpected value must produce a
    // safe position, never leak into the stylesheet.
    expect(focusToObjectPosition('50% 0%; background:url(x)')).toBe('50% 50%');
    expect(focusToObjectPosition(null)).toBe('50% 50%');
  });
});

describe('fitWithin', () => {
  it('scales the long edge down to the cap, preserving aspect', () => {
    expect(fitWithin(4800, 3200, 2400)).toEqual({ w: 2400, h: 1600, scaled: true });
    expect(fitWithin(3200, 4800, 2400)).toEqual({ w: 1600, h: 2400, scaled: true });
  });

  it('never upscales a source that is already small', () => {
    expect(fitWithin(1000, 667, 2400)).toEqual({ w: 1000, h: 667, scaled: false });
  });

  it('treats exactly-at-the-cap as not needing a scale', () => {
    expect(fitWithin(2400, 1600, 2400)).toEqual({ w: 2400, h: 1600, scaled: false });
  });

  it('handles a zero/absent dimension without producing NaN', () => {
    expect(fitWithin(0, 0, 2400)).toEqual({ w: 0, h: 0, scaled: false });
  });
});
