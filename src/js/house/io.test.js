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
  it('RECOVERS a mixed-width สาย file, loudly — the house is the last digit', () => {
    // Excel strips LEADING zeros only, so left-padding is information-preserving
    // and the house (last digit) is invariant under it. This was fatal once; it
    // refused real files to protect against a corruption that padding undoes.
    const mixed = [
      HEAD,
      '659999999-9,ก,ข,,a@kkumail.com,MD,17',    // was 017
      '669999998-8,ค,ง,,b@kkumail.com,MD,003',
    ].join('\n');
    const r = parseStudentsCsv(mixed, ['MD']);
    expect(r.fatal).toBeNull();
    expect(r.rows.map((x) => x.sai_code)).toEqual(['017', '003']);
    expect(r.rows.map((x) => x._house)).toEqual([7, 3]);
    // …and still says what it did, as INFO not a warning: short สาย are
    // explicitly allowed by the spec we send out, so the common cause of a
    // mixed-width file is a sender following instructions, not damage.
    const note = r.problems.find((p) => /ยาวไม่เท่ากัน/.test(p.message));
    expect(note.level).toBe('info');
    expect(note.message).toMatch(/ถ้าตั้งใจส่งมาแบบสั้น ถือว่าถูกต้อง/);
  });

  it('refuses a file that is not UTF-8 — the Thai names are already gone', () => {
    const mojibake = [HEAD, '659999999-9,\uFFFD\uFFFD,\uFFFD,,a@kkumail.com,MD,001'].join('\n');
    const r = parseStudentsCsv(mojibake, ['MD']);
    expect(r.fatal).toMatch(/UTF-8/);
    expect(r.rows).toHaveLength(0);
  });

  it('refuses a file whose name is ONE combined column — a split renames people', () => {
    const combined = ['full_name,kkumail,major,sai',
      'สมชาย ณ อยุธยา,a@kkumail.com,MD,001'].join('\n');
    const r = parseStudentsCsv(combined, ['MD']);
    expect(r.fatal).toMatch(/รวมชื่อกับนามสกุล/);
    expect(r.rows).toHaveLength(0);
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

  it('names its columns the way the TABLE does, so an export re-imports', () => {
    // One vocabulary — the schema's. The spec's friendlier spellings (`sai`,
    // `nickname_th`, ชื่อ, อีเมล) are aliases resolved at the door.
    expect(CSV_COLUMNS).toEqual([
      'student_id', 'first_name_th', 'last_name_th', 'nickname_imported',
      'kkumail', 'major', 'sai_code']);
    // Every import-owned column of a row IS an export column, so a backup taken
    // from this app can be handed straight back to it.
    for (const c of CSV_COLUMNS) expect(EXPORT_COLUMNS).toContain(c);
  });

  it('exports no generated column that the importer would READ BACK', () => {
    // `nickname` is coalesce(nickname_self, nickname_imported) in the database,
    // and the importer resolves a `nickname` header to nickname_imported — so
    // exporting it made an export→import round trip overwrite the university's
    // value with the student's own, irreversibly. `house` is derived too but has
    // no alias, so it round-trips as an ignored column and stays for humans.
    expect(EXPORT_COLUMNS).not.toContain('nickname');
    expect(EXPORT_COLUMNS).not.toContain('full_name');
    expect(EXPORT_COLUMNS).toContain('house');
  });
});

describe('an import never destroys a column the file did not carry', () => {
  // The bug this pins: toUpsertRow used to emit EVERY import-owned column, so a
  // corrected name-list that omitted `sai` wrote null over ~1,800 สายรหัส — and
  // every house placement with them — while the preview said "แก้ไข 1,800".
  const NO_SAI = ['kkumail,first_name_th,last_name_th',
    'a@kkumail.com,ก,ข'].join('\n');

  it('omits the missing column from the upsert payload entirely', () => {
    const r = parseStudentsCsv(NO_SAI, ['MD']);
    expect(r.fatal).toBeNull();
    expect(r.presentColumns).not.toContain('sai_code');
    const row = toUpsertRow(r.rows[0], 'batch-1', r.presentColumns);
    // Absent, NOT null: PostgREST builds ON CONFLICT DO UPDATE SET from the keys
    // present, so an absent key keeps the stored value while null overwrites it.
    expect('sai_code' in row).toBe(false);
    expect('major' in row).toBe(false);
    expect(row.kkumail).toBe('a@kkumail.com');
    expect(row.first_name_th).toBe('ก');
  });

  it('still writes null for a column that IS in the file but empty', () => {
    const withBlank = ['kkumail,first_name_th,nickname_th',
      'a@kkumail.com,ก,'].join('\n');
    const r = parseStudentsCsv(withBlank, ['MD']);
    const row = toUpsertRow(r.rows[0], 'b', r.presentColumns);
    expect('nickname_imported' in row).toBe(true);
    expect(row.nickname_imported).toBeNull();
  });

  it('does not report a change in a column the import will not touch', () => {
    const r = parseStudentsCsv(NO_SAI, ['MD']);
    const existing = [{ id: 'x', kkumail: 'a@kkumail.com', first_name_th: 'ก',
      last_name_th: 'ข', sai_code: '017', major: 'MD' }];
    const d = diffAgainstExisting(r.rows, existing, r.presentColumns);
    expect(d.same).toBe(1);
    expect(d.update).toBe(0);
  });
});

