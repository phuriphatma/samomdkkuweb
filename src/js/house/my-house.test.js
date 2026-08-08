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
  // No `title` key since 0128 — คำนำหน้า is part of the name, exactly as it is
  // for ทีม SAMO since 0113, and the RPC no longer returns the field.
  advisors: [{
    name: 'ผศ.นพ. ก ข', dept: 'ภาควิชาอายุรศาสตร์', email: 'kor@kku.ac.th',
  }],
  house_advisors: [
    { name: 'ผศ.นพ. ก ข', dept: 'ภาควิชาอายุรศาสตร์', email: 'kor@kku.ac.th', sai: '017' },
    { name: 'พญ. ค ง', dept: 'ภาควิชากุมารเวชศาสตร์', email: 'kor2@kku.ac.th', sai: '027' },
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

  it('shows รุ่น and ชั้นปี as SEPARATE facts, never one relabelled as the other', () => {
    // This test used to assert ชั้นปี was absent entirely (0123 removed it
    // because a STORED ชั้นปี rots). 0131 brings it back as a DERIVED value, at
    // the owner's request — "it's easier to visualized by like ปี 4 than MDxx".
    // The two are different facts and the ลาพัก case is what separates them:
    // someone who paused a year is still MD50 and is now studying ปี 4.
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('MD50');       // รุ่น — cohort identity
    expect(el.innerHTML).toContain('ชั้นปี');      // ชั้นปี — derived, this year
  });

  it('never puts a ชั้นปี NUMBER in the save patch — only the difference', () => {
    // The invariant the old "no ชั้นปี" test was really protecting. A stored
    // ชั้นปี is right for one August and silently wrong every August after; what
    // travels is `year_offset`, the gap, which needs no yearly maintenance.
    const patch = CODE.match(/const patch = \{[\s\S]*?\n\s*\};/);
    expect(patch[0]).not.toMatch(/year:/);
    expect(patch[0]).not.toMatch(/study_year:/);
    expect(CODE).toMatch(/patch\.year_offset\s*=/);
    // …and the gap is measured with the shared rule, not re-derived inline.
    expect(CODE).toMatch(/offsetForPickedYear\(/);
  });

  it('disables the ชั้นปี chooser when there is no ปีที่เข้า to count from', () => {
    // A shared department account or a row whose รหัส is not filled in yet.
    // Letting them pick an absolute year here would recreate `year_override`,
    // the exact column 0129 deleted.
    const el = host();
    renderMyHouse(el, recWith({ student_id: null, cohort_year: null }));
    expect(el.innerHTML).not.toContain('name="study_year"');
    expect(el.innerHTML).toContain('กรอกรหัสนักศึกษาก่อน');
  });

  it('offers the ชั้นปี chooser, defaulting to "ตามที่ระบบคำนวณ"', () => {
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('name="study_year"');
    expect(el.innerHTML).toMatch(/<option value=""\s+selected>ตามที่ระบบคำนวณ/);
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
    expect(CODE).not.toMatch(/sai_editable/);     // no "sometimes" about it
    // Scoped to the SAVE PATCH rather than to the whole file. The bare grep for
    // `sai_code:` used to stand in for this, and it started failing on a
    // field-LABEL map (`{ sai_code: 'สายรหัส' }`) that sends nothing anywhere —
    // a guard that fires on the word instead of the thing eventually gets
    // deleted by whoever is trying to ship. What must never happen is
    // `sai_code` appearing in the object handed to saveMyStudentRecord.
    const patch = CODE.match(/const patch = \{[\s\S]*?\n\s*\};/);
    expect(patch).not.toBeNull();
    expect(patch[0]).not.toMatch(/sai/);
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

  it('shows the อาจารย์ address and ภาควิชา, not just a name', () => {
    // A card that names the person you need and withholds how to reach them
    // moves the work rather than doing it.
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('mailto:kor@kku.ac.th');
    expect(el.innerHTML).toContain('ภาควิชาอายุรศาสตร์');
  });

  it('renders nothing extra for an อาจารย์ with no address on file', () => {
    const el = host();
    renderMyHouse(el, recWith({
      advisors: [{ name: 'ก ข' }], house_advisors: [],
    }));
    expect(el.innerHTML).not.toContain('mailto:');
    expect(el.innerHTML).toContain('ก ข');
  });

  describe('คำขอแก้ไขของฉัน — the answer has to come back', () => {
    // REPORTED: "the reason admin type doesn't get shown for the user, also the
    // status that admin reject or accept doesn't get shown to the user". There
    // was no read path at all: student_change_requests is admin-only under RLS,
    // so the admin was typing into a column nobody on the other side could see.
    it('is absent entirely when the student has never filed one', () => {
      const el = host();
      renderMyHouse(el, recWith());
      expect(el.innerHTML).not.toContain('คำขอแก้ไขของฉัน');
    });

    it('shows a pending request as waiting, with no verdict implied', () => {
      const el = host();
      renderMyHouse(el, recWith({
        my_requests: [{ field: 'sai_code', requested_value: '027', status: 'pending' }],
      }));
      expect(el.innerHTML).toContain('คำขอแก้ไขของฉัน');
      expect(el.innerHTML).toContain('กำลังรอผู้ดูแลตรวจสอบ');
      expect(el.innerHTML).toContain('027');
    });

    it('shows the admin\'s note on both an approval and a rejection', () => {
      for (const status of ['approved', 'rejected']) {
        const el = host();
        renderMyHouse(el, recWith({
          my_requests: [{
            field: 'sai_code', requested_value: '027', status,
            decision_note: 'ตรวจกับทะเบียนแล้ว',
          }],
        }));
        expect(el.innerHTML).toContain('ตรวจกับทะเบียนแล้ว');
      }
    });

    it('says so when the admin saved something OTHER than what was asked', () => {
      // An admin may correct the value on approval (0128). "อนุมัติแล้ว" beside
      // a card showing a third สาย is the confusion this line exists to stop.
      const el = host();
      renderMyHouse(el, recWith({
        my_requests: [{
          field: 'sai_code', requested_value: '027', applied_value: '037',
          status: 'approved',
        }],
      }));
      expect(el.innerHTML).toContain('037');
      expect(el.innerHTML).toContain('ผู้ดูแลบันทึกให้เป็น');
    });

    it('does not repeat the value back when it was approved as asked', () => {
      const el = host();
      renderMyHouse(el, recWith({
        my_requests: [{
          field: 'sai_code', requested_value: '027', applied_value: '027',
          status: 'approved',
        }],
      }));
      expect(el.innerHTML).not.toContain('ผู้ดูแลบันทึกให้เป็น');
    });

    it('escapes the admin\'s note — it is free text typed into an admin form', () => {
      const el = host();
      renderMyHouse(el, recWith({
        my_requests: [{
          field: 'sai_code', requested_value: '027', status: 'rejected',
          decision_note: '<img src=x onerror=alert(1)>',
        }],
      }));
      expect(el.innerHTML).not.toContain('<img src=x');
    });
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
      .toEqual(['full_name', 'nickname', 'student_id', 'study_year', 'major']);
  });

  it('asks for nothing request_my_change would reject', () => {
    // The allow-list in migration 0116. A field outside it raises
    // 'ไม่รองรับการขอแก้ไขช่องนี้', i.e. a button that always fails.
    const allowed = new Set(['sai_code', 'student_id', 'first_name_th',
      'last_name_th', 'major', 'cohort_year']);
    for (const f of REQUESTABLE_FIELDS) expect(allowed.has(f.field)).toBe(true);
  });
});
