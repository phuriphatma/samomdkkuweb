// master-seat.test.js — REPORTED 2026-08-18
//
//   "when i select permission as master, i cant select sub of the หนังสือโครงการ
//    as ผู้ส่งหนังสือ เจ้าหน้าที่คณะ อาจารย์ … so my friend has to tick manually
//    like 7 tickcheckbox"
//
// The select was live and enabled; `readPermInputs` threw its value away. The
// distinction that fixes it, and that these tests pin:
//
//   VitalSound แผนก and SAMO Passport ฝ่าย are SCOPES. Each has a widest value
//   and `master` IS that value, so storing a narrower one beside the blanket
//   grant is the 0083 trap — they are correctly nulled.
//
//   The หนังสือโครงการ seat is NOT a scope. ผู้ส่ง / เจ้าหน้าที่ / อาจารย์ are
//   three DESKS in one transaction; there is no "all three" desk. And the
//   stored seat is what `list_project_seat_users()` reads to decide who gets
//   NOTIFIED (projects/notify.js) and who can be picked as the signing อาจารย์
//   (projects/sign.js) — so nulling it made a master holder invisible to both
//   while the database happily let them do the work.
//
// These are BEHAVIOURAL, not source greps: the functions are pure enough to
// call with plain-object stand-ins for the DOM nodes, which is the only kind of
// assertion that would have failed before the fix.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readPermInputs, permChipsHtml } from './index.js';
import { stripComments } from '../strip-comments.js';

/** A stand-in for the checkbox grid. `readPermInputs` only ever asks it for
 *  `input:checked`, so a list of `{ value }` is a faithful substitute. */
const grid = (keys) => ({ querySelectorAll: () => keys.map((value) => ({ value })) });
/** A stand-in for a <select>. `d-none` matters: a hidden passport sub-select is
 *  read as "no sub-department", which is how the real one signals absence. */
const sel = (value = '', hidden = false) => ({
  value, classList: { contains: (c) => hidden && c === 'd-none' },
});

describe('readPermInputs — master keeps the seat, drops the scopes', () => {
  it('stores the หนังสือโครงการ seat chosen alongside master', () => {
    const out = readPermInputs(grid(['master']), sel(''), sel('vpa'), sel(''), sel('', true));
    expect(out.permissions).toEqual(['master']);
    // The whole bug in one assertion: this was null.
    expect(out.project_seat).toBe('vpa');
  });

  it('stores whichever seat was picked, not just the default one', () => {
    // A master who is really a เจ้าหน้าที่คณะ must keep that desk — otherwise
    // the pick is decorative and they land on the sender's screen.
    for (const seat of ['vpa', 'staff', 'prof']) {
      expect(readPermInputs(grid(['master']), sel(''), sel(seat), sel(''), sel('', true)).project_seat)
        .toBe(seat);
    }
  });

  it('still nulls the VitalSound and Passport scopes under master', () => {
    // These two ARE scopes and master is already their widest value. Storing a
    // narrower one next to the blanket grant is the 0083 trap: the blanket key
    // is an unconditional true branch that swallows the dept check.
    const out = readPermInputs(grid(['master', 'vs', 'passport']), sel('อุปนายกฝ่ายวิชาการ'),
      sel('vpa'), sel('3'), sel('7'));
    expect(out.vs_dept).toBeNull();
    expect(out.passport_dept_id).toBeNull();
    expect(out.passport_sub_dept_id).toBeNull();
  });

  it('still stores master ALONE, never the keys it implies', () => {
    // Writing the implied keys next to it would make them look like independent
    // grants someone could untick, and would rot the day a new key is added.
    const out = readPermInputs(grid(['master', 'pr', 'samoshop', 'house']), sel(''), sel('vpa'),
      sel(''), sel('', true));
    expect(out.permissions).toEqual(['master']);
  });

  it('accepts master with no seat at all — it is optional, not required', () => {
    // 36 of the 41 live master holders are in exactly this state. Blocking the
    // save would make every future edit of a master row answer a question most
    // master holders do not have; projectSeatRole() falls back to the sender
    // screen instead, and they simply stay off the notification lists.
    const out = readPermInputs(grid(['master']), sel(''), sel(''), sel(''), sel('', true));
    expect(out.project_seat).toBeNull();
    expect(out.missing).toBeUndefined();
  });

  it('leaves the non-master path exactly as it was', () => {
    // A `projects` grant with no seat is still blocked — that path has a real
    // dead end (a tab with no controls), which master does not.
    expect(readPermInputs(grid(['projects']), sel(''), sel(''), sel(''), sel('', true)))
      .toEqual({ missing: 'seat' });
    const ok = readPermInputs(grid(['projects']), sel(''), sel('staff'), sel(''), sel('', true));
    expect(ok.permissions).toEqual(['projects']);
    expect(ok.project_seat).toBe('staff');
  });
});

