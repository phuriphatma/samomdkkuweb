// ==============================================
// duplicate-message.test.js — a unique-index violation, said to a human.
//
// REPORTED: adding a นักศึกษา who already exists produced
//   {"code":"23505","details":null,"hint":null,"message":"duplicate key value
//    violates unique constraint \"students_kkumail_key\""}
// on screen, in an alert().
//
// The banner in the form is the FIRST line of defence and it is a courtesy. This
// is the second, and it is the guarantee: the lookup can be in flight, it can
// fail, two admins can pass it in the same instant, and the รหัสนักศึกษา clash is
// deliberately not pre-checked at all (a shared รหัส is an ambiguous fact about
// two people, not a duplicate to merge — 0108). `update_my_student_record` is
// built the same way, and its comment says why: "the pre-check gives the good
// message in the ordinary case; the exception handler is what makes it true".
//
// So the thing worth pinning is that the handler recognises the error in EVERY
// shape PostgREST hands it back, and — the half that is easy to forget — that it
// stays out of the way of every OTHER error.
// ==============================================
import { describe, it, expect } from 'vitest';
import { duplicateMessage } from './index.js';

// The literal payload from the report, as PostgREST returns it.
const KKUMAIL_CLASH = {
  code: '23505',
  details: null,
  hint: null,
  message: 'duplicate key value violates unique constraint "students_kkumail_key"',
};

describe('duplicateMessage', () => {
  it('names the ADDRESS and what to do, not the index', () => {
    const out = duplicateMessage(KKUMAIL_CLASH, { kkumail: 'somebody@kkumail.com' });
    expect(out).toContain('somebody@kkumail.com');
    expect(out).toContain('แก้ไขแถวเดิม');
    // The thing the admin was shown before, and must never be shown again.
    expect(out).not.toContain('students_kkumail_key');
    expect(out).not.toContain('23505');
  });

  it('tells the รหัสนักศึกษา clash apart — it is a different problem', () => {
    // A shared kkumail means "this is the same person twice". A shared
    // รหัสนักศึกษา means either a typo or two humans wearing one id, and the fix
    // for that is never "add another row".
    const out = duplicateMessage(
      { code: '23505', message: 'duplicate key value violates unique constraint "students_sid_uniq"' },
      { student_id: '659999999-9' },
    );
    expect(out).toContain('659999999-9');
    expect(out).toContain('ไม่ใช่เพิ่มแถวใหม่');
  });

  it('recognises the violation however PostgREST spells it', () => {
    // Different clients surface this as `message`, as `details`, or only as the
    // code on the envelope. A handler that reads one of the three is a handler
    // that works until the day the transport changes.
    for (const err of [
      { code: '23505', message: 'duplicate key value violates unique constraint "students_kkumail_key"' },
      { message: 'duplicate key value violates unique constraint "students_kkumail_key"' },
      { code: '23505', message: 'Conflict', details: 'Key (kkumail)=(a@b.com) already exists.' },
    ]) {
      expect(duplicateMessage(err, {})).toBeTruthy();
    }
  });

  it('CONTROL — leaves every other error completely alone', () => {
    // The deny half. A translator that swallows unrelated failures turns a
    // permissions bug or a dropped connection into "ข้อมูลนี้ซ้ำ", and the admin
    // spends the afternoon hunting a duplicate that does not exist.
    for (const err of [
      { code: '42501', message: 'new row violates row-level security policy' },
      { code: '23503', message: 'insert or update violates foreign key constraint "students_sai_fk"' },
      { message: 'Failed to fetch' },
      {},
      null,
    ]) {
      expect(duplicateMessage(err, {})).toBeNull();
    }
  });

  it('still says something useful when the constraint is one we do not name', () => {
    const out = duplicateMessage(
      { code: '23505', message: 'duplicate key value violates unique constraint "students_something_new"' },
      {},
    );
    expect(out).toContain('ซ้ำ');
  });
});
