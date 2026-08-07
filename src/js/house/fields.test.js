import { describe, it, expect } from 'vitest';
import {
  normalizeSai, houseOf, houseLabel, auditSaiWidths, cleanCell, cleanSpace,
  normalizeKkumail, joinName, blankish, SAI_RE, HOUSE_COUNT,
  studentYear, cohortFromStudentId,
} from './fields.js';

describe('normalizeSai — three digits, zero-padded', () => {
  it('pads short values, which is the whole point', () => {
    expect(normalizeSai('1').value).toBe('001');
    expect(normalizeSai('17').value).toBe('017');
    expect(normalizeSai('017').value).toBe('017');
    expect(normalizeSai('100').value).toBe('100');
  });

  it('reports WHETHER it had to pad, so the importer can spot Excel damage', () => {
    expect(normalizeSai('017').padded).toBe(false);
    expect(normalizeSai('17').padded).toBe(true);
    expect(normalizeSai('1').padded).toBe(true);
  });

  it('accepts Thai numerals and surrounding space', () => {
    expect(normalizeSai(' ๐๑๗ ').value).toBe('017');
  });

  it('REFUSES 4+ digits rather than guessing which end to cut', () => {
    const r = normalizeSai('1234');
    expect(r.ok).toBe(false);
    // The raw value is kept, never silently blanked.
    expect(r.value).toBe('1234');
  });

  it('treats empty as empty, not as zero', () => {
    expect(normalizeSai('').value).toBeNull();
    expect(normalizeSai(null).value).toBeNull();
    expect(normalizeSai('  ').ok).toBe(true);
  });

  it('every normalised value matches the canonical shape', () => {
    for (const raw of ['1', '17', '100', '007', '๙']) {
      expect(SAI_RE.test(normalizeSai(raw).value)).toBe(true);
    }
  });
});

describe('houseOf — the last digit, and nothing else', () => {
  it('maps the documented examples', () => {
    expect(houseOf('001')).toBe(1);
    expect(houseOf('010')).toBe(0);
    expect(houseOf('100')).toBe(0);
    expect(houseOf('017')).toBe(7);
    expect(houseOf('099')).toBe(9);
  });

  it('refuses a non-canonical code rather than guessing', () => {
    expect(houseOf('1')).toBeNull();
    expect(houseOf('17')).toBeNull();
    expect(houseOf('')).toBeNull();
    expect(houseOf(null)).toBeNull();
    expect(houseOf('abc')).toBeNull();
  });

  // This is the assertion migration 0116 makes in SQL. Pinning it here too is
  // deliberate: it is the ONE rule the whole feature hangs off, and the JS copy
  // exists for the import preview. If these ever disagree, the DB column wins —
  // but they must not disagree.
  it('partitions สาย 001..100 into exactly 10 houses of 10', () => {
    const buckets = new Map();
    for (let n = 1; n <= 100; n += 1) {
      const code = String(n).padStart(3, '0');
      const h = houseOf(code);
      expect(h).not.toBeNull();
      buckets.set(h, (buckets.get(h) || 0) + 1);
    }
    expect(buckets.size).toBe(HOUSE_COUNT);
    for (const [, count] of buckets) expect(count).toBe(10);
  });

  it('puts 100 with 010..090, not in a house of its own', () => {
    expect(houseOf('100')).toBe(houseOf('010'));
  });
});

describe('auditSaiWidths — the leading-zero disaster is only visible file-wide', () => {
  it('accepts a file where every สาย is three digits', () => {
    const a = auditSaiWidths(['001', '017', '100', '099']);
    expect(a.consistent).toBe(true);
    expect(a.looksLikeStrippedZeros).toBe(false);
  });

  it('accepts a consistently 2-digit file (a different but valid convention)', () => {
    const a = auditSaiWidths(['01', '17', '99']);
    expect(a.consistent).toBe(true);
  });

  it('CATCHES the Excel mix, which no single row reveals', () => {
    // '1' here was '001' before a spreadsheet touched it. On its own it looks
    // like a perfectly ordinary สาย.
    const a = auditSaiWidths(['1', '17', '100', '003']);
    expect(a.consistent).toBe(false);
    expect(a.looksLikeStrippedZeros).toBe(true);
    expect(a.widths).toEqual([
      { width: 1, count: 1 }, { width: 2, count: 1 }, { width: 3, count: 2 },
    ]);
  });

  it('counts blanks separately instead of calling them a width', () => {
    const a = auditSaiWidths(['001', '', '  ', '017']);
    expect(a.blank).toBe(2);
    expect(a.consistent).toBe(true);
  });
});

