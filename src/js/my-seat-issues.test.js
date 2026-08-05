// What the ตำแหน่งของฉัน card says is wrong with a person's own record (0110).
//
// The point of these tests is that the card and the admin ตรวจสอบข้อมูล pane
// agree — they now run the SAME rule engine (team/identity.js), and the
// regression worth guarding against is someone re-deriving the rules here.
import { describe, it, expect } from 'vitest';
import { ownIssues, DETAIL_FIELDS } from './my-seat.js';
import { findIssues } from './team/identity.js';

const posting = (over = {}) => ({
  member_id: 'm1',
  node_id: 'n1',
  node: 'หัวหน้าฝ่าย IT',
  path: ['ฝ่ายดิจิทัล'],
  prefix: 'นาย',
  full_name: 'สมชาย ใจดี',
  nickname: 'ชาย',
  student_id: '653070001-1',
  year: '5',
  major: 'MD',
  kkumail: 'somchai@kkumail.com',
  photo_url: 'https://lh3.googleusercontent.com/d/abc=w1200',
  ...over,
});
const seat = (postings) => ({ postings });

describe('ownIssues', () => {
  it('says nothing about a complete record', () => {
    expect(ownIssues(seat([posting()]))).toEqual([]);
  });

  it('handles a signed-out / empty payload without throwing', () => {
    expect(ownIssues(null)).toEqual([]);
    expect(ownIssues({ postings: [] })).toEqual([]);
  });

  it('names every empty field in ONE finding, not one finding per field', () => {
    const out = ownIssues(seat([posting({ nickname: '', year: null, major: '   ' })]));
    const missing = out.filter((i) => i.kind === 'missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].detail).toContain('ชื่อเล่น');
    expect(missing[0].detail).toContain('ชั้นปี');
    expect(missing[0].detail).toContain('สาขา');
  });

  it('reports a missing portrait separately — it is fixed elsewhere', () => {
    const out = ownIssues(seat([posting({ photo_url: null })]));
    expect(out.some((i) => i.kind === 'missing_photo')).toBe(true);
  });

  it('flags a kkumail that is not an address, like the admin pane does', () => {
    // '-' is a real live value, and it is what split one person into two.
    const out = ownIssues(seat([posting({ kkumail: '-' })]));
    expect(out.some((i) => i.kind === 'invalid_email')).toBe(true);
  });

  it('flags two postings that disagree about the same field', () => {
    const out = ownIssues(seat([
      posting({ member_id: 'm1', nickname: 'ชาย' }),
      posting({ member_id: 'm2', node_id: 'n2', node: 'เลขานุการ', nickname: 'ชายน้อย' }),
    ]));
    const drift = out.find((i) => i.kind === 'drift');
    expect(drift).toBeTruthy();
    expect(drift.detail).toContain('ชาย');
    expect(drift.detail).toContain('ชายน้อย');
  });

  it('flags one person carrying two different รหัสนักศึกษา', () => {
    const out = ownIssues(seat([
      posting({ member_id: 'm1', student_id: '653070001-1' }),
      posting({ member_id: 'm2', node_id: 'n2', student_id: '653070002-2' }),
    ]));
    expect(out.some((i) => i.kind === 'sid_drift')).toBe(true);
  });

  it('uses the shared rule engine, not a private copy of the rules', () => {
    // If someone re-implements the checks inside my-seat.js, this drifts. The
    // assertion is deliberately about AGREEMENT rather than about a literal
    // count, so adding a new rule to identity.js does not fail it spuriously.
    const rows = [
      { id: 'm1', node_id: 'n1', full_name: 'ก', nickname: 'x', kkumail: 'a@kkumail.com', student_id: '1' },
      { id: 'm2', node_id: 'n2', full_name: 'ก', nickname: 'y', kkumail: 'a@kkumail.com', student_id: '2' },
    ];
    const engineKinds = new Set(findIssues(rows, () => '').issues.map((i) => i.kind));
    const cardKinds = new Set(
      ownIssues(seat(rows.map((r) => ({ ...r, member_id: r.id })))).map((i) => i.kind),
    );
    for (const k of engineKinds) expect(cardKinds.has(k)).toBe(true);
  });

  it('never offers kkumail as editable — it is the identity every resolver keys on', () => {
    // Changing it would also move the row out of the caller's own SELECT
    // policy, which Postgres reports as a WITH CHECK violation (0107).
    const mail = DETAIL_FIELDS.find((f) => f.key === 'kkumail');
    expect(mail.editable).toBe(false);
    expect(DETAIL_FIELDS.filter((f) => f.editable).map((f) => f.key))
      .toEqual(['nickname', 'student_id', 'year', 'major']);
  });
});
