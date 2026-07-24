// ==============================================
// VS STAFF — Staff Dashboard for Vital Sound (Supabase-backed)
// ==============================================

import { formatThaiDate, renderTimeline, escHtml, stripHtmlToText } from './utils.js';
import { db, dbRest } from './db.js';
import { sendNotify } from './notify.js';
import { getUser as authGetUser } from './auth.js';
import { MANUAL_VS_RESOLUTIONS, vsResolution } from './vs-resolution.js';

const DONE_STATUS = 'เสร็จสิ้น';

let staffTicketsCache = [];        // ALL tickets visible to this user (RLS-filtered)
let currentActiveTicketId = null;
let currentStaffRole = null;
// True once the dashboard has been entered at least once this session.
// The home-dept default (e.g. president → นายกสโม) applies only on the
// FIRST entry; after that the user's picker selection is authoritative.
let staffDashboardEntered = false;
// Kanban-only now. List view was dropped — the cross-dept board with
// the dept dropdown filter is the canonical surface for everyone.

// --------------------------------------------------
// Dept identity — colour + short label per อุปนายก.
// Maps target_dept value → { color, short } for the UI badges.
// --------------------------------------------------

const DEPT_META = {
  'SE':                                            { color: '#6B7280', short: 'SE' },
  'นายกสโม':                                        { color: '#C8A951', short: 'นายกสโม' },
  'อุปนายกฝ่ายบริหารองค์กร':                       { color: '#A17A60', short: 'บริหาร' },
  'อุปนายกฝ่ายดิจิทัลและสื่อสารองค์กร':            { color: '#F2CB67', short: 'ดิจิทัล' },
  'อุปนายกฝ่ายกิจการภายใน':                       { color: '#E68FAA', short: 'ภายใน' },
  'อุปนายกฝ่ายกิจการภายนอก':                      { color: '#7DB0CD', short: 'ภายนอก' },
  'อุปนายกฝ่ายกิจการมหาวิทยาลัย':                 { color: '#F49D5F', short: 'มหา​วิทยาลัย' },
  'อุปนายกฝ่ายวิชาการ':                            { color: '#2F5F9C', short: 'วิชาการ' },
  'อุปนายกฝ่ายยุทธศาสตร์และพัฒนาองค์กร':           { color: '#318D65', short: 'ยุทธ​ศาสตร์' },
  'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม':          { color: '#8DC96C', short: 'คุณภาพ' },
  'อุปนายกฝ่ายเวชนิทัศน์':                         { color: '#2294BC', short: 'เวช​นิทัศน์' },
  'อุปนายกฝ่ายรังสีเทคนิค':                        { color: '#9F84BD', short: 'รังสี' },
  'คณะ':                                          { color: '#475569', short: 'คณะ' },
};

function deptColor(name) { return DEPT_META[name]?.color || '#94a3b8'; }
function deptShort(name) { return DEPT_META[name]?.short || name; }

// One kanban column per status — mirrors the dropdown in modal-vs-staff.html
// so the board reflects exactly the workflow states a staffer can pick.
// Order left → right is the natural progression: incoming → SE → VP →
// in-flight → terminal. Donw stays on the right so finished work doesn't
// crowd active work. Most accounts won't have items in every column;
// the "ซ่อนคอลัมน์ว่าง" toggle (default ON) hides empties.
const KANBAN_COLUMNS = [
  { key: 'waiting_se',     label: 'รอ SE รับเรื่อง',             statuses: ['รอ SE รับเรื่อง'] },
  { key: 'se_acked',       label: 'SE รับเรื่องแล้ว',            statuses: ['SE รับเรื่องแล้ว'] },
  { key: 'urgent_vp',      label: 'รออุปนายก (ด่วน)',            statuses: ['กำลังรออุปนายกพิจารณา (ด่วน)'] },
  { key: 'waiting_vp',     label: 'รออุปนายกพิจารณา',            statuses: ['กำลังรออุปนายกพิจารณา'] },
  { key: 'vp_acked',       label: 'อุปนายกรับเรื่องแล้ว',         statuses: ['อุปนายกรับเรื่องแล้ว'] },
  // 0077 split: SAMO-working vs faculty-working. Legacy 'กำลังดำเนินการ'
  // stays mapped to the SAMO column so a stale client's write still shows.
  { key: 'samo_progress',  label: 'สโมกำลังดำเนินการ',             statuses: ['สโมกำลังดำเนินการ', 'กำลังดำเนินการ'] },
  { key: 'faculty_progress', label: 'คณะกำลังดำเนินการ',           statuses: ['คณะกำลังดำเนินการ'] },
  { key: 'faculty_liaison',label: 'กำลังติดต่อคณะ',                statuses: ['กำลังติดต่อคณะ'] },
  { key: 'rejected',       label: 'ปฏิเสธ (ส่งคืน SE)',           statuses: ['ปฏิเสธ (ส่งคืน SE)'] },
  { key: 'done',           label: 'เสร็จสิ้น',                     statuses: ['เสร็จสิ้น'] },
];

// Persisted user preference: hide columns that have 0 tickets.
// Default ON because 9 columns of mostly empty is noisy for any
// account that only touches part of the workflow.
const HIDE_EMPTY_KEY = 'vsKanbanHideEmpty';
function getHideEmpty() {
  const v = localStorage.getItem(HIDE_EMPTY_KEY);
  return v === null ? true : v === '1';
}
function setHideEmpty(on) {
  localStorage.setItem(HIDE_EMPTY_KEY, on ? '1' : '0');
}

// --------------------------------------------------
// Age helpers — ticket "age" = ms since timestamp (created_at fallback).
// Thresholds: <24h fresh, 1-3d warming, >3d overdue.
// --------------------------------------------------

const ONE_DAY_MS = 86_400_000;

function ageMs(ticket) {
  const t = ticket.timestamp || ticket.created_at;
  if (!t) return 0;
  return Date.now() - new Date(t).getTime();
}

function ageBucket(ticket) {
  const ms = ageMs(ticket);
  if (ms < ONE_DAY_MS)       return 'fresh';      // green
  if (ms < 3 * ONE_DAY_MS)   return 'warming';    // yellow
  return 'overdue';                                // red
}

function ageLabel(ticket) {
  const ms = ageMs(ticket);
  const days = Math.floor(ms / ONE_DAY_MS);
  if (days >= 1) return `${days}d`;
  const hrs = Math.floor(ms / (60 * 60 * 1000));
  if (hrs >= 1)  return `${hrs}h`;
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return `${mins}m`;
}

function isOverdue(ticket) {
  // Overdue only counts for "still-waiting" statuses — not completed/done.
  if ((ticket.status || '').includes('เสร็จสิ้น')) return false;
  return ageBucket(ticket) === 'overdue';
}

// --------------------------------------------------
// Staff Entry — gated by global auth (Admin tab)
//
// For a VP (role=vp_admin): force the dept filter to THEIR users.department
// and hide the picker entirely — they're only authorized to see their own
// dept's tickets, and the picker would just confuse them. RLS (migration
// 0010) already enforces this at the DB level; this just stops the UI
// from offering a choice that returns nothing.
//
// For vs_staff / dev (super): keep the picker so they can browse any dept.
// --------------------------------------------------

const ALL_DEPTS = '__all__';

