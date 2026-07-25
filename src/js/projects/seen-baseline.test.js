import { describe, it, expect } from 'vitest';
import { planSeenAtRows } from './inbox.js';

// Seen-state is PER USER (project_doc_views + a user-scoped localStorage map).
// The shared samomdkkuvpa account looks clean only because it has been reading
// these documents for months; a newly seat-granted person starts with nothing,
// so every card rendered an "อัปเดต" pill for activity that predates their
// access. planSeenAtRows decides between migrating an existing reader's local
// state and baselining a brand-new one to "caught up as of now".
const U = 'user-1';
const DOCS = ['DOC-A', 'DOC-B', 'DOC-C'];
const NOW = '2026-07-25T10:00:00.000Z';

describe('planSeenAtRows', () => {
  it('BASELINE: a brand-new reader is marked caught-up on every visible doc', () => {
    const rows = planSeenAtRows({
      userId: U, local: new Map(), knownDocIds: DOCS, now: NOW,
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.seen_at === NOW && r.user_id === U)).toBe(true);
    expect(rows.map((r) => r.document_id).sort()).toEqual(DOCS);
  });

  it('never baselines an established reader — that would mark real unread as read', () => {
    expect(planSeenAtRows({
      userId: U, local: new Map(), knownDocIds: DOCS,
      server: new Map([['DOC-A', '2026-01-01T00:00:00.000Z']]), now: NOW,
    })).toEqual([]);
  });

  // The sentinel key was bumped so the new rule re-runs once for everyone.
  // The upsert uses merge-duplicates (it OVERWRITES seen_at), so a stale local
  // value must never be pushed over a newer server one — that would re-flag
  // documents the user has already read.
  it('re-run is safe: a local seenAt older than the server is dropped', () => {
    const rows = planSeenAtRows({
      userId: U,
      local: new Map([['DOC-A', '2026-01-01T00:00:00.000Z']]),
      server: new Map([['DOC-A', '2026-06-01T00:00:00.000Z']]),
      knownDocIds: DOCS, now: NOW,
    });
    expect(rows).toEqual([]);
  });

  it('a local seenAt NEWER than the server still wins (other device read it)', () => {
    const rows = planSeenAtRows({
      userId: U,
      local: new Map([['DOC-A', '2026-06-02T00:00:00.000Z']]),
      server: new Map([['DOC-A', '2026-06-01T00:00:00.000Z']]),
      knownDocIds: DOCS, now: NOW,
    });
    expect(rows).toEqual([
      { user_id: U, document_id: 'DOC-A', seen_at: '2026-06-02T00:00:00.000Z' },
    ]);
  });

  it('MIGRATE: local seenAt is pushed up verbatim, not flattened to now', () => {
    const local = new Map([['DOC-A', '2026-01-01T00:00:00.000Z']]);
    const rows = planSeenAtRows({
      userId: U, local, knownDocIds: DOCS, now: NOW,
    });
    expect(rows).toEqual([
      { user_id: U, document_id: 'DOC-A', seen_at: '2026-01-01T00:00:00.000Z' },
    ]);
  });

  it('having ANY local history suppresses the baseline — the rest stay unread', () => {
    const local = new Map([['DOC-A', '2026-01-01T00:00:00.000Z']]);
    const rows = planSeenAtRows({
      userId: U, local, knownDocIds: DOCS, now: NOW,
    });
    expect(rows.map((r) => r.document_id)).toEqual(['DOC-A']);
  });

  it('drops local entries for docs that are not visible, so the FK resolves', () => {
    const local = new Map([['DOC-A', NOW], ['DOC-GONE', NOW]]);
    const rows = planSeenAtRows({
      userId: U, local, knownDocIds: DOCS, now: NOW,
    });
    expect(rows.map((r) => r.document_id)).toEqual(['DOC-A']);
  });

  it('writes nothing when there are no visible docs at all', () => {
    expect(planSeenAtRows({
      userId: U, local: new Map(), knownDocIds: [], now: NOW,
    })).toEqual([]);
  });

  it('writes nothing without a user', () => {
    expect(planSeenAtRows({
      userId: null, local: new Map(), knownDocIds: DOCS, now: NOW,
    })).toEqual([]);
  });
});
