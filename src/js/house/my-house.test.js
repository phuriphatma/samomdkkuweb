// Tests for the "บ้านของฉัน" card.
//
// THE BUG THESE EXIST FOR. Reported as "the แก้ไขข้อมูล of ระบบบ้าน — i need to
// click many times and sometime it will appear, also the เพื่อนร่วมบ้าน".
// renderMyHouse() runs on every auth event, and it used to add a DELEGATED
// listener to `host` — a node that SURVIVES the re-render — whose handler did
// `classList.toggle('d-none')`. Two paints meant two listeners, so one click
// toggled twice and the panel stayed shut; three paints meant it opened again.
// It looked intermittent, which is exactly why nobody could pin it down.
//
// A DOM-level test would be the direct proof, but this repo's test setup has no
// jsdom and the renderer's contract is deliberately "anything with .innerHTML
// and .hidden". So the shape is pinned at the SOURCE, the way delete-guard.test.js
// pins the DELETE convention: the module must never attach a listener to the
// host it re-renders, and must never derive panel visibility from the panel's
// own current class.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../db.js', () => ({ dbRest: vi.fn() }));
vi.mock('../uploads.js', () => ({ convertDriveUrl: (u) => u }));

const { renderMyHouse, HOUSE_DETAIL_FIELDS, REQUESTABLE_FIELDS } = await import('./my-house.js');
const SRC = readFileSync(new URL('./my-house.js', import.meta.url), 'utf8');
// Comment lines stripped: the header explains the traps by NAME, and a test
// that greps for a hazard must not fire on the sentence describing it.
const CODE = SRC.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

/** Minimal element stand-in: renderMyHouse only sets .hidden / .innerHTML, and
 *  wiring is skipped when there is no querySelector. */
const host = () => ({ hidden: false, innerHTML: '' });

const recWith = (over = {}) => ({
  kkumail: 'somebody@kkumail.com',
  student_id: '659999999-9',
  full_name: 'สมชาย ใจดี',
  nickname: 'ชาย',
  major: 'MD',
  cohort_year: 2565,
  sai: '017',
  house_id: 7,
  house_name: 'บ้านทดสอบ',
  house_color: '#105922',
  advisors: [{ title: 'ผศ.นพ.', name: 'ก ข', dept: 'ภาควิชาอายุรศาสตร์' }],
  house_advisors: [
    { title: 'ผศ.นพ.', name: 'ก ข', dept: 'ภาควิชาอายุรศาสตร์', sai: '017' },
    { title: 'พญ.', name: 'ค ง', dept: 'ภาควิชากุมารเวชศาสตร์', sai: '027' },
  ],
  ...over,
});