export async function enterVSStaffDashboard() {
  const select = document.getElementById('staffRole');
  const user = authGetUser();
  const isVP = user?.role === 'vp_admin';

  if (isVP && user.department) {
    // Lock the dept filter to the VP's own dept (RLS allows them
    // nothing else anyway). Picker stays hidden.
    currentStaffRole = user.department;
    if (select) {
      if (![...select.options].some((o) => o.value === currentStaffRole)) {
        const opt = document.createElement('option');
        opt.value = currentStaffRole;
        opt.textContent = currentStaffRole;
        select.appendChild(opt);
      }
      select.value = currentStaffRole;
      select.classList.add('d-none');
    }
  } else {
    // SE / dev — keep the picker (they can browse any dept). On first
    // entry, ignore the select's default "__all__" so a home-dept default
    // can win: a super user with a department (e.g. the president account,
    // department='นายกสโม') lands on that dept first but can still switch to
    // ทุกฝ่าย / any dept; everyone else falls through to "all" (the cross-
    // dept triage board). After the first entry, respect the user's pick.
    const selected = staffDashboardEntered && select && select.value ? select.value : null;
    currentStaffRole = selected || user?.department || ALL_DEPTS;
    if (select) {
      // Ensure the home-dept value exists as an option before selecting it.
      if (currentStaffRole !== ALL_DEPTS
          && ![...select.options].some((o) => o.value === currentStaffRole)) {
        const opt = document.createElement('option');
        opt.value = currentStaffRole;
        opt.textContent = currentStaffRole;
        select.appendChild(opt);
      }
      select.value = currentStaffRole;
      select.classList.remove('d-none');
    }
  }

  const titleEl = document.getElementById('staffTitle');
  if (titleEl) {
    titleEl.innerText = `Dashboard: ${currentStaffRole === ALL_DEPTS ? 'ทุกฝ่าย' : currentStaffRole}`;
  }
  // Wire the scroll-affordance listener now that admin DOM is alive.
  bindKanbanScrollAffordance();
  staffDashboardEntered = true;
  await fetchStaffTickets();
}

// --------------------------------------------------
// Fetch Staff Tickets (Supabase)
// SE sees non-emergency tickets routed to "SE"; everyone else sees
// tickets currently assigned to their dept (target_dept = role).
// --------------------------------------------------

export async function fetchStaffTickets() {
  const loading = document.getElementById('staffLoading');
  loading?.classList.remove('d-none');

  try {
    // dbRest (raw PostgREST) instead of db.from(...). The supabase-js
    // client serialises requests behind a session lock that the
    // periodic auth refresh in db.js + the JWT-auto-refresh path in
    // dbRest both contend for; under heavy auth churn a `db.from`
    // read can stall the dashboard for several seconds (or hang
    // entirely per mistakes.md "supabase-js gets into a bad state").
    // dbRest skips supabase-js, has an AbortController timeout, and
    // single-flight refreshes the JWT on 401 — same pattern just
    // applied to pr-staff in dcfd381.
    //
    // ALWAYS fetch all visible tickets — RLS handles the boundary
    // (VPs see only their dept; vs_staff/dev see all). The list view
    // filters client-side by currentStaffRole; the kanban view shows
    // them all grouped by status.
    const { data, error } = await dbRest(
      '/vs_tickets?select=*&deleted_at=is.null&order=timestamp.desc',
    );
    if (error) throw new Error(error.message || 'โหลดไม่สำเร็จ');
    staffTicketsCache = data || [];
  } catch (e) {
    console.error('[vs-staff] fetch failed', e);
    staffTicketsCache = [];
  } finally {
    loading?.classList.add('d-none');
  }

  renderKanban();
}

/** Public — toggle the "hide empty columns" preference. */
export function setVsKanbanHideEmpty(on) {
  setHideEmpty(!!on);
  renderKanban();
}

// Expanded state of the per-canonical "ซ้ำ N เรื่อง" strips. Session-scoped
// (module Set) so a re-render — refresh, filter change, modal save — keeps
// whatever the staffer had open.
const expandedKanbanDups = new Set();

/** Public — expand/collapse a canonical card's nested duplicates. */
export function toggleKanbanDups(id) {
  if (expandedKanbanDups.has(id)) expandedKanbanDups.delete(id);
  else expandedKanbanDups.add(id);
  renderKanban();
}

// --------------------------------------------------
// Renderers
// --------------------------------------------------

/** Actor label for timeline remarks + notifications. NEVER the internal
 *  "__all__" filter value (it used to leak into timelines as the author).
 *  Prefer the concrete dept filter, else the signed-in user's dept, else
 *  their display name/username, else a generic label. */
function staffActorLabel() {
  if (currentStaffRole && currentStaffRole !== ALL_DEPTS) return currentStaffRole;
  const u = authGetUser();
  return u?.department || u?.name || (u?.username ? `@${u.username}` : '') || 'เจ้าหน้าที่';
}

/** Tickets visible in the current view, respecting the dropdown filter
 *  AND the free-text search (id / problem / status / dept — same pattern
 *  as the PR dashboard's prStaffSearch). Single source of truth for the
 *  kanban renderer. */
function filteredTickets() {
  let list = currentStaffRole === ALL_DEPTS
    ? staffTicketsCache
    : staffTicketsCache.filter((t) => t.target_dept === currentStaffRole);
  const q = (document.getElementById('vsStaffSearch')?.value || '').trim().toLowerCase();
  if (q) {
    list = list.filter((t) =>
      (t.id || '').toLowerCase().includes(q)
      || stripHtmlToText(t.problem).toLowerCase().includes(q)
      || (t.status || '').toLowerCase().includes(q)
      || (t.target_dept || '').toLowerCase().includes(q));
  }
  return list;
}

// Debounced re-render for the search box (wired via oninput in tab-admin.html).
let vsSearchTimer = null;
export function onVsStaffSearch() {
  clearTimeout(vsSearchTimer);
  vsSearchTimer = setTimeout(renderKanban, 200);
}

// --------------------------------------------------
// Age chip + Kanban render
// --------------------------------------------------

function renderAgeChip(ticket) {
  const bucket = ageBucket(ticket);
  const label  = ageLabel(ticket);
  return `<span class="vs-age-chip is-${bucket}" title="เข้ามาเมื่อ ${label} ที่แล้ว"><i class="bi bi-inbox"></i> ${label}</span>`;
}

