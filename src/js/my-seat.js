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
import {
  portraitSrc, portraitSrcSet, focusToObjectPosition, uploadTeamPhoto,
} from './uploads.js';
import { cropImage } from './image-crop.js';
import { findIssues, idsOf, KIND_LABEL } from './team/identity.js';
// The same รหัสนักศึกษา / ชั้นปี / สาขา rules the admin form and the CSV importer
// use. A person fixing their own row is a THIRD writer to these columns, and it
// must not be the one that reintroduces `md` beside `MD`.
import {
  normalizeIdentityFields, YEARS, SID_HINT, SID_PLACEHOLDER, majorKey,
} from './team/fields.js';
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
  house: 'house',
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
  // ชื่อ-สกุล is editable and was missing until now, which made the card's own
  // promise false: the admin guard (0110) has always allowed a person to fix
  // their own name, the header shows it, and the form quietly did not offer it —
  // so "แก้ไขข้อมูลของฉัน" could not fix the single most visible field.
  { key: 'full_name', label: 'ชื่อ-สกุล', editable: true, wide: true },
  { key: 'nickname', label: 'ชื่อเล่น', editable: true },
  { key: 'student_id', label: 'รหัสนักศึกษา', editable: true, hint: SID_HINT },
  // Choosers, for the same reason the admin form has them: ปี5 / 5 / "5 " and
  // md / MD / M.D. are one answer spelled four ways, and the difference shows up
  // as a ตรวจสอบข้อมูล finding on the person who typed the second spelling.
  { key: 'year', label: 'ชั้นปี', editable: true, control: 'year' },
  { key: 'major', label: 'สาขา', editable: true, control: 'major' },
  // `wide` puts a field on its own row. KKU Mail is ~3x the length of the
  // others, so sharing a row with them squeezed it into a quarter of the card
  // and it wrapped MID-ADDRESS ("somebody.ex@kkuma / il.com").
  { key: 'kkumail', label: 'KKU Mail', editable: false, wide: true },
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

  // รหัสนักศึกษา shared with someone else. This is the ONE finding the rule
  // engine cannot reach from here: a clash is a fact about TWO people, and this
  // payload carries only one. The server counts the others (migration 0112) —
  // a count, never a name — and the wording matches the admin pane's, so the
  // person and the admin are talking about the same thing.
  if (Number(seat.student_id_shared_with) > 0) {
    out.push({
      kind: 'sid_clash',
      label: KIND_LABEL.sid_clash,
      // Names WHO to tell. "ผู้ดูแลทีม SAMO" is not a person anybody can find —
      // the people who can actually fix another person's row are the ฝ่าย's
      // อุปนายก and whoever holds ทีม SAMO (แก้ไข).
      detail: `${String(first.student_id ?? '').trim()} — มีอีก ${seat.student_id_shared_with} คนใช้รหัสนี้ `
        + 'ตรวจสอบว่ารหัสของคุณถูกต้อง หากถูกต้องแล้วให้แจ้งอุปนายกฝ่ายของท่าน '
        + 'หรือผู้ที่มีสิทธิ์แก้ไขทีม SAMO',
    });
  }

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

/**
 * One posting, as ONE breadcrumb that ends at the ตำแหน่ง.
 *
 * Reported: "หัวหน้าฝ่าย IT / ฝ่ายดิจิทัลและสื่อสารองค์กร ฝ่าย IT — it should show
 * until the role like ฝ่ายดิจิทัลและสื่อสารองค์กร > ฝ่าย IT > หัวหน้าฝ่าย IT".
 * It used to print the ตำแหน่ง on one line and its ANCESTORS on another, so the
 * person's own ตำแหน่ง appeared first and then again by implication at the end of
 * a trail that stopped one level short of it. `team_node_path()` returns
 * ancestors only (root first, excluding the node), so the node name is appended
 * here — as the last, emphasised crumb, which is the one the reader is looking
 * for.
 */
