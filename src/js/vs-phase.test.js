// Pure-function tests for the submitter-facing VS phase mapping.
//
// The 9 internal staff statuses stay the source of truth; the student
// tracking view collapses them into 4 friendly phases. This locks the
// mapping so a status rename (or a new column in vs-staff.js) can't
// silently drop a status into the wrong phase — most importantly that a
// completed ticket never reads as still-in-progress, and a rejected
// bounce reads as "under review", not "done".

import { describe, it, expect } from 'vitest';
import { vsPhaseIndex, VS_PHASES } from './vs-tracking.js';

describe('vsPhaseIndex — 9 statuses → 4 phases', () => {
  const cases = [
    // status (exact, from vs-staff.js KANBAN_COLUMNS) → expected phase index
    ['รอ SE รับเรื่อง', 0],
    ['SE รับเรื่องแล้ว', 1],
    ['กำลังรออุปนายกพิจารณา (ด่วน)', 1],
    ['กำลังรออุปนายกพิจารณา', 1],
    ['อุปนายกรับเรื่องแล้ว', 1],
    ['ปฏิเสธ (ส่งคืน SE)', 1], // bounce back to SE — not terminal
    ['กำลังดำเนินการ', 2],        // legacy value (renamed by 0077, kept for stale clients)
    ['สโมกำลังดำเนินการ', 2],     // 0077 split: SAMO working
    ['คณะกำลังดำเนินการ', 2],     // 0077 split: faculty working
    ['กำลังติดต่อคณะ', 2],
    ['เสร็จสิ้น', 3],
  ];

  it.each(cases)('%s → phase %i', (status, expected) => {
    expect(vsPhaseIndex(status)).toBe(expected);
  });

  it('completed never falls into an earlier band even with extra text', () => {
    expect(vsPhaseIndex('เสร็จสิ้น (แก้ไขแล้ว)')).toBe(3);
  });

  it('unknown / legacy status defaults to the initial phase', () => {
    expect(vsPhaseIndex('')).toBe(0);
    expect(vsPhaseIndex(undefined)).toBe(0);
    expect(vsPhaseIndex('สถานะเก่าจาก Sheets')).toBe(0);
  });

  it('every phase index has a defined phase descriptor', () => {
    expect(VS_PHASES).toHaveLength(4);
    for (const p of VS_PHASES) {
      expect(p.label).toBeTruthy();
      expect(p.desc).toBeTruthy();
      expect(p.badge).toBeTruthy();
    }
  });
});
