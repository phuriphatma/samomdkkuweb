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

// db.js creates a supabase client and a setInterval at import time; the card
// renderer never touches it, so stub the whole module rather than booting it.
vi.mock('./db.js', () => ({ dbRest: vi.fn() }));

const { renderMySeat } = await import('./my-seat.js');

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

  it('sends an admin-feature grantee to /admin/', () => {
    renderMySeat(el, seatWith({ permissions: ['pr'] }));
    expect(el.innerHTML).toContain('href="/admin/"');
  });

  it('sends a passport-ONLY grantee to /passport/, never /admin/', () => {
    renderMySeat(el, seatWith({ permissions: ['passport'] }));
    expect(el.innerHTML).toContain('href="/passport/"');
    expect(el.innerHTML).not.toContain('href="/admin/"');
  });

  it('prefers /admin/ when the person holds both', () => {
    renderMySeat(el, seatWith({ permissions: ['passport', 'team'] }));
    expect(el.innerHTML).toContain('href="/admin/"');
    expect(el.innerHTML).not.toContain('href="/passport/"');
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
