import { describe, it, expect } from 'vitest';
import {
  parseStudentsCsv, diffAgainstExisting, toUpsertRow, buildStudentsCsv,
  IMPORT_OWNED_COLUMNS, EXPORT_COLUMNS, CSV_COLUMNS,
} from './io.js';

const HEAD = 'student_id,first_name_th,last_name_th,nickname_th,kkumail,major,sai';
const good = [
  HEAD,
  '659999999-9,มานี,ใจดี,นก,manee.j@kkumail.com,MD,017',
  '669999998-8,ปิติ,รักเรียน,ต้น,piti.r@kkumail.com,MD,003',
  '689999996-6,วีระ,ตั้งใจ,,weera.t@kkumail.com,MD,001',
].join('\n');

describe('parseStudentsCsv — the happy file', () => {
  it('parses every row and normalises สาย to three digits', () => {
    const r = parseStudentsCsv(good, ['MD', 'MDI', 'RT']);
    expect(r.fatal).toBeNull();
    expect(r.rows).toHaveLength(3);
    expect(r.rows.map((x) => x.sai_code)).toEqual(['017', '003', '001']);
    expect(r.rows[0].kkumail).toBe('manee.j@kkumail.com');
  });

  it('computes the house for the preview', () => {
    const r = parseStudentsCsv(good, ['MD']);
    expect(r.rows.map((x) => x._house)).toEqual([7, 3, 1]);
  });

  it('puts the nickname in nickname_IMPORTED, never nickname_self', () => {
    const r = parseStudentsCsv(good, ['MD']);
    expect(r.rows[0].nickname_imported).toBe('นก');
    expect(r.rows[0].nickname_self).toBeUndefined();
  });

  it('leaves a blank nickname blank rather than storing a dash', () => {
    const r = parseStudentsCsv(good, ['MD']);
    expect(r.rows[2].nickname_imported).toBeNull();
  });

  it('turns a "-" placeholder into null', () => {
    const t = [HEAD, '659999999-9,ก,ข,-,a@kkumail.com,MD,001'].join('\n');
    expect(parseStudentsCsv(t, ['MD']).rows[0].nickname_imported).toBeNull();
  });
});

describe('parseStudentsCsv — REFUSES the files that corrupt silently', () => {
  it('refuses a file with mixed สาย widths (Excel ate the leading zeros)', () => {
    const bad = [
      HEAD,
      '659999999-9,ก,ข,,a@kkumail.com,MD,17',    // was 017
      '669999998-8,ค,ง,,b@kkumail.com,MD,003',
    ].join('\n');
    const r = parseStudentsCsv(bad, ['MD']);
    expect(r.fatal).toBeTruthy();
    expect(r.fatal).toMatch(/ความยาวไม่เท่ากัน/);
    expect(r.rows).toHaveLength(0);   // nothing is offered for import
  });

  it('ACCEPTS a consistently 2-digit file — the width just has to be uniform', () => {
    const two = [
      HEAD,
      '659999999-9,ก,ข,,a@kkumail.com,MD,17',
      '669999998-8,ค,ง,,b@kkumail.com,MD,03',
    ].join('\n');
    const r = parseStudentsCsv(two, ['MD']);
    expect(r.fatal).toBeNull();
    expect(r.rows.map((x) => x.sai_code)).toEqual(['017', '003']);
  });

  it('refuses a file with no kkumail column at all', () => {
    const noMail = ['student_id,first_name_th,sai', '659999999-9,ก,001'].join('\n');
    const r = parseStudentsCsv(noMail, []);
    expect(r.fatal).toMatch(/kkumail/);
  });

  it('refuses an empty file', () => {
    expect(parseStudentsCsv('', []).fatal).toBeTruthy();
  });
});

describe('parseStudentsCsv — per-row problems', () => {
  it('skips a row with an unusable email and says which line', () => {
    const t = [HEAD, '659999999-9,ก,ข,,not-an-email,MD,001'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows).toHaveLength(0);
    expect(r.problems[0].level).toBe('skip');
    expect(r.problems[0].message).toMatch(/บรรทัด 2/);
  });

  it('skips a duplicate email and names the first line it saw', () => {
    const t = [HEAD,
      '659999999-9,ก,ข,,a@kkumail.com,MD,001',
      '669999998-8,ค,ง,,a@kkumail.com,MD,002'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows).toHaveLength(1);
    expect(r.problems.some((p) => /ซ้ำกับบรรทัด 2/.test(p.message))).toBe(true);
  });

  it('WARNS but keeps a row whose สาขา is unknown — never blanks it', () => {
    const t = [HEAD, '659999999-9,ก,ข,,a@kkumail.com,ZZ,001'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].major).toBe('ZZ');
    expect(r.problems.some((p) => p.field === 'major' && p.level === 'warn')).toBe(true);
  });

  it('accepts Thai and aliased headers', () => {
    const t = ['รหัสนักศึกษา,ชื่อ,นามสกุล,ชื่อเล่น,อีเมล,สาขา,สายรหัส',
      '659999999-9,ก,ข,ค,a@kkumail.com,MD,001'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.fatal).toBeNull();
    expect(r.rows[0].sai_code).toBe('001');
  });
});

