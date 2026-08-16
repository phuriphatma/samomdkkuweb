// ============================================================
// claude/index.js — จองโควตา Claude (migration 0154).
//
// SAMO holds ONE Claude Pro subscription. This is the board people use to
// claim a share of it without silently spending someone else's.
//
// THE ONE THING TO UNDERSTAND BEFORE EDITING
// A "session" is not a slot on a grid. Claude opens its 5-hour window at the
// FIRST message, so the window is created by the earliest booking in an area
// and runs five hours from there, carrying 100%. Anyone whose block lands
// inside that span shares the same 100%.
//
// This module does NOT implement that rule. It renders `board.sessions`, which
// `get_claude_board()` derived with the same `claude_sessions()` the INSERT
// trigger enforces with. Two implementations of one rule drift, and this repo
// has paid for that more than any other mistake — so the arithmetic has exactly
// one home and it is the database. The modal's live preview below is a
// PROJECTION of those rows, never a second derivation: it answers "which of the
// sessions the server sent would this land in", and the server still gets the
// final word on save.
//
// It also does not ENFORCE anything about Claude itself. Everyone shares one
// login and can use it outside their block. This is the same kind of object as
// ระบบจองห้องสโม — an attributable, public claim on a shared thing.
// ============================================================

import { dbRest } from '../db.js';
import { getUser } from '../auth.js';
import { escHtml } from '../utils.js';
import { askDelete } from '../confirm-modal.js';
import { sendNotify } from '../notify.js';
import { dayColumnsFor, bookableRangeFor, startOfDay } from './week.js';
import {
  pressIntent, movedTooFar, shouldBlockScroll, HOLD_MS, HOLD_MIN,
} from './gesture.js';
import { paintUsageLog, paintFreeNow } from './usage.js';
// Every formatter and the ฝ่าย colour live in ONE module, shared with
// usage.js. Two copies of "what colour is this person" is the drift class
// this repo pays for most.
import {
  pad, hhmm, minsOfDay, THAI_DOW, fullDate, stampLabel, durLabel, pctText,
  personName, shortName, personDept, personColor,
} from './fmt.js';

const HOUR_MS  = 3600000;
const DAY_MS   = 86400000;
const MIN_MS   = 60000;
const SLOT_MIN = 15;               // picker granularity, and the drag snap

let board = null;                  // the whole payload from get_claude_board()
let weekAnchor = null;             // Date inside the week being viewed
let built = false;                 // listeners wired once
let gridBuilt = false;             // grid skeleton painted for the current week
let pollTimer = null;              // the once-a-minute repaint while on screen
let editing = null;                // the booking open in the modal, or null
let modalRef = null;               // one Bootstrap Modal instance, reused
let continuation = null;           // the tail a session edge cut off, if any

const $ = (id) => document.getElementById(id);

// ============================================================
// Data
// ============================================================
async function loadBoard(at) {
  const { data, error } = await dbRest('/rpc/get_claude_board', {
    method: 'POST',
    body: { p_at: (at || new Date()).toISOString() },
  });
  if (error) throw new Error(error.message || `HTTP ${error.status}`);
  return data;
}

const weekStart = () => new Date(board.week.starts_at);
const weekEnd   = () => new Date(board.week.ends_at);
const sessionMs = () => (board.settings.session_minutes || 300) * MIN_MS;

/**
 * The day columns and the bookable slice of each — geometry lives in week.js,
 * which is pure and directly tested (claude/week.test.js). Keeping it there is
 * the point: the bug this replaces was a hardcoded column count, and a number
 * assumed in a DOM module is a number nothing can assert about.
 */
const dayColumns = () => dayColumnsFor(weekStart(), weekEnd());
const bookableRange = (dayStartMs) => bookableRangeFor(dayStartMs, weekStart(), weekEnd());

// ============================================================
// Entry point
// ============================================================
export async function enterClaudeWorkspace() {
  if (!$('claudeCalBody')) return;           // pane not in this bundle
  if (!built) {
    wire();
    built = true;
  }
  await refresh();
  startPolling();
}

/**
 * Reload the board and repaint.
 *
 * `quiet` is for the poll below: it must not steal the page out from under
 * somebody. Two things it preserves that a naive repaint destroys —
 *   • the scroll position (buildGrid() jumps to 08:00, so re-running it every
 *     minute would yank the view while you were reading Thursday night);
 *   • the grid skeleton, which is only rebuilt when the WEEK changes, because
 *     rebuilding is what moves the scroll in the first place.
 */
async function refresh({ quiet = false } = {}) {
  const scroller = $('claudeCalScroll');
  const keepScroll = scroller ? scroller.scrollTop : null;
  const prevWeek = board?.week?.starts_at || null;

  try {
    board = await loadBoard(weekAnchor);
  } catch (e) {
    console.warn('claude: board load failed:', e);
    // A failed POLL must stay silent — the board on screen is still valid, and
    // overwriting the help line every minute would be its own bug.
    if (!quiet) {
      $('claudeHelp').textContent = 'โหลดข้อมูลการจองไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง';
    }
    return;
  }

  weekAnchor = new Date(board.week.starts_at);
  const weekChanged = prevWeek !== board.week.starts_at;

  paintFreeNow($('claudeNow'), board.right_now);
  paintWeekMeter();
  if (weekChanged || !gridBuilt) {
    buildGrid();
    gridBuilt = true;
  }
  paintGrid();
  if (!weekChanged && keepScroll != null && scroller) scroller.scrollTop = keepScroll;
  // The log is a second RPC over the same week, so it follows the week being
  // browsed — but only while it is open. Closed, it costs nothing.
  if (usageOpen) loadUsage({ quiet });
}

// ============================================================
// The measured log — a second RPC, on demand
// ============================================================
let usageOpen = false;

function toggleUsage() {
  usageOpen = !usageOpen;
  $('claudeUsageBody').classList.toggle('d-none', !usageOpen);
  $('claudeUsageToggle').setAttribute('aria-expanded', String(usageOpen));
  $('claudeUsageToggle').classList.toggle('is-open', usageOpen);
  if (usageOpen) loadUsage();
}

async function loadUsage({ quiet = false } = {}) {
  const host = $('claudeUsageBody');
  if (!quiet) host.innerHTML = '<div class="cu-loading">กำลังโหลดข้อมูลการใช้งานจริง…</div>';
  try {
    const { data, error } = await dbRest('/rpc/get_claude_usage_log', {
      method: 'POST',
      body: { p_at: (weekAnchor || new Date()).toISOString() },
    });
    if (error) throw new Error(error.message || `HTTP ${error.status}`);
    paintUsageLog(host, data);
  } catch (e) {
    console.warn('claude: usage log failed:', e);
    // A failed POLL leaves what is on screen alone — it is still valid, and
    // replacing a working panel with an error every minute is its own bug.
    if (!quiet) {
      host.innerHTML = '<div class="cu-loading">โหลดข้อมูลการใช้งานจริงไม่สำเร็จ</div>';
    }
  }
}

/**
 * Keep the page as live as the data underneath it.
 *
 * The measured numbers land every 15 minutes, but nothing was re-reading them:
 * a tab left open showed whatever was true when it was opened, with a
 * "อัปเดต N นาทีที่แล้ว" label quietly counting up. A minute is well below the
 * sample cadence, so the reading is never more stale on screen than it is in
 * the database, and the reset countdowns tick.
 *
 * Three things stop it, each a bug this repo has already paid for once:
 *   • the pane is not on screen — an admin sitting in VitalSound should not be
 *     polling this;
 *   • the tab is backgrounded — same request, nobody to see it;
 *   • THE MODAL IS OPEN — repainting a pane while someone is typing into a form
 *     it owns is exactly the "shared render() destroys in-progress input" class.
 */
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    const pane = document.querySelector('[data-admin-pane="claude"]');
    if (!pane || pane.classList.contains('d-none')) return;
    if (document.hidden) return;
    if ($('claudeBookingModal')?.classList.contains('show')) return;
    refresh({ quiet: true });
  }, 60000);
}

