// Tests for the "ตำแหน่งของฉันในทีม SAMO" card.
//
// The renderer touches the DOM, so these exercise the two decisions that are
// actually easy to get wrong and impossible to see in review:
//   1. WHERE the CTA points. A `passport`-only grantee must not be sent to
//      /admin/, which bounces them (admin-main.js canUseAdmin excludes passport).
//   2. WHEN a scope line appears. "VitalSound: ทุกฝ่าย" is noise; a dept-scoped
//      grant is the single most surprising fact about the grant and must show.
// Plus the escaping, since every field here is user-typed and lands in innerHTML.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// db.js creates a supabase client and a setInterval at import time; the card
// renderer never touches it, so stub the whole module rather than booting it.
vi.mock('./db.js', () => ({ dbRest: vi.fn() }));

const { renderMySeat, PERM_SECTION } = await import('./my-seat.js');

/** Minimal element stand-in: renderMySeat only ever sets .hidden / .innerHTML. */
function host() {
  return { hidden: false, innerHTML: '' };
}

const seatWith = (over = {}) => ({
  email: 'a@kkumail.com',
  name: 'ชื่อ จริง',
  nickname: 'เล่น',
  postings: [{ node_id: 'n1', node: 'หัวหน้าฝ่าย IT', path: ['ฝ่ายดิจิทัล'], is_board: false, permissions: [], confirmed: true }],
  permissions: [],
  vs_depts: [],
  project_seats: [],
  passport_scopes: [],
  ...over,
});

