// my-seat.js — "ตำแหน่งของฉันในทีม SAMO".
//
// THE PROBLEM. A ทีม SAMO grant is invisible to the person holding it. Someone
// whose kkumail sits in the org tree signs in and the app quietly changes shape
// — a section appears in /admin/, a form starts saving — with nothing naming
// their ตำแหน่ง or listing what they may now do. Until now the only way to
// answer "what am I, and what can I do?" was to ask a developer with SQL access.
//
// One source: public.get_my_team_seat() (migrations 0109, extended in 0110). It
// takes no argument — identity comes from auth.uid() — so this module cannot be
// pointed at anyone else, and there is nothing here that could turn into a
// roster lookup. Every field it returns is the CALLER'S OWN.
//
// TWO SURFACES, ONE FETCH:
//   • the home page, under the greeting — the answer to "what am I" belongs
//     where the app already says hello, and this is the only place a member who
//     never opens /admin/ will see it;
//   • the โปรไฟล์ modal — the canonical "about my account" surface, where
//     someone goes when they specifically want to check.
// Both render from the same cached payload, so opening the modal after the home
// card has loaded costs nothing.
//
// WHAT 0110 ADDED. The card now shows the WHOLE record — portrait, ชื่อเล่น,
// รหัสนักศึกษา, ชั้นปี, สาขา, kkumail — and, when something about that record is
// wrong or missing, says so and offers the fix inline. The rules behind
// "something is wrong" are NOT restated here: they come from ./team/identity.js,
// the same module the admin ตรวจสอบข้อมูล pane uses, because this repo has been
// bitten by one rule with two implementations. `sid_clash` is the one finding
// that cannot be computed here (it needs other people's rows, which this
// payload deliberately does not contain) — and it is also the one a person
// cannot fix alone, so its absence costs nothing.
import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import { portraitSrc, portraitSrcSet, focusToObjectPosition } from './uploads.js';
import { findIssues, idsOf, KIND_LABEL } from './team/identity.js';
import {
  PERM_LABEL, VS_DEPT_LABEL, PROJECT_SEAT_LABEL, ADMIN_FEATURES,
} from './team-vocab.js';

// Cached per signed-in user. Keyed by uid so an account switch cannot show the
// previous person's ตำแหน่ง — the account switcher swaps the session in place
// (see the module-scope-cache entry in the mistakes log), and a plain boolean
// "already fetched" flag would survive that swap.
let cacheUid = null;
let cachePromise = null;

export function clearMySeatCache() {
  cacheUid = null;
  cachePromise = null;
}

/** Resolves to the seat payload, or null if the caller has no posting / is
 *  signed out / the lookup failed. Callers treat all three the same: no card. */
export function loadMySeat(uid) {
  if (!uid) return Promise.resolve(null);
  if (cacheUid === uid && cachePromise) return cachePromise;
  cacheUid = uid;
  cachePromise = dbRest('/rpc/get_my_team_seat', { method: 'POST', body: {} })
    .then(({ data, error }) => {
      if (error) throw new Error(error.message || `HTTP ${error.status}`);
      // A person with no ตำแหน่ง gets the empty envelope, not an error — that is
      // the overwhelmingly common case (every ordinary student login), so it
      // must be silent rather than logged as a failure.
      if (!data || !Array.isArray(data.postings) || !data.postings.length) return null;
      // Stamped here, not at the call site, so BOTH surfaces (home card and the
      // profile modal, which calls loadMySeat directly) can refetch and repaint
      // after a self-edit without each having to remember to pass it.
      data.__uid = uid;
      return data;
    })
    .catch((err) => {
      console.warn('my-seat: lookup failed:', err);
      return null;
    });
  return cachePromise;
}

const chips = (keys) => (keys || [])
  .map((k) => `<span class="myseat-chip">${escHtml(PERM_LABEL[k] || k)}</span>`)
  .join('');

/**
 * Permission key → the admin section it opens (`SECTION_META` in admin-main.js).
 *
 * They are NOT the same strings and that is the trap: the SAMO Shop permission
 * is `samoshop` while its section is `shop`, so linking `/admin/#${perm}` would
 * have produced a dead hash that silently falls back to ภาพรวม — the exact
 * "button implies a destination it does not reach" problem this map exists to
 * fix. `my-seat.test.js` pins every value against SECTION_META.
 */