function wire() {
  $('claudePrevWeek').addEventListener('click', () => shiftWeek(-1));
  $('claudeNextWeek').addEventListener('click', () => shiftWeek(1));
  $('claudeThisWeek').addEventListener('click', () => { weekAnchor = null; refresh(); });
  $('claudeNewBooking').addEventListener('click', () => {
    // Default to the next quarter-hour inside the week being viewed, so the
    // button works the same whether you are on this week or browsing ahead.
    const now = new Date();
    const base = (now >= weekStart() && now < weekEnd()) ? now : weekStart();
    const s = roundUp(base);
    openModal({ start: s, end: new Date(s.getTime() + 2 * HOUR_MS) });
  });

  $('claudeCalBody').addEventListener('pointerdown', onDragStart);
  $('claudeCalBody').addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  // Both directions of "the browser took the gesture": pointercancel is fired
  // when it starts scrolling, and a finger lifted off-pane raises pointerup on
  // window. Without the first, a scrolled-away drag stayed armed and the next
  // tap anywhere opened the booking modal.
  window.addEventListener('pointercancel', onDragCancel);
  // `touchcancel` as well, and not as belt-and-braces theatre: the two are
  // separate event streams, and an engine that fires one without the other
  // leaves the drag armed — which is the whole bug. onDragCancel is idempotent,
  // so being told twice costs nothing and being told once is enough.
  window.addEventListener('touchcancel', onDragCancel);
  // passive:false or preventDefault() is ignored — the default for touchmove is
  // passive in every current browser, and a listener that cannot prevent is a
  // listener that silently does nothing.
  $('claudeCalScroll').addEventListener('touchmove', onTouchMove, { passive: false });

  // The measured log is heavier than the board and answers a different
  // question, so it loads when it is opened rather than on every visit.
  $('claudeUsageToggle').addEventListener('click', toggleUsage);

  // Say the gesture the device in someone's hands actually uses. `pointer:
  // coarse` is the media query for "the primary input is a finger", which is
  // the question being asked — not the screen width, which answers a different
  // one and gets it wrong on a laptop with a touchscreen.
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
  $('claudeHelp').innerHTML = coarse
    ? '<strong>แตะค้างไว้</strong>บนตารางแล้วลากเพื่อเลือกช่วงเวลา '
      + '(แตะเฉย ๆ ใช้เลื่อนดูตารางได้ตามปกติ) — กรอบสีเขียวคือ '
      + '<strong>เซสชัน 5 ชั่วโมง</strong> ที่เกิดจากการจองแรกของช่วงนั้น '
      + 'ทุกคนที่จองอยู่ในกรอบเดียวกันจะแบ่งโควตา 100% ก้อนเดียวกัน'
    : 'ลากบนตารางเพื่อเลือกช่วงเวลา — กรอบสีเขียวคือ '
      + '<strong>เซสชัน 5 ชั่วโมง</strong> ที่เกิดจากการจองแรกของช่วงนั้น '
      + 'ทุกคนที่จองอยู่ในกรอบเดียวกันจะแบ่งโควตา 100% ก้อนเดียวกัน';
  // The rail has no meaning until it is named. A colour down the edge of a
  // calendar that nobody can read is decoration, however correct the number
  // behind it is.
  $('claudeHelp').innerHTML += '<br><span class="claude-rail-key">'
    + '<i class="claude-free is-full"></i>แถบด้านซ้ายของแต่ละวันคือ '
    + '<strong>โควตาที่ใช้ได้ทันทีโดยไม่ต้องจอง</strong> ถ้าเริ่มใช้ตอนนั้น — '
    + '<i class="claude-free is-part"></i>สีส้มคือช่วงที่มีคนจองไว้แล้วบางส่วน '
    + '<i class="claude-free is-none"></i>สีแดงคือไม่เหลือ</span>';

  ['claudeDate', 'claudeStart', 'claudeEnd', 'claudePct'].forEach((id) => {
    $(id).addEventListener('input', recalc);
    $(id).addEventListener('change', recalc);
  });
  $('claudeSave').addEventListener('click', save);
  $('claudeDelete').addEventListener('click', removeBooking);
}

function shiftWeek(dir) {
  weekAnchor = new Date(weekStart().getTime() + dir * 7 * DAY_MS + HOUR_MS);
  refresh();
}

const roundUp = (d) => {
  const x = new Date(d);
  x.setSeconds(0, 0);
  x.setMinutes(Math.ceil(x.getMinutes() / SLOT_MIN) * SLOT_MIN);
  return x;
};

