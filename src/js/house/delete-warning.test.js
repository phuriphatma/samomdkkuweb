// ==============================================
// THE DELETE DIALOG MUST SAY WHICH OF THE TWO DELETES THIS IS.
//
// Deleting a นักศึกษา from ระบบบ้าน does one of two very different things, and
// the dialog said the same sentence for both:
//
//   • the person also holds a ทีม SAMO ตำแหน่ง → only the house placement goes;
//     team_members.person_id is ON DELETE SET NULL and the registry row is
//     pruned only when NO placement of any kind remains (proved against a real
//     rolled-back delete in tools/house0144-delete-impact.sql, 18/18);
//   • house-only, never signed in, never confirmed → public.people is pruned
//     with it and the person is gone entirely.
//
// Both wrong answers are silent and bad in opposite directions: promising
// erasure that does not happen makes the warning noise, and promising survival
// that does not happen erases somebody the admin meant to keep.
//
// The `impact` shape comes from student_delete_impact() (migration 0144).
// ==============================================
import { describe, it, expect } from 'vitest';
import { deleteWarningFor } from './index.js';

const BASE = 'ข้อมูลบ้าน สายรหัส และสิ่งที่นักศึกษาคนนี้กรอกเองจะหายไปทั้งหมด';

describe('deleteWarningFor', () => {
  it('falls back to the cautious wording when the server did not answer', () => {
    // A wrong reassurance is worse than a vague one — so no lookup means no
    // claim about ทีม SAMO in either direction.
    for (const v of [null, undefined]) {
      expect(deleteWarningFor(v)).toBe(BASE);
      expect(deleteWarningFor(v)).not.toMatch(/ทีม SAMO/);
    }
  });

  it('says the ตำแหน่ง SURVIVES, and names the ฝ่าย, when there is a posting', () => {
    const out = deleteWarningFor({
      team_postings: 2, team_nodes: 'ฝ่ายดิจิทัล · สำนักนายกฯ',
      person_will_be_pruned: false, pending_requests: 0,
    });
    expect(out).toMatch(/ยังอยู่ในทีม SAMO/);
    expect(out).toMatch(/ฝ่ายดิจิทัล · สำนักนายกฯ/);
    expect(out).toMatch(/จะไม่ถูกลบ/);
    expect(out).not.toMatch(/ลบออกจากระบบทั้งหมด/);
  });

  it('still says the ตำแหน่ง survives when the ฝ่าย names are missing', () => {
    const out = deleteWarningFor({ team_postings: 1, team_nodes: null, person_will_be_pruned: false });
    expect(out).toMatch(/ยังอยู่ในทีม SAMO/);
    expect(out).not.toMatch(/\(\)/);        // no empty bracket where a name would go
  });

  it('warns about TOTAL erasure only for a house-only, never-signed-in person', () => {
    const out = deleteWarningFor({
      team_postings: 0, team_nodes: null, person_will_be_pruned: true,
      signed_in: false, identity_confirmed: false, pending_requests: 0,
    });
    expect(out).toMatch(/ลบออกจากระบบทั้งหมด/);
    expect(out).toMatch(/กู้คืนไม่ได้/);
    expect(out).not.toMatch(/ยังอยู่ในทีม SAMO/);
  });

  it('does NOT threaten erasure for someone who has signed in', () => {
    const out = deleteWarningFor({
      team_postings: 0, person_will_be_pruned: false,
      signed_in: true, identity_confirmed: false,
    });
    expect(out).toMatch(/ข้อมูลตัวตนจะยังอยู่/);
    expect(out).not.toMatch(/ลบออกจากระบบทั้งหมด/);
  });

  it('does NOT threaten erasure for someone who confirmed their identity', () => {
    const out = deleteWarningFor({
      team_postings: 0, person_will_be_pruned: false,
      signed_in: false, identity_confirmed: true,
    });
    expect(out).toMatch(/ข้อมูลตัวตนจะยังอยู่/);
    expect(out).not.toMatch(/ลบออกจากระบบทั้งหมด/);
  });

  it('names the คำขอแก้ไข that CASCADE with the row', () => {
    const out = deleteWarningFor({ team_postings: 1, pending_requests: 3, person_will_be_pruned: false });
    expect(out).toMatch(/คำขอแก้ไข 3 รายการ/);
    expect(out).toMatch(/คำตอบของผู้ดูแล/);
  });

  it('says nothing about requests when there are none', () => {
    expect(deleteWarningFor({ team_postings: 1, pending_requests: 0, person_will_be_pruned: false }))
      .not.toMatch(/คำขอแก้ไข/);
  });

  it('always keeps the base sentence — the house data is gone in every case', () => {
    const cases = [
      { team_postings: 2, person_will_be_pruned: false },
      { team_postings: 0, person_will_be_pruned: true },
      { team_postings: 0, person_will_be_pruned: false, signed_in: true },
      null,
    ];
    for (const c of cases) expect(deleteWarningFor(c)).toContain(BASE);
  });

  it('never claims BOTH survival and erasure', () => {
    const cases = [
      { team_postings: 2, team_nodes: 'ฝ่าย', person_will_be_pruned: true },   // contradictory input
      { team_postings: 0, person_will_be_pruned: true },
      { team_postings: 1, person_will_be_pruned: false },
    ];
    for (const c of cases) {
      const out = deleteWarningFor(c);
      const survives = /จะไม่ถูกลบ/.test(out);
      const erased = /ลบออกจากระบบทั้งหมด/.test(out);
      expect(survives && erased, `said both for ${JSON.stringify(c)}`).toBe(false);
    }
  });
});