export const PERM_SECTION = {
  pr: 'pr', vs: 'vs', samoshop: 'shop', projects: 'projects',
  creator: 'creator', team: 'team', team_edit: 'team',
};

/** Where — if anywhere — this person's grants actually let them go.
 *  `passport` does NOT open /admin/ (admin-main.js canUseAdmin gates on
 *  ADMIN_FEATURES, which excludes it), so linking a passport-only member there
 *  would hand them a door that bounces them. SAMO Passport is its own app. */
function ctaFor(perms) {
  // Land on the section this CARD is about, not the admin landing page. The
  // card's whole subject is ทีม SAMO, so "เปิดหน้าจัดการ" dropping the reader on
  // ภาพรวม made them navigate again to get where the button implied they were
  // going. `#team` is read by showAdminSide() in admin-main.js, which routes on
  // the first hash segment.
  if (perms.includes('team') || perms.includes('team_edit')) {
    return { href: '/admin/#team', label: 'เปิดหน้าทีม SAMO' };
  }
  // No ทีม SAMO rung but some other admin grant: if it is the ONLY one they
  // hold, go straight there rather than making them pick from a menu of one.
  const mine = ADMIN_FEATURES.filter((f) => perms.includes(f));
  const section = mine.length === 1 ? PERM_SECTION[mine[0]] : null;
  if (section) return { href: `/admin/#${section}`, label: 'เปิดหน้าจัดการ' };
  if (mine.length) return { href: '/admin/', label: 'เปิดหน้าจัดการ' };
  if (perms.includes('passport')) {
    return { href: '/passport/', label: 'เปิด SAMO Passport' };
  }
  return null;
}

/** The scope lines. Only rendered when a scope actually narrows something —
 *  "VitalSound: ทุกฝ่าย" is noise next to the VitalSound chip that already says
 *  it, whereas "VitalSound: เฉพาะฝ่ายวิชาการ" is the single most surprising
 *  fact about the grant and has to be said out loud. */
function scopeRows(seat) {
  const rows = [];
  const perms = seat.permissions || [];

  const vs = seat.vs_depts || [];
  // `vs` (all depts) and a vs_dept are mutually exclusive by design (0083); if
  // both somehow appear, the broad one is what RLS will honour, so say that.
  if (vs.length && !perms.includes('vs')) {
    rows.push(['VitalSound', `เฉพาะ ${vs.map((d) => VS_DEPT_LABEL[d] || d).join(' · ')}`]);
  }

  const seats = seat.project_seats || [];
  if (seats.length) {
    rows.push(['หนังสือโครงการ', seats.map((s) => PROJECT_SEAT_LABEL[s] || s).join(' · ')]);
  }

  const pass = seat.passport_scopes || [];
  if (pass.length && !perms.includes('passport')) {
    rows.push(['SAMO Passport', `เฉพาะบางหน่วยงาน (${pass.length})`]);
  }
  return rows;
}

// ── the person's own record ────────────────────────────────────────────────

/** The identity fields, read off the FIRST posting. A person with two postings
 *  whose rows disagree gets a `drift` finding below saying exactly that, so
 *  picking one here is safe: the card never silently hides the disagreement. */
export const DETAIL_FIELDS = [
  { key: 'nickname', label: 'ชื่อเล่น', editable: true },
  { key: 'student_id', label: 'รหัสนักศึกษา', editable: true },
  { key: 'year', label: 'ชั้นปี', editable: true },
  { key: 'major', label: 'สาขา', editable: true },
  { key: 'kkumail', label: 'KKU Mail', editable: false },
];

/**
 * What is wrong with THIS person's record, in the words the admin pane uses.
 *
 * Pure and exported for the tests. Two sources:
 *  • the shared rule engine (findIssues) over the caller's own postings — this
 *    is what catches an invalid kkumail and two postings that disagree;
 *  • a plain "this field is empty" pass, which is not a `findIssues` kind but
 *    is what a member can actually act on, and is the common case.
 */