describe('renderMySeat', () => {
  let el;
  beforeEach(() => { el = host(); });

  it('hides itself when there is no seat', () => {
    renderMySeat(el, null);
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe('');
  });

  it('is a no-op on a missing host rather than throwing', () => {
    expect(() => renderMySeat(null, seatWith())).not.toThrow();
  });

  it('names the ตำแหน่ง and its ฝ่าย path', () => {
    renderMySeat(el, seatWith());
    expect(el.hidden).toBe(false);
    expect(el.innerHTML).toContain('หัวหน้าฝ่าย IT');
    expect(el.innerHTML).toContain('ฝ่ายดิจิทัล');
  });

  it('runs the breadcrumb ALL THE WAY IN, ending at the ตำแหน่ง', () => {
    // Reported: the trail read "ฝ่ายดิจิทัลและสื่อสารองค์กร > ฝ่าย IT" and stopped
    // one level short, with the ตำแหน่ง printed separately ABOVE it.
    // team_node_path() returns ancestors only, so the node name has to be
    // appended by the renderer — assert it is INSIDE the path element, after the
    // last ancestor, or this silently regresses to two disconnected lines.
    renderMySeat(el, seatWith({
      postings: [{
        node_id: 'n1', node: 'หัวหน้าฝ่าย IT',
        path: ['ฝ่ายดิจิทัลและสื่อสารองค์กร', 'ฝ่าย IT'],
        is_board: false, permissions: [], confirmed: true,
      }],
    }));
    const path = el.innerHTML.match(/<span class="myseat-posting-path">([\s\S]*?)<\/span>\s*<\/li>/);
    expect(path).not.toBeNull();
    const inside = path[1];
    expect(inside).toContain('ฝ่ายดิจิทัลและสื่อสารองค์กร');
    expect(inside).toContain('ฝ่าย IT');
    expect(inside.indexOf('หัวหน้าฝ่าย IT')).toBeGreaterThan(inside.indexOf('ฝ่ายดิจิทัลและสื่อสารองค์กร'));
    // and the ตำแหน่ง is the emphasised last crumb, not a plain one
    expect(inside).toContain('myseat-crumb is-self');
  });

  it('renders every posting, not just the first', () => {
    renderMySeat(el, seatWith({
      postings: [
        { node_id: 'a', node: 'ตำแหน่งหนึ่ง', path: [], is_board: false, permissions: [], confirmed: true },
        { node_id: 'b', node: 'ตำแหน่งสอง', path: [], is_board: true, permissions: [], confirmed: true },
      ],
    }));
    expect(el.innerHTML).toContain('ตำแหน่งหนึ่ง');
    expect(el.innerHTML).toContain('ตำแหน่งสอง');
  });

  // ---- the CTA target ----

  it('every permission maps to a REAL admin section', () => {
    // The keys differ (`samoshop` the permission vs `shop` the section), so a
    // naive `/admin/#${perm}` link lands on a hash SECTION_META does not know
    // and quietly falls back to ภาพรวม.
    const admin = readFileSync(new URL('./admin-main.js', import.meta.url), 'utf8');
    const meta = admin.slice(admin.indexOf('const SECTION_META = {'));
    for (const [perm, section] of Object.entries(PERM_SECTION)) {
      expect(meta, `${perm} -> #${section} is not a section`).toMatch(new RegExp(`\\n\\s*${section}\\s*:`));
    }
  });

  it('sends a single-grant holder STRAIGHT to their section, not the dashboard', () => {
    // Landing on ภาพรวม when there is exactly one thing you can do makes the
    // reader navigate again to reach the place the button implied.
    renderMySeat(el, seatWith({ permissions: ['pr'] }));
    expect(el.innerHTML).toContain('href="/admin/#pr"');
  });

  it('sends a multi-grant holder to the dashboard, since there IS a choice', () => {
    renderMySeat(el, seatWith({ permissions: ['pr', 'samoshop'] }));
    expect(el.innerHTML).toContain('href="/admin/"');
  });

  it('uses the SECTION key, not the permission key, for SAMO Shop', () => {
    renderMySeat(el, seatWith({ permissions: ['samoshop'] }));
    expect(el.innerHTML).toContain('href="/admin/#shop"');
  });

  it('sends a passport-ONLY grantee to /passport/, never /admin/', () => {
    renderMySeat(el, seatWith({ permissions: ['passport'] }));
    expect(el.innerHTML).toContain('href="/passport/"');
    expect(el.innerHTML).not.toContain('href="/admin/"');
  });

  it('prefers /admin/ over /passport/ when the person holds both', () => {
    renderMySeat(el, seatWith({ permissions: ['passport', 'team'] }));
    expect(el.innerHTML).not.toContain('href="/passport/"');
  });

  it('opens ทีม SAMO — the card\'s own subject — whenever they hold a team rung', () => {
    // Reported: "when i click เปิดหน้าจัดการ, it should show page teamsamo in
    // admin, not the admin dashboard". The card is about ทีม SAMO, so its
    // button goes there even for someone who could open several sections.
    renderMySeat(el, seatWith({ permissions: ['pr', 'samoshop', 'team'] }));
    expect(el.innerHTML).toContain('href="/admin/#team"');
  });

  it('offers no CTA at all for a posting with no permissions', () => {
    renderMySeat(el, seatWith({ permissions: [] }));
    expect(el.innerHTML).not.toContain('myseat-cta');
    // …and says so, rather than showing an unexplained empty card.
    expect(el.innerHTML).toContain('ยังไม่ได้รับสิทธิ์');
  });

  // ---- scope lines ----

  it('states a dept-scoped VitalSound grant', () => {
    renderMySeat(el, seatWith({ vs_depts: ['อุปนายกฝ่ายวิชาการ'] }));
    expect(el.innerHTML).toContain('เฉพาะ');
    expect(el.innerHTML).toContain('วิชาการ');
  });

  it('stays quiet about VS scope when the grant is already full `vs`', () => {
    renderMySeat(el, seatWith({ permissions: ['vs'], vs_depts: ['อุปนายกฝ่ายวิชาการ'] }));
    // Asserted against the SCOPE BLOCK, not the whole card: a bare
    // `not.toContain('เฉพาะ')` also matched ordinary copy elsewhere on the card
    // and failed the moment the self-edit form was added, which said nothing
    // about VS scope at all.
    const scopes = el.innerHTML.match(/<dl class="myseat-scopes">[\s\S]*?<\/dl>/)?.[0] || '';
    expect(scopes).not.toContain('วิชาการ');
  });

  it('names the หนังสือโครงการ seat, since the permission alone is not the job', () => {
    renderMySeat(el, seatWith({ permissions: ['projects'], project_seats: ['staff'] }));
    expect(el.innerHTML).toContain('เจ้าหน้าที่คณะ');
  });

  it('falls back to the raw key when a permission has no label', () => {
    renderMySeat(el, seatWith({ permissions: ['brandnew'] }));
    expect(el.innerHTML).toContain('brandnew');
  });

  // ---- escaping ----
  // full_name / nickname / node names are all typed by an admin in ทีม SAMO and
  // land in innerHTML, so they are untrusted by the same rule as every other
  // renderer in this app.

  it('escapes the ตำแหน่ง name', () => {
    renderMySeat(el, seatWith({
      postings: [{ node_id: 'x', node: '<img src=x onerror=alert(1)>', path: [], is_board: false, permissions: [], confirmed: true }],
    }));
    expect(el.innerHTML).not.toContain('<img');
    expect(el.innerHTML).toContain('&lt;img');
  });

  it('escapes the ฝ่าย path and the person name', () => {
    renderMySeat(el, seatWith({
      name: '<script>bad()</script>',
      postings: [{ node_id: 'x', node: 'ok', path: ['<b>x</b>'], is_board: false, permissions: [], confirmed: true }],
    }));
    expect(el.innerHTML).not.toContain('<script>');
    expect(el.innerHTML).not.toContain('<b>x</b>');
  });
});