describe('the MINIMUM useful file — kkumail + สาย, no names at all (0126)', () => {
  // Asking Data Analytics for three columns instead of seven means 1,800
  // people's names never leave their department. The two things ระบบบ้าน cannot
  // derive are the สายรหัส and the address that identifies the person; a name is
  // not one of them, because the student can type their own.
  const MINIMAL = ['kkumail,student_id,sai',
    'a@kkumail.com,659999999-9,017',
    'b@kkumail.com,649999998-8,003'].join('\n');

  it('imports a file with no name column', () => {
    const r = parseStudentsCsv(MINIMAL, ['MD']);
    expect(r.fatal).toBeNull();
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].sai_code).toBe('017');
    expect(r.rows[0].first_name_th).toBeNull();
    // …and says so once, at file level, rather than 1,800 times per row.
    const notes = r.problems.filter((p) => p.field === 'first_name_th');
    expect(notes).toHaveLength(1);
    expect(notes[0].level).toBe('info');
  });

  it('writes only those three columns, so names already stored survive', () => {
    const r = parseStudentsCsv(MINIMAL, ['MD']);
    const row = toUpsertRow(r.rows[0], 'b', r.presentColumns);
    expect('first_name_th' in row).toBe(false);
    expect('nickname_imported' in row).toBe(false);
    expect(row.sai_code).toBe('017');
    expect(row.student_id).toBe('659999999-9');
  });

  it('still refuses a COMBINED name column — that one renames people', () => {
    // No name column names nobody; one combined column would rename everybody
    // whose surname has a space. The distinction is the whole point.
    const combined = ['full_name,kkumail,sai', 'สมชาย ณ อยุธยา,a@kkumail.com,017'].join('\n');
    expect(parseStudentsCsv(combined, ['MD']).fatal).toMatch(/รวมชื่อกับนามสกุล/);
  });

  it('keeps a row whose name cell is blank in a file that HAS the column', () => {
    const gap = [HEAD, '659999999-9,,,,a@kkumail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(gap, ['MD']);
    expect(r.rows).toHaveLength(1);          // was: skipped entirely, losing the สาย
    expect(r.problems.some((p) => p.level === 'warn' && p.field === 'first_name_th')).toBe(true);
  });
});

describe('a คำนำหน้า is REPORTED, never stripped', () => {
  // Reported by the owner: "some people has นาย in their names". They are right
  // — นาย and นาง open real Thai names, so cutting them off renames a person
  // irreversibly and nothing downstream can tell. Same class as splitting a
  // combined "ชื่อ-สกุล", which this importer already refuses to do.
  it('keeps "นายก" intact — it is a NAME, not a title plus a name', () => {
    const t = [HEAD, '659999999-9,นายก,ใจดี,,a@kkumail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows[0].first_name_th).toBe('นายก');
  });

  it('keeps "นายสมชาย" intact too, and says so', () => {
    const t = [HEAD, '659999999-9,นายสมชาย,ใจดี,,a@kkumail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows[0].first_name_th).toBe('นายสมชาย');   // NOT 'สมชาย'
    const warn = r.problems.find((p) => p.field === 'first_name_th');
    expect(warn.level).toBe('warn');
    expect(warn.message).toMatch(/คำนำหน้า/);
  });

  it('does not flag an ordinary name', () => {
    const t = [HEAD, '659999999-9,สมชาย,ใจดี,,a@kkumail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.problems.some((p) => p.field === 'first_name_th')).toBe(false);
  });
});

describe('kkumail case is flattened, and that is load-bearing', () => {
  it('lowercases the address the file sent', () => {
    // Not a style rule: students_kkumail_key is a plain UNIQUE index and every
    // identity lookup compares lower(kkumail) = lower(email), so two spellings
    // of one address would be two rows for one human. The database enforces it
    // as well (normalize_kkumail, migration 0119).
    const t = [HEAD, '659999999-9,ก,ข,,Somchai.J@KKUmail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    expect(r.rows[0].kkumail).toBe('somchai.j@kkumail.com');
  });

  it('still matches an existing row that differs only in case', () => {
    const t = [HEAD, '659999999-9,ก,ข,,Somchai.J@kkumail.com,MD,017'].join('\n');
    const r = parseStudentsCsv(t, ['MD']);
    const d = diffAgainstExisting(r.rows, [{ id: 'x', kkumail: 'somchai.j@kkumail.com',
      first_name_th: 'ก', last_name_th: 'ข', student_id: '659999999-9',
      major: 'MD', sai_code: '017' }], r.presentColumns);
    expect(d.insert).toBe(0);   // one person, not two
    expect(d.same).toBe(1);
  });
});
