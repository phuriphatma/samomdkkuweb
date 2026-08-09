// ==============================================
// WHICH DRIVE FILES AN ARTICLE EDIT ORPHANED.
//
// `uploadPRFile` had no delete counterpart until now, so every re-crop of a
// cover and every image dropped out of an article body stayed in Drive, shared
// "anyone with the link", forever. An article edited five times left five
// covers, four of them still readable by anyone who ever saw the URL.
//
// `filesToRetire(before, after, others)` is the whole rule, and it has two ways
// to be wrong, both silent:
//
//   • TOO EAGER — it returns a file the article (or another article) still
//     shows, and a picture turns into a broken image later;
//   • TOO SHY — it returns nothing, and the file stays public forever. That is
//     the bug this closes, and it is the direction an implementation falls into
//     by accident.
//
// The trap that makes "too eager" easy: ONE file has several URL spellings.
// `=w1200`, `=w600`, a bare `/view`, an old `?id=` — comparing URL strings
// would call two spellings of one file two different files and delete a picture
// the body still renders. So the rule works in Drive FILE IDS, and half the
// cases below exist to hold that line.
// ==============================================
import { describe, it, expect } from 'vitest';
import { filesToRetire } from './announcements.js';
import { driveIdsInHtml } from './uploads.js';

const A = '1AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const B = '1BBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const C = '1CCCCCCCCCCCCCCCCCCCCCCCCCCCC';

const lh3 = (id, w = 1200) => `https://lh3.googleusercontent.com/d/${id}=w${w}`;
const view = (id) => `https://drive.google.com/file/d/${id}/view?usp=drivesdk`;
const thumb = (id) => `https://drive.google.com/thumbnail?id=${id}&sz=w1000`;
const img = (url) => `<p>ข้อความ</p><img src="${url}"><p>ต่อ</p>`;

describe('driveIdsInHtml — every URL shape this app has ever stored', () => {
  it('finds the lh3 CDN form the app writes today', () => {
    expect([...driveIdsInHtml(img(lh3(A)))]).toEqual([A]);
  });
  it('finds the viewer form GAS returns and older bodies carry', () => {
    expect([...driveIdsInHtml(img(view(A)))]).toEqual([A]);
  });
  it('finds the legacy ?id= thumbnail form', () => {
    expect([...driveIdsInHtml(img(thumb(A)))]).toEqual([A]);
  });
  it('collapses several SPELLINGS of one file to one id', () => {
    const html = `${img(lh3(A, 1200))}${img(lh3(A, 600))}${img(view(A))}`;
    expect([...driveIdsInHtml(html)]).toEqual([A]);
  });
  it('finds several distinct files in one body', () => {
    expect([...driveIdsInHtml(img(lh3(A)) + img(view(B)))].sort())
      .toEqual([A, B].sort());
  });
  it('is empty for text with no Drive links, and for junk input', () => {
    for (const v of ['', null, undefined, '<p>ไม่มีรูป</p>', '<img src="https://example.com/x.png">']) {
      expect(driveIdsInHtml(v).size).toBe(0);
    }
  });
});

describe('filesToRetire — RETIRE (the leak this closes)', () => {
  it('a re-cropped cover retires the previous cover', () => {
    const before = { thumbnail: lh3(A), content: '<p>x</p>' };
    const after = { thumbnail: lh3(B), content: '<p>x</p>' };
    expect(filesToRetire(before, after)).toEqual([A]);
  });

  it('an image deleted from the body is retired', () => {
    const before = { thumbnail: lh3(A), content: img(lh3(B)) };
    const after = { thumbnail: lh3(A), content: '<p>ลบรูปออกแล้ว</p>' };
    expect(filesToRetire(before, after)).toEqual([B]);
  });

  it('deleting the article retires the cover AND every body image', () => {
    const before = { thumbnail: lh3(A), content: img(lh3(B)) + img(view(C)) };
    expect(filesToRetire(before, null).sort()).toEqual([A, B, C].sort());
  });

  it('retires several at once when a rewrite drops both', () => {
    const before = { thumbnail: lh3(A), content: img(lh3(B)) };
    const after = { thumbnail: lh3(C), content: '<p>เขียนใหม่</p>' };
    expect(filesToRetire(before, after).sort()).toEqual([A, B].sort());
  });

  it('reads thumbnail_url as well as thumbnail — the server row spells it differently', () => {
    // deleteAnnouncement passes the row PostgREST returned, which has
    // thumbnail_url; the editor passes the cached shape, which has thumbnail.
    const before = { thumbnail_url: lh3(A), content: '' };
    expect(filesToRetire(before, null)).toEqual([A]);
  });
});