describe('the re-render trap', () => {
  it('never attaches a listener to the host it re-renders', () => {
    // `host.addEventListener(...)` accumulates one handler per paint. Listeners
    // must go on nodes created by THIS paint, which the next `innerHTML =`
    // discards along with them.
    expect(CODE).not.toMatch(/host\.addEventListener/);
  });

  it('never toggles panel visibility off the panel\'s own class', () => {
    // `classList.toggle('d-none')` answers "was it open?" from the DOM, so a
    // handler that fires twice ends where it started. State is held in one
    // variable and every panel is set explicitly from it.
    expect(CODE).not.toMatch(/classList\.toggle\(\s*['"]d-none['"]/);
  });

  it('does not use native prompt()/alert()/confirm()', () => {
    // Chrome's "Prevent this page from creating additional dialogs" makes them
    // return null with no error and no trace — the shape that made the ทีม SAMO
    // delete button look dead. The report flow is an in-card form instead.
    expect(CODE).not.toMatch(/\b(prompt|alert|confirm)\(/);
  });
});

describe('renderMyHouse', () => {
  it('renders nothing at all for a student who is not in the table', () => {
    const el = host();
    renderMyHouse(el, null);
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe('');
  });

  it('shows the record as label → value, like ตำแหน่งของฉันในทีม SAMO', () => {
    const el = host();
    renderMyHouse(el, recWith());
    for (const label of ['ชื่อ-สกุล', 'ชื่อเล่น', 'รหัสนักศึกษา', 'รุ่น', 'สาขา',
      'สายรหัส', 'บ้าน', 'KKU Mail']) {
      expect(el.innerHTML).toContain(label);
    }
    expect(el.innerHTML).toContain('659999999-9');
    expect(el.innerHTML).toContain('somebody@kkumail.com');
  });

  it('labels the cohort as รุ่น MD50, never as a ชั้นปี', () => {
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('MD50');
    expect(el.innerHTML).not.toContain('ชั้นปี');
    expect(el.innerHTML).not.toMatch(/ปี\s*[1-6]/);
  });

  it('offers NO ยืนยันข้อมูล — it is not data we collect', () => {
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).not.toContain('ยืนยัน');
    expect(CODE).not.toMatch(/verif/i);
  });

  it('names an unnamed house "บ้าน N" rather than hiding it', () => {
    const el = host();
    renderMyHouse(el, recWith({ house_name: null, house_id: 3 }));
    expect(el.innerHTML).toContain('บ้าน 3');
  });

  it('says so plainly when there is no สายรหัส yet', () => {
    const el = host();
    renderMyHouse(el, recWith({ house_id: null, house_name: null, sai: null }));
    expect(el.innerHTML).toContain('ยังไม่ได้กำหนดสายรหัส');
  });

  it('names NO other student, ever — อาจารย์ only', () => {
    // ระบบบ้าน publishes อาจารย์ in their staff capacity and nobody else.
    // เพื่อนร่วมบ้าน and the RPC behind it were removed in 0124; a button here
    // would be the first step back toward publishing a 1,800-name directory.
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).not.toContain('เพื่อนร่วมบ้าน');
    expect(el.innerHTML).not.toContain('data-house-act="roster"');
    expect(CODE).not.toMatch(/roster/i);
  });

  it('lists the อาจารย์ of the whole house, tagged with their สาย', () => {
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('อาจารย์ที่ปรึกษาสายของฉัน');
    expect(el.innerHTML).toContain('อาจารย์ในบ้านเดียวกัน');
    expect(el.innerHTML).toContain('สาย 027');
    // …and does not name the student's OWN สาย advisor twice.
    expect(el.innerHTML.match(/ผศ\.นพ\. ก ข/g)).toHaveLength(1);
  });

  it('NEVER offers สายรหัส as an editable field — it decides the house', () => {
    // The one field with an incentive to abuse: editing it moves you between
    // houses. Read-only here, refused by update_my_student_record (0125), and
    // the only route is a request an admin approves.
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('readonly');
    expect(el.innerHTML).not.toContain('name="sai"');
    expect(CODE).not.toMatch(/sai_code:/);        // never sent in a save patch
    expect(CODE).not.toMatch(/sai_editable/);     // no "sometimes" about it
  });

  it('offers the five fields a person can fix about themselves', () => {
    const el = host();
    renderMyHouse(el, recWith());
    for (const name of ['first_name_th', 'last_name_th', 'nickname',
      'student_id', 'major']) {
      expect(el.innerHTML).toContain(`name="${name}"`);
    }
    // สาขา is a CHOOSER, never free text — free text is what produced MD/md/M.D.
    expect(el.innerHTML).toMatch(/<select name="major"/);
  });

  it('opens the สาขา chooser on the CURRENT value, not on an empty placeholder', () => {
    // The form is submittable the instant it appears. If the select started as
    // a bare <option value=""> while the vocabulary loaded, a fast submit would
    // send major:"" — written as NULL, and self_edited then makes that loss
    // permanent against every future import. The list arriving later only
    // REPLACES options; it must never be what stops the value being right.
    const el = host();
    renderMyHouse(el, recWith({ major: 'MDI' }));
    const select = el.innerHTML.match(/<select name="major"[^>]*>([\s\S]*?)<\/select>/);
    expect(select).not.toBeNull();
    expect(select[1]).toMatch(/value="MDI" selected/);
    expect(select[1]).not.toContain('กำลังโหลด');
  });

  it('escapes every user-typed field — it all lands in innerHTML', () => {
    const el = host();
    renderMyHouse(el, recWith({
      full_name: '<img src=x onerror=alert(1)>',
      nickname: '"><script>bad()</script>',
      house_name: '<b>x</b>',
    }));
    expect(el.innerHTML).not.toContain('<img src=x');
    expect(el.innerHTML).not.toContain('<script>');
    expect(el.innerHTML).not.toContain('<b>x</b>');
  });
});

describe('the field lists', () => {
  it('leaves no field without a route — self-edit, derived, or a request', () => {
    // Every field the card SHOWS must be fixable somehow, or "mine is wrong" is
    // a dead end. Since 0125 the student edits five of them directly; the rest
    // are either derived from one of those, or go through a request.
    const requestable = new Set(REQUESTABLE_FIELDS.map((f) => f.field));
    const route = {
      cohort: 'derived',      // from student_id, which IS self-editable
      sai: 'request',
      house: 'request',       // the house IS the last digit of the สาย
      kkumail: 'identity',    // changing it is an admin/auth job, not a request
    };
    for (const f of HOUSE_DETAIL_FIELDS.filter((x) => !x.self)) {
      expect(route[f.key]).toBeDefined();
      if (route[f.key] === 'request') expect(requestable.has('sai_code')).toBe(true);
    }
    // …and the five self-editable ones are exactly what the form offers.
    expect(HOUSE_DETAIL_FIELDS.filter((f) => f.self).map((f) => f.key))
      .toEqual(['full_name', 'nickname', 'student_id', 'major']);
  });

  it('asks for nothing request_my_change would reject', () => {
    // The allow-list in migration 0116. A field outside it raises
    // 'ไม่รองรับการขอแก้ไขช่องนี้', i.e. a button that always fails.
    const allowed = new Set(['sai_code', 'student_id', 'first_name_th',
      'last_name_th', 'major', 'cohort_year']);
    for (const f of REQUESTABLE_FIELDS) expect(allowed.has(f.field)).toBe(true);
  });
});
