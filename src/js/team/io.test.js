import { describe, it, expect } from 'vitest';
import {
  buildMembersCsv, parseCsv, parseMembersCsv, splitPath, buildExportJson,
  normalizeYear, parseConfirmed, isLikelyEmail, cleanSpace, validateExportJson,
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

  it('splitPath separates on " / " but keeps a slash inside a name', () => {
    expect(splitPath(' A / B / C ')).toEqual(['A', 'B', 'C']);     // leading/trailing trimmed
    expect(splitPath('A / B / ')).toEqual(['A', 'B']);            // trailing separator dropped
    expect(splitPath('A Inc /  B ')).toEqual(['A Inc', 'B']);      // collapsed inner space
    expect(splitPath('ComArt / Art/Graphic')).toEqual(['ComArt', 'Art/Graphic']); // slash in name kept
    expect(splitPath('Art/Graphic')).toEqual(['Art/Graphic']);    // bare slash = part of name
  });

  it('normalizes year to a bare number', () => {
    expect(normalizeYear('ปี 5')).toBe('5');
    expect(normalizeYear('5')).toBe('5');
    expect(normalizeYear(3)).toBe('3');
    expect(normalizeYear('ปีที่ 3')).toBe('3');
    expect(normalizeYear('')).toBe(null);
    expect(normalizeYear('-')).toBe(null);
  });

  it('parses loose confirm values + flags unrecognized', () => {
    expect(parseConfirmed('true')).toEqual({ value: true, recognized: true });
    expect(parseConfirmed('TRU')).toEqual({ value: true, recognized: true });   // typo, leading t
    expect(parseConfirmed('เข้าแล้ว')).toEqual({ value: true, recognized: true });
    expect(parseConfirmed('รอยืนยัน')).toEqual({ value: false, recognized: true });
    expect(parseConfirmed('')).toEqual({ value: false, recognized: true });
    expect(parseConfirmed('maybe')).toEqual({ value: false, recognized: false });
  });

  it('parseMembersCsv normalizes year + carries confirm recognition', () => {
    const csv = 'path,full_name,year,confirmed\nA/B,สมชาย,ปี 4,เข้าแล้ว\nA/B,สมหญิง,2,หืม';
    const rows = parseMembersCsv(csv);
    expect(rows[0].year).toBe('4');
    expect(rows[0].confirmed).toBe(true);
    expect(rows[0].confirmedRecognized).toBe(true);
    expect(rows[1].year).toBe('2');
    expect(rows[1].confirmedRecognized).toBe(false);  // "หืม" ⇒ warn
  });

  it('isLikelyEmail / cleanSpace', () => {
    expect(isLikelyEmail('a@kkumail.com')).toBe(true);
    expect(isLikelyEmail('nope')).toBe(false);
    expect(cleanSpace('  a   b ')).toBe('a b');
  });

  it('validateExportJson rejects malformed shapes', () => {
    expect(validateExportJson([]).ok).toBe(false);              // array, not object
    expect(validateExportJson({ nodes: [] }).ok).toBe(false);   // empty nodes
    expect(validateExportJson({ nodes: [{ name: '' }] }).ok).toBe(false); // nameless node
    expect(validateExportJson({ nodes: [{ name: 'X' }], members: {} }).ok).toBe(false); // members not array
    expect(validateExportJson({ nodes: [{ name: 'X' }] }).ok).toBe(true);
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
