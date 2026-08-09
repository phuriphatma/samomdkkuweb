// ==============================================
// The reconciliation rule, as tests.
//
// The rule 0138 implements is short enough to state and easy enough to get
// backwards: a field the person has TOUCHED is theirs, everything else is the
// file's, and silence is not agreement. These pin the two halves that live in
// JS — what the check block says, and what the import preview promises.
// ==============================================
import { describe, it, expect } from 'vitest';
import { identityCheckState } from './identity-check.js';
import { diffAgainstExisting } from './house/io.js';

describe('identityCheckState — what the block says', () => {
  it('asks about every open conflict', () => {
    const s = identityCheckState({
      confirmed_at: '2026-08-01T00:00:00Z',
      conflicts: [{ id: 'a', field: 'last_name_th', mine: 'ณ อยุธยา', theirs: 'ณ.อยุธยา' }],
    });
    expect(s.kind).toBe('conflicts');
    expect(s.conflicts).toHaveLength(1);
  });

  it('a conflict outranks having confirmed — confirming last week says nothing about a file that arrived today', () => {
    const s = identityCheckState({
      confirmed_at: '2026-01-01T00:00:00Z',
      conflicts: [{ id: 'a', field: 'major', mine: 'MD', theirs: 'MDI' }],
    });
    expect(s.kind).toBe('conflicts');
  });

  it('asks for a confirmation from somebody who has never given one', () => {
    expect(identityCheckState({ confirmed_at: null, conflicts: [] }).kind).toBe('unconfirmed');
  });

  it('says NOTHING once there is nothing to say', () => {
    // Deliberately not a green tick. A block that lives on the page forever
    // reassuring you is the block people stop reading — and then they stop
    // reading it on the day it says something else.
    expect(identityCheckState({ confirmed_at: '2026-08-01T00:00:00Z', conflicts: [] }).kind)
      .toBe('none');
  });

  it('says nothing at all for somebody the registry has never heard of', () => {
    expect(identityCheckState(null).kind).toBe('none');
  });
});

describe('the import preview does not promise a write the table will refuse', () => {
  const file = [{
    _line: 2, kkumail: 'a@kkumail.com', first_name_th: 'ของไฟล์',
    last_name_th: 'นามสกุล', student_id: '659999999-9', major: 'MD',
    nickname_imported: '', sai_code: '017',
  }];

  it('counts a change the student owns as KEPT, never as an update', () => {
    const diff = diffAgainstExisting(file, [{
      id: 's1', kkumail: 'a@kkumail.com', first_name_th: 'ของเจ้าตัว',
      last_name_th: 'นามสกุล', student_id: '659999999-9', major: 'MD',
      nickname_imported: '', sai_code: '017',
      self_edited: ['first_name_th'],
    }]);
    expect(diff.update).toBe(0);
    expect(diff.kept).toBe(1);
    expect(diff.verdicts[0]._kept).toEqual(['first_name_th']);
    // The stored value travels with it, because "ชื่อ จะไม่ถูกทับ" without
    // saying WHAT is being kept is not something anyone can check.
    expect(diff.verdicts[0]._keptBefore.first_name_th).toBe('ของเจ้าตัว');
  });

  it('still counts the columns the student does NOT own as an update', () => {
    const diff = diffAgainstExisting(
      [{ ...file[0], major: 'MDI' }],
      [{
        id: 's1', kkumail: 'a@kkumail.com', first_name_th: 'ของเจ้าตัว',
        last_name_th: 'นามสกุล', student_id: '659999999-9', major: 'MD',
        nickname_imported: '', sai_code: '017',
        self_edited: ['first_name_th'],
      }],
    );
    expect(diff.update).toBe(1);
    expect(diff.verdicts[0]._changed).toEqual(['major']);
    expect(diff.verdicts[0]._kept).toEqual(['first_name_th']);
  });

  it('an untouched row is an ordinary update — this is the 1,800-row common case', () => {
    // If this ever became "kept", every student would be asked a question they
    // never raised and the real disagreements would be buried in the noise.
    const diff = diffAgainstExisting(file, [{
      id: 's1', kkumail: 'a@kkumail.com', first_name_th: 'ของเดิม',
      last_name_th: 'นามสกุล', student_id: '659999999-9', major: 'MD',
      nickname_imported: '', sai_code: '017',
      self_edited: [],
    }]);
    expect(diff.update).toBe(1);
    expect(diff.kept).toBe(0);
    expect(diff.verdicts[0]._kept).toBeUndefined();
  });

  it('a row with nothing to change is unchanged, not kept', () => {
    const diff = diffAgainstExisting(file, [{
      id: 's1', ...file[0], self_edited: ['first_name_th'],
    }]);
    expect(diff.same).toBe(1);
    expect(diff.kept).toBe(0);
  });

  it('survives a stored row with no self_edited at all', () => {
    // fetchStudents() selects it, but an older cached payload or a hand-built
    // caller may not — and a preview that throws is worse than one that is
    // conservative.
    const diff = diffAgainstExisting(file, [{
      id: 's1', kkumail: 'a@kkumail.com', first_name_th: 'ของเดิม',
      last_name_th: 'นามสกุล', student_id: '659999999-9', major: 'MD',
      nickname_imported: '', sai_code: '017',
    }]);
    expect(diff.update).toBe(1);
  });
});