// ============================================================
// "ใช้ได้เลยตอนนี้" — the question this board is actually opened with
// ============================================================
//
// Nobody books before opening Claude for ten minutes. The question people
// arrive with is the opposite of the one a calendar answers: *I want to use it
// NOW. How much may I take, and until when, without stepping on anyone?*
//
// The arithmetic is claude_free_now() (migration 0155) and it is not repeated
// here — this renders `board.right_now`. What it adds is the SENTENCE: a number
// with no reason beside it gets argued with, and the reason is different
// depending on which of the two ceilings bound it.
// ============================================================
// Weekly meter
// ============================================================
function paintWeekMeter() {
  const pool = board.week.pool_pct;
  const used = board.week.used_pct;
  // The headline figure is what has actually been SPENT when that is known,
  // and only falls back to the booked total when the reporter has never run.
  // They are different quantities and the label says which one is on screen —
  // a number whose meaning depends on a system's state elsewhere must never
  // wear the same words in both states.
  const rnw = board.right_now?.week;
  const haveMeasured = rnw && rnw.used_pct != null;
  $('claudeWeekUsed').textContent = haveMeasured ? Math.round(rnw.used_pct) : used;
  $('claudeWeekPool').textContent = pool;
  $('claudeWeekWhat').textContent = haveMeasured
    ? 'ใช้ไปแล้วจริงสัปดาห์นี้' : 'จองไว้แล้วสัปดาห์นี้';
  $('claudeWeekLabel').textContent =
    `${fullDate(weekStart())} ${hhmm(weekStart())} – ${fullDate(weekEnd())} ${hhmm(weekEnd())}`;
  $('claudeResetAt').textContent = stampLabel(weekEnd());

  const left = weekEnd().getTime() - Date.now();
  $('claudeResetIn').textContent = left > 0
    ? `(อีก ${Math.floor(left / DAY_MS)} วัน ${Math.floor((left % DAY_MS) / HOUR_MS)} ชม.)`
    : '';

  // THE BAR ANSWERS "how much is left for me", not "who booked what".
  //
  // It used to be per-person booked segments end to end, which reads as a full
  // week the moment a few people book — even when almost none of it has been
  // spent. The three states someone actually needs apart are: gone (measured),
  // promised to somebody (booked and not yet run), and genuinely free. The
  // per-person split survives inside the promised segment and in the legend, so
  // nothing is lost; it stops being the first thing read.
  const rn = board.right_now;
  const measured = rn && rn.week.left_pct != null;
  const usedReal = measured ? Number(rn.week.used_pct) : null;

  const bar = $('claudeWeekBar');
  bar.innerHTML = '';
  const seg = (w, cls, style, title) => {
    if (w <= 0) return;
    const i = document.createElement('i');
    i.className = cls;
    i.style.width = `${(w / pool) * 100}%`;
    if (style) i.style.background = style;
    if (title) i.title = title;
    bar.appendChild(i);
  };

  if (measured) {
    seg(usedReal, 'is-used', null, `ใช้ไปแล้วจริง — ${pctText(usedReal)}`);
  }
  // The promised part, still split by person: whose claim it is stays visible.
  //
  // Built from the bookings that have NOT finished, not by scaling the
  // all-bookings totals down — a person whose blocks all ran yesterday is
  // reserving nothing, and pro-rating would draw them a slice anyway.
  const perPending = new Map();
  board.bookings
    .filter((b) => !measured || new Date(b.ends_at).getTime() > Date.now())
    .forEach((b) => {
      const key = personName(b.person);
      const cur = perPending.get(key) || { pct: 0, color: personColor(b.person) };
      cur.pct += b.pct;
      perPending.set(key, cur);
    });
  [...perPending.entries()].forEach(([name, v]) => {
    seg(v.pct, 'is-booked', v.color, `${name} จองไว้ ${v.pct}%`);
  });
  // One tick per full session the pool holds: 700% IS seven sessions, and the
  // scale says so without a sentence of help text.
  const sessions = Math.round(pool / board.settings.session_pool_pct);
  for (let k = 1; k < sessions; k++) {
    const t = document.createElement('div');
    t.className = 'claude-week-tick';
    t.style.left = `${(k / sessions) * 100}%`;
    bar.appendChild(t);
  }
  $('claudeWeekScale').innerHTML =
    Array.from({ length: sessions + 1 }, (_, k) => `<span>${k}</span>`).join('');

  // The legend names the three states first, then who holds the middle one.
  // The last item is the one people came for: what is left that nobody has
  // claimed, in sessions as well as percent, because "374%" means nothing until
  // it is "more than three full sessions".
  const freeLeft = measured ? Number(rn.week.free_pct) : pool - used;
  const legend = $('claudeLegend');
  legend.innerHTML =
    (measured
      ? '<span class="claude-legend-item"><span class="claude-swatch is-used"></span>'
        + `ใช้ไปแล้วจริง · <b>${pctText(usedReal)}</b></span>`
      : '')
    + [...perPending.entries()]
      .sort((a, b) => b[1].pct - a[1].pct)
      .map(([name, v]) => '<span class="claude-legend-item">'
        + `<span class="claude-swatch" style="background:${v.color}"></span>`
        + `${escHtml(name)} จองไว้ · <b>${v.pct}%</b></span>`)
      .join('')
    + '<span class="claude-legend-item is-free">'
    + '<span class="claude-swatch is-track"></span>'
    + `${measured ? 'ว่างให้ใช้โดยไม่ต้องจอง' : 'ยังไม่ถูกจอง'} · <b>${pctText(freeLeft)}</b>`
    + ` = อีก <b>${(freeLeft / board.settings.session_pool_pct).toFixed(1)}</b> เซสชัน</span>`;

  paintMeasured();
}

/**
 * The MEASURED panel — the only numbers on this page that are not a guess.
 *
 * Everything above it is what people DECLARED they would use. This is what
 * Claude says the account actually spent, from claude_usage_samples, written by
 * tools/claude-usage-report.mjs running where the credential is.
 *
 * Two things it does that the ledger cannot:
 *   • shows how much of each real window is LEFT, with the real reset time —
 *     including when Anthropic resets early after an incident, which the
 *     configured Wed 16:00 cannot know about;
 *   • carries the reset instants the configured Wed 16:00 cannot know about.
 *
 * The booked-vs-actual reconciliation used to live here too, on the weekly
 * window's own 0–100 scale, one card below a bar reading 287 / 700 in session
 * percent. Same comparison, two units, and no way to tell that they agreed. It
 * is now stated once, in the measured log, in session percent like everything
 * else.
 *
 * With no sample it says so, rather than hiding: an admin looking for the live
 * numbers should learn the reporter was never switched on, not see a blank.
 */
function paintMeasured() {
  const host = $('claudeMeasured');
  const m = board.measured;

  if (!m) {
    host.innerHTML =
      '<div class="claude-measured-off">'
      + '<i class="bi bi-info-circle" aria-hidden="true"></i>'
      + '<div>ยังไม่ได้เชื่อมต่อข้อมูลการใช้งานจริงจาก Claude — '
      + 'ตัวเลขด้านบนคือสิ่งที่ทุกคนจองไว้ ไม่ใช่สิ่งที่ใช้ไปจริง<br>'
      + 'ตั้งค่าได้ที่เซิร์ฟเวอร์ (ดู <code>tools/claude-usage-report.mjs</code>)</div></div>';
    return;
  }

  const age = Date.now() - new Date(m.sampled_at).getTime();
  // The timer runs every 15 minutes, so anything past ~35 tells you the
  // reporter has stopped rather than that usage is quiet.
  const stale = age > 35 * 60 * 1000;

  // NO reconciliation here any more. It printed booked-vs-actual on the WEEKLY
  // window's 0–100 scale, directly under a bar reading 287 / 700 in session
  // percent — the same comparison twice, in two units, one card apart. It now
  // lives once, in the measured log, in the unit the rest of the feature uses.
  // Two numbers that mean the same thing and do not match is worse than one.

  host.innerHTML =
    '<div class="claude-measured-head">'
    + '<b>ใช้จริง</b><span class="text-muted">วัดจาก Claude โดยตรง</span>'
    + `<span class="claude-measured-age ms-auto ${stale ? 'is-stale' : ''}">`
    + `${stale ? 'ข้อมูลค้าง — ' : ''}อัปเดต${ago(age)}</span>`
    + '</div>'
    + '<div class="claude-gauges">'
    + gauge('เซสชัน 5 ชม. ตอนนี้', m.five_hour_pct, m.five_hour_resets_at)
    + gauge('โควตารายสัปดาห์', m.seven_day_pct, m.seven_day_resets_at)
    + '</div>'
    ;
}

/** One window: how much is left, and when it comes back. */
function gauge(label, pct, resetsAt) {
  if (pct == null) {
    return `<div><div class="claude-gauge-k"><span>${escHtml(label)}</span>`
      + '<span class="claude-gauge-left">—</span></div>'
      + '<div class="claude-meter"><i style="width:0"></i></div></div>';
  }
  const used = Math.max(0, Math.min(100, Number(pct)));
  const cls = used >= 90 ? ' is-crit' : used >= 80 ? ' is-warn' : '';
  const reset = resetsAt ? new Date(resetsAt) : null;
  const left = reset ? reset.getTime() - Date.now() : null;
  return '<div>'
    + `<div class="claude-gauge-k"><span>${escHtml(label)}</span>`
    + `<span class="claude-gauge-left">เหลือ ${(100 - used).toFixed(0)}%</span></div>`
    + `<div class="claude-meter${cls}"><i style="width:${used}%"></i></div>`
    + '<div class="claude-gauge-sub">'
    + `ใช้ไป ${used.toFixed(0)}%`
    + (reset ? ` · รีเซ็ต ${stampLabel(reset)}${left > 0 ? ` (อีก ${durLabel(left)})` : ''}` : '')
    + '</div></div>';
}

/** "3 นาทีที่แล้ว" — a timestamp answers "when", this answers "is it live". */
function ago(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'เมื่อครู่';
  if (mins < 60) return ` ${mins} นาทีที่แล้ว`;
  const h = Math.floor(mins / 60);
  if (h < 24) return ` ${h} ชม.ที่แล้ว`;
  return ` ${Math.floor(h / 24)} วันที่แล้ว`;
}