describe('permChipsHtml — a master row prints one chip', () => {
  const set = (...k) => new Set(k);
  const empty = new Set();

  it('replaces the implied capability chips instead of printing them beside master', () => {
    // The reported screenshot: a master ตำแหน่ง printed `ทุกระบบ (Master)` and
    // then dashed `SAMO Shop` / `จองโควตา Claude`, which says master is NOT
    // covering them — the opposite of what 0111 does.
    const html = permChipsHtml({
      own: set('master'), inherited: set('samoshop', 'claude'),
      vsOwn: null, vsInherited: empty, seatOwn: null, seatInherited: empty,
    });
    expect(html).toContain('ทุกระบบ (Master)');
    expect(html).not.toContain('SAMO Shop');
    expect(html).not.toContain('จองโควตา Claude');
  });

  it('keeps the seat chip under master — the one thing master does not imply', () => {
    const html = permChipsHtml({
      own: set('master'), inherited: set('pr'),
      vsOwn: null, vsInherited: empty, seatOwn: 'vpa', seatInherited: empty,
    });
    expect(html).toContain('ผู้ส่งหนังสือ (SAMO)');
    expect(html).not.toContain('PR');
  });

  it('honours master reached through inheritance, not only stored on the row', () => {
    // 26 of the 29 rows that carry master are ตำแหน่ง, so a check that only
    // looked at `own` would leave almost every affected row unchanged.
    const html = permChipsHtml({
      own: empty, inherited: set('master', 'house'),
      vsOwn: null, vsInherited: empty, seatOwn: null, seatInherited: empty,
    });
    expect(html).toContain('ทุกระบบ (Master)');
    expect(html).not.toContain('ระบบบ้าน');
  });

  it('prints the value-carrying chips BEFORE the capability keys', () => {
    // Why the reported row wrapped: `ผู้ส่งหนังสือ (SAMO)` — the single most
    // important fact about that person — printed last, behind eight
    // interchangeable capability chips, and landed on line 2.
    const html = permChipsHtml({
      own: set('pr', 'samoshop', 'creator'), inherited: empty,
      vsOwn: 'อุปนายกฝ่ายบริหารองค์กร', vsInherited: empty,
      seatOwn: 'vpa', seatInherited: empty,
    });
    expect(html.indexOf('ผู้ส่งหนังสือ')).toBeLessThan(html.indexOf('PR'));
    expect(html.indexOf('บริหารองค์กร')).toBeLessThan(html.indexOf('PR'));
  });

  it('shows an own seat INSTEAD of the inherited one, never both (0092)', () => {
    const html = permChipsHtml({
      own: empty, inherited: empty, vsOwn: null, vsInherited: empty,
      seatOwn: 'staff', seatInherited: set('vpa'),
    });
    expect(html).toContain('เจ้าหน้าที่คณะ');
    expect(html).not.toContain('ผู้ส่งหนังสือ');
  });

  it('says ไม่มีสิทธิ์ when there is genuinely nothing', () => {
    expect(permChipsHtml({
      own: empty, inherited: empty, vsOwn: null, vsInherited: empty,
      seatOwn: null, seatInherited: empty,
    })).toContain('ไม่มีสิทธิ์');
  });

  it('escapes the label of an unknown key rather than interpolating it raw', () => {
    // Row text reaches innerHTML; an unrecognised key falls through to the raw
    // value, which is the shape that made the ticket renderers an XSS.
    const html = permChipsHtml({
      own: set('<img src=x onerror=alert(1)>'), inherited: empty,
      vsOwn: null, vsInherited: empty, seatOwn: null, seatInherited: empty,
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('the two SCOPE pickers are hidden under master, the seat is not', () => {
  // Source-level, because these three only touch DOM elements. Comments are
  // stripped so a paragraph explaining the rule cannot satisfy the assertion
  // (the confirm-modal.test.js trap).
  const SRC = stripComments(readFileSync(new URL('./index.js', import.meta.url), 'utf8'));

  it('VitalSound and Passport scope blocks test masterOn()', () => {
    // Before the fix these appeared under master (their box is force-ticked),
    // stayed enabled — syncMasterVisibility only disables CHECKBOXES — and had
    // their value discarded on save. Three live controls with no effect.
    expect(SRC).toMatch(/function syncVsScopeVisibility[\s\S]{0,220}&& !masterOn\(grid\)/);
    expect(SRC).toMatch(/function syncPassVisibility[\s\S]{0,220}&& !masterOn\(grid\)/);
  });

  it('the seat block does NOT test masterOn() — master does not answer it', () => {
    const fn = SRC.slice(SRC.indexOf('function syncSeatVisibility'));
    expect(fn.slice(0, 260)).not.toContain('masterOn');
  });

  it('only the บุคคล editor pre-fills the seat; a ตำแหน่ง fans out instead', () => {
    // Measured on the live tree: auto-filling every master-bearing ตำแหน่ง
    // would have handed `vpa` to 57 more people, each then on
    // list_project_seat_users('vpa') — notified on every หนังสือ update.
    expect(SRC).toMatch(/refreshMemberPermEff[\s\S]{0,400}syncMasterSeatDefault\(\$\('teamMPermGrid'\)/);
    const nodeSync = SRC.slice(SRC.indexOf('const syncPermGrid = ()'));
    expect(nodeSync.slice(0, 400)).not.toContain('syncMasterSeatDefault');
    expect(nodeSync.slice(0, 400)).toContain('refreshSeatFanout');
  });

  it('the auto-filled value is marked so turning master off removes it again', () => {
    // A value the FORM invented must not survive as if a human chose it — the
    // same rule `preMaster` follows for the checkboxes.
    expect(SRC).toMatch(/dataset\.masterAuto = '1'/);
    expect(SRC).toMatch(/!on && sel\.dataset\.masterAuto[\s\S]{0,80}delete sel\.dataset\.masterAuto/);
    // …and cleared between rows, or it leaks onto the next person opened.
    // NOTE: stripComments BLANKS a comment to spaces rather than removing it,
    // so a `{0,N}` window over a commented function measures the comment, not
    // the code. Slice the function and search inside it instead.
    const reset = SRC.slice(SRC.indexOf('function resetMasterState'));
    expect(reset.slice(0, reset.indexOf('\n}'))).toContain('delete seatSel.dataset.masterAuto');
    // Both fill panes must actually PASS the select, or the reset is a no-op.
    expect(SRC).toContain("resetMasterState($('teamPermGrid'), $('teamPermSeat'))");
    expect(SRC).toContain("resetMasterState($('teamMPermGrid'), $('teamMPermSeat'))");
  });
});

describe('permChipsHtml — the seat chip subsumes the plain หนังสือโครงการ chip', () => {
  const set = (...k) => new Set(k);
  const empty = new Set();

  it('drops the capability chip when a seat chip already says it', () => {
    // "ผู้ส่งหนังสือ (SAMO)" already says หนังสือโครงการ AND which desk, so
    // printing the plain key beside it spends two chips on one fact.
    const html = permChipsHtml({
      own: set('projects', 'pr'), inherited: empty,
      vsOwn: null, vsInherited: empty, seatOwn: 'vpa', seatInherited: empty,
    });
    expect(html).toContain('ผู้ส่งหนังสือ (SAMO)');
    // Assert on the LABEL position, not anywhere in the string: the seat chip's
    // own `title` reads "หนังสือโครงการ: ผู้ส่งหนังสือ (SAMO)", so a bare
    // .not.toContain() fails on the very chip that is supposed to be there.
    expect(html).not.toContain('หนังสือโครงการ</span>');
    expect(html).toContain('PR');
  });

  it('drops it for an INHERITED seat too, not just an own one', () => {
    const html = permChipsHtml({
      own: set('projects'), inherited: empty,
      vsOwn: null, vsInherited: empty, seatOwn: null, seatInherited: set('staff'),
    });
    expect(html).toContain('เจ้าหน้าที่คณะ');
    expect(html).not.toContain('หนังสือโครงการ</span>');
  });

  it('KEEPS it when there is no seat — that state is the one worth flagging', () => {
    // A `projects` grant with no seat opens the tab onto no controls (0086).
    // The plain chip is the only sign of it on the row, so dropping this
    // unconditionally would hide the broken state instead of the redundant one.
    const html = permChipsHtml({
      own: set('projects'), inherited: empty,
      vsOwn: null, vsInherited: empty, seatOwn: null, seatInherited: empty,
    });
    expect(html).toContain('หนังสือโครงการ</span>');
  });
});