describe('the import/self-edit boundary', () => {
  it('IMPORT_OWNED_COLUMNS contains nothing the student owns', () => {
    for (const forbidden of ['nickname_self', 'photo_url', 'bio', 'year_override',
      'is_listed', 'verified_at', 'sai_locked', 'status']) {
      expect(IMPORT_OWNED_COLUMNS).not.toContain(forbidden);
    }
  });

  it('toUpsertRow emits ONLY import-owned columns plus bookkeeping', () => {
    const row = {
      kkumail: 'a@kkumail.com', first_name_th: 'ก', sai_code: '001',
      nickname_self: 'ห้ามเขียน', photo_url: 'ห้ามเขียน', _line: 2, _house: 1,
    };
    const out = toUpsertRow(row, 'batch-1');
    expect(out.nickname_self).toBeUndefined();
    expect(out.photo_url).toBeUndefined();
    expect(out._line).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(
      [...IMPORT_OWNED_COLUMNS, 'last_import_batch', 'missing_since'].sort());
  });
});

describe('diffAgainstExisting — the preview must be right before anything writes', () => {
  const parsed = parseStudentsCsv(good, ['MD']).rows;

  it('counts everything as an insert against an empty database', () => {
    const d = diffAgainstExisting(parsed, []);
    expect(d).toMatchObject({ insert: 3, update: 0, same: 0 });
  });

  it('detects an unchanged row as "same", not as an update', () => {
    const existing = parsed.map((r) => ({ ...r }));
    const d = diffAgainstExisting(parsed, existing);
    expect(d.same).toBe(3);
    expect(d.update).toBe(0);
  });

  it('names which columns changed', () => {
    const existing = parsed.map((r) => ({ ...r }));
    existing[0].sai_code = '099';
    const d = diffAgainstExisting(parsed, existing);
    expect(d.update).toBe(1);
    expect(d.verdicts[0]._changed).toContain('sai_code');
  });

  it('reports rows absent from the file as MISSING — never as a delete', () => {
    const existing = [...parsed.map((r) => ({ ...r })),
      { kkumail: 'ghost@kkumail.com', first_name_th: 'ผี' }];
    const d = diffAgainstExisting(parsed, existing);
    expect(d.missing).toHaveLength(1);
    expect(d.missing[0].kkumail).toBe('ghost@kkumail.com');
  });

  it('matches case-insensitively on kkumail', () => {
    const existing = parsed.map((r) => ({ ...r, kkumail: r.kkumail.toUpperCase() }));
    expect(diffAgainstExisting(parsed, existing).insert).toBe(0);
  });
});

describe('export is a BACKUP allow-list', () => {
  it('round-trips the import columns, so an export→import cannot lose them', () => {
    for (const c of IMPORT_OWNED_COLUMNS) {
      // nickname_imported is exported under its own name; the rest map 1:1.
      expect(EXPORT_COLUMNS).toContain(c === 'nickname_imported' ? 'nickname_imported' : c);
    }
  });

  it('includes the derived house so a human reading the file can see it', () => {
    const csv = buildStudentsCsv([{ kkumail: 'a@kkumail.com', sai_code: '017' }]);
    const [head, row] = csv.split('\r\n');
    expect(head.split(',')).toEqual(EXPORT_COLUMNS);
    expect(row.split(',')[EXPORT_COLUMNS.indexOf('house')]).toBe('7');
  });

  it('quotes a value containing a comma', () => {
    const csv = buildStudentsCsv([{ kkumail: 'a@kkumail.com', first_name_th: 'ก,ข' }]);
    expect(csv).toContain('"ก,ข"');
  });

  it('the documented 7 request columns are what the parser expects', () => {
    expect(CSV_COLUMNS).toEqual([
      'student_id', 'first_name_th', 'last_name_th', 'nickname_th',
      'kkumail', 'major', 'sai']);
  });
});