// ============================================================
// Grid
// ============================================================
function hourH() {
  const probe = document.querySelector('.claude-tab');
  return parseFloat(getComputedStyle(probe).getPropertyValue('--claude-hour-h')) || 44;
}
const yForMin = (m) => (m / 60) * hourH();

function buildGrid() {
  const head = $('claudeCalHead');
  const body = $('claudeCalBody');
  head.innerHTML = '<div class="claude-corner"></div>';
  body.innerHTML = '';

  // The column count is derived (7 or 8, see dayColumns), so the grid track
  // list has to follow it rather than being fixed in the stylesheet.
  const cols = dayColumns();
  head.style.setProperty('--claude-cols', String(cols.length));
  body.style.setProperty('--claude-cols', String(cols.length));

  const today = startOfDay(new Date()).getTime();
  cols.forEach((d) => {
    const el = document.createElement('div');
    el.className = 'claude-dayhead' + (d.getTime() === today ? ' is-today' : '');
    el.innerHTML = `<div class="claude-dow">${THAI_DOW[d.getDay()]}</div>`
      + `<div class="claude-dnum">${d.getDate()}</div>`;
    head.appendChild(el);
  });

  const gut = document.createElement('div');
  gut.className = 'claude-gutter';
  for (let h = 0; h < 24; h++) {
    const r = document.createElement('div');
    r.className = 'claude-hr';
    r.innerHTML = h ? `<span>${pad(h)}:00</span>` : '';
    gut.appendChild(r);
  }
  body.appendChild(gut);

  cols.forEach((d, i) => {
    const col = document.createElement('div');
    col.className = 'claude-daycol';
    col.dataset.dayIndex = String(i);
    col.dataset.dayStart = String(d.getTime());
    for (let h = 0; h < 24; h++) {
      const r = document.createElement('div');
      r.className = 'claude-hr';
      col.appendChild(r);
    }
    body.appendChild(col);
  });

  // Open on the working day rather than at midnight. Only ever on a FRESH
  // grid — refresh() restores the reader's own scroll otherwise.
  $('claudeCalScroll').scrollTop = 8 * hourH();
}

const colFor = (i) => document.querySelector(`.claude-daycol[data-day-index="${i}"]`);

/** Split an absolute [start,end) across the day columns it touches, so a
 *  session that runs past midnight draws in both. */
function splitAcrossDays(start, end) {
  const out = [];
  const cols = dayColumns();
  cols.forEach((d, i) => {
    const dayStart = d.getTime();
    const dayEnd = dayStart + DAY_MS;
    const s = Math.max(start, dayStart);
    const e = Math.min(end, dayEnd);
    if (e > s) out.push({ i, sMin: (s - dayStart) / MIN_MS, eMin: (e - dayStart) / MIN_MS });
  });
  return out;
}

function paintGrid() {
  document.querySelectorAll('.claude-daycol').forEach((c) => {
    c.querySelectorAll('.claude-session,.claude-bk,.claude-dead,.claude-nowline,.claude-sel,.claude-free')
      .forEach((n) => n.remove());
  });

  // Hatch what belongs to the neighbouring quota weeks. Indexed off the DERIVED
  // column list — a hardcoded 6 here is what left the last 16 hours of the week
  // undrawn.
  const cols = dayColumns();
  const last = cols.length - 1;
  addDead(0, 0, bookableRange(cols[0].getTime()).min, 'โควตาสัปดาห์ก่อน', 'is-before');
  addDead(last, bookableRange(cols[last].getTime()).max, 1440, 'โควตาสัปดาห์ถัดไป', 'is-after');

  const pool = board.settings.session_pool_pct;

  // ── "how much may I take if I start HERE" ─────────────────────────────────
  //
  // A capacity RAIL down the left edge of each column, not a wash over the
  // whole column: the answer is a property of a START TIME, and it has to be
  // readable next to the bookings that cause it rather than tinted underneath
  // them. Bookings begin at 9px, so the rail owns the strip beside them and
  // nothing overlaps.
  //
  // Segments come from claude_free_windows() — the same claude_free_now() the
  // hero panel prints, evaluated at each instant where the answer can change.
  // Nothing here recomputes it; a second implementation of this rule in
  // JavaScript would drift from the trigger within a week.
  //
  // Only the current week has any: for a later week the weekly remainder is not
  // knowable yet, and a plausible-looking number would be a lie.
  (board.free_windows || []).forEach((fw) => {
    const free = Math.round(Number(fw.free_pct));
    const s = new Date(fw.starts_at).getTime();
    const e = new Date(fw.ends_at).getTime();
    splitAcrossDays(s, e).forEach((seg, idx) => {
      const col = colFor(seg.i);
      if (!col) return;
      const el = document.createElement('div');
      el.className = 'claude-free'
        + (free <= 0 ? ' is-none' : free < pool ? ' is-part' : ' is-full');
      el.style.top = `${yForMin(seg.sMin)}px`;
      el.style.height = `${Math.max(2, yForMin(seg.eMin) - yForMin(seg.sMin))}px`;
      el.title = free > 0
        ? `เริ่มใช้ในช่วงนี้ได้ ${free}% โดยไม่ต้องจอง`
        : 'ช่วงนี้ไม่เหลือโควตาให้ใช้โดยไม่จอง';
      // Label the first day-segment, and any CONTINUATION long enough to be
      // read as its own band. Labelling only idx 0 left a whole column of อ 18
      // drawing a 968px ribbon with nothing on it — a colour with no number is
      // a decoration, and the number is the entire point. Found by measuring
      // the painted bands, not by reading the loop.
      if ((idx === 0 || seg.eMin - seg.sMin >= 180) && seg.eMin - seg.sMin >= 45) {
        const tag = document.createElement('span');
        tag.className = 'claude-free-tag';
        tag.textContent = free > 0 ? `ว่าง ${free}%` : 'เต็ม';
        el.appendChild(tag);
      }
      col.appendChild(el);
    });
  });

  board.sessions.forEach((sn) => {
    const full = sn.used_pct >= pool;
    const s = new Date(sn.starts_at).getTime();
    const e = new Date(sn.ends_at).getTime();
    splitAcrossDays(s, e).forEach((seg, idx) => {
      const col = colFor(seg.i);
      if (!col) return;
      const el = document.createElement('div');
      el.className = 'claude-session' + (full ? ' is-full' : '') + (idx > 0 ? ' is-cont' : '');
      el.style.top = `${yForMin(seg.sMin)}px`;
      el.style.height = `${Math.max(6, yForMin(seg.eMin) - yForMin(seg.sMin))}px`;
      if (idx === 0) {
        const tag = document.createElement('div');
        tag.className = 'claude-session-tag';
        tag.textContent = full ? 'เต็ม' : `เหลือ ${pool - sn.used_pct}%`;
        el.appendChild(tag);
      }
      col.appendChild(el);
    });
  });

  board.bookings.forEach((b) => {
    const s = new Date(b.starts_at).getTime();
    const e = new Date(b.ends_at).getTime();
    splitAcrossDays(s, e).forEach((seg) => {
      const col = colFor(seg.i);
      if (!col) return;
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'claude-bk' + (b.is_mine ? ' is-mine' : '');
      el.style.setProperty('--claude-c', personColor(b.person));
      el.style.top = `${yForMin(seg.sMin)}px`;
      el.style.height = `${Math.max(18, yForMin(seg.eMin) - yForMin(seg.sMin) - 2)}px`;
      el.title = `${personName(b.person)} — ${b.purpose}`;
      // escHtml on every interpolated field: purpose and name are user text,
      // and a ticket renderer that interpolated raw user text into innerHTML is
      // an entry in this repo's mistakes log.
      el.innerHTML =
        `<span class="claude-bk-p">${b.pct}%</span>`
        + `<span class="claude-bk-t">${hhmm(new Date(b.starts_at))}–${hhmm(new Date(b.ends_at))}</span>`
        + `<span class="claude-bk-n d-block">${escHtml(shortName(b.person))} · ${escHtml(b.purpose)}</span>`;
      el.addEventListener('click', (ev) => { ev.stopPropagation(); openModal({ edit: b }); });
      col.appendChild(el);
    });
  });

  // "Now", only when the week on screen is the one containing it.
  const now = Date.now();
  if (now >= cols[0].getTime() && now < cols[last].getTime() + DAY_MS) {
    const idx = Math.floor((now - cols[0].getTime()) / DAY_MS);
    const col = colFor(idx);
    if (col) {
      const nl = document.createElement('div');
      nl.className = 'claude-nowline';
      nl.style.top = `${yForMin(minsOfDay(new Date()))}px`;
      col.appendChild(nl);
    }
  }

  $('claudeEmptyNote').classList.toggle('d-none', board.bookings.length > 0);
}