describe('filesToRetire — KEEP (deleting any of these breaks a live page)', () => {
  it('an unchanged cover is never retired', () => {
    const same = { thumbnail: lh3(A), content: img(lh3(B)) };
    expect(filesToRetire(same, { ...same })).toEqual([]);
  });

  it('THE SPELLING TRAP: the same file at a different width is the same file', () => {
    const before = { thumbnail: lh3(A, 1200), content: '' };
    const after = { thumbnail: lh3(A, 600), content: '' };
    expect(filesToRetire(before, after)).toEqual([]);
  });

  it('THE SPELLING TRAP: viewer URL and CDN URL are the same file', () => {
    expect(filesToRetire({ thumbnail: view(A) }, { thumbnail: lh3(A) })).toEqual([]);
    expect(filesToRetire({ thumbnail: lh3(A) }, { thumbnail: thumb(A) })).toEqual([]);
  });

  it('a cover MOVED into the body is still in use', () => {
    const before = { thumbnail: lh3(A), content: '<p>x</p>' };
    const after = { thumbnail: lh3(B), content: img(lh3(A)) };
    expect(filesToRetire(before, after)).toEqual([]);
  });

  it('a file another article still points at is kept', () => {
    // The duplicate-an-article-for-next-year case: two rows, one cover.
    const before = { thumbnail: lh3(A), content: '' };
    const after = { thumbnail: lh3(B), content: '' };
    const others = [{ id: 2, thumbnail_url: lh3(A), content: '' }];
    expect(filesToRetire(before, after, others)).toEqual([]);
  });

  it('a file another article uses in its BODY is kept', () => {
    const before = { thumbnail: lh3(A), content: '' };
    const others = [{ id: 2, thumbnail_url: lh3(C), content: img(view(A)) }];
    expect(filesToRetire(before, null, others)).toEqual([]);
  });

  it('a new article replaced nothing', () => {
    expect(filesToRetire(null, { thumbnail: lh3(A), content: img(lh3(B)) })).toEqual([]);
    expect(filesToRetire({ thumbnail: '', content: '' }, { thumbnail: lh3(A) })).toEqual([]);
  });

  it('survives junk without retiring anything', () => {
    expect(filesToRetire(undefined, undefined)).toEqual([]);
    expect(filesToRetire({}, {})).toEqual([]);
    expect(filesToRetire({ content: '<p>ไม่มีรูป</p>' }, null)).toEqual([]);
  });

  it('a non-Drive image is never returned — we can only delete our own files', () => {
    const before = { thumbnail: 'https://example.com/cover.png', content: '<img src="https://cdn.x/y.png">' };
    expect(filesToRetire(before, null)).toEqual([]);
  });
});

describe('filesToRetire — invariants that hold for every input', () => {
  const cases = [
    [{ thumbnail: lh3(A), content: img(lh3(B)) }, { thumbnail: lh3(C), content: '' }, []],
    [{ thumbnail: lh3(A) }, null, [{ id: 9, content: img(lh3(A)) }]],
    [{ thumbnail: lh3(A) }, { thumbnail: lh3(A) }, []],
    [{ content: img(view(B)) }, { content: img(lh3(B)) }, []],
  ];

  it('never returns an id the NEW version still uses', () => {
    for (const [before, after, others] of cases) {
      const kept = driveIdsInHtml(`${after?.thumbnail || ''} ${after?.content || ''}`);
      for (const id of filesToRetire(before, after, others)) {
        expect(kept.has(id), `would delete ${id}, which the article still shows`).toBe(false);
      }
    }
  });

  it('never returns an id that was not in the OLD version', () => {
    for (const [before, after, others] of cases) {
      const had = driveIdsInHtml(
        `${before?.thumbnail || before?.thumbnail_url || ''} ${before?.content || ''}`,
      );
      for (const id of filesToRetire(before, after, others)) {
        expect(had.has(id), `${id} was never used by this article`).toBe(true);
      }
    }
  });

  it('returns no duplicates, so a file is never trashed twice', () => {
    const before = { thumbnail: lh3(A, 1200), content: img(lh3(A, 600)) + img(view(A)) };
    const out = filesToRetire(before, null);
    expect(out).toEqual([A]);
    expect(new Set(out).size).toBe(out.length);
  });
});