describe('cleanCell / blankish — "-" must never become a nickname', () => {
  it('turns the placeholder spellings into null', () => {
    for (const v of ['-', '–', 'N/A', 'na', 'ไม่มี', 'ยังไม่ทราบ', 'null', '']) {
      expect(cleanCell(v)).toBeNull();
    }
    expect(blankish('-')).toBe(true);
  });

  it('keeps real content', () => {
    expect(cleanCell(' โอ๊ต ')).toBe('โอ๊ต');
  });

  it('strips the invisible spaces that arrive from Word/web copy-paste', () => {
    expect(cleanSpace('ภูริพัฒน์ มาตรา')).toBe('ภูริพัฒน์ มาตรา');
    expect(cleanSpace('ก​ข')).toBe('ก ข');
    expect(cleanSpace('  a   b  ')).toBe('a b');
  });
});

describe('normalizeKkumail', () => {
  it('lowercases and trims', () => {
    expect(normalizeKkumail('  Phuriphat.MA@KKUmail.com ').value)
      .toBe('phuriphat.ma@kkumail.com');
  });
  it('rejects a value that is not an address — this key is the login match', () => {
    expect(normalizeKkumail('phuriphat.ma').ok).toBe(false);
    expect(normalizeKkumail('-').ok).toBe(false);
    expect(normalizeKkumail('').ok).toBe(false);
  });
});

describe('joinName', () => {
  it('joins the two columns the spec asks for', () => {
    expect(joinName('ภูริพัฒน์', 'มาตรา')).toBe('ภูริพัฒน์ มาตรา');
  });
  it('keeps a multi-word surname whole', () => {
    expect(joinName('ปรียานุช', 'ณ อยุธยา')).toBe('ปรียานุช ณ อยุธยา');
  });
  it('survives a missing half', () => {
    expect(joinName('ภูริพัฒน์', '')).toBe('ภูริพัฒน์');
  });
});

describe('houseLabel — a house with no name yet is not an error', () => {
  it('falls back to the number, which IS the pre-จับฉลาก state', () => {
    expect(houseLabel(3, null)).toBe('บ้าน 3');
    expect(houseLabel(0, '   ')).toBe('บ้าน 0');
  });
  it('uses the name once there is one', () => {
    expect(houseLabel(3, 'กัลปพฤกษ์')).toBe('กัลปพฤกษ์');
  });
});

// These cases are the SAME ones tools/house0116-authz.sql asserts against the
// live database (สาย 017 → house 7, รหัส 65…, academic year 2569 → ปี 5). The
// SQL is the authority; this pins the JS mirror to it so the two cannot drift
// silently between deploys.
describe('cohortFromStudentId — mirrors SQL cohort_from_student_id', () => {
  it('reads ปีที่เข้า from the first two digits', () => {
    expect(cohortFromStudentId('653070317-0')).toBe(2565);
    expect(cohortFromStudentId('6530703170')).toBe(2565);
    expect(cohortFromStudentId('683070001-4')).toBe(2568);
  });

  it('FAILS CLOSED outside 2540–2580 — the 0118 fix', () => {
    // 2500+99 = 2599 was inside the original bound, so a malformed id produced
    // a confident "ปี 1" after the clamp. It must be null.
    expect(cohortFromStudentId('993070001-4')).toBeNull();
    expect(cohortFromStudentId('103070001-4')).toBeNull();
  });

  it('returns null rather than guessing on junk', () => {
    expect(cohortFromStudentId('abc')).toBeNull();
    expect(cohortFromStudentId('')).toBeNull();
    expect(cohortFromStudentId(null)).toBeNull();
  });
});

describe('studentYear — mirrors SQL student_year', () => {
  const AY = 2569;

  it('derives ชั้นปี from the stored cohort', () => {
    expect(studentYear({ cohort_year: 2565 }, AY)).toBe(5);
    expect(studentYear({ cohort_year: 2569 }, AY)).toBe(1);
  });

  it('falls back to รหัสนักศึกษา when no cohort is stored', () => {
    expect(studentYear({ student_id: '653070317-0' }, AY)).toBe(5);
  });

  it('lets a self-declared override win — the ลาพัก / จบช้า escape hatch', () => {
    expect(studentYear({ cohort_year: 2565, year_override: 6 }, AY)).toBe(6);
    expect(studentYear({ student_id: '653070317-0', year_override: 3 }, AY)).toBe(3);
  });

  it('never returns a year below 1, however old the cohort', () => {
    expect(studentYear({ cohort_year: 2500 }, AY)).toBeGreaterThanOrEqual(1);
  });

  it('returns null — not a guess — when there is nothing to derive from', () => {
    expect(studentYear({}, AY)).toBeNull();
    expect(studentYear({ cohort_year: 2565 }, null)).toBeNull();
    expect(studentYear({ student_id: '993070001-4' }, AY)).toBeNull();
  });
});