function addDead(colIdx, sMin, eMin, label, edge) {
  const col = colFor(colIdx);
  if (!col || eMin <= sMin) return;
  const el = document.createElement('div');
  // `edge` says which side of this block the quota week is on, so the 2px rule
  // lands on the reset moment itself rather than on both borders.
  el.className = `claude-dead ${edge}`;
  el.style.top = `${yForMin(sMin)}px`;
  el.style.height = `${yForMin(eMin) - yForMin(sMin)}px`;
  el.innerHTML = `<div class="claude-dead-label">${escHtml(label)}</div>`;
  col.appendChild(el);
}

// ============================================================
// How far may a block starting HERE run?
// ============================================================
//
// Three things can stop it, and until now none of them stopped anything until
// you pressed ยืนยัน and the database said no:
//
//   • the 5-hour ceiling;
//   • the edge of the session this block would sit in — one booking belongs to
//     exactly one session or its percentage means nothing;
//   • the next booking or the next session already on the board.
//
// WHY CLAMP RATHER THAN SPLIT. Consider 03:00–06:45 booked, which opens a
// session running to 08:00, and someone now wants 06:45–13:00. Splitting that
// into 06:45–08:00 + 08:00–13:00 automatically looks kind and is not: the two
// halves draw from DIFFERENT pools — the first from whatever the 03:00 session
// has left, the second from a fresh 100% — so one `pct` cannot describe both,
// and the system would have to invent the division. Worse, the first half can
// be REFUSED (that session may have 10% left) while the second succeeds,
// leaving half a booking nobody asked for.
//
// So the block stops at the edge, the edge is DRAWN and explained, and the
// second booking is offered as one tap with the remaining time already filled
// in. One press still makes one row; the boundary stays visible, which matters
// because it is real — it is how Claude meters, not a rule this app invented.
function limitsFor(startMs) {
  const span = sessionMs();
  let maxEnd = startMs + span;
  let reason = null;

  // Inside an existing session? Then this block belongs to it, and its edge is
  // the ceiling — that is the straddle the 0154 trigger refuses.
  const host = board.sessions.find((sn) => {
    const ss = new Date(sn.starts_at).getTime();
    return startMs >= ss && startMs < ss + span;
  });
  if (host) {
    const edge = new Date(host.starts_at).getTime() + span;
    if (edge < maxEnd) { maxEnd = edge; reason = 'session'; }
  } else {
    // Otherwise the next session's opening is the wall: a block reaching past
    // it would straddle that session's start.
    board.sessions.forEach((sn) => {
      const ss = new Date(sn.starts_at).getTime();
      if (ss > startMs && ss < maxEnd) { maxEnd = ss; reason = 'session'; }
    });
  }

  // And nothing may overlap an existing block — the exclusion constraint. Doing
  // this here as well as in the database is not a second implementation of the
  // rule; it is refusing to let someone DRAW something the rule forbids.
  board.bookings.forEach((b) => {
    if (editing && b.id === editing.id) return;
    const bs = new Date(b.starts_at).getTime();
    if (bs > startMs && bs < maxEnd) { maxEnd = bs; reason = 'booking'; }
  });

  // The quota week itself.
  if (weekEnd().getTime() < maxEnd) { maxEnd = weekEnd().getTime(); reason = 'week'; }

  return { maxEnd, reason };
}

/** Is this instant already inside somebody's block? Nothing may start there. */
function insideBooking(ms) {
  return board.bookings.some((b) => {
    if (editing && b.id === editing.id) return false;
    return ms >= new Date(b.starts_at).getTime() && ms < new Date(b.ends_at).getTime();
  });
}

// ============================================================
// Drag to select — and, with a finger, HOLD to select
// ============================================================
//
// A mouse presses without scrolling, so for a mouse this is unchanged: press,
// drag, release. A finger cannot — every scroll of this eight-day, 24-hour grid
// begins with a press on a day column, so a press alone cannot mean "book
// here". On an iPad it meant both, and the two failures that produced are in
// gesture.js: a tap opened the modal, and a scroll left the drag ARMED so the
// next tap anywhere — the week arrows at the top of the pane — opened it too.
//
// So a finger must hold still for HOLD_MS first. Holding still is the one thing
// a scroll never does.
let drag = null;      // a live selection
let pending = null;    // a finger waiting out the hold

const snapMin = (m) => Math.max(0, Math.min(1440, Math.round(m / SLOT_MIN) * SLOT_MIN));

/** Where in the week is this pointer, and may a selection start there?
 *  null when it may not — outside a column, on an existing booking, or in the
 *  hatched sliver that belongs to a neighbouring quota week. */
function seedFor(ev) {
  const col = ev.target.closest?.('.claude-daycol');
  if (!col || ev.target.closest('.claude-bk')) return null;
  const rect = col.getBoundingClientRect();
  const dayStart = Number(col.dataset.dayStart);
  const range = bookableRange(dayStart);
  const start = snapMin(((ev.clientY - rect.top) / hourH()) * 60);
  // Starting inside a hatched sliver means a different quota week. Refuse
  // outright rather than booking a block this view will not draw — the bug this
  // replaces let exactly that happen, silently.
  if (start < range.min || start >= range.max) return null;
  // A block already occupies this minute. Overlapping is refused by the
  // exclusion constraint, so let nobody draw one.
  if (insideBooking(dayStart + start * MIN_MS)) return null;
  return { col, rect, start, cur: start, dayStart, range };
}

function beginDrag(seed, ev, viaTouch) {
  drag = { ...seed, viaTouch };
  const box = document.createElement('div');
  box.className = 'claude-sel' + (viaTouch ? ' is-armed' : '');
  box.id = 'claudeSelBox';
  seed.col.appendChild(box);
  paintSel();
  try { seed.col.setPointerCapture(ev.pointerId); } catch { /* pointer already gone */ }
}

function clearPending() {
  if (!pending) return;
  clearTimeout(pending.timer);
  pending.col.classList.remove('is-holding');
  pending = null;
}