/** Human "time ago" for an arbitrary timestamp (same buckets as ageLabel). */
function agoLabel(ts) {
  if (!ts) return null;
  const ms = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / ONE_DAY_MS);
  if (days >= 1) return `${days}d`;
  const hrs = Math.floor(ms / (60 * 60 * 1000));
  if (hrs >= 1) return `${hrs}h`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m`;
}

/** Second chip: time since the last update (0077 updated_at). Neutral colour —
 *  the age chip keeps the urgency bucket; this one answers "ขยับล่าสุดเมื่อไหร่". */
function renderUpdatedChip(ticket) {
  const label = agoLabel(ticket.updated_at);
  if (!label) return '';
  return `<span class="vs-age-chip is-updated" title="อัปเดตล่าสุด ${label} ที่แล้ว"><i class="bi bi-arrow-repeat"></i> ${label}</span>`;
}

function renderKanban() {
  const wrap = document.getElementById('staffTicketKanban');
  if (!wrap) return;
  // Reflect the hide-empty checkbox state every render.
  const cb = document.getElementById('vsKanbanHideEmpty');
  if (cb) cb.checked = getHideEmpty();

  // Columns by status. Newest-first across every column — same as the
  // PR kanban. (Was oldest-first for open columns; the "stale at the
  // top" pattern made sense for a triage queue but felt wrong vs PR
  // which staff move between constantly. Age-bucket colour on the
  // card still flags overdue tickets for triage.)
  const base = filteredTickets();
  const hideEmpty = getHideEmpty();

  // Empty state — when the user's filter has zero tickets, render a
  // single full-width placeholder so the surface doesn't look broken.
  if (base.length === 0) {
    wrap.innerHTML = `
      <div class="vs-kanban-empty-state">
        <i class="bi bi-inbox"></i>
        <p>ไม่มี ticket ในมุมมองนี้</p>
        <p class="small">ลองเปลี่ยนตัวกรองฝ่าย หรือกดรีเฟรชด้านบน</p>
      </div>
    `;
    syncKanbanScrollAffordance();
    return;
  }
  // Nest duplicates under their canonical card (expand/collapse strip)
  // instead of rendering them as free-floating cards — since 0074 mirrors a
  // duplicate's status, dup + canonical land in the SAME column and double
  // the noise. A duplicate whose canonical is NOT in the current filtered
  // set (e.g. dept filter) still renders top-level so it never vanishes.
  const visibleIds = new Set(base.map((t) => t.id));
  const nestedDups = new Map(); // canonical id -> [duplicate tickets]
  const topLevel = [];
  for (const t of base) {
    if (t.duplicate_of && visibleIds.has(t.duplicate_of)) {
      if (!nestedDups.has(t.duplicate_of)) nestedDups.set(t.duplicate_of, []);
      nestedDups.get(t.duplicate_of).push(t);
    } else {
      topLevel.push(t);
    }
  }

  // Collect every status string the 9 canonical columns claim, so we
  // can build a catch-all "อื่นๆ" column for tickets with legacy /
  // non-canonical status strings (Sheets-migrated rows in particular).
  // Without this, those tickets are in the cache but absent from
  // every column — silently invisible.
  const knownStatuses = new Set(KANBAN_COLUMNS.flatMap((c) => c.statuses));
  const columnsWithFallback = [
    ...KANBAN_COLUMNS,
    { key: 'other', label: 'อื่นๆ', statuses: null }, // null = catch-all
  ];
  const html = columnsWithFallback.map((col) => {
    const items = col.statuses === null
      ? topLevel.filter((t) => !knownStatuses.has(t.status))
      : topLevel.filter((t) => col.statuses.includes(t.status));
    if (hideEmpty && items.length === 0) return '';
    items.sort((a, b) => ageMs(a) - ageMs(b));   // newest first, every column

    const overdueCount = items.filter(isOverdue).length;
    const headerBadge = overdueCount > 0
      ? `<span class="vs-kanban-overdue" title="ค้างเกิน 3 วัน">${overdueCount}</span>`
      : '';
    const cardsHtml = items.length === 0
      ? '<div class="vs-kanban-empty">ไม่มี</div>'
      : items.map((t) => {
          const cacheIdx = staffTicketsCache.indexOf(t);
          const strippedProblem = stripHtmlToText(t.problem, 90);
          const deptC = deptColor(t.target_dept);
          // Top-level dup = its canonical is outside the current filter; keep
          // the "ซ้ำ" badge so the state stays visible.
          const isDup = !!t.duplicate_of;
          const dupTag = isDup
            ? `<span class="vs-kanban-card-dup" title="เรื่องซ้ำของ ${escHtml(t.duplicate_of)}"><i class="bi bi-diagram-2"></i> ซ้ำ</span>`
            : '';

          // Nested duplicates: collapsed strip on the canonical card;
          // expanding reveals tappable mini-rows (stopPropagation so the
          // strip/rows never trigger the canonical's own onclick).
          const dups = nestedDups.get(t.id) || [];
          const isOpen = expandedKanbanDups.has(t.id);
          let dupBlock = '';
          if (dups.length > 0) {
            const rows = !isOpen ? '' : `<div class="vs-kanban-dup-rows">${dups.map((d) => {
              const dIdx = staffTicketsCache.indexOf(d);
              const dSnippet = stripHtmlToText(d.problem, 60);
              return `<div class="vs-kanban-dup-row" role="button" tabindex="0"
                  onclick="event.stopPropagation();openStaffModalByIndex(${dIdx})"
                  onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();openStaffModalByIndex(${dIdx});}">
                  <span class="vs-kanban-dup-row-id">${escHtml(d.id)}</span>
                  <span class="vs-kanban-dup-row-text">${escHtml(dSnippet)}</span>
                </div>`;
            }).join('')}</div>`;
            dupBlock = `
              <div class="vs-kanban-dup-strip${isOpen ? ' is-open' : ''}" role="button" tabindex="0"
                aria-expanded="${isOpen}"
                onclick="event.stopPropagation();toggleKanbanDups('${escHtml(t.id)}')"
                onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();toggleKanbanDups('${escHtml(t.id)}');}">
                <i class="bi bi-diagram-2"></i> ซ้ำ ${dups.length} เรื่อง
                <i class="bi bi-chevron-${isOpen ? 'up' : 'down'} ms-auto"></i>
              </div>${rows}`;
          }

          return `
            <div class="vs-kanban-card is-${ageBucket(t)}${isDup ? ' is-duplicate' : ''}"
              style="--card-accent: ${deptC};"
              onclick="openStaffModalByIndex(${cacheIdx})">
              <div class="vs-kanban-card-head">
                <span class="vs-kanban-card-id">${escHtml(t.id)}</span>
                <span class="vs-kanban-card-chips">${renderAgeChip(t)}${renderUpdatedChip(t)}</span>
              </div>
              <div class="vs-kanban-card-body">${escHtml(strippedProblem)}</div>
              <div class="vs-kanban-card-foot">
                <span class="vs-kanban-card-dept" style="background:${deptC};">${escHtml(deptShort(t.target_dept))}</span>
                ${t.is_emergency ? '<span class="vs-kanban-card-urgent" title="ฉุกเฉิน">ด่วน</span>' : ''}
                ${dupTag}
              </div>
              ${dupBlock}
            </div>
          `;
        }).join('');
    return `
      <section class="vs-kanban-col ${col.key === 'other' ? 'is-other' : ''}">
        <header class="vs-kanban-col-head">
          <span class="vs-kanban-col-title">${escHtml(col.label)}</span>
          <span class="vs-kanban-col-count">${items.length}</span>
          ${headerBadge}
        </header>
        <div class="vs-kanban-col-body">${cardsHtml}</div>
      </section>
    `;
  }).join('');
  wrap.innerHTML = html;

  // After every render, recompute scroll affordances (left/right fade
  // gradients). Listener attached once; here we just refresh state in
  // case columns just changed.
  syncKanbanScrollAffordance();
}

// --------------------------------------------------
// Scroll affordances — edge fade gradients on the kanban container.
// Pattern from Linear / Apple App Store / Notion gallery: subtle
// gradient on each side that fades as you reach that end. Combined
// with the natural column-peek (next column ~partially visible),
// users feel "more content" without being told. Mobile-friendly.
// --------------------------------------------------

function syncKanbanScrollAffordance() {
  const wrap   = document.getElementById('vsKanbanWrap');
  const kanban = document.getElementById('staffTicketKanban');
  if (!wrap || !kanban) return;
  const max = kanban.scrollWidth - kanban.clientWidth;
  // No overflow at all → hide both fades.
  if (max <= 4) {
    wrap.classList.remove('is-scrolled');
    wrap.classList.add('is-end');
    return;
  }
  wrap.classList.toggle('is-scrolled', kanban.scrollLeft > 8);
  wrap.classList.toggle('is-end', max - kanban.scrollLeft < 8);
}

// Attach the scroll listener once. Lives at module load (the elements
// might not exist yet on first import, so we re-bind on first render
// guarded by a flag).
let scrollAffordanceBound = false;
function bindKanbanScrollAffordance() {
  if (scrollAffordanceBound) return;
  const kanban = document.getElementById('staffTicketKanban');
  if (!kanban) return;
  kanban.addEventListener('scroll', syncKanbanScrollAffordance, { passive: true });
  window.addEventListener('resize', syncKanbanScrollAffordance);
  scrollAffordanceBound = true;
}
// Bind on next microtask so the DOM has the element by the time we run.
queueMicrotask(bindKanbanScrollAffordance);

// --------------------------------------------------
// Open Staff Modal
// --------------------------------------------------

export function openStaffModalByIndex(idx) {
  const t = staffTicketsCache[idx];
  if (!t) return;
  openStaffModal(t.id, t.status, t.target_dept, t.problem, t.timestamp || t.created_at, t.remarks || []);
}

function openStaffModal(id, status, dept, problemHTML, date, remarks) {
  currentActiveTicketId = id;
  document.getElementById('staffModalTitle').innerText = id;
  document.getElementById('staffModalCurrentStatus').innerText = `สถานะปัจจุบัน: ${status}`;
  const formattedDate = formatThaiDate(date);
  // Both times (0077): submitted date + how long since the last update.
  const tRow = staffTicketsCache.find((x) => x.id === id);
  const updAgo = agoLabel(tRow?.updated_at);
  document.getElementById('staffModalDate').innerText =
    `วันที่แจ้ง: ${formattedDate} | ฝ่ายที่รับผิดชอบ: ${dept}`
    + (updAgo ? ` | อัปเดตล่าสุด: ${updAgo} ที่แล้ว` : '');
  document.getElementById('staffModalProblem').innerHTML = problemHTML;
  renderTimeline('staffModalTimeline', remarks, formattedDate);

  document.getElementById('staffActionStatus').value = status;
  document.getElementById('staffActionTransfer').value = dept;
  document.getElementById('staffActionRemark').value = '';
  document.getElementById('staffNotifyTo').value = '';
  document.getElementById('staffSilentNotify').checked = false;
  setupResolutionUI(status);
  bootstrap.Tab.getOrCreateInstance(document.getElementById('staff-detail-tab')).show();
  renderDupBanner();
  renderDupTree();
  renderPublishPanel();
  wirePublishPanelOnce();
  resetSimilarPane();
  resetMergeSearch();
  wireSimilarTabOnce();
  wireMergeSearchOnce();
  // getOrCreateInstance, NOT `new bootstrap.Modal(...)`: the dup tree /
  // kanban dup-rows re-open this modal while it is ALREADY shown (jumping
  // between linked tickets). A fresh Modal instance on an open element
  // stacks a second backdrop that never gets removed — the page stays
  // dimmed after close. getOrCreateInstance reuses the live instance, whose
  // .show() no-ops when open; the content above has already re-rendered.
  bootstrap.Modal.getOrCreateInstance(document.getElementById('staffManageModal')).show();
}

// ----- Resolution reason on close (migration 0073) -----

let resolutionOptionsFilled = false;
let resolutionWired = false;

/** Prefill + reveal the resolution picker for the currently-open ticket.
 *  Options come from the shared VS_RESOLUTIONS vocab (single source of truth).
 *  The box is only visible when the (chosen) status is เสร็จสิ้น. */
function setupResolutionUI(status) {
  const sel = document.getElementById('staffResolution');
  const note = document.getElementById('staffResolutionNote');
  if (sel && !resolutionOptionsFilled) {
    // Only MANUAL reasons (duplicate is handled by the merge action, not here).
    sel.insertAdjacentHTML('beforeend', MANUAL_VS_RESOLUTIONS
      .map((r) => `<option value="${escHtml(r.key)}">${escHtml(r.staff)}</option>`)
      .join(''));
    resolutionOptionsFilled = true;
  }
  const t = staffTicketsCache.find((x) => x.id === currentActiveTicketId);
  if (sel) sel.value = t?.resolution || '';
  if (note) note.value = t?.resolution_note || '';

  // Toggle visibility on any status change; wire once.
  if (!resolutionWired) {
    resolutionWired = true;
    document.getElementById('staffActionStatus')
      ?.addEventListener('change', syncResolutionVisibility);
    sel?.addEventListener('change', syncResolutionNoteHint);
  }
  syncResolutionVisibility();
}

function syncResolutionVisibility() {
  const box = document.getElementById('staffResolutionBox');
  const statusVal = document.getElementById('staffActionStatus')?.value;
  if (box) box.classList.toggle('d-none', statusVal !== DONE_STATUS);
  syncResolutionNoteHint();
}

/** Show the "note required" hint only for the wont_do reason. */
function syncResolutionNoteHint() {
  const meta = vsResolution(document.getElementById('staffResolution')?.value);
  const hint = document.getElementById('staffResolutionNoteHint');
  const note = document.getElementById('staffResolutionNote');
  const required = !!meta?.noteRequired;
  hint?.classList.toggle('d-none', !required);
  if (note) note.placeholder = required
    ? 'ระบุเหตุผลที่ไม่สามารถดำเนินการได้ (นักศึกษาจะเห็นข้อความนี้)'
    : 'รายละเอียดผลการดำเนินการ (นักศึกษาจะเห็นข้อความนี้)';
}

// ----- Duplicate management (Phase 1, migration 0068) -----

let similarTabWired = false;

/** Count of tickets merged into `id` (from the loaded cache). */
function dupCountFor(id) {
  return staffTicketsCache.filter((t) => t.duplicate_of === id && !t.deleted_at).length;
}

/** Detail-tab banner: is this ticket a duplicate, or a canonical with duplicates? */
function renderDupBanner() {
  const el = document.getElementById('staffDupBanner');
  if (!el) return;
  const t = staffTicketsCache.find((x) => x.id === currentActiveTicketId);
  if (!t) { el.classList.add('d-none'); el.innerHTML = ''; return; }

  if (t.duplicate_of) {
    el.className = 'alert alert-warning d-flex align-items-center gap-2 py-2 px-3 mb-3';
    el.innerHTML =
      `<i class="bi bi-diagram-2"></i><span class="small flex-grow-1">เรื่องนี้ถูกรวมเป็น<strong>เรื่องซ้ำ</strong>ของ `
      + `<strong>${escHtml(t.duplicate_of)}</strong> — จะปิดอัตโนมัติเมื่อเรื่องหลักเสร็จสิ้น</span>`
      + `<button type="button" class="btn btn-sm btn-outline-warning" data-vs-unmerge>แยกออก</button>`;
    el.querySelector('[data-vs-unmerge]')?.addEventListener('click', onUnmergeClick);
    return;
  }
  const n = dupCountFor(t.id);
  if (n > 0) {
    el.className = 'alert alert-info d-flex align-items-center gap-2 py-2 px-3 mb-3';
    el.innerHTML = `<i class="bi bi-diagram-2"></i><span class="small">เรื่องหลัก — มี <strong>${n}</strong> เรื่องซ้ำรวมอยู่ (จะปิดพร้อมกันเมื่อเสร็จสิ้น)</span>`;
    el.classList.remove('d-none');
    return;
  }
  el.classList.add('d-none');
  el.innerHTML = '';
}

function resetSimilarPane() {
  const body = document.getElementById('staffSimilarBody');
  if (body) body.innerHTML = '<div class="text-muted small">เปิดแท็บนี้เพื่อค้นหาเรื่องที่คล้ายกัน…</div>';
}

/** Staff-only duplicate-cluster tree: canonical → [duplicates], clickable.
 *  Staff see the real links (0071 keeps cross-refs internal to STAFF; this is
 *  a staff surface). Chains are collapsed by merge, so it's always one level.
 *  Rendered from the loaded cache — no fetch. Hidden when there's no cluster. */
function renderDupTree() {
  const el = document.getElementById('staffDupTree');
  if (!el) return;
  const t = staffTicketsCache.find((x) => x.id === currentActiveTicketId);
  if (!t) { el.classList.add('d-none'); el.innerHTML = ''; return; }

  const canonicalId = t.duplicate_of || t.id;
  const canonical = staffTicketsCache.find((x) => x.id === canonicalId);
  const dups = staffTicketsCache
    .filter((x) => x.duplicate_of === canonicalId && !x.deleted_at)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (dups.length === 0) { el.classList.add('d-none'); el.innerHTML = ''; return; }

  const node = (x, isCanonical) => {
    if (!x) return '';
    const idx = staffTicketsCache.indexOf(x);
    const isCurrent = x.id === currentActiveTicketId;
    const pub = x.is_public
      ? '<span class="vs-duptree-badge is-public" title="เผยแพร่บนกระดานปัญหา"><i class="bi bi-megaphone-fill"></i> สาธารณะ</span>'
      : '';
    return `<div class="vs-duptree-node ${isCanonical ? 'is-canonical' : 'is-dup'} ${isCurrent ? 'is-current' : ''}"
        onclick="openStaffModalByIndex(${idx})"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openStaffModalByIndex(${idx});}"
        role="button" tabindex="0"
        aria-label="เปิด ${escHtml(x.id)}">
        <span class="vs-duptree-role">${isCanonical ? 'เรื่องหลัก' : 'ซ้ำ'}</span>
        <span class="vs-duptree-id">${escHtml(x.id)}</span>
        <span class="vs-duptree-dept" style="background:${deptColor(x.target_dept)}">${escHtml(deptShort(x.target_dept))}</span>
        <span class="vs-duptree-status">${escHtml(x.status || '')}</span>
        ${pub}
        ${isCurrent ? '<span class="vs-duptree-here">เรื่องนี้</span>' : ''}
      </div>`;
  };

  el.classList.remove('d-none');
  el.innerHTML = `
    <div class="vs-duptree">
      <div class="vs-duptree-head"><i class="bi bi-diagram-3 me-1"></i>แผนผังเรื่องซ้ำ (${dups.length + 1} เรื่อง)</div>
      ${node(canonical, true)}
      <div class="vs-duptree-children">
        ${dups.map((d) => node(d, false)).join('')}
      </div>
    </div>`;
}

// ----- Public board publish panel (SE only; migration 0072) -----

let vsCategoriesCache = null;   // active vs_categories, loaded once
let publishPanelWired = false;

function isSEPublisher() {
  const u = authGetUser();
  return !!u && (u.role === 'vs_staff' || u.role === 'dev'
    || (Array.isArray(u.permissions) && u.permissions.includes('vs')));
}

async function loadVsCategories() {
  if (vsCategoriesCache) return vsCategoriesCache;
  const { data } = await dbRest(
    '/vs_categories?select=id,label,is_confidential,public_eligible&is_active=eq.true&order=sort_order.asc');
  vsCategoriesCache = Array.isArray(data) ? data : [];
  return vsCategoriesCache;
}

async function renderPublishPanel() {
  const panel = document.getElementById('staffPublishPanel');
  if (!panel) return;
  // SE-only surface; vp_admin never sees publish controls (matches vs_set_public).
  if (!isSEPublisher()) { panel.classList.add('d-none'); return; }
  const t = staffTicketsCache.find((x) => x.id === currentActiveTicketId);
  if (!t) { panel.classList.add('d-none'); return; }
  panel.classList.remove('d-none');

  const cats = await loadVsCategories();
  const sel = document.getElementById('staffPubCategory');
  if (sel) {
    sel.innerHTML = '<option value="">-- เลือกหมวดหมู่ --</option>'
      + cats.map((c) => {
        const conf = c.is_confidential || !c.public_eligible;
        return `<option value="${escHtml(c.id)}"${conf ? ' disabled' : ''}>`
          + `${escHtml(c.label)}${conf ? ' 🔒 (เผยแพร่ไม่ได้)' : ''}</option>`;
      }).join('');
    sel.value = t.category || '';
  }
  const titleEl = document.getElementById('staffPubTitle');
  const noteEl = document.getElementById('staffPubNote');
  if (titleEl) titleEl.value = t.public_title || '';
  if (noteEl) noteEl.value = t.public_note || '';

  const stateBadge = document.getElementById('staffPubState');
  const saveBtn = document.getElementById('staffPubSaveBtn');
  const unpubBtn = document.getElementById('staffPubUnpublishBtn');
  const isDup = !!t.duplicate_of;

  if (isDup) {
    // A duplicate can't be published (only its canonical can). A fully
    // disabled panel was pure noise on the screenshot review — hide it; the
    // dup banner in section 1 already explains the state.
    panel.classList.add('d-none');
    return;
  }

  // Submitter consent (0076): explicit decline blocks publish (also enforced
  // server-side in vs_set_public); legacy null = SE judgment.
  const consentEl = document.getElementById('staffPubConsent');
  const declined = t.public_consent === false && !t.is_public;
  if (consentEl) {
    if (t.public_consent === true) {
      consentEl.innerHTML = '<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>ผู้แจ้งยินยอมให้เผยแพร่แบบไม่ระบุตัวตน</span>';
    } else if (t.public_consent === false) {
      consentEl.innerHTML = '<span class="text-danger"><i class="bi bi-x-circle-fill me-1"></i>ผู้แจ้งไม่ยินยอมให้เผยแพร่ — เผยแพร่ไม่ได้</span>';
    } else {
      consentEl.innerHTML = '<span class="text-muted"><i class="bi bi-question-circle me-1"></i>เรื่องเก่า — ผู้แจ้งไม่ได้ระบุความยินยอม (ใช้ดุลยพินิจ)</span>';
    }
  }
  if (declined) {
    [sel, titleEl, noteEl, saveBtn].forEach((e) => e && (e.disabled = true));
    unpubBtn?.classList.add('d-none');
    stateBadge.className = 'badge rounded-pill ms-1 bg-secondary';
    stateBadge.textContent = 'ไม่ยินยอม';
    return;
  }
  [sel, titleEl, noteEl, saveBtn].forEach((e) => e && (e.disabled = false));

  if (t.is_public) {
    stateBadge.className = 'badge rounded-pill ms-1 bg-success';
    stateBadge.textContent = 'เผยแพร่อยู่';
    saveBtn.innerHTML = '<i class="bi bi-check2 me-1"></i>อัปเดตหัวข้อ';
    unpubBtn?.classList.remove('d-none');
  } else {
    stateBadge.className = 'badge rounded-pill ms-1 bg-secondary';
    stateBadge.textContent = 'ยังไม่เผยแพร่';
    saveBtn.innerHTML = '<i class="bi bi-megaphone me-1"></i>เผยแพร่';
    unpubBtn?.classList.add('d-none');
  }
}

function wirePublishPanelOnce() {
  if (publishPanelWired) return;
  publishPanelWired = true;
  document.getElementById('staffPubSaveBtn')?.addEventListener('click', () => setTicketPublic(true));
  document.getElementById('staffPubUnpublishBtn')?.addEventListener('click', () => setTicketPublic(false));
}

async function setTicketPublic(makePublic) {
  const id = currentActiveTicketId;
  const t = staffTicketsCache.find((x) => x.id === id);
  if (!t) return;
  const category = document.getElementById('staffPubCategory')?.value || null;
  const title = (document.getElementById('staffPubTitle')?.value || '').trim();
  const note = (document.getElementById('staffPubNote')?.value || '').trim();
  if (makePublic) {
    if (!category) { alert('กรุณาเลือกหมวดหมู่'); return; }
    if (!title) { alert('กรุณาระบุหัวข้อสาธารณะ'); return; }
  }
  const btn = document.getElementById(makePublic ? 'staffPubSaveBtn' : 'staffPubUnpublishBtn');
  if (btn) { btn.disabled = true; }
  const { error } = await dbRest('/rpc/vs_set_public', {
    method: 'POST',
    body: { p_id: id, p_public: makePublic, p_title: title || null, p_note: note || null, p_category: category },
  });
  if (btn) { btn.disabled = false; }
  if (error) {
    const m = (() => { const raw = error?.message || ''; try { return JSON.parse(raw)?.message || raw; } catch { return raw; } })();
    alert(/ความลับ|หัวข้อ|หมวดหมู่|เรื่องหลัก/.test(m) ? m : 'ดำเนินการไม่สำเร็จ');
    return;
  }
  // reflect locally so the panel + kanban stay in sync without a full refetch
  t.is_public = makePublic;
  t.category = category || t.category;
  if (makePublic) { t.public_title = title; t.public_note = note; }
  renderPublishPanel();
}

// ----- Category manager (SE publishers; vs_categories CRUD via RLS 0072) -----

let vsCatManagerRows = [];   // last-loaded full rows (incl. inactive)

function vsCatStatus(msg, isError) {
  const el = document.getElementById('vsCatStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('d-none', !msg);
  el.classList.toggle('text-danger', !!isError);
  el.classList.toggle('text-success', !isError && !!msg);
}

let vsCatModalWired = false;

export async function openVsCategoryManager() {
  if (!isSEPublisher()) return;
  vsCatStatus('');
  const el = document.getElementById('vsCategoryModal');
  if (!el) return;
  if (!vsCatModalWired) {
    vsCatModalWired = true;
    // Stacked-modal plumbing (opened on top of the staff ticket modal):
    // Bootstrap gives every modal/backdrop the same z-index, so the second
    // backdrop lands UNDER the first modal — looks like the manager is
    // tangled with the ticket. Lift this modal + its (latest) backdrop above.
    el.addEventListener('shown.bs.modal', () => {
      el.style.zIndex = '1080';
      const backdrops = document.querySelectorAll('.modal-backdrop');
      const last = backdrops[backdrops.length - 1];
      if (backdrops.length > 1 && last) last.style.zIndex = '1075';
    });
    // Closing the top modal makes Bootstrap drop body.modal-open, which
    // kills scrolling in the still-open staff modal — restore it.
    el.addEventListener('hidden.bs.modal', () => {
      if (document.querySelector('.modal.show')) {
        document.body.classList.add('modal-open');
      }
    });
  }
  bootstrap.Modal.getOrCreateInstance(el).show();
  await loadVsCatManager();
}

async function loadVsCatManager() {
  const list = document.getElementById('vsCatList');
  if (!list) return;
  list.innerHTML = '<div class="text-muted small">กำลังโหลด…</div>';
  const { data, error } = await dbRest(
    '/vs_categories?select=id,label,icon,is_confidential,public_eligible,sort_order,is_active&order=sort_order.asc');
  if (error) {
    list.innerHTML = '<div class="text-danger small">โหลดหมวดหมู่ไม่สำเร็จ</div>';
    return;
  }
  vsCatManagerRows = Array.isArray(data) ? data : [];
  renderVsCatManager();
}

function renderVsCatManager() {
  const list = document.getElementById('vsCatList');
  if (!list) return;
  if (vsCatManagerRows.length === 0) {
    list.innerHTML = '<div class="text-muted small">ยังไม่มีหมวดหมู่</div>';
    return;
  }
  list.innerHTML = vsCatManagerRows.map((c) => `
    <div class="vs-cat-row${c.is_active ? '' : ' is-hidden'}" data-cat-id="${escHtml(c.id)}">
      <input type="text" class="form-control form-control-sm vs-cat-label" maxlength="60"
        value="${escHtml(c.label)}" ${c.is_active ? '' : 'disabled'} aria-label="ชื่อหมวดหมู่">
      <button type="button" class="btn btn-sm vs-cat-conf${c.is_confidential ? ' is-on' : ''}"
        data-cat-conf title="${c.is_confidential ? 'เป็นความลับ — เผยแพร่ไม่ได้ (กดเพื่อเปลี่ยน)' : 'เผยแพร่ได้ (กดเพื่อทำเป็นความลับ)'}">
        <i class="bi ${c.is_confidential ? 'bi-shield-lock-fill' : 'bi-unlock'}"></i>
      </button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-cat-toggle>
        ${c.is_active ? '<i class="bi bi-eye-slash"></i> ซ่อน' : '<i class="bi bi-eye"></i> แสดง'}
      </button>
    </div>
  `).join('');

  list.querySelectorAll('.vs-cat-row').forEach((row) => {
    const id = row.getAttribute('data-cat-id');
    row.querySelector('.vs-cat-label')?.addEventListener('change', (e) => {
      vsCatPatch(id, { label: e.target.value.trim() }, 'บันทึกชื่อแล้ว');
    });
    row.querySelector('[data-cat-conf]')?.addEventListener('click', () => {
      const c = vsCatManagerRows.find((x) => x.id === id);
      if (!c) return;
      const makeConf = !c.is_confidential;
      // Confirm BOTH directions. Turning confidential OFF is the more
      // dangerous one — it removes a privacy guard (tickets in the category
      // become publishable) — and an unconfirmed tap once flipped the seeded
      // "personal" lane to publishable during testing.
      const msg = makeConf
        ? `ทำ "${c.label}" เป็นความลับ?\nหมวดนี้จะเผยแพร่สู่กระดานสาธารณะไม่ได้ และเรื่องที่เผยแพร่อยู่ในหมวดนี้จะหายจากกระดานทันที`
        : `เอา "${c.label}" ออกจากความลับ?\n\n⚠️ นี่คือการถอดการป้องกันความเป็นส่วนตัว — เรื่องในหมวดนี้จะสามารถถูกเผยแพร่สู่กระดานสาธารณะได้`;
      if (!confirm(msg)) return;
      vsCatPatch(id, { is_confidential: makeConf, public_eligible: !makeConf },
        makeConf ? 'ตั้งเป็นความลับแล้ว' : 'เปิดให้เผยแพร่ได้แล้ว');
    });
    row.querySelector('[data-cat-toggle]')?.addEventListener('click', () => {
      const c = vsCatManagerRows.find((x) => x.id === id);
      if (!c) return;
      vsCatPatch(id, { is_active: !c.is_active }, c.is_active ? 'ซ่อนหมวดหมู่แล้ว' : 'แสดงหมวดหมู่แล้ว');
    });
  });
}

async function vsCatPatch(id, patch, okMsg) {
  if (patch.label !== undefined && !patch.label) { vsCatStatus('ชื่อหมวดหมู่ห้ามว่าง', true); return; }
  const { data, error } = await dbRest(`/vs_categories?id=eq.${encodeURIComponent(id)}`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' });
  if (error || !Array.isArray(data) || data.length === 0) {
    vsCatStatus('บันทึกไม่สำเร็จ — คุณอาจไม่มีสิทธิ์แก้ไข', true);
    return;
  }
  const i = vsCatManagerRows.findIndex((x) => x.id === id);
  if (i >= 0) vsCatManagerRows[i] = { ...vsCatManagerRows[i], ...data[0] };
  vsCategoriesCache = null;          // publish-panel select reloads next paint
  renderVsCatManager();
  renderPublishPanel();
  vsCatStatus(okMsg);
}

export async function vsCatAdd() {
  const labelEl = document.getElementById('vsCatNewLabel');
  const confEl = document.getElementById('vsCatNewConfidential');
  const label = (labelEl?.value || '').trim();
  if (!label) { vsCatStatus('กรุณาระบุชื่อหมวดหมู่', true); return; }
  const isConf = !!confEl?.checked;
  const maxSort = vsCatManagerRows.reduce((m, c) => Math.max(m, c.sort_order || 0), 0);
  const row = {
    id: `cat_${Date.now().toString(36)}`,
    label,
    icon: 'bi-tag',
    is_confidential: isConf,
    public_eligible: !isConf,
    sort_order: maxSort + 10,
    is_active: true,
  };
  const { data, error } = await dbRest('/vs_categories',
    { method: 'POST', body: row, prefer: 'return=representation' });
  if (error || !Array.isArray(data) || data.length === 0) {
    vsCatStatus('เพิ่มไม่สำเร็จ — คุณอาจไม่มีสิทธิ์', true);
    return;
  }
  if (labelEl) labelEl.value = '';
  if (confEl) confEl.checked = false;
  vsCatManagerRows.push(data[0]);
  vsCategoriesCache = null;
  renderVsCatManager();
  renderPublishPanel();
  vsCatStatus(`เพิ่ม "${label}" แล้ว`);
}

/** Lazy-load the similar list the first time the เรื่องซ้ำ tab is shown. */
function wireSimilarTabOnce() {
  if (similarTabWired) return;
  similarTabWired = true;
  document.getElementById('staff-similar-tab')?.addEventListener('shown.bs.tab', () => {
    loadSimilarTickets(currentActiveTicketId);
  });
}

async function loadSimilarTickets(id) {
  const body = document.getElementById('staffSimilarBody');
  if (!body || !id) return;
  body.innerHTML = '<div class="text-muted small"><span class="spinner-border spinner-border-sm me-1"></span> กำลังค้นหาเรื่องที่คล้ายกัน…</div>';
  const { data, error } = await dbRest('/rpc/find_similar_vs_tickets',
    { method: 'POST', body: { p_id: id, p_limit: 6 } });
  if (error) {
    body.innerHTML = `<div class="text-danger small">ค้นหาไม่สำเร็จ: ${escHtml(String(error.message || '').slice(0, 120))}</div>`;
    return;
  }
  renderSimilar(Array.isArray(data) ? data : []);
}

/** True when the ticket being viewed is itself a duplicate (can't be a merge source). */
function currentIsDuplicate() {
  const current = staffTicketsCache.find((x) => x.id === currentActiveTicketId);
  return !!current?.duplicate_of;
}

/** One merge-target row (shared by the suggestion list + the search results).
 *  `pct` is a similarity % (suggestions) or null (search). */
function mergeTargetRow(s, isDup, pct) {
  const snippet = escHtml(String(s.problem_snippet || '').trim() || '(ไม่มีรายละเอียด)');
  const dept = escHtml(deptShort(s.target_dept));
  const status = escHtml(s.status || '');
  const dupBadge = Number(s.dup_count) > 0
    ? `<span class="badge bg-info-subtle text-info-emphasis">มี ${Number(s.dup_count)} ซ้ำ</span>` : '';
  const pctBadge = (pct != null)
    ? `<span class="badge bg-primary-subtle text-primary-emphasis flex-shrink-0" title="ความคล้าย">${pct}%</span>` : '';
  const action = isDup
    ? ''
    : `<button type="button" class="btn btn-sm btn-outline-primary flex-shrink-0" data-vs-merge="${escHtml(s.id)}">รวมเข้าเรื่องนี้</button>`;
  return `<div class="border rounded p-2 mb-2 d-flex align-items-start gap-2">
    ${pctBadge}
    <div class="flex-grow-1" style="min-width:0">
      <div class="small fw-semibold">${escHtml(s.id)} <span class="text-muted">· ${dept} · ${status}</span> ${dupBadge}</div>
      <div class="small text-muted text-truncate">${snippet}</div>
    </div>
    ${action}
  </div>`;
}

function renderSimilar(list) {
  const body = document.getElementById('staffSimilarBody');
  if (!body) return;
  const isDup = currentIsDuplicate();

  if (!list.length) {
    body.innerHTML = '<div class="text-muted small py-2">ไม่พบเรื่องที่คล้ายกัน — ลองใช้ช่องค้นหาด้านบน</div>';
    return;
  }
  const rows = list.map((s) => mergeTargetRow(s, isDup, Math.round(Number(s.sim || 0) * 100))).join('');
  const hint = isDup
    ? '<div class="alert alert-warning small py-2 px-3">เรื่องนี้ถูกรวมเป็นเรื่องซ้ำแล้ว — กด “แยกออก” ในแท็บรายละเอียดก่อน หากต้องการรวมกับเรื่องอื่น</div>'
    : '<div class="text-muted small mb-2">หากเป็นเรื่องเดียวกัน กด “รวมเข้าเรื่องนี้” เพื่อยุบเป็นเรื่องซ้ำ (เวิร์กโฟลว์ SE↔VP ของเรื่องหลักไม่เปลี่ยน)</div>';
  body.innerHTML = hint + rows;
  body.querySelectorAll('[data-vs-merge]').forEach((b) => b.addEventListener('click', onMergeClick));
}

// ----- Search for a merge target (0070) -----

let mergeSearchWired = false;
let mergeSearchTimer = null;

function wireMergeSearchOnce() {
  if (mergeSearchWired) return;
  mergeSearchWired = true;
  const input = document.getElementById('staffMergeSearch');
  input?.addEventListener('input', () => {
    clearTimeout(mergeSearchTimer);
    mergeSearchTimer = setTimeout(runMergeSearch, 300);
  });
}

function resetMergeSearch() {
  const input = document.getElementById('staffMergeSearch');
  if (input) input.value = '';
  const res = document.getElementById('staffSearchResults');
  if (res) res.innerHTML = '<div class="text-muted small">พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา…</div>';
}

async function runMergeSearch() {
  const input = document.getElementById('staffMergeSearch');
  const res = document.getElementById('staffSearchResults');
  if (!input || !res) return;
  if (currentIsDuplicate()) {
    res.innerHTML = '<div class="alert alert-warning small py-2 px-3 mb-0">เรื่องนี้ถูกรวมเป็นเรื่องซ้ำแล้ว — กด “แยกออก” ในแท็บรายละเอียดก่อนจึงจะรวมกับเรื่องอื่นได้</div>';
    return;
  }
  const qStr = input.value.trim();
  if (qStr.length < 2) {
    res.innerHTML = '<div class="text-muted small">พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา…</div>';
    return;
  }
  res.innerHTML = '<div class="text-muted small"><span class="spinner-border spinner-border-sm me-1"></span> กำลังค้นหา…</div>';
  const { data, error } = await dbRest('/rpc/search_vs_tickets',
    { method: 'POST', body: { p_query: qStr, p_exclude: currentActiveTicketId, p_limit: 8 } });
  if (error) {
    res.innerHTML = `<div class="text-danger small">ค้นหาไม่สำเร็จ: ${escHtml(String(error.message || '').slice(0, 120))}</div>`;
    return;
  }
  const list = Array.isArray(data) ? data : [];
  if (!list.length) {
    res.innerHTML = '<div class="text-muted small py-2">ไม่พบเรื่องที่ตรงกับคำค้น</div>';
    return;
  }
  const isDup = currentIsDuplicate();
  res.innerHTML = list.map((s) => mergeTargetRow(s, isDup, null)).join('');
  res.querySelectorAll('[data-vs-merge]').forEach((b) => b.addEventListener('click', onMergeClick));
}

async function onMergeClick(e) {
  const canonicalId = e.currentTarget.getAttribute('data-vs-merge');
  const dupId = currentActiveTicketId;
  if (!canonicalId || !dupId) return;
  if (!confirm(`รวม ${dupId} เข้าเป็นเรื่องซ้ำของ ${canonicalId} ?\nเรื่องนี้จะปิดอัตโนมัติเมื่อ ${canonicalId} เสร็จสิ้น`)) return;
  e.currentTarget.disabled = true;
  const { error } = await dbRest('/rpc/merge_vs_tickets',
    { method: 'POST', body: { p_dup: dupId, p_canonical: canonicalId } });
  if (error) {
    alert('รวมไม่สำเร็จ: ' + (error.message || 'unknown'));
    e.currentTarget.disabled = false;
    return;
  }
  bootstrap.Modal.getInstance(document.getElementById('staffManageModal'))?.hide();
  currentActiveTicketId = null;
  await fetchStaffTickets();
}

async function onUnmergeClick() {
  const id = currentActiveTicketId;
  if (!id) return;
  const { error } = await dbRest('/rpc/unmerge_vs_ticket', { method: 'POST', body: { p_id: id } });
  if (error) { alert('แยกออกไม่สำเร็จ: ' + (error.message || 'unknown')); return; }
  bootstrap.Modal.getInstance(document.getElementById('staffManageModal'))?.hide();
  currentActiveTicketId = null;
  await fetchStaffTickets();
}

// --------------------------------------------------
// Delete VS Ticket — vs_staff / dev only (RLS enforces).
// dbRest + return=representation so we surface RLS no-ops as real errors
// (see mistakes.md "supabase-js silent-success" entry).
// --------------------------------------------------

export async function deleteCurrentVSTicket() {
  if (!currentActiveTicketId) return;
  const ticket = staffTicketsCache.find((t) => t.id === currentActiveTicketId);
  const hint = ticket ? `"${stripHtmlToText(ticket.problem, 60)}"` : '';
  if (!confirm(`ลบ ticket ${currentActiveTicketId} ${hint} ใช่หรือไม่? ไม่สามารถกู้คืนได้`)) return;

  // Soft-delete via the RPC (recoverable by admin — NOT surfaced to staff).
  // Any VS staff or VP may delete any ticket (0044); still staff-only
  // (submitters/guests can't). See migrations 0043 + 0044.
  const { data, error } = await dbRest(
    '/rpc/soft_delete_vs_ticket',
    { method: 'POST', body: { p_id: currentActiveTicketId } },
  );
  if (error) {
    alert('ลบไม่สำเร็จ: ' + (error.message || 'unknown'));
    return;
  }
  if (!data || !data.id) {
    alert('ลบไม่สำเร็จ — ไม่พบ ticket หรือคุณไม่มีสิทธิ์ลบ');
    return;
  }

  // Close the modal + refresh.
  const modalEl = document.getElementById('staffManageModal');
  bootstrap.Modal.getInstance(modalEl)?.hide();
  currentActiveTicketId = null;
  await fetchStaffTickets();
}

// --------------------------------------------------
// Submit Staff Action (Supabase update + GAS Discord proxy)
// --------------------------------------------------

export async function submitStaffAction() {
  const newStatus = document.getElementById('staffActionStatus').value;
  const newDept = document.getElementById('staffActionTransfer').value;
  const remark = document.getElementById('staffActionRemark').value.trim();
  const notifyTo = document.getElementById('staffNotifyTo').value;
  const isSilent = document.getElementById('staffSilentNotify').checked;

  const ticket = staffTicketsCache.find((t) => t.id === currentActiveTicketId);
  if (!ticket) return;

  const statusChanged = newStatus && newStatus !== ticket.status;
  const deptChanged = newDept && newDept !== ticket.target_dept;

  // Resolution on close (0073). Effective status = the new status if the
  // dropdown was changed, else the ticket's current status. The picker is
  // only relevant when that lands on เสร็จสิ้น.
  const effectiveStatus = newStatus || ticket.status;
  const isDone = effectiveStatus === DONE_STATUS;
  const resolution = document.getElementById('staffResolution')?.value || '';
  const resNote = (document.getElementById('staffResolutionNote')?.value || '').trim();
  const closingNow = isDone && statusChanged && newStatus === DONE_STATUS;
  const willWriteResolution = isDone && !!resolution
    && (resolution !== (ticket.resolution || '')
        || resNote !== (ticket.resolution_note || '')
        || closingNow);

  if (!statusChanged && !deptChanged && !remark && !notifyTo && !willWriteResolution) {
    alert('ไม่มีการเปลี่ยนแปลง กรุณาแก้ไขสถานะ โอนย้ายฝ่าย เพิ่ม Remark หรือส่งแจ้งเตือน ก่อนบันทึก');
    return;
  }

  // Closing a ticket requires a reason; wont_do additionally requires a note.
  if (closingNow && !resolution) {
    alert('กรุณาเลือกเหตุผลการปิดเรื่องก่อนบันทึก');
    return;
  }
  if (isDone && resolution === 'wont_do' && !resNote) {
    alert('กรุณาระบุเหตุผลที่ไม่สามารถดำเนินการได้');
    return;
  }

  // Guard: a VP can only transfer back to SE — not directly to another
  // VP. RLS (migration 0013's with-check) enforces this server-side; we
  // catch it here with a friendly Thai message before the request fires
  // so users don't see the raw RLS error.
  if (deptChanged) {
    const user = authGetUser();
    if (user?.role === 'vp_admin') {
      const ownDept = user.department || '';
      const isVPDest = (newDept || '').startsWith('อุปนายก');
      if (isVPDest && newDept !== ownDept) {
        alert('ไม่สามารถส่งต่อให้อุปนายกท่านอื่นโดยตรงได้\n\nกรุณาเลือก "โอนคืน SE" เพื่อให้ SE พิจารณาและส่งต่อให้อุปนายกท่านที่เกี่ยวข้อง');
        return;
      }
    }
  }

  const btn = document.querySelector('#staffManageModal .btn-dark');
  btn.disabled = true; btn.innerHTML = 'กำลังบันทึก...';

  try {
    // Refetch remarks to avoid clobbering server-side updates.
    const { data: existing, error: fetchErr } = await db
      .from('vs_tickets')
      .select('remarks, status, target_dept')
      .eq('id', currentActiveTicketId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;

    const remarks = Array.isArray(existing?.remarks) ? [...existing.remarks] : [];
    const time = new Date().toLocaleString('en-GB', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    // Human actor label — never the internal "__all__" filter value.
    const actor = staffActorLabel();
    if (statusChanged) {
      remarks.push({ type: 'log', by: actor, time, text: `เปลี่ยนสถานะ: "${existing.status}" → "${newStatus}"` });
    }
    if (deptChanged) {
      remarks.push({ type: 'log', by: actor, time, text: `โอนย้ายฝ่าย: "${existing.target_dept}" → "${newDept}"` });
    }
    if (notifyTo) {
      remarks.push({ type: 'log', by: actor, time, text: `ส่งแจ้งเตือน/ปรึกษา ไปที่ Discord ฝ่าย: "${notifyTo}"` });
    }
    if (remark) {
      remarks.push({ type: 'remark', by: actor, time, text: remark });
    }
    if (willWriteResolution) {
      const meta = vsResolution(resolution);
      // Submitter-visible (NOT internal) — this is the outcome we want the
      // student to read on their tracking view.
      remarks.push({
        type: 'log', by: actor, time,
        text: `สรุปผลการดำเนินการ: ${meta?.student || resolution}${resNote ? ` — ${resNote}` : ''}`,
      });
    }

    const update = { remarks };
    if (statusChanged) update.status = newStatus;
    if (deptChanged) update.target_dept = newDept;
    if (willWriteResolution) {
      update.resolution = resolution;
      update.resolution_note = resNote || null;
    }

    // dbRest + return=representation so we surface RLS no-ops as errors
    // (see mistakes.md "supabase-js silent-success on RLS-blocked updates").
    const idEsc = encodeURIComponent(currentActiveTicketId);
    const { data: updated, error: updErr } = await dbRest(
      `/vs_tickets?id=eq.${idEsc}`,
      { method: 'PATCH', body: update, prefer: 'return=representation' },
    );
    if (updErr) throw new Error(updErr.message || 'update failed');
    if (!Array.isArray(updated) || updated.length === 0) {
      throw new Error('อัปเดตไม่สำเร็จ — ไม่พบ ticket หรือคุณไม่มีสิทธิ์แก้ไข');
    }

    // Fire-and-forget Discord notification via the unified helper
    // (fetch + keepalive; see notify.js for why not sendBeacon).
    if (notifyTo) {
      sendNotify('vs', {
        mode: 'consult',
        ticketId: currentActiveTicketId,
        role: actor,
        notifyTo,
        isSilent,
        remark,
        displayDept: newDept || existing.target_dept,
        displayStatus: newStatus || existing.status,
      });
    }

    alert('อัปเดตข้อมูลสำเร็จ!');
    bootstrap.Modal.getInstance(document.getElementById('staffManageModal')).hide();
    fetchStaffTickets();
  } catch (e) {
    alert('เกิดข้อผิดพลาดในการบันทึก: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'บันทึกข้อมูล';
  }
}
