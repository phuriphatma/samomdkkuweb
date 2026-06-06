import { describe, it, expect } from 'vitest';
import {
  buildMembersCsv, parseCsv, parseMembersCsv, splitPath, buildExportJson,
} from './io.js';

describe('team/io CSV', () => {
  it('round-trips members through CSV (quoting commas + Thai)', () => {
    const rows = [
      { path: 'ฝ่ายบริหารองค์กร / ฝ่ายเอกสาร / หัวหน้าฝ่ายเอกสาร', prefix: 'นางสาว',
        full_name: 'ณญาดา รัตนวิศิษฏ์กุล', nickname: 'ปูปู้', student_id: '653070301-5',
        year: 'ปี 5', major: 'MD', kkumail: 'nayada.r@kkumail.com', confirmed: true },
      { path: 'A, Inc / B', prefix: '', full_name: 'มี, จุลภาค', nickname: '', student_id: '',
        year: '', major: '', kkumail: '', confirmed: false },
    ];
    const csv = buildMembersCsv(rows);
    const parsed = parseMembersCsv(csv);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].full_name).toBe('ณญาดา รัตนวิศิษฏ์กุล');
    expect(parsed[0].confirmed).toBe(true);
    expect(parsed[1].full_name).toBe('มี, จุลภาค');     // comma survived quoting
    expect(parsed[1].path).toBe('A, Inc / B');
    expect(parsed[1].confirmed).toBe(false);
  });

  it('parses escaped quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"he said ""hi""",2\r\n');
    expect(rows).toEqual([['a', 'b'], ['he said "hi"', '2']]);
  });

  it('maps Thai header aliases and confirm synonyms', () => {
    const csv = 'ตำแหน่ง,ชื่อ-สกุล,ชื่อเล่น,ยืนยัน\nฝ่าย/บทบาท,สมชาย ใจดี,ชาย,เข้าแล้ว';
    const [m] = parseMembersCsv(csv);
    expect(m.path).toBe('ฝ่าย/บทบาท');
    expect(m.full_name).toBe('สมชาย ใจดี');
    expect(m.nickname).toBe('ชาย');
    expect(m.confirmed).toBe(true);
  });

  it('drops rows without a full_name', () => {
    expect(parseMembersCsv('full_name\n\n')).toHaveLength(0);
  });

  it('splitPath trims and drops empties', () => {
    expect(splitPath(' A / B /  / C ')).toEqual(['A', 'B', 'C']);
  });
});

describe('team/io JSON export', () => {
  it('normalizes node + member shape', () => {
    const out = buildExportJson(
      [{ id: 'n1', parent_id: null, name: 'Div', kind: 'division', position: 0,
         permissions: ['pr'], inherit_permissions: false }],
      [{ id: 'm1', node_id: 'n1', position: 0, full_name: 'X', confirmed: true }],
    );
    expect(out.version).toBe(1);
    expect(out.nodes[0]).toMatchObject({ id: 'n1', permissions: ['pr'], inherit_permissions: false });
    expect(out.members[0]).toMatchObject({ id: 'm1', full_name: 'X', confirmed: true, prefix: null });
  });
});
