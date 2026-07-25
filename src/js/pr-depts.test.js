import { describe, it, expect } from 'vitest';
import { PR_DEPARTMENTS, canonicalPrDept } from './pr-depts.js';

describe('pr-depts list', () => {
  it('offers นายกสโม first and โครงการอื่นๆ last', () => {
    expect(PR_DEPARTMENTS[0]).toBe('นายกสโม');
    expect(PR_DEPARTMENTS[PR_DEPARTMENTS.length - 1]).toBe('โครงการอื่นๆ');
  });

  it('has no duplicates and no legacy spelling', () => {
    expect(new Set(PR_DEPARTMENTS).size).toBe(PR_DEPARTMENTS.length);
    expect(PR_DEPARTMENTS).not.toContain('ฝ่ายคุณภาพขีวิตและสิ่งแวดล้อม');
    expect(PR_DEPARTMENTS).toContain('ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม');
    expect(PR_DEPARTMENTS).toContain('ฝ่ายรังสีเทคนิค');
  });
});

describe('canonicalPrDept', () => {
  it('maps the superseded ขีวิต spelling onto the canonical option value', () => {
    // 8 live pr_tickets rows carry this; the dept filter must still find them.
    expect(canonicalPrDept('ฝ่ายคุณภาพขีวิตและสิ่งแวดล้อม'))
      .toBe('ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม');
    expect(PR_DEPARTMENTS).toContain(canonicalPrDept('ฝ่ายคุณภาพขีวิตและสิ่งแวดล้อม'));
  });

  it('passes every canonical value through untouched', () => {
    PR_DEPARTMENTS.forEach((d) => expect(canonicalPrDept(d)).toBe(d));
  });

  it('trims and tolerates empty / non-string input', () => {
    expect(canonicalPrDept('  นายกสโม  ')).toBe('นายกสโม');
    expect(canonicalPrDept('')).toBe('');
    expect(canonicalPrDept(null)).toBe('');
    expect(canonicalPrDept(undefined)).toBe('');
  });

  it('leaves an unknown department alone rather than dropping it', () => {
    expect(canonicalPrDept('ฝ่ายที่ยังไม่มีในลิสต์')).toBe('ฝ่ายที่ยังไม่มีในลิสต์');
  });
});