export function ownIssues(seat) {
  if (!seat) return [];
  const postings = seat.postings || [];
  if (!postings.length) return [];

  const out = [];
  const nodeName = (id) => (postings.find((p) => p.node_id === id) || {}).node || '';
  const { issues } = findIssues(
    postings.map((p) => ({
      id: p.member_id,
      node_id: p.node_id,
      full_name: p.full_name,
      prefix: p.prefix,
      nickname: p.nickname,
      year: p.year,
      major: p.major,
      photo_url: p.photo_url,
      student_id: p.student_id,
      kkumail: p.kkumail,
    })),
    nodeName,
  );
  for (const is of issues) {
    // Only findings that actually name one of this person's rows. Belt and
    // braces — every row fed in is theirs — but it keeps the guarantee local
    // rather than resting on the payload's contents.
    const mine = idsOf(is).filter((id) => postings.some((p) => p.member_id === id));
    if (!mine.length) continue;
    out.push({
      kind: is.kind,
      label: KIND_LABEL[is.kind] || is.kind,
      detail: is.kind === 'drift'
        ? `${is.fieldLabel}: ${(is.values || []).map((v) => v.value).join(' / ')}`
        : is.kind === 'sid_drift'
          ? (is.values || []).join(' / ')
          : is.value || '',
    });
  }

  // Missing fields. Reported once per field even across several postings —
  // "กรอกชั้นปี" twice is noise, and fixing it once fixes the person.
  const first = postings[0];
  const missing = DETAIL_FIELDS
    .filter((f) => !String(first[f.key] ?? '').trim())
    .map((f) => f.label);
  if (missing.length) {
    out.push({ kind: 'missing', label: 'ข้อมูลยังไม่ครบ', detail: missing.join(' · ') });
  }
  if (!String(first.photo_url ?? '').trim()) {
    out.push({ kind: 'missing_photo', label: 'ยังไม่มีรูป', detail: '' });
  }
  return out;
}

function portraitHtml(p, size = 96) {
  const url = p.photo_url;
  const name = p.full_name || '';
  if (!url) {
    const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('');
    return `<div class="myseat-photo myseat-photo--empty" aria-hidden="true">${escHtml(initials || '?')}</div>`;
  }
  // portraitSrc(), never convertDriveUrl(url, size) — the latter returns an
  // already-lh3 URL unchanged, so its size argument is a no-op for every URL
  // this app stores (logged in the mistakes log).
  return `<img class="myseat-photo" src="${escHtml(portraitSrc(url, size, p.photo_focus || 'center'))}"
    srcset="${escHtml(portraitSrcSet(url, [size, size * 2], p.photo_focus || 'center'))}"
    sizes="${size}px" alt="${escHtml(name)}" loading="lazy"
    style="object-position:${escHtml(focusToObjectPosition(p.photo_focus))}" />`;
}

function postingHtml(p) {
  const path = Array.isArray(p.path) ? p.path : [];
  return `
    <li class="myseat-posting">
      <span class="myseat-posting-role">
        ${p.is_board ? '<i class="bi bi-award-fill myseat-board" aria-hidden="true"></i> ' : ''}${escHtml(p.node || '')}
      </span>
      ${path.length ? `<span class="myseat-posting-path">${path.map(escHtml).join(' <i class="bi bi-chevron-right" aria-hidden="true"></i> ')}</span>` : ''}
    </li>`;
}

function detailsHtml(p) {
  const rows = DETAIL_FIELDS.map((f) => {
    const v = String(p[f.key] ?? '').trim();
    return `<div class="myseat-detail${v ? '' : ' is-empty'}">
      <dt>${escHtml(f.label)}</dt>
      <dd>${v ? escHtml(v) : '<span class="myseat-missing">ยังไม่ได้กรอก</span>'}</dd>
    </div>`;
  }).join('');
  return `<dl class="myseat-details">${rows}</dl>`;
}

/** The findings block. Its wording depends on whether the person may fix it —
 *  telling someone "แก้ไขได้เลย" when every write will 42501 is worse than
 *  saying nothing, and telling an admin to "ติดต่อฝ่าย IT" about their own
 *  record is absurd. */
