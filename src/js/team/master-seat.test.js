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
import { readPermInputs, permChipsHtml, permChip, seatFanoutCount } from './index.js';
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

  it('BOTH editors pre-fill the seat under master — changed 2026-08-19', () => {
    // This assertion used to say the OPPOSITE, and going red is it working.
    // The original reasoning was that a ตำแหน่ง seat fans out and would sign
    // ~57 people up for notifications. Re-measured on the owner's challenge:
    // notifyVpAdmin fires ONE Discord message to ONE channel OUTSIDE the
    // recipient loop, and email goes to a fixed settings address — so extra
    // recipients add neither. `master` exists so the dev team can TEST every
    // workflow, which a silently-unnotified master holder cannot.
    const memberFn = SRC.slice(SRC.indexOf('function refreshMemberPermEff'));
    expect(memberFn.slice(0, memberFn.indexOf('\n}'))).toContain("syncMasterSeatDefault($('teamMPermGrid')");
    // Slice the arrow body to its closing `};` rather than a fixed window — a
    // {0,N} window measures whatever comment happens to be in the way, and this
    // assertion already failed once for exactly that reason when a comment grew.
    const nodeSync = SRC.slice(SRC.indexOf('const syncPermGrid = ()'));
    const body = nodeSync.slice(0, nodeSync.indexOf('\n  };'));
    expect(body).toContain("syncMasterSeatDefault(grid, $('teamPermSeat')");
    // The head-count note stays: the seat still applies to the whole subtree,
    // and that is worth saying even when the fill is automatic.
    expect(body).toContain('refreshSeatFanout');
  });

  it('the EMPTY option is selectable — clearing must not be re-filled', () => {
    // Shipped broken on 2026-08-18: the fill condition was `on && !sel.value`,
    // so choosing "— เลือกบทบาท —" was undone by the very next sync and the
    // seat could not be cleared at all while master was on.
    expect(SRC).toMatch(/if \(on && !sel\.value && !sel\.dataset\.userSet\)/);
    // Every human touch must set the flag, on BOTH editors…
    expect(SRC).toMatch(/function markSeatUserSet\(sel\)[\s\S]{0,200}dataset\.userSet = '1'/);
    expect(SRC).toContain("$('teamPermSeat')?.addEventListener('change'");
    expect(SRC).toContain("$('teamMPermSeat')?.addEventListener('change'");
    const listeners = SRC.split('\n').filter((l) => l.includes("Seat')?.addEventListener('change'"));
    expect(listeners).toHaveLength(2);
    // …and it must be cleared between rows, or row B inherits row A's answer.
    const reset = SRC.slice(SRC.indexOf('function resetMasterState'));
    expect(reset.slice(0, reset.indexOf('\n}'))).toContain('delete seatSel.dataset.userSet');
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

describe('permChipsHtml — master hides SCOPES, keeps the IDENTITY', () => {
  const set = (...k) => new Set(k);
  const empty = new Set();

  it('drops the VitalSound แผนก chip under master — it understates', () => {
    // A แผนก chip is a SCOPE and master is already its widest value, so drawing
    // "บริหารองค์กร" next to Master says "only that dept" about someone who
    // reads every one. Measured 2026-08-18: 2 live member rows drew one.
    const html = permChipsHtml({
      own: set('master'), inherited: empty,
      vsOwn: 'อุปนายกฝ่ายบริหารองค์กร', vsInherited: set('อุปนายกฝ่ายวิชาการ'),
      seatOwn: 'vpa', seatInherited: empty,
    });
    expect(html).toContain('ทุกระบบ (Master)');
    expect(html).not.toContain('บริหารองค์กร');
    expect(html).not.toContain('วิชาการ');
    // …but the SEAT is an identity, not a scope, so it survives.
    expect(html).toContain('ผู้ส่งหนังสือ (SAMO)');
  });

  it('still draws แผนก chips when master is absent', () => {
    const html = permChipsHtml({
      own: empty, inherited: empty,
      vsOwn: 'อุปนายกฝ่ายบริหารองค์กร', vsInherited: empty,
      seatOwn: null, seatInherited: empty,
    });
    expect(html).toContain('บริหารองค์กร');
  });

  it('flat mode draws every chip solid — a dashed chip would claim "inherited"', () => {
    // The modal preview answers "what will they end up with", where own-vs-
    // inherited is not a distinction being drawn. A dashed chip there would say
    // "from the parent" about a value the admin just picked in that same form.
    const html = permChipsHtml({
      own: set('pr'), inherited: empty, vsOwn: null, vsInherited: set('อุปนายกฝ่ายวิชาการ'),
      seatOwn: null, seatInherited: set('staff'), flat: true,
    });
    expect(html).not.toContain('is-inherited');
    expect(html).toContain('is-own');
  });

  it('is safe to call with only `own` — every other field defaults', () => {
    // It is exported and has three callers now; a missing `seatInherited` used
    // to throw on `.size` rather than render nothing.
    expect(() => permChipsHtml({ own: set('pr') })).not.toThrow();
    expect(permChipsHtml({ own: empty })).toContain('ไม่มีสิทธิ์');
  });
});

describe('the modal preview uses the shared builder, not a fourth copy', () => {
  const SRC = stripComments(readFileSync(new URL('./index.js', import.meta.url), 'utf8'));

  it('refreshMemberPermEff renders through permChipsHtml', () => {
    // It hand-rolled its own chips and never learned the master rule, so
    // ticking Master previewed the Master chip PLUS everything it implies.
    const fn = SRC.slice(SRC.indexOf('function refreshMemberPermEff'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).toContain('permChipsHtml({');
    expect(body).toContain('flat: true');
    // No hand-rolled chip markup left anywhere in it.
    expect(body).not.toContain('team-perm-chip');
  });

  it('nothing else in the module hand-rolls a team-perm-chip span', () => {
    // permChip() is the only place that may emit one. If this fails, a fourth
    // copy has appeared and it will drift exactly like the third one did.
    const lines = SRC.split('\n');
    const at = lines.reduce((acc, l, i) => (l.includes('class="team-perm-chip') ? [...acc, i] : acc), []);
    expect(at).toHaveLength(1);
    // …and that one line must live inside permChip(). The emitter is the
    // RETURN line, not the signature, so walk back to the nearest declaration
    // rather than asserting on the line itself.
    // `export function` counts too — this regex missed it once and walked back
    // to an unrelated function, reporting a failure that was purely the
    // instrument's.
    const owner = lines.slice(0, at[0] + 1).reverse().find((l) => /^(export )?function \w+\(/.test(l));
    expect(owner).toMatch(/^(export )?function permChip\(/);
  });
});

describe('permChip — the icon is the one value that reaches markup unescaped', () => {
  const set = (...k) => new Set(k);

  it('refuses a hostile icon at the boundary itself', () => {
    // Tested on permChip DIRECTLY, not through permChipsHtml. The
    // null-prototype vocabulary maps already close the only route that reaches
    // it today, so a test going through the caller passes whether or not this
    // validation exists — it could not tell the regex from a no-op. This is the
    // guard for the NEXT caller that sources an icon from somewhere else.
    expect(permChip('is-own', 'x', { icon: 'x" onerror="alert(1)' }))
      .not.toMatch(/onerror="/);
    expect(permChip('is-own', 'x', { icon: 'x" onerror="alert(1)' })).not.toContain('<i ');
    expect(permChip('is-own', 'x', { icon: 'bi-megaphone' })).toContain('<i class="bi-megaphone">');
    // A typo'd icon renders as nothing anyway, so dropping it loses nothing.
    expect(permChip('is-own', 'x', { icon: 'BI-Megaphone' })).not.toContain('<i ');
  });

  it('refuses an icon that is not a bootstrap-icons class', () => {
    // PERM_ICON is a plain object, so a permission key of `constructor` returns
    // a FUNCTION, not undefined — truthy, and stringified straight into the
    // class attribute. Permission keys are admin-writable text[].
    const html = permChipsHtml({ own: set('constructor') });
    expect(html).not.toContain('native code');
    expect(html).not.toContain('<i class="function');
    // The label still renders (escaped), so the row does not silently lose it.
    expect(html).toContain('constructor');
  });

  it('is not fooled by __proto__ or toString either', () => {
    for (const key of ['__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      const html = permChipsHtml({ own: set(key) });
      expect(html).not.toMatch(/<i class="(?!bi-[a-z0-9-]+")/);
      expect(html).not.toContain('[object Object]');
    }
  });

  it('still emits a real icon for a real key', () => {
    expect(permChipsHtml({ own: set('pr') })).toContain('<i class="bi-megaphone">');
  });

  it('cannot break out of an attribute even if a key smuggles quotes', () => {
    // The label falls back to the raw key when the vocabulary misses, and it
    // reaches innerHTML. Assert the QUOTE is neutralised, not that the word is
    // absent — `onload=&quot;` is inert text and a blanket .not.toContain()
    // would fail on a correct escape.
    const html = permChipsHtml({ own: set('x" onload="alert(1)') });
    expect(html).not.toMatch(/onload="/);
    expect(html).toContain('&quot;');
  });
});

describe('seatFanoutCount — the number the ตำแหน่ง editor puts in front of an admin', () => {
  // Injected tree, so this asserts the RULE rather than whatever the live
  // roster happens to contain. Shape: root → [a, b]; b sets its own seat.
  const tree = {
    root: [{ id: 'm1', kkumail: 'a@kkumail.com' },
           { id: 'm2', kkumail: '' },
           { id: 'm3' }],
    a:    [{ id: 'm4', kkumail: 'd@kkumail.com' },
           { id: 'm5', kkumail: 'e@kkumail.com', project_seat: 'prof' },
           { id: 'm6', kkumail: 'f@kkumail.com', inherit_permissions: false }],
    b:    [{ id: 'm7', kkumail: 'g@kkumail.com' }],
  };
  const kids = { root: [{ id: 'a' }, { id: 'b', project_seat: 'staff' }], a: [], b: [] };
  const count = (id) => seatFanoutCount(id, (x) => tree[x] || [], (x) => kids[x] || []);

  it('counts only people a seat would actually reach', () => {
    // root: m1 ✓ · m2 ✗ no email · m3 ✗ no email · m4 ✓ · m5 ✗ own seat ·
    // m6 ✗ opted out · m7 ✗ shielded by b's own seat  ⇒ 2
    expect(count('root')).toBe(2);
  });

  it('excludes members with no อีเมล — they have no account to notify', () => {
    // The sentence beside this number promises a notification. 31 of the 447
    // live member rows have no email; counting them would make it false, and
    // would disagree with the SQL simulation that produced the 57 figure.
    const noMail = { x: [{ id: 'p', kkumail: '' }, { id: 'q', kkumail: '   ' }, { id: 'r' }] };
    expect(seatFanoutCount('x', (i) => noMail[i] || [], () => [])).toBe(0);
  });

  it('a descendant ตำแหน่ง with its own seat shields its whole subtree (0092)', () => {
    expect(count('b')).toBe(1);   // reached directly, nothing shields it
    expect(count('a')).toBe(1);   // m4 only
  });
});

describe('the ตำแหน่ง editor explains why its seat is NOT auto-filled', () => {
  const SRC = stripComments(readFileSync(new URL('./index.js', import.meta.url), 'utf8'));
  const HTML = readFileSync(new URL('../../html/tab-team.html', import.meta.url), 'utf8');

  it('has a master hint that does not ride on the fan-out count', () => {
    // REPORTED: "i gave my self master permission but why doesnt it display
    // autoselect of ผู้ส่งหนังสือ" — from the ตำแหน่ง modal, which is the one
    // that deliberately does not auto-fill. Its only note was the fan-out
    // head-count, and refreshSeatFanout HIDES itself at 0, so the common case
    // was an empty dropdown with no explanation at all.
    expect(HTML).toContain('id="teamPermSeatMasterHint"');
    // It must be toggled by syncMasterNote (master state), never by
    // refreshSeatFanout (head-count) — that distinction IS the bug.
    expect(SRC).toMatch(/syncMasterNote\(grid, \$\('teamPermMasterNote'\), \$\('teamPermSeatMasterHint'\)\)/);
    expect(SRC).toMatch(/syncMasterNote\(\$\('teamPermGrid'\), \$\('teamPermMasterNote'\), \$\('teamPermSeatMasterHint'\)\)/);
    const fanout = SRC.slice(SRC.indexOf('function refreshSeatFanout'));
    expect(fanout.slice(0, fanout.indexOf('\n}'))).not.toContain('teamPermSeatMasterHint');
  });

  it('says what leaving it empty costs, in the words a person would use', () => {
    // Plain-Thai consequence, not mechanism: the two things they actually lose.
    const block = HTML.slice(HTML.indexOf('id="teamPermSeatMasterHint"'));
    const hint = block.slice(0, block.indexOf('</div>'));
    expect(hint).toContain('ไม่ได้รับแจ้งเตือน');
    expect(hint).toContain('เลือกบทบาท');
    // No table names, no permission keys, no migration numbers in user copy.
    expect(hint).not.toMatch(/project_seat|managed_|team_nodes|vpa|master\b/);
  });
});