function postingHtml(p) {
  const path = Array.isArray(p.path) ? p.path : [];
  const sep = ' <i class="bi bi-chevron-right" aria-hidden="true"></i> ';
  const crumbs = [
    ...path.map((seg) => `<span class="myseat-crumb">${escHtml(seg)}</span>`),
    `<span class="myseat-crumb is-self">${
      p.is_board ? '<i class="bi bi-award-fill myseat-board" aria-hidden="true"></i> ' : ''
    }${escHtml(p.node || '')}</span>`,
  ];
  return `
    <li class="myseat-posting">
      <span class="myseat-posting-path">${crumbs.join(sep)}</span>
    </li>`;
}

function detailsHtml(p) {
  const rows = DETAIL_FIELDS.map((f) => {
    const v = String(p[f.key] ?? '').trim();
    return `<div class="myseat-detail${v ? '' : ' is-empty'}${f.wide ? ' is-wide' : ''}">
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
      ${canFix ? '' : '<p class="myseat-issue-hint">แจ้งอุปนายกฝ่ายของท่าน หรือผู้ที่มีสิทธิ์แก้ไขทีม SAMO เพื่อแก้ไขข้อมูลนี้</p>'}
    </div>`;
}

/**
 * The สาขา vocabulary (migration 0113), for the chooser.
 *
 * Module-scope and fetched once. It is three rows of non-confidential codes, so
 * a failed fetch is not fatal: the chooser then offers only what the person
 * already has, which is still better than a free-text box that lets them invent
 * a fourth spelling of MD.
 */
let majorOptions = null;
async function loadMajorOptions() {
  if (majorOptions) return majorOptions;
  try {
    const { data, error } = await dbRest('/team_majors?select=code,label&order=position.asc,code.asc');
    if (error) throw new Error(error.message);
    majorOptions = Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('my-seat: majors lookup failed:', err);
    majorOptions = [];
  }
  return majorOptions;
}

/** `<option>`s for a chooser, keeping an off-list stored value as its own option
 *  — a select that silently drops what the row holds would REWRITE that value on
 *  the next save of an unrelated field. */
function optionsHtml(values, current, labelOf = (v) => v) {
  const cur = String(current ?? '').trim();
  const known = values.some((v) => majorKey(v) === majorKey(cur));
  return `<option value="">— ไม่ระบุ —</option>`
    + values.map((v) => `<option value="${escHtml(v)}"${
      majorKey(v) === majorKey(cur) ? ' selected' : ''}>${escHtml(labelOf(v))}</option>`).join('')
    + (cur && !known
      ? `<option value="${escHtml(cur)}" selected>${escHtml(cur)} (ไม่อยู่ในรายการ)</option>` : '');
}

/**
 * The inline self-edit form. Only the columns migration 0110 lets a member
 * write — kkumail is shown read-only because it is the identity every resolver
 * keys on, and changing it would move the row out of the caller's own SELECT
 * policy (an un-PATCHable UPDATE, logged in the mistakes log).
 *
 * The photo is part of it (the ยังไม่มีรูป finding used to point at an admin the
 * person then had to go and find), and it follows the same rule as the admin
 * form: NOTHING is uploaded until บันทึก. Uploading on pick is what left orphan
 * files in Drive.
 */
function editFormHtml(p) {
  const majors = (majorOptions || []).map((m) => m.code);
  const majorLabel = (code) => {
    const hit = (majorOptions || []).find((m) => m.code === code);
    return hit?.label ? `${code} — ${hit.label}` : code;
  };
  const field = (f) => {
    const val = String(p[f.key] ?? '');
    const inner = f.control === 'year'
      ? `<select name="year">${optionsHtml(YEARS, val, (y) => `ปี ${y}`)}</select>`
      : f.control === 'major'
        ? `<select name="major">${optionsHtml(majors, val, majorLabel)}</select>`
        : `<input type="text" name="${escHtml(f.key)}" value="${escHtml(val)}"${
          f.key === 'student_id' ? ` inputmode="numeric" placeholder="${SID_PLACEHOLDER}"` : ''} />`;
    return `
    <label class="myseat-field${f.wide ? ' is-wide' : ''}">
      <span>${escHtml(f.label)}</span>
      ${inner}
      ${f.hint ? `<em class="myseat-field-hint">${escHtml(f.hint)}</em>` : ''}
    </label>`;
  };
  return `
    <form class="myseat-edit" data-myseat-form hidden>
      <p class="myseat-edit-intro">แก้ไขข้อมูลส่วนตัวของคุณได้ที่นี่ ส่วนตำแหน่งและสิทธิ์ อุปนายกฝ่ายหรือผู้ที่มีสิทธิ์แก้ไขทีม SAMO เป็นผู้กำหนด</p>

      <div class="myseat-photo-edit">
        <div class="myseat-photo-frame" data-myseat-photo>${portraitHtml(p, 96)}</div>
        <div class="myseat-photo-actions">
          <label class="myseat-photo-btn">
            <input type="file" accept="image/*" data-myseat-photo-file hidden />
            <i class="bi bi-camera" aria-hidden="true"></i>
            ${p.photo_url ? 'เปลี่ยนรูป' : 'เพิ่มรูป'}
          </label>
          <button type="button" class="myseat-photo-remove${p.photo_url ? '' : ' is-hidden'}"
            data-myseat-photo-remove>นำรูปออก</button>
          <em class="myseat-photo-note" data-myseat-photo-note>รูปนี้แสดงบนหน้าโครงสร้างองค์กรที่เปิดให้บุคคลทั่วไปดูได้</em>
        </div>
      </div>

      <div class="myseat-fields">
        ${DETAIL_FIELDS.filter((f) => f.editable).map(field).join('')}
      </div>
      <label class="myseat-field myseat-field--locked is-wide">
        <span>KKU Mail</span>
        <input type="text" value="${escHtml(String(p.kkumail ?? ''))}" readonly />
        <em class="myseat-field-hint">เปลี่ยนไม่ได้ — เป็นอีเมลที่ใช้จับคู่ตำแหน่งของคุณ</em>
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
  // คำนำหน้า used to lead this line; migration 0113 dropped the column.
  const who = [seat.name, seat.nickname ? `(${seat.nickname})` : '']
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
      ${me.member_id ? `
        <button type="button" class="myseat-fix myseat-fix--quiet" data-myseat-edit>
          <i class="bi bi-pencil" aria-hidden="true"></i> แก้ไขข้อมูลของฉัน
        </button>` : ''}
      ${editFormHtml(me)}
      ${issuesHtml(issues, !!me.member_id)}

      ${perms.length ? `
        <div class="myseat-block">
          <span class="myseat-label">สิทธิ์ที่ได้รับ</span>
          <div class="myseat-chips">${chips(perms)}</div>
        </div>` : `
        <p class="myseat-none">ตำแหน่งนี้ยังไม่ได้รับสิทธิ์ใช้งานระบบใด — หากคิดว่าไม่ถูกต้อง แจ้งอุปนายกฝ่ายของท่าน หรือผู้ที่มีสิทธิ์แก้ไขทีม SAMO</p>`}

      ${rows.length ? `
        <div class="myseat-block">
          <span class="myseat-label">ขอบเขต</span>
          <dl class="myseat-scopes">${rows.map(([k, v]) => `
            <div><dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd></div>`).join('')}</dl>
        </div>` : ''}

      ${cta ? `
        <a class="myseat-cta" href="${cta.href}">
          ${escHtml(cta.label)} <i class="bi bi-arrow-right" aria-hidden="true"></i>
        </a>` : ''}
    </div>`;

  wireSelfEdit(host, seat);
}

/** The self-edit round trip. Writes ONLY the columns migration 0110 allows; the
 *  server guard (team_members_self_update_guard) is the real boundary and
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

  host.querySelectorAll('[data-myseat-edit]').forEach((b) => b.addEventListener('click', () => {
    show(true);
    // Fill the สาขา chooser the first time the form is actually opened, not on
    // every card paint: the list is only needed by someone editing, and the card
    // renders for every signed-in member on the home page.
    loadMajorOptions().then(() => {
      const sel = form.querySelector('[name="major"]');
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = optionsHtml(
        (majorOptions || []).map((m) => m.code), cur,
        (code) => {
          const hit = (majorOptions || []).find((m) => m.code === code);
          return hit?.label ? `${code} — ${hit.label}` : code;
        },
      );
    });
  }));
  form.querySelector('[data-myseat-cancel]')?.addEventListener('click', () => show(false));

  // ── the photo. Framed here, uploaded on บันทึก (see the admin form's
  // memberPhotoPending for the bug that rule exists to prevent: an upload on
  // PICK leaves a file in Drive that nothing will ever reference).
  const me = (seat.postings || [])[0] || {};
  let pendingPhoto = null;       // { file, previewUrl }
  let removePhoto = false;
  const frame = form.querySelector('[data-myseat-photo]');
  const note = form.querySelector('[data-myseat-photo-note]');
  const removeBtn = form.querySelector('[data-myseat-photo-remove]');
  const dropPending = () => {
    if (pendingPhoto?.previewUrl) URL.revokeObjectURL(pendingPhoto.previewUrl);
    pendingPhoto = null;
  };

  form.querySelector('[data-myseat-photo-file]')?.addEventListener('change', async (ev) => {
    const picked = ev.target.files?.[0];
    ev.target.value = '';               // re-picking the same file must re-fire
    if (!picked) return;
    let file;
    try {
      file = await cropImage(picked, {
        title: 'ปรับกรอบรูปของฉัน',
        hint: 'กรอบนี้คือสิ่งที่แสดงบนหน้าโครงสร้างองค์กร — ลากให้ใบหน้าอยู่กลางกรอบ',
      });
    } catch (err) {
      if (note) note.textContent = `เปิดรูปไม่สำเร็จ: ${err?.message || err}`;
      return;
    }
    if (!file) return;
    dropPending();
    removePhoto = false;
    pendingPhoto = { file, previewUrl: URL.createObjectURL(file) };
    if (frame) frame.innerHTML = `<img class="myseat-photo" src="${escHtml(pendingPhoto.previewUrl)}" alt="" />`;
    if (removeBtn) removeBtn.classList.remove('is-hidden');
    if (note) note.textContent = 'รูปใหม่ยังไม่ถูกบันทึก — กดบันทึกเพื่ออัปโหลด';
  });

  removeBtn?.addEventListener('click', () => {
    dropPending();
    removePhoto = true;
    if (frame) frame.innerHTML = portraitHtml({ full_name: me.full_name }, 96);
    removeBtn.classList.add('is-hidden');
    if (note) note.textContent = 'จะนำรูปออกเมื่อกดบันทึก';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const memberId = me.member_id;
    if (!memberId) return;

    // Canonicalise through the shared rules, and refuse a รหัสนักศึกษา that was
    // CHANGED into something unreadable. Unchanged legacy values pass: a person
    // whose stored รหัส is already malformed must still be able to fix their
    // ชื่อเล่น (and the ตรวจสอบข้อมูล list right below the form is what tells them
    // the รหัส itself needs attention).
    const raw = {};
    for (const f of DETAIL_FIELDS.filter((x) => x.editable)) {
      const el = form.querySelector(`[name="${f.key}"]`);
      if (el) raw[f.key] = el.value.trim();
    }
    const fields = normalizeIdentityFields(raw, (majorOptions || []).map((m) => m.code));
    const sidProblem = fields.problemFor('student_id');
    if (sidProblem && String(me.student_id ?? '') !== String(raw.student_id ?? '')) {
      if (status) status.textContent = sidProblem.message;
      form.querySelector('[name="student_id"]')?.focus();
      return;
    }

    const body = {
      full_name: raw.full_name || null,
      nickname: raw.nickname || null,
      student_id: fields.student_id,
      year: fields.year,
      major: fields.major,
    };
    // ชื่อ-สกุล is NOT NULL on the table; an empty box would 23502 with a message
    // nobody can read, so say it in Thai instead.
    if (!body.full_name) {
      if (status) status.textContent = 'กรุณากรอกชื่อ-สกุล';
      form.querySelector('[name="full_name"]')?.focus();
      return;
    }

    const btn = form.querySelector('.myseat-save');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก…'; }
    if (status) status.textContent = '';
    try {
      if (pendingPhoto) {
        if (btn) btn.textContent = 'กำลังอัปโหลดรูป…';
        // Filed under Team/<ปีการศึกษา>/<ฝ่าย>/ exactly as the admin upload is —
        // term_year comes from the payload (0113) and the ฝ่าย is the ROOT of this
        // person's path, so one human's portraits stay in one folder whichever
        // surface uploaded them.
        const res = await uploadTeamPhoto(pendingPhoto.file, {
          year: seat.term_year || 'unsorted',
          dept: (Array.isArray(me.path) && me.path[0]) || me.node || 'ทั่วไป',
          order: 0,
          name: body.full_name,
        });
        body.photo_url = res.url;
        // The framed file IS 3:4, so the stored crop anchor must go back to
        // centre — leaving a legacy 'top' would re-crop the new photo.
        body.photo_focus = 'center';
      } else if (removePhoto) {
        body.photo_url = null;
      }
      // A person with TWO postings has two rows to keep in step — writing only
      // the first would CREATE the `drift` finding this card exists to clear.
      // This is also what makes the admin ทีม SAMO pane show what the person
      // typed: every row carrying their kkumail is the same edit.
      const ids = (seat.postings || []).map((p) => p.member_id).filter(Boolean);
      const { data, error } = await dbRest(
        `/team_members?id=in.(${ids.join(',')})`,
        { method: 'PATCH', body, prefer: 'return=representation' },
      );
      // dbRest returns { data: [] } on an RLS-blocked write rather than an
      // error — the silent-success trap. A zero-length result IS the failure.
      if (error) throw new Error(error.message || `HTTP ${error.status}`);
      if (!Array.isArray(data) || !data.length) throw new Error('ไม่มีสิทธิ์แก้ไขข้อมูลนี้');

      // …and the SAME edit into ระบบบ้าน, for a person who is in both (0132).
      // This is the second half of "one account": the seat card is where the
      // identity is edited, so its save has to reach the other placement or the
      // two say different things about one human until an admin notices.
      //
      // Best-effort and deliberately AFTER the write above: a student who has
      // no ระบบบ้าน record — every shared department account — gets a no-op, and
      // a failure here must not report the ทีม SAMO save (which landed) as
      // failed. `update_my_identity` resolves the caller from auth.uid() and is
      // a no-op when there is no students row.
      try {
        const [first, ...rest] = String(body.full_name || '').trim().split(/\s+/);
        await dbRest('/rpc/update_my_identity', {
          method: 'POST',
          body: {
            p_patch: {
              // Only what ระบบบ้าน also holds. `full_name` is split here ONLY
              // because ทีม SAMO stores one column and the RPC needs two; the
              // server prefers the students row's own split when it has one, so
              // this guess never overwrites a real ชื่อ/นามสกุล pair.
              nickname_self: body.nickname ?? '',
              student_id: body.student_id ?? '',
              major: body.major ?? '',
              ...(rest.length ? { first_name_th: first, last_name_th: rest.join(' ') } : {}),
            },
          },
        });
      } catch (syncErr) {
        console.warn('my-seat: ระบบบ้าน sync skipped:', syncErr);
      }
      dropPending();
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