function issuesHtml(issues, canFix) {
  if (!issues.length) return '';
  const items = issues.map((i) => `
    <li class="myseat-issue">
      <i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i>
      <span><strong>${escHtml(i.label)}</strong>${i.detail ? ` — ${escHtml(i.detail)}` : ''}</span>
    </li>`).join('');
  return `
    <div class="myseat-block myseat-issues">
      <span class="myseat-label">ข้อมูลที่ควรแก้</span>
      <ul class="myseat-issue-list">${items}</ul>
      ${canFix
        ? '<button type="button" class="myseat-fix" data-myseat-edit>แก้ไขข้อมูลของฉัน</button>'
        : '<p class="myseat-issue-hint">ติดต่อหัวหน้าฝ่ายหรือฝ่าย IT เพื่อแก้ไขข้อมูลนี้</p>'}
    </div>`;
}

/** The inline self-edit form. Only the columns migration 0110 lets a member
 *  write — kkumail is shown read-only because it is the identity every
 *  resolver keys on, and changing it would move the row out of the caller's
 *  own SELECT policy (an un-PATCHable UPDATE, logged in the mistakes log). */
function editFormHtml(p) {
  const field = (f) => `
    <label class="myseat-field">
      <span>${escHtml(f.label)}</span>
      <input type="text" name="${escHtml(f.key)}" value="${escHtml(String(p[f.key] ?? ''))}"
        ${f.key === 'year' ? 'inputmode="numeric"' : ''} />
    </label>`;
  return `
    <form class="myseat-edit" data-myseat-form hidden>
      <p class="myseat-edit-intro">แก้ไขข้อมูลส่วนตัวของคุณได้ที่นี่ ส่วนตำแหน่งและสิทธิ์ ผู้ดูแลทีม SAMO เป็นผู้กำหนด</p>
      <div class="myseat-fields">
        ${DETAIL_FIELDS.filter((f) => f.editable).map(field).join('')}
      </div>
      <label class="myseat-field myseat-field--locked">
        <span>KKU Mail</span>
        <input type="text" value="${escHtml(String(p.kkumail ?? ''))}" readonly />
      </label>
      <div class="myseat-edit-actions">
        <button type="submit" class="myseat-save">บันทึก</button>
        <button type="button" class="myseat-cancel" data-myseat-cancel>ยกเลิก</button>
        <span class="myseat-edit-status" data-myseat-status role="status"></span>
      </div>
    </form>`;
}

/**
 * Paint the card into `host`.
 * @param {HTMLElement|null} host
 * @param {object|null} seat  payload from loadMySeat(), or null
 * @param {{ compact?: boolean }} [opts] compact drops the eyebrow — the
 *        profile modal already has a "ตำแหน่งในทีม SAMO" heading above it, and
 *        saying it twice reads as a rendering bug. (This stopped being wired
 *        up when the duplicated name was removed; re-pointed at the eyebrow
 *        rather than deleted, because the modal genuinely needs the difference.)
 */
