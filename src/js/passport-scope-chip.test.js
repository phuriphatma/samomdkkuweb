// ============================================================
// passport-scope-chip.test.js — a SCOPED SAMO Passport grant must be VISIBLE.
//
// REPORTED 2026-08-30, as urgent: "i set samopassport permission in the admin
// teamsamo ฝ่ายกิจการมหาวิทยาลัย as กิจการมหาวิทยาลัย ทั้งฝ่าย(ทุกแผนกย่อย) and
// it doesn't show on the จัดการสิทธิ์ … i'm not sure if they couldn't access it
// now."
//
// They could. The grant was live the entire time — the server's own resolver
// put all 51 people under that ฝ่าย on `d:5`, and all 19 who had signed in
// already carried it in `users.managed_passport_scopes`. What was missing was
// the CHIP.
//
// CAUSE. `readPermInputs` DROPS the `passport` key the moment a scope is chosen
// — scoped-is-not-full, the 0083 rule — so a scoped grant stores a
// `passport_dept_id` and NO capability key at all. `permChipsHtml` rendered
// from the capability keys plus two hand-passed scopes, VitalSound and the
// project seat. Passport was never added, so a scoped grant drew nothing and
// the row said only "จองโควตา Claude".
//
// This is the SECOND TWIN (0149) once more: VitalSound got a scope chip when
// scopes were invented; Passport later got the column, the editor, the
// inheritance walk and the SQL resolver — and not this one reader.
// ============================================================
import { describe, it, expect } from 'vitest';
import { permChipsHtml, passportToken } from './team/index.js';

const chips = (opts) => permChipsHtml({ own: new Set(), ...opts });

describe('passportToken mirrors public.passport_scope_tokens', () => {
  // SQL:  sub is not null -> 's:'||sub ; dept is not null -> 'd:'||dept ; else {}
  it('a sub-department wins over its department', () => {
    expect(passportToken(5, 12)).toBe('s:12');
  });
  it('a department alone is a d: token', () => {
    expect(passportToken(5, null)).toBe('d:5');
  });
  it('no scope is no token', () => {
    expect(passportToken(null, null)).toBeNull();
    expect(passportToken(undefined, undefined)).toBeNull();
  });
});

describe('a scoped SAMO Passport grant is visible on the row', () => {
  it('control — a row with no grants says so', () => {
    // Proves the assertions below can distinguish "chip present" from
    // "renderer returns something no matter what".
    expect(chips({})).toContain('team-perm-none');
  });

  it('renders a chip for an OWN scope, even though `passport` is not a key', () => {
    // The exact shape stored for ฝ่ายกิจการมหาวิทยาลัย: dept 5, no sub, and the
    // capability key deliberately absent.
    const html = chips({ own: new Set(['claude']), passOwn: 'd:5' });
    expect(html, 'a scoped passport grant rendered no chip — the reported bug')
      .toMatch(/is-pass/);
    expect(html).toContain('bi-airplane');
  });

  it('renders an INHERITED scope dashed, and never twice', () => {
    const html = chips({ passOwn: 'd:5', passInherited: new Set(['d:5', 'd:7']) });
    expect((html.match(/is-pass/g) || []).length,
      'the own scope was drawn again as inherited').toBe(2);
    expect(html).toMatch(/is-pass is-own|is-pass.*is-own/);
    expect(html).toMatch(/is-inherited/);
  });

  it('falls back to the id when the department names have not loaded yet', () => {
    // `loadPassportDepts()` is async, so a row can paint before the names
    // arrive. A chip with no text reads as a bug, not as "still loading".
    expect(chips({ passOwn: 'd:5' })).toMatch(/ฝ่าย #5/);
    expect(chips({ passOwn: 's:12' })).toMatch(/แผนกย่อย #12/);
  });

  it('is HIDDEN under master, like the VitalSound scope', () => {
    // master IS the widest scope, so naming a narrower one UNDERSTATES it —
    // the same reason the editor hides the picker under master.
    const html = chips({ own: new Set(['master']), passOwn: 'd:5' });
    expect(html, 'a scope chip under master understates what the holder reaches')
      .not.toMatch(/is-pass/);
  });
});