function onDragStart(ev) {
  clearPending();
  const intent = pressIntent(ev);
  if (intent === 'ignore') return;
  const seed = seedFor(ev);
  if (!seed) return;

  if (intent === 'drag') { beginDrag(seed, ev, false); return; }

  // A finger: arm, and let the browser keep the gesture until we know.
  pending = {
    ...seed,
    x: ev.clientX,
    y: ev.clientY,
    timer: setTimeout(() => {
      const seedNow = pending;
      if (!seedNow) return;
      seedNow.col.classList.remove('is-holding');
      pending = null;
      // A hold with no drag is already a complete gesture, so it produces a
      // real block rather than the 15-minute sliver a stray tap used to make.
      beginDrag({ ...seedNow, cur: seedNow.start + HOLD_MIN }, ev, true);
      // Android/desktop honour this; iOS ignores it silently. The visible
      // change of state is what actually tells everyone the hold took.
      navigator.vibrate?.(12);
    }, HOLD_MS),
  };
  seed.col.classList.add('is-holding');
}

function onDragMove(ev) {
  // Still waiting out the hold: any real movement means this was a scroll.
  if (pending) {
    if (movedTooFar(ev.clientX - pending.x, ev.clientY - pending.y)) clearPending();
    return;
  }
  if (!drag) return;
  drag.cur = snapMin(((ev.clientY - drag.rect.top) / hourH()) * 60);
  paintSel();
}

/**
 * The browser has taken the gesture over — almost always to scroll.
 *
 * Nothing was listening for this, and that is the whole of report #3: a
 * cancelled drag stayed armed, so the next `pointerup` ANYWHERE ran onDragEnd
 * and opened the booking modal. The pointerup listener is on `window` by
 * necessity (a drag may end outside the column), which is exactly what made the
 * stale state reachable from the other end of the pane.
 */
function onDragCancel() {
  clearPending();
  if (!drag) return;
  drag = null;
  $('claudeSelBox')?.remove();
}

/**
 * Refuse the browser's scroll, but only while a finger-selection is live.
 *
 * Deliberately NOT `touch-action: none` in the stylesheet: that would make the
 * calendar unscrollable with a finger, which is its own entry in this repo's
 * mistakes log. The hold only fires while the finger is STILL, so at that
 * moment no scroll has begun — and a scroll that has not begun can still be
 * refused. Once one is under way, preventDefault does nothing.
 */
function onTouchMove(ev) {
  if (shouldBlockScroll(drag)) ev.preventDefault();
}

function paintSel() {
  const box = $('claudeSelBox');
  if (!box || !drag) return;
  const maxMin = sessionMs() / MIN_MS;
  let a = Math.min(drag.start, drag.cur);
  let b = Math.max(drag.start, drag.cur);
  // Clamp to the part of this column that is inside the quota week.
  a = Math.max(a, drag.range.min);
  b = Math.min(b, drag.range.max);
  if (b - a < SLOT_MIN) b = Math.min(drag.range.max, a + SLOT_MIN);
  // Clamp to the 5-hour ceiling AT THE EDGE THE POINTER IS MOVING, so dragging
  // upward past the limit walks the start rather than freezing the selection.
  if (b - a > maxMin) {
    if (drag.cur >= drag.start) b = a + maxMin; else a = b - maxMin;
  }
  // …and to the first real wall past the start: a session edge, the next
  // booking, or the weekly reset. The same limitsFor() the modal uses, because
  // a rule enforced on one entry point is not enforced (class 4).
  const lim = limitsFor(drag.dayStart + a * MIN_MS);
  const maxB = (lim.maxEnd - drag.dayStart) / MIN_MS;
  const hitWall = b > maxB;
  if (hitWall) b = Math.max(a + SLOT_MIN, maxB);

  drag.a = a; drag.b = b;
  box.classList.toggle('is-capped', hitWall);
  box.style.top = `${yForMin(a)}px`;
  box.style.height = `${yForMin(b) - yForMin(a)}px`;
  box.textContent = `${pad(Math.floor(a / 60))}:${pad(a % 60)} – `
    + `${pad(Math.floor(b / 60) % 24)}:${pad(b % 60)} (${durLabel((b - a) * MIN_MS)})`
    + (hitWall ? ` · สุดขอบ${WALL_WORD[lim.reason] || ''}` : '');
}

const WALL_WORD = {
  session: 'เซสชัน',
  booking: 'การจองถัดไป',
  week: 'สัปดาห์',
};

function onDragEnd() {
  // A finger that let go before the hold fired was scrolling, or changed its
  // mind. Either way it books nothing — the tap-opens-the-modal bug.
  clearPending();
  if (!drag) return;
  const d = drag;
  drag = null;
  $('claudeSelBox')?.remove();
  if (d.a == null || d.b - d.a < SLOT_MIN) return;
  openModal({
    start: new Date(d.dayStart + d.a * MIN_MS),
    end: new Date(d.dayStart + d.b * MIN_MS),
  });
}

// ============================================================
// Modal
// ============================================================
function timeOptions(sel) {
  sel.innerHTML = '';
  for (let m = 0; m <= 1440; m += SLOT_MIN) {
    const o = document.createElement('option');
    o.value = String(m);
    o.textContent = m === 1440 ? '24:00' : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
    sel.appendChild(o);
  }
}

function openModal({ start, end, edit = null } = {}) {
  editing = edit;
  const s = edit ? new Date(edit.starts_at) : start;
  const e = edit ? new Date(edit.ends_at) : end;

  $('claudeModalTitle').textContent = edit ? 'แก้ไขการจอง' : 'จองโควตา Claude';
  $('claudeSave').textContent = edit ? 'บันทึกการแก้ไข' : 'ยืนยันการจอง';
  // Only offered when the row is actually deletable — the RLS policy admits
  // the owner or `master`, and a button that 42501s is worse than no button.
  $('claudeDelete').classList.toggle('d-none', !edit || !edit.is_mine);

  $('claudeDate').value = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
  timeOptions($('claudeStart'));
  timeOptions($('claudeEnd'));
  $('claudeStart').value = String(minsOfDay(s));
  $('claudeEnd').value = String(minsOfDay(s) + Math.round((e - s) / MIN_MS));
  $('claudePct').value = String(edit ? edit.pct : 30);
  $('claudePurpose').value = edit ? edit.purpose : '';
  $('claudePurpose').classList.remove('is-invalid');

  paintIdCard(edit);
  recalc();

  const el = $('claudeBookingModal');
  // ONE instance, reused. Constructing a second Modal over an already-open one
  // stacks a backdrop that never clears (mistakes.md, frontend-ui).
  modalRef = modalRef || new window.bootstrap.Modal(el);
  modalRef.show();
}

function paintIdCard(edit) {
  const host = $('claudeIdCard');
  // Editing shows whose booking it is; a new booking shows the signed-in
  // account — from `board.me`, which the server resolves through the same
  // projection as everyone else on the board.
  //
  // This used to hunt for a booking of yours in the week on screen and fall
  // back to the raw account when it found none, so browsing to a week you had
  // not booked in showed "Phuriphat Mahapromrak · ยังไม่มีตำแหน่งในผังทีม" for
  // the same person the current week named correctly. Identity is not a
  // property of which week is open.
  // An account with no ตำแหน่ง in the tree resolves to a projection with a null
  // name. That is not an identity, so it must not displace the account's own
  // name — otherwise the card reads "บัญชีที่ยังไม่มีตำแหน่งในผังทีม" for
  // somebody the sign-in screen greeted by name a moment ago.
  const me = board.me?.name ? board.me : null;
  const person = edit ? edit.person : me;
  const user = getUser();
  const name = person ? personName(person) : (user?.name || user?.email || 'บัญชีของคุณ');
  const dept = person ? personDept(person) : '';
  const color = person ? personColor(person) : 'var(--brand-primary)';
  const postings = (person?.postings || []).map((p) => p.node).filter(Boolean);

  host.style.setProperty('--claude-c', color);
  host.innerHTML =
    `<div class="claude-av">${escHtml((name || '?').trim().charAt(0))}</div>`
    + `<div><div class="claude-nm">${escHtml(name)}</div>`
    + (dept ? `<div class="claude-mt">${escHtml(dept)}</div>` : '')
    + (postings.length
      ? `<div class="claude-roles">${postings
          .map((p) => `<span class="claude-role-pill">${escHtml(p)}</span>`).join('')}</div>`
      : '<div class="claude-mt text-muted">ยังไม่มีตำแหน่งในผังทีม</div>')
    + '</div>';
}