export function renderMySeat(host, seat, opts = {}) {
  if (!host) return;
  if (!seat) { host.hidden = true; host.innerHTML = ''; return; }

  const perms = seat.permissions || [];
  const rows = scopeRows(seat);
  const cta = ctaFor(perms);
  const postings = seat.postings || [];
  const me = postings[0] || {};
  // The person's name, said ONCE. It used to appear twice — in the header and
  // again beside the portrait — which read as a rendering bug on the home card.
  const who = [me.prefix, seat.name, seat.nickname ? `(${seat.nickname})` : '']
    .filter(Boolean).join(' ');
  const issues = ownIssues(seat);

  host.hidden = false;
  host.innerHTML = `
    <div class="myseat-card">
      ${opts.compact ? '' : `
      <div class="myseat-head">
        <span class="myseat-eyebrow"><i class="bi bi-diagram-3-fill" aria-hidden="true"></i> ตำแหน่งของฉันในทีม SAMO</span>
      </div>`}

      <div class="myseat-person">
        ${portraitHtml(me)}
        <div class="myseat-person-body">
          ${who ? `<p class="myseat-name">${escHtml(who)}</p>` : ''}
          <ul class="myseat-postings">${postings.map(postingHtml).join('')}</ul>
        </div>
      </div>

      ${detailsHtml(me)}
      ${editFormHtml(me)}
      ${issuesHtml(issues, !!me.member_id)}

      ${perms.length ? `
        <div class="myseat-block">
          <span class="myseat-label">สิทธิ์ที่ได้รับ</span>
          <div class="myseat-chips">${chips(perms)}</div>
        </div>` : `
        <p class="myseat-none">ตำแหน่งนี้ยังไม่ได้รับสิทธิ์ใช้งานระบบใด — หากคิดว่าไม่ถูกต้อง ติดต่อฝ่าย IT</p>`}

      ${rows.length ? `
        <div class="myseat-block">
          <span class="myseat-label">ขอบเขต</span>
          <dl class="myseat-scopes">${rows.map(([k, v]) => `
            <div><dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd></div>`).join('')}</dl>
        </div>` : ''}

      ${!issues.length && me.member_id ? `
        <button type="button" class="myseat-fix myseat-fix--quiet" data-myseat-edit>แก้ไขข้อมูลของฉัน</button>` : ''}

      ${cta ? `
        <a class="myseat-cta" href="${cta.href}">
          ${escHtml(cta.label)} <i class="bi bi-arrow-right" aria-hidden="true"></i>
        </a>` : ''}
    </div>`;

  wireSelfEdit(host, seat);
}

/** The self-edit round trip. Writes ONLY the four safe columns; the server
 *  guard (team_members_self_update_guard, 0110) is the real boundary and
 *  refuses anything else, so this list is a UI convenience, not the security. */
function wireSelfEdit(host, seat) {
  // renderMySeat's contract is "anything with .innerHTML and .hidden" — the
  // unit tests assert the MARKUP against a plain object, with no DOM at all.
  // Behaviour wiring is therefore opt-in on a real element rather than assumed.
  if (typeof host.querySelector !== 'function') return;
  const form = host.querySelector('[data-myseat-form]');
  const details = host.querySelector('.myseat-details');
  if (!form) return;
  const status = form.querySelector('[data-myseat-status]');
  const show = (on) => {
    form.hidden = !on;
    if (details) details.hidden = on;
    host.querySelectorAll('[data-myseat-edit]').forEach((b) => { b.hidden = on; });
  };

  host.querySelectorAll('[data-myseat-edit]').forEach((b) => b.addEventListener('click', () => show(true)));
  form.querySelector('[data-myseat-cancel]')?.addEventListener('click', () => show(false));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const memberId = (seat.postings || [])[0]?.member_id;
    if (!memberId) return;
    const body = {};
    for (const f of DETAIL_FIELDS.filter((x) => x.editable)) {
      const el = form.querySelector(`[name="${f.key}"]`);
      if (el) body[f.key] = el.value.trim() || null;
    }
    const btn = form.querySelector('.myseat-save');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
    if (status) status.textContent = '';
    try {
      // A person with TWO postings has two rows to keep in step — writing only
      // the first would CREATE the `drift` finding this card exists to clear.
      const ids = (seat.postings || []).map((p) => p.member_id).filter(Boolean);
      const { data, error } = await dbRest(
        `/team_members?id=in.(${ids.join(',')})`,
        { method: 'PATCH', body, prefer: 'return=representation' },
      );
      // dbRest returns { data: [] } on an RLS-blocked write rather than an
      // error — the silent-success trap. A zero-length result IS the failure.
      if (error) throw new Error(error.message || `HTTP ${error.status}`);
      if (!Array.isArray(data) || !data.length) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
      clearMySeatCache();
      const fresh = await loadMySeat(seat.__uid);
      renderMySeat(host, fresh || seat, seat.__opts || {});
    } catch (err) {
      if (status) status.textContent = `บันทึกไม่สำเร็จ: ${err.message || err}`;
      if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; }
    }
  });
}

/** Convenience for the two call sites: fetch (cached) then paint. */
export async function showMySeat(host, uid, opts) {
  if (!host) return;
  if (!uid) { renderMySeat(host, null); return; }
  const seat = await loadMySeat(uid);
  if (seat) seat.__opts = opts || {};
  renderMySeat(host, seat, opts);
}
