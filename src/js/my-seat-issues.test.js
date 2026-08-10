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
    const out = ownIssues(seat([posting({ nickname: '', major: '   ' })]));
    const missing = out.filter((i) => i.kind === 'missing');
    expect(missing).toHaveLength(1);
    expect(missing[0].detail).toContain('ชื่อเล่น');
    expect(missing[0].detail).toContain('สาขา');
  });

  it('never asks for ชั้นปี — it asks for the รหัส it is computed from', () => {
    // "กรอกชั้นปี" is an instruction nobody can follow: the only way to fill it
    // is the รหัสนักศึกษา that is already on the same list. A derived field is
    // never "ยังไม่ได้กรอก" (0145).
    const out = ownIssues(seat([posting({ student_id: null })]));
    const missing = out.find((i) => i.kind === 'missing');
    expect(missing.detail).toContain('รหัสนักศึกษา');
    expect(missing.detail).not.toContain('ชั้นปี');
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
    // The editable set must match what team_members_self_update_guard allows
    // (0110, rewritten in 0113, extended in 0135): name, nickname, รหัส, ชั้นปี,
    // สาขา and the photo. `full_name` was missing here until 0113 — the guard
    // allowed it, the card showed it, and the form did not offer it.
    //
    // ชื่อ and นามสกุล replaced the single ชื่อ-สกุล box in 0135. The card no
    // longer offers `full_name` at all: it is DERIVED from these two, and the
    // only way to edit it as one string would be to split it again.
    // `study_year` replaced `year` in 0145: same box, same position, but it
    // reads a calculation and saves the GAP (ลาพัก / เรียนซ้ำ) on the registry
    // instead of an absolute ชั้นปี on the posting.
    expect(DETAIL_FIELDS.filter((f) => f.editable).map((f) => f.key))
      .toEqual(['first_name_th', 'last_name_th', 'nickname', 'student_id', 'study_year', 'major']);
    expect(DETAIL_FIELDS.some((f) => f.key === 'year')).toBe(false);
    // คำนำหน้า is gone from the schema entirely (0113).
    expect(DETAIL_FIELDS.some((f) => f.key === 'prefix')).toBe(false);
  });
});

describe('sid_clash — the finding the client cannot compute', () => {
  it('is surfaced from the server count, in the admin pane\'s words', () => {
    const s = { postings: [posting()], student_id_shared_with: 1 };
    const clash = ownIssues(s).find((i) => i.kind === 'sid_clash');
    expect(clash).toBeTruthy();
    expect(clash.label).toBe('รหัสนักศึกษาซ้ำกับคนอื่น');   // same wording as ตรวจสอบข้อมูล
    expect(clash.detail).toContain('653070001-1');            // their own รหัส
    expect(clash.detail).toContain('1');                      // how many others
  });

  it('names nobody — the payload carries a COUNT, not people', () => {
    const s = { postings: [posting()], student_id_shared_with: 2 };
    const clash = ownIssues(s).find((i) => i.kind === 'sid_clash');
    expect(clash.detail).not.toContain('@');
  });

  it('stays quiet when the รหัส is unique', () => {
    expect(ownIssues({ postings: [posting()], student_id_shared_with: 0 })
      .some((i) => i.kind === 'sid_clash')).toBe(false);
    // and when an older payload has no such key at all
    expect(ownIssues({ postings: [posting()] })
      .some((i) => i.kind === 'sid_clash')).toBe(false);
  });
});