/** The range currently in the form, as absolute Dates. */
function formRange() {
  const [y, m, d] = $('claudeDate').value.split('-').map(Number);
  const base = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  const s = new Date(base.getTime() + Number($('claudeStart').value) * MIN_MS);
  const e = new Date(base.getTime() + Number($('claudeEnd').value) * MIN_MS);
  return { s, e };
}

/**
 * Which server-derived session would this range land in?
 *
 * A PROJECTION of `board.sessions`, not a re-derivation: the rule lives in
 * claude_sessions() and is enforced by the INSERT trigger. This only answers
 * "of the sessions the server already sent, which one contains this range" so
 * the modal can show a number before the round trip. `editing` is excluded from
 * the used total because an edit-in-place must not count itself twice.
 */
function probeSession(s, e) {
  const span = sessionMs();
  const mine = editing ? editing.id : null;
  const host = board.sessions.find((sn) => {
    const ss = new Date(sn.starts_at).getTime();
    return s.getTime() >= ss && e.getTime() <= ss + span;
  });
  if (host) {
    const own = (mine && host.booking_ids.includes(mine))
      ? (editing.pct || 0) : 0;
    return { host, used: host.used_pct - own, isNew: false };
  }
  // Not inside any session — does it CROSS one? That is the straddle the
  // trigger refuses, and saying so here beats a 500 from the database.
  const straddled = board.sessions.find((sn) => {
    const ss = new Date(sn.starts_at).getTime();
    const se = new Date(sn.ends_at).getTime();
    const crosses = s.getTime() < se && e.getTime() > ss;
    const only = mine && sn.booking_ids.length === 1 && sn.booking_ids.includes(mine);
    return crosses && !only;
  });
  return { host: null, used: 0, isNew: true, straddled };
}

function recalc() {
  const pool = board.settings.session_pool_pct;
  const maxMin = sessionMs() / MIN_MS;

  let sMin = Number($('claudeStart').value);
  let eMin = Number($('claudeEnd').value);
  if (eMin <= sMin) { eMin = Math.min(1440, sMin + 60); $('claudeEnd').value = String(eMin); }
  if (eMin - sMin > maxMin) { eMin = sMin + maxMin; $('claudeEnd').value = String(eMin); }

  // The wall, applied to the SELECTS as well as to the drag. What the person
  // asked for is remembered, because the leftover is what the continuation
  // offer below is made of — clamping without keeping it would silently throw
  // away the half of the request the board cannot take.
  const dayBase = formRange().s.getTime() - sMin * MIN_MS;
  const lim = limitsFor(dayBase + sMin * MIN_MS);
  const wallMin = (lim.maxEnd - dayBase) / MIN_MS;
  const wanted = eMin;
  continuation = null;
  if (eMin > wallMin) {
    eMin = Math.max(sMin + SLOT_MIN, wallMin);
    $('claudeEnd').value = String(eMin);
    if (wanted - eMin >= SLOT_MIN) {
      continuation = {
        start: new Date(dayBase + eMin * MIN_MS),
        end: new Date(dayBase + wanted * MIN_MS),
        reason: lim.reason,
      };
    }
  }

  const { s, e } = formRange();
  const pr = probeSession(s, e);
  const remaining = pr.isNew ? pool : pool - pr.used;
  const cap = Math.max(5, remaining);

  const slider = $('claudePct');
  slider.max = String(cap);
  if (Number(slider.value) > cap) slider.value = String(cap);
  const pct = Number(slider.value);

  $('claudePctVal').textContent = `${pct}%`;
  $('claudePctMax').textContent = pr.isNew
    ? `เซสชันใหม่ — จองได้สูงสุด ${pool}%`
    : `เซสชันนี้เหลือ ${remaining}%`;

  // percent chips
  $('claudePctChips').innerHTML = '';
  [10, 25, 50, 75, 100].filter((v) => v <= cap).forEach((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'claude-chip' + (v === pct ? ' on' : '');
    b.textContent = `${v}%`;
    b.addEventListener('click', () => { slider.value = String(v); recalc(); });
    $('claudePctChips').appendChild(b);
  });

  const snStart = pr.host ? new Date(pr.host.starts_at) : s;
  const snEnd = new Date(snStart.getTime() + sessionMs());
  const snAfter = pr.used + pct;
  const weekAfter = board.week.used_pct - (editing ? editing.pct : 0) + pct;
  const tailMs = Math.max(0, snEnd.getTime() - e.getTime());

  $('claudeLedger').innerHTML = [
    ledgerRow('ช่วงที่จอง', `${hhmm(s)} – ${hhmm(e)} · ${durLabel(e - s)}`),
    ledgerRow('เซสชัน 5 ชม.',
      `${hhmm(snStart)} – ${hhmm(snEnd)}${pr.isNew ? ' (ใหม่)' : ''}`),
    ledgerRow('เซสชันนี้หลังจอง', `${snAfter}% / ${pool}%`, snAfter > pool ? 'bad' : 'good'),
    ledgerRow('เหลือให้คนอื่นจอง', `${Math.max(0, pool - snAfter)}% · อีก ${durLabel(tailMs)}`),
    ledgerRow('โควตาสัปดาห์หลังจอง',
      `${weekAfter}% / ${board.week.pool_pct}%`, weekAfter > board.week.pool_pct ? 'bad' : ''),
  ].join('');

  const notes = [];
  // The clamp, explained where it bit. Not an error: nothing is wrong, the
  // block simply stops at a real boundary — and the rest of what was asked for
  // is offered as the next booking rather than dropped on the floor.
  if (continuation) {
    const why = continuation.reason === 'booking'
      ? `มีคนจองต่อจาก <strong>${escHtml(hhmm(continuation.start))}</strong> อยู่แล้ว`
      : continuation.reason === 'week'
        ? `<strong>${escHtml(hhmm(continuation.start))}</strong> คือเวลารีเซ็ตโควตาสัปดาห์`
        : `เซสชัน 5 ชั่วโมงรอบนี้จบที่ <strong>${escHtml(hhmm(continuation.start))}</strong>`
          + ' — หนึ่งการจองต้องอยู่ในเซสชันเดียว โควตาคนละก้อนกัน';
    notes.push(noteHtml('info',
      `${why} จึงจองได้ถึง <strong>${escHtml(hhmm(continuation.start))}</strong> ก่อน`
      + `<br>กด “${escHtml($('claudeSave').textContent)}” แล้วระบบจะเปิดฟอร์มให้จองช่วง `
      + `<strong>${escHtml(hhmm(continuation.start))}–${escHtml(hhmm(continuation.end))}</strong>`
      + ' ต่อให้ทันที'));
  }
  if (pr.straddled && !continuation) {
    notes.push(noteHtml('crit',
      `ช่วงนี้คร่อมขอบเซสชันที่เริ่ม <strong>${escHtml(stampLabel(new Date(pr.straddled.starts_at)))}</strong>`
      + ' — หนึ่งการจองต้องอยู่ในเซสชัน 5 ชั่วโมงเดียว ลองเลื่อนเวลาเริ่ม'));
  }
  if (snAfter > pool) {
    notes.push(noteHtml('crit',
      `เกินโควตาเซสชัน ${snAfter - pool}% — ลดเหลือ ${Math.max(0, pool - pr.used)}% หรือย้ายไปเซสชันอื่น`));
  }
  if (weekAfter > board.week.pool_pct) {
    notes.push(noteHtml('crit',
      `เกินโควตาสัปดาห์ ${weekAfter - board.week.pool_pct}% — สัปดาห์นี้เหลือ `
      + `${board.week.pool_pct - board.week.used_pct}%`));
  }
  // The selects are a SECOND way into the range, so the week bounds have to be
  // checked here too and not only in the drag handler — a guard on one entry
  // point is not a guard (class 4).
  if (e.getTime() > weekEnd().getTime()) {
    notes.push(noteHtml('crit',
      'ช่วงนี้เลยเวลารีเซ็ตโควตาสัปดาห์ '
      + `(${stampLabel(weekEnd())}) — ไปที่สัปดาห์ถัดไปแล้วจองที่นั่น`));
  }
  if (s.getTime() < weekStart().getTime()) {
    notes.push(noteHtml('crit',
      `ช่วงนี้อยู่ก่อนเวลาเริ่มโควตาสัปดาห์นี้ (${stampLabel(weekStart())}) `
      + 'จึงนับเป็นโควตาของสัปดาห์ก่อน — กดปุ่มย้อนสัปดาห์แล้วจองที่นั่น'));
  }
  $('claudeNotes').innerHTML = notes.join('');

  // Only a CRITICAL note blocks the save. The continuation note is information
  // about a boundary the form has already respected — disabling ยืนยัน on it
  // would refuse the very booking it just made legal.
  $('claudeSave').disabled = notes.some((n) => n.includes('claude-note crit'));
}

