// my-seat.js — "ตำแหน่งของฉันในทีม SAMO".
//
// THE PROBLEM. A ทีม SAMO grant is invisible to the person holding it. Someone
// whose kkumail sits in the org tree signs in and the app quietly changes shape
// — a section appears in /admin/, a form starts saving — with nothing naming
// their ตำแหน่ง or listing what they may now do. Until now the only way to
// answer "what am I, and what can I do?" was to ask a developer with SQL access.
//
// One source: public.get_my_team_seat() (migration 0109). It takes no argument —
// identity comes from auth.uid() — so this module cannot be pointed at anyone
// else, and there is nothing here that could turn into a roster lookup.
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
// Read-only. Nothing here writes; the grant itself is issued in ทีม SAMO by an
// admin and synced at login by sync_my_team_permissions().
import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import {
  PERM_LABEL, VS_DEPT_LABEL, PROJECT_SEAT_LABEL, ADMIN_FEATURES,
} from './team-vocab.js';

// Cached per signed-in user. Keyed by uid so an account switch cannot show the
// previous person's ตำแหน่ง — the account switcher swaps the session in place
// (see the module-scope-cache entry in mistakes.md), and a plain boolean
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

/** Where — if anywhere — this person's grants actually let them go.
 *  `passport` does NOT open /admin/ (admin-main.js canUseAdmin gates on
 *  ADMIN_FEATURES, which excludes it), so linking a passport-only member there
 *  would hand them a door that bounces them. SAMO Passport is its own app. */
function ctaFor(perms) {
  if (ADMIN_FEATURES.some((f) => perms.includes(f))) {
    return { href: '/admin/', label: 'เปิดหน้าจัดการ' };
  }
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

/**
 * Paint the card into `host`.
 * @param {HTMLElement|null} host
 * @param {object|null} seat  payload from loadMySeat(), or null
 * @param {{ compact?: boolean }} [opts] compact drops the intro line (the
 *        profile modal already has a section heading above it).
 */
export function renderMySeat(host, seat, opts = {}) {
  if (!host) return;
  if (!seat) { host.hidden = true; host.innerHTML = ''; return; }

  const perms = seat.permissions || [];
  const rows = scopeRows(seat);
  const cta = ctaFor(perms);
  const who = [seat.name, seat.nickname ? `(${seat.nickname})` : ''].filter(Boolean).join(' ');

  host.hidden = false;
  host.innerHTML = `
    <div class="myseat-card">
      <div class="myseat-head">
        <span class="myseat-eyebrow"><i class="bi bi-diagram-3-fill" aria-hidden="true"></i> ตำแหน่งของฉันในทีม SAMO</span>
        ${!opts.compact && who ? `<span class="myseat-who">${escHtml(who)}</span>` : ''}
      </div>

      <ul class="myseat-postings">${(seat.postings || []).map(postingHtml).join('')}</ul>

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

      ${cta ? `
        <a class="myseat-cta" href="${cta.href}">
          ${escHtml(cta.label)} <i class="bi bi-arrow-right" aria-hidden="true"></i>
        </a>` : ''}
    </div>`;
}

/** Convenience for the two call sites: fetch (cached) then paint. */
export async function showMySeat(host, uid, opts) {
  if (!host) return;
  if (!uid) { renderMySeat(host, null); return; }
  renderMySeat(host, await loadMySeat(uid), opts);
}