// ============================================================
// A SCOPED grant is still a grant — the seat card must offer a way in.
//
// FOUND 2026-08-30 while sweeping for other instances of the จัดการสิทธิ์ chip
// bug. `ctaFor` read only `seat.permissions`, but `readPermInputs` DROPS the
// capability key the moment a scope is chosen (0083). Measured against
// production that day: 42 people held a passport ฝ่าย with no `passport` key
// and 3 held a VitalSound แผนก with no `vs` key. Their own seat card offered
// them no way into a system they had been granted.
// ============================================================
describe('the seat CTA honours a scoped grant', () => {
  it('control — no grants at all offers no button', () => {
    // Proves the assertions below distinguish "a button appeared" from
    // "this renderer always produces one".
    const el = host();
    renderMySeat(el, seatWith({}));
    expect(el.innerHTML).not.toMatch(/เปิด SAMO Passport|เปิดหน้าจัดการ/);
  });

  it('a passport ฝ่าย with NO `passport` key still offers the Passport link', () => {
    const el = host();
    renderMySeat(el, seatWith({ permissions: [], passport_scopes: ['d:5'] }));
    expect(el.innerHTML, 'a scoped passport holder was offered no way in')
      .toMatch(/เปิด SAMO Passport/);
  });

  it('a VitalSound แผนก with NO `vs` key still offers the admin link', () => {
    const el = host();
    renderMySeat(el, seatWith({ permissions: [], vs_depts: ['วิชาการ'] }));
    expect(el.innerHTML, 'a scoped VS holder was offered no way in')
      .toMatch(/เปิดหน้าจัดการ/);
  });

  it('the blanket keys still work (no regression)', () => {
    const el = host();
    renderMySeat(el, seatWith({ permissions: ['passport'] }));
    expect(el.innerHTML).toMatch(/เปิด SAMO Passport/);
  });
});

describe('a scope line under master understates it, so it is not drawn', () => {
  // FOUND 2026-08-30 by scan. Both master holders in the tree inherit a vs_dept
  // AND a passport scope from an ancestor node, so their own card told them
  // their VitalSound access was limited to one ฝ่าย while they were in fact
  // reading every department. `permChipsHtml` already applied this rule in the
  // admin tree; this was the SECOND reader of the same fact.
  //
  // ⚠️ Asserted against the SCOPE BLOCK, not the whole card — `บริหารองค์กร`
  // also appears in ordinary copy, and the first version of this test matched
  // the raw dept KEY, which `VS_DEPT_LABEL` never renders. It therefore passed
  // while asserting nothing at all.
  const scopeBlock = (el) => el.innerHTML.match(/<dl class="myseat-scopes">[\s\S]*?<\/dl>/)?.[0] || '';

  it('hides the VitalSound and Passport scope lines under master', () => {
    const el = host();
    renderMySeat(el, seatWith({
      permissions: ['master', 'team', 'team_edit'],
      vs_depts: ['อุปนายกฝ่ายบริหารองค์กร'],
      passport_scopes: ['d:1'],
    }));
    expect(scopeBlock(el), 'a master holder was told their VS access is scoped')
      .not.toContain('บริหารองค์กร');
    expect(scopeBlock(el), 'a master holder was told their Passport access is scoped')
      .not.toContain('เฉพาะบางหน่วยงาน');
  });

  it('control — the SAME scopes DO show without master', () => {
    // Without this the assertions above would pass on a renderer that had
    // stopped drawing scope lines at all.
    const el = host();
    renderMySeat(el, seatWith({
      permissions: [], vs_depts: ['อุปนายกฝ่ายบริหารองค์กร'], passport_scopes: ['d:1'],
    }));
    expect(scopeBlock(el)).toContain('บริหารองค์กร');
    expect(scopeBlock(el)).toContain('เฉพาะบางหน่วยงาน');
  });

  it('the หนังสือโครงการ seat still shows under master — a seat is an identity', () => {
    const el = host();
    renderMySeat(el, seatWith({ permissions: ['master'], project_seats: ['staff'] }));
    expect(scopeBlock(el)).toContain('เจ้าหน้าที่คณะ');
  });
});