const ledgerRow = (k, v, cls = '') =>
  `<div class="claude-ledger-row"><span class="claude-lk">${escHtml(k)}</span>`
  + `<span class="claude-lv ${cls}">${escHtml(v)}</span></div>`;

/** The icon follows the KIND. An info note wearing a warning triangle reads as
 *  a problem, and this one is the opposite — it is the form telling you it has
 *  already handled a boundary for you. */
const noteHtml = (kind, html) =>
  `<div class="claude-note ${kind}">`
  + `<i class="bi ${kind === 'info' ? 'bi-info-circle-fill' : 'bi-exclamation-triangle-fill'}"></i>`
  + `<div>${html}</div></div>`;

// ============================================================
// Write paths
// ============================================================
async function save() {
  const purpose = $('claudePurpose').value.trim();
  if (purpose.length < 3) {
    $('claudePurpose').classList.add('is-invalid');
    $('claudePurpose').focus();
    return;
  }
  const { s, e } = formRange();
  const row = {
    starts_at: s.toISOString(),
    ends_at: e.toISOString(),
    pct: Number($('claudePct').value),
    purpose,
  };

  const btn = $('claudeSave');
  btn.disabled = true;
  try {
    let saved;
    if (editing) {
      const { data, error } = await dbRest(`/claude_bookings?id=eq.${editing.id}`, {
        method: 'PATCH', body: row, prefer: 'return=representation',
      });
      if (error) throw new Error(readableError(error));
      // RLS does not RAISE on a blocked UPDATE — it returns zero rows. Without
      // this check a refused edit reads as a successful one.
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('บันทึกไม่สำเร็จ — บัญชีนี้อาจไม่มีสิทธิ์แก้ไขการจองนี้');
      }
      saved = data[0];
    } else {
      const user = getUser();
      const { data, error } = await dbRest('/claude_bookings', {
        method: 'POST', body: { ...row, user_id: user?.id }, prefer: 'return=representation',
      });
      if (error) throw new Error(readableError(error));
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('บันทึกไม่สำเร็จ — บัญชีนี้อาจไม่มีสิทธิ์จอง');
      }
      saved = data[0];
    }

    modalRef?.hide();
    const wasEdit = !!editing;
    const next = continuation;
    editing = null;
    continuation = null;
    await refresh();
    if (!wasEdit) notifyBooked(saved);

    // The half the session edge cut off, offered as its own booking with the
    // times already in place — announced BEFORE the save, so this is the thing
    // that was promised and not a surprise. The purpose carries over because it
    // is the same piece of work; only the pool is different.
    if (next) {
      const lim = limitsFor(next.start.getTime());
      const end = new Date(Math.min(next.end.getTime(), lim.maxEnd));
      if (end.getTime() - next.start.getTime() >= SLOT_MIN * MIN_MS) {
        openModal({ start: next.start, end });
        $('claudePurpose').value = purpose;
        recalc();
      }
    }
  } catch (err) {
    $('claudeNotes').innerHTML = noteHtml('crit', escHtml(err.message || String(err)));
  } finally {
    btn.disabled = false;
  }
}

/** The trigger's messages are already written for a person to read, so surface
 *  them instead of a status code. Anything else falls back to plain language. */
function readableError(error) {
  const raw = error?.message || '';
  try {
    const body = JSON.parse(raw);
    if (body?.message) {
      if (String(body.message).includes('claude_bookings_no_overlap')) {
        return 'ช่วงเวลานี้ทับกับการจองอื่นที่มีอยู่แล้ว';
      }
      if (String(body.message).includes('claude_bookings_span_max')) {
        return 'จองได้ครั้งละไม่เกิน 5 ชั่วโมง';
      }
      return body.message;
    }
  } catch { /* not JSON — fall through */ }
  return raw || 'บันทึกไม่สำเร็จ';
}

async function removeBooking() {
  if (!editing) return;
  const ok = await askDelete('การจองนี้',
    `${stampLabel(new Date(editing.starts_at))} · ${editing.pct}%`);
  if (!ok) return;
  const id = editing.id;
  const { data, error } = await dbRest(`/claude_bookings?id=eq.${id}`, {
    method: 'DELETE', prefer: 'return=representation',
  });
  if (error) {
    $('claudeNotes').innerHTML = noteHtml('crit', escHtml(readableError(error)));
    return;
  }
  // RLS returns zero rows rather than an error on a blocked DELETE — the
  // repo-wide rule enforced by delete-guard.test.js.
  if (!Array.isArray(data) || data.length === 0) {
    $('claudeNotes').innerHTML =
      noteHtml('crit', 'ลบไม่สำเร็จ — บัญชีนี้อาจไม่มีสิทธิ์ลบการจองนี้');
    return;
  }
  modalRef?.hide();
  editing = null;
  await refresh();
}

/** Fire-and-forget, exactly like PR / VS. The queue serialises and logs it;
 *  a dropped notification must never block or fail a save that succeeded. */
function notifyBooked(rowFromDb) {
  const b = board.bookings.find((x) => x.id === rowFromDb?.id);
  const person = b?.person || null;
  const s = new Date(rowFromDb.starts_at);
  const e = new Date(rowFromDb.ends_at);
  const sn = board.sessions.find((x) => (x.booking_ids || []).includes(rowFromDb.id));
  const pool = board.settings.session_pool_pct;
  sendNotify('claude', {
    who: person ? personName(person) : (getUser()?.name || ''),
    dept: person ? personDept(person) : '',
    roles: (person?.postings || []).map((p) => p.node).filter(Boolean).join(' · '),
    when: `${fullDate(s)} ${hhmm(s)}–${hhmm(e)}`,
    duration: durLabel(e - s),
    pct: rowFromDb.pct,
    sessionLeft: sn ? Math.max(0, pool - sn.used_pct) : pool - rowFromDb.pct,
    purpose: rowFromDb.purpose,
    weekUsed: board.week.used_pct,
    weekPool: board.week.pool_pct,
  });
}
