// ==============================================
// WHICH FILE A SAVE JUST STOPPED POINTING AT.
//
// REPORTED: "when i เปลี่ยนรูป it changes the picture but when i look in the
// drive there is still the old picture of me."
//
// `photoToRetire` is the single rule behind all three portrait writers (the
// ทีม SAMO admin editor, the ข้อมูลของฉัน self-service card, the ระบบบ้าน crest).
// It is tested in BOTH directions, because both directions have a way to be
// wrong that produces no error and no visible symptom:
//
//   • too eager → it trashes a file the database still points at, and somebody's
//     portrait becomes a broken image weeks later;
//   • too shy   → the file stays in Drive, shared "anyone with the link",
//     forever. That is the bug that was reported, and the shy direction is the
//     one an implementation falls into by accident — one `??` is enough
//     (`body.photo_url ?? prev` reads a นำรูปออก's null as "unchanged").
// ==============================================
import { describe, it, expect } from 'vitest';
import { photoToRetire } from './team/api.js';

const A = 'https://lh3.googleusercontent.com/d/AAA=w1200';
const B = 'https://lh3.googleusercontent.com/d/BBB=w1200';

describe('photoToRetire — the file this save stopped pointing at', () => {
  describe('RETIRE (the reported bug lives here)', () => {
    it('เปลี่ยนรูป: a different URL retires the previous file', () => {
      expect(photoToRetire(A, { photo_url: B })).toBe(A);
    });

    it('นำรูปออก: an explicit null retires it — this is the `??` trap', () => {
      expect(photoToRetire(A, { photo_url: null })).toBe(A);
      // The shape that would have broken it, spelled out so nobody reintroduces it.
      const wrong = A !== (null ?? A);
      expect(wrong).toBe(false);      // `??` says "unchanged" — which is why it is not used
    });

    it('an empty string is a removal too', () => {
      expect(photoToRetire(A, { photo_url: '' })).toBe(A);
    });

    it('honours a non-default column — ระบบบ้าน crests are icon_url', () => {
      expect(photoToRetire(A, { icon_url: B }, 'icon_url')).toBe(A);
      expect(photoToRetire(A, { icon_url: null }, 'icon_url')).toBe(A);
    });

    it('ignores surrounding whitespace on either side', () => {
      expect(photoToRetire(`  ${A}  `, { photo_url: B })).toBe(A);
    });
  });

  describe('KEEP (the file is still in use, or nothing changed)', () => {
    it('the same URL retires nothing — an unrelated field was edited', () => {
      expect(photoToRetire(A, { photo_url: A })).toBeNull();
      expect(photoToRetire(A, { photo_url: `  ${A}  ` })).toBeNull();
    });

    it('an ABSENT key means the photo was never touched', () => {
      // The admin editor sends a payload without photo_url when only the ชั้นปี
      // changed. Treating that as a removal would trash a live portrait.
      expect(photoToRetire(A, { nickname: 'เอิง' })).toBeNull();
      expect(photoToRetire(A, {})).toBeNull();
    });

    it('there was no previous photo, so there is nothing to retire', () => {
      expect(photoToRetire('', { photo_url: B })).toBeNull();
      expect(photoToRetire(null, { photo_url: B })).toBeNull();
      expect(photoToRetire(undefined, { photo_url: null })).toBeNull();
      expect(photoToRetire('   ', { photo_url: B })).toBeNull();
    });

    it('a missing or non-object payload never retires anything', () => {
      expect(photoToRetire(A, null)).toBeNull();
      expect(photoToRetire(A, undefined)).toBeNull();
      expect(photoToRetire(A, 'photo_url')).toBeNull();
    });

    it('the key must match — a payload about a DIFFERENT url column is not this one', () => {
      expect(photoToRetire(A, { icon_url: B })).toBeNull();
      expect(photoToRetire(A, { photo_url: B }, 'icon_url')).toBeNull();
    });
  });

  it('never returns the NEW url — the thing to delete is always the old one', () => {
    for (const payload of [{ photo_url: B }, { photo_url: null }, { photo_url: '' }]) {
      const out = photoToRetire(A, payload);
      expect(out).not.toBe(B);
      expect(out).toBe(A);
    }
  });
});
