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
import { getUser, getRole, holdsMaster } from '../auth.js';
import { escHtml } from '../utils.js';
import { askConfirm } from '../confirm-modal.js';
import { sendNotify } from '../notify.js';
import {
  dayColumnsFor, bookableRangeFor, startOfDay, carve, mergeBands, bookingLayout,
} from './week.js';
import {
  pressIntent, movedTooFar, shouldBlockScroll, HOLD_MS, HOLD_MIN,
} from './gesture.js';
import { paintUsageLog, paintFreeNow } from './usage.js';
import {
  canEditMonitor, monitorState, staleAfterMs, pauseAge, pauseNeedsRelogin,
} from './monitor.js';
// Every formatter and the ฝ่าย colour live in ONE module, shared with
// usage.js. Two copies of "what colour is this person" is the drift class
// this repo pays for most.
import {
  pad, hhmm, minsOfDay, THAI_DOW, THAI_DOW_FULL, fullDate, stampLabel, durLabel, pctText,
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
let monitorRef = null;             // ditto, for the measurement on/off dialog
let termsRef = null;               // the ข้อตกลง modal, also reused
let continuation = null;           // the tail a wall cut off, if any

// The server's answer for the range currently in the form, and the range it was
// asked about. Keeping the KEY beside the answer is the whole point: without it
// a stale reply for a range somebody has already changed would cap the slider
// at the wrong number, silently.
let limits = null;
let limitsKey = null;
let limitsTimer = null;
let limitsSeq = 0;                 // late replies lose

// The measured log for the week on screen, fetched once and shared by the
// collapsible panel and the calendar overlay. Two fetches of one payload is a
// second implementation of "which week are we looking at".
let usageData = null;
let usageWeek = null;

const $ = (id) => document.getElementById(id);

// ── remembered view choices ───────────────────────────────────────────────
// localStorage and not a column: these are about this DEVICE (a phone wants the
// compressed grid, a desktop does not), so storing them per account would make
// one choice fight the other.
const LS_FIT  = 'claude.cal.fit';
const LS_HIST = 'claude.cal.hist';
const LS_TERMS = 'claude.terms.seen';
const LS_SILENT = 'claude.notify.silent';
/** Bump when the ข้อตกลง text changes materially — everyone sees it again. */
const TERMS_VERSION = '2026-08-17';

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

let fitMode = lsGet(LS_FIT) === '1';
let histMode = lsGet(LS_HIST) === '1';

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
  applyFit();
  paintViewToggles();
  paintSilentToggle();
  startPolling();
  // The rules open by themselves the first time an account reaches this pane,
  // and again whenever the text changes. "Make sure everyone sees it" cannot be
  // a link somebody might click.
  if (!termsSeen()) openTerms();
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
  // A cached log belongs to the week it was fetched for. Keeping it across a
  // week change would draw last week's measurements over this week's grid.
  if (weekChanged) { usageData = null; usageWeek = null; }
  // Keep the date picker on the week actually being shown, so re-opening it
  // starts where the reader is rather than where they last typed.
  const wsFor = new Date(weekStart().getTime() + 12 * HOUR_MS);
  $('claudeJump').value =
    `${wsFor.getFullYear()}-${pad(wsFor.getMonth() + 1)}-${pad(wsFor.getDate())}`;

  paintMonitor();
  paintFreeNow($('claudeNow'), board.right_now, board.week.is_current === false);
  paintWeekMeter();
  if (weekChanged || !gridBuilt) {
    applyFit();
    buildGrid();
    gridBuilt = true;
  }
  // The overlay needs the log; ask for it once and repaint when it lands rather
  // than blocking the board on a second RPC.
  if (histMode && !usageData) {
    ensureUsage().then(() => paintGrid()).catch(() => {});
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
    // Through the shared cache, so the panel and the calendar overlay cannot
    // end up describing two different weeks.
    const data = await ensureUsage({ force: quiet });
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
    // …and neither may it repaint while somebody is typing a pause reason.
    // Same rule as the line above, and the reason it needs its own line is that
    // the line above names ONE modal by id: a second modal on this pane is
    // invisible to it. Any third one must be added here too.
    if ($('claudeMonitorModal')?.classList.contains('show')) return;
    refresh({ quiet: true });
  }, 60000);
}

function wire() {
  $('claudePrevWeek').addEventListener('click', () => shiftWeek(-1));
  $('claudeNextWeek').addEventListener('click', () => shiftWeek(1));
  $('claudeThisWeek').addEventListener('click', () => { weekAnchor = null; refresh(); });

  // Jump to the week containing a date, instead of tapping an arrow eight
  // times. Noon and not midnight: the quota week starts at 16:00, so a date at
  // 00:00 lands in the PREVIOUS week for that day and the picker would send you
  // somewhere you did not ask for on eight days out of every fifty-six.
  // ON A DESKTOP THE OVERLAY IS NOT ENOUGH. A transparent <input type="date">
  // laid over the label opens the platform picker on a phone and an iPad, where
  // tapping the FIELD opens it — but on a desktop browser the field only takes
  // focus, and the calendar is opened by the small indicator icon, which is
  // exactly the thing opacity:0 makes unclickable. Reported as *"i can select
  // calendar in mobile, but i can't in computer"*.
  //
  // showPicker() is the API for "open it now", and the click IS the user
  // gesture it requires. It throws where it is unsupported or already open, and
  // in both of those cases the native behaviour is what we already had.
  $('claudeJump').addEventListener('click', (ev) => {
    try { ev.currentTarget.showPicker(); } catch { /* older browser, or already open */ }
  });
  $('claudeJump').addEventListener('change', (ev) => {
    const v = ev.target.value;
    if (!v) return;
    const [y, m, d] = v.split('-').map(Number);
    weekAnchor = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
    refresh();
  });

  // A manual re-read. Throttled, because the thing underneath it only moves
  // every 15 minutes and a button somebody can hold down is a button somebody
  // will hold down.
  $('claudeRefresh').addEventListener('click', manualRefresh);

  // The measurement on/off control (0167). The listener is wired ONCE here,
  // but who may use it is decided in paintMonitor(), which runs on every
  // refresh — the account switcher swaps the signed-in user without reloading,
  // so a permission read taken at wire() goes stale exactly as the silent-
  // booking toggle's did.
  $('claudeMonitor').addEventListener('click', openMonitorDialog);
  $('claudeMonitorSave').addEventListener('click', saveMonitor);
  // The DB refuses a pause with no reason; the button refuses first, so nobody
  // meets a 400 at the end of a form. Same rule, stated twice on purpose —
  // one of them is the gate and one of them is the manners.
  $('claudeMonitorReason').addEventListener('input', paintMonitorDialog);

  $('claudeFitToggle').addEventListener('click', () => {
    fitMode = !fitMode;
    lsSet(LS_FIT, fitMode ? '1' : '0');
    applyFit();
    buildGrid();
    paintGrid();
  });
  $('claudeHistToggle').addEventListener('click', () => {
    histMode = !histMode;
    lsSet(LS_HIST, histMode ? '1' : '0');
    paintViewToggles();
    if (histMode) ensureUsage().then(() => paintGrid()).catch(() => paintGrid());
    else paintGrid();
  });

  // The cap "พอดีจอ" divides is a CSS max-height with a mobile breakpoint, so
  // rotating a tablet changes the right answer. Recompute on resize — but only
  // when the mode is on, and only after the browser has settled, or every
  // intermediate width during a drag repaints the grid.
  let fitTimer = null;
  window.addEventListener('resize', () => {
    if (!fitMode || !board) return;
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => { applyFit(); buildGrid(); paintGrid(); }, 200);
  });

  $('claudeTermsOpen').addEventListener('click', () => openTerms());
  $('claudeTermsOk').addEventListener('click', () => {
    lsSet(LS_TERMS, TERMS_VERSION);
    termsRef?.hide();
  });
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
  $('claudeHelp').innerHTML = (coarse
    ? '<strong>แตะค้างไว้</strong>บนตารางแล้วลากเพื่อเลือกช่วงเวลา '
      + '(แตะเฉย ๆ ใช้เลื่อนดูตารางได้ตามปกติ) — '
    : 'ลากบนตารางเพื่อเลือกช่วงเวลา — ')
    // The dashed box is the RULE, drawn. One 5-hour pot is opened by whoever
    // starts first and shared by everyone inside it; the box hangs off the
    // bottom of the block that opened it and covers exactly the time still
    // open, which is the question somebody looking at the week is asking.
    + '<strong>กล่องเส้นประใต้การจอง</strong> คือช่วงที่ยัง<strong>จองต่อได้</strong> '
    + 'ในรอบ 5 ชั่วโมงเดียวกัน (บอกว่าเหลือกี่ % และรอบนั้นจบเมื่อไร) '
    + 'เส้นประ<strong>สีแดง</strong>แปลว่าเวลาว่างแต่โควตาหมดแล้ว จองเพิ่มไม่ได้ '
    + '<strong>รอบที่มีคนจองเป็นของผู้จอง</strong> ช่วงที่ไม่มีใครจอง ใครใช้ก็ได้ '
    + '<a href="#" class="claude-terms-link" id="claudeTermsInline">อ่านข้อตกลง</a>';
  // The rail has no meaning until it is named. A colour down the edge of a
  // calendar that nobody can read is decoration, however correct the number
  // behind it is.
  //
  // It is deliberately NOT drawn inside a 5-hour window any more — there the
  // block and the dashed box already answer it — so the key says where it
  // applies rather than leaving a reader to wonder why it stops.
  $('claudeHelp').innerHTML += '<br><span class="claude-rail-key">'
    + '<i class="claude-free is-full"></i>แถบด้านซ้ายของแต่ละวันบอกว่า '
    + '<strong>ถ้าเริ่มใช้ตอนนั้น จะได้กี่เปอร์เซ็นต์</strong> โดยไม่ต้องจอง — '
    + 'เขียวคือได้เต็มรอบ '
    + '<i class="claude-free is-part"></i>เหลืองคือได้เกินครึ่งรอบ '
    + '<i class="claude-free is-low"></i>น้ำตาลคือเหลือน้อย '
    + '<i class="claude-free is-none"></i>แดงคือไม่เหลือ '
    + '<i class="claude-free is-held"></i>ลายทแยงคือช่วงที่มีคนจองไว้ '
    + 'ส่วนในรอบ 5 ชั่วโมงที่มีคนจอง ให้ดูที่กล่องเส้นประแทน</span>';
  $('claudeTermsInline')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    openTerms();
  });

  // The percentage is LOCAL — its ceiling was already fetched for this range,
  // so dragging the slider must not fire a request per pixel. Date and times
  // change the range, and the range is what the server has to be asked about.
  ['claudeDate', 'claudeStart', 'claudeEnd', 'claudePct'].forEach((id) => {
    $(id).addEventListener('input', recalc);
    $(id).addEventListener('change', recalc);
  });
  $('claudeSave').addEventListener('click', save);
  $('claudeDelete').addEventListener('click', removeBooking);

  // `editing` was cleared only on a SUCCESSFUL save or delete, so dismissing
  // the modal with ยกเลิก or the X left it pointing at that booking. Both
  // limitsFor() and insideBooking() deliberately skip the row being edited —
  // so after closing someone's block you could drag a selection straight
  // across it and the clamp said nothing. (The database still refused it on
  // save, and openModal() resets `editing` before the form opens, so nothing
  // was ever written wrongly; the drag preview simply lied.)
  //
  // Bootstrap fires this for every close path there is, which is the point:
  // one place to clear it beats finding all four buttons.
  // Only master holders see it at all. It is a convenience for the people who
  // maintain this board, not a way for a booker to hide a claim on shared quota.
  // The change listener is wired ONCE here; its VISIBILITY is (re)decided on
  // every entry by paintSilentToggle() — because the account switcher does not
  // reload, a holdsMaster() read taken once at wire() goes stale the moment the
  // signed-in account changes. Wiring the listener here (not in the per-entry
  // paint) avoids stacking one listener per entry.
  $('claudeSilent').addEventListener('change', (ev) => {
    lsSet(LS_SILENT, ev.target.checked ? '1' : '0');
  });

  $('claudeBookingModal').addEventListener('hidden.bs.modal', () => {
    editing = null;
    continuation = null;
  });
}

// ============================================================
// Toolbar — refresh, the two view switches, the ข้อตกลง
// ============================================================

/**
 * A manual re-read.
 *
 * WHAT IT CAN AND CANNOT DO, because the difference matters and the button
 * would otherwise promise the wrong thing: it re-reads what is already IN the
 * database. It does not ask Claude. The sample lands from a timer on the VM
 * every 15 minutes and nothing in a browser can make that happen sooner.
 *
 * So it says how old the reading is afterwards. A refresh button that returns
 * the identical number with no explanation is read as broken, and the honest
 * explanation — "this is as fresh as it gets, and here is how fresh that is" —
 * is exactly what somebody staring at a stale gauge needs to be told.
 *
 * Throttled to 5 s: below that it is answering a held-down finger, not a
 * question.
 */
let lastManual = 0;
async function manualRefresh() {
  const btn = $('claudeRefresh');
  const since = Date.now() - lastManual;
  if (since < 5000) return;
  lastManual = Date.now();
  btn.disabled = true;
  btn.classList.add('is-spinning');
  usageData = null;                     // the log must be re-read too
  try {
    await refresh();
    if (usageOpen || histMode) await ensureUsage({ force: true }).catch(() => {});
    if (histMode) paintGrid();
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-spinning');
  }
  const m = board?.measured;
  const age = m ? Date.now() - new Date(m.sampled_at).getTime() : null;
  $('claudeHistNote').textContent = m
    ? `อ่านข้อมูลล่าสุดแล้ว — ตัวเลข “ใช้จริง” จาก Claude อัปเดต${ago(age)} (ทุก 15 นาที)`
    : 'อ่านข้อมูลล่าสุดแล้ว — ยังไม่มีข้อมูลการใช้จริงจาก Claude';
}

/**
 * "พอดีจอ" — squeeze 24 hours into the height that is actually on screen.
 *
 * WHY A TOGGLE AND NOT A REDESIGN. Every calendar people already use — Google,
 * Outlook, Notion — scrolls a tall day and opens near the working hours, and it
 * does that because a block has to be big enough to carry a name and a time.
 * Compressing 24 hours into a phone screen makes a 45-minute booking four
 * pixels tall. So the scrolled view stays the default and this is the answer to
 * the other, real question — "let me see the whole week at once" — which is a
 * DIFFERENT need, not a better version of the same one.
 *
 * The hour height is a CSS variable that every piece of geometry here already
 * reads through hourH(), so this is one number and a repaint.
 */
function applyFit() {
  const tab = document.querySelector('.claude-tab');
  const scroller = $('claudeCalScroll');
  if (!tab || !scroller) return;
  if (fitMode) {
    // DO NOT MEASURE THE SCROLLER'S OWN HEIGHT. It is `max-height: 620px` with
    // `overflow: auto`, so while the content is shorter than the cap its
    // clientHeight IS the content height — and sizing the content from it is a
    // feedback loop. Measured, with the toggle remembered across a reload: the
    // grid shrank, the scroller shrank with it, the next pass shrank it again,
    // and it settled on the 16px floor with two thirds of the card empty.
    //
    // The CAP is the fixed quantity, so read that. It is also where the mobile
    // breakpoint lives (480px), which this then follows for free.
    const capRaw = parseFloat(getComputedStyle(scroller).maxHeight);
    const cap = Number.isFinite(capRaw) ? capRaw : window.innerHeight * 0.7;
    // The head row is sticky but still part of scrollHeight, so its height has
    // to come off the top. Read it rather than assume it — it carries two lines
    // of Thai and grows with the font.
    const headH = $('claudeCalHead')?.getBoundingClientRect().height || 46;
    // 16px is the floor at which a block can still show its percentage. Below
    // that the compressed view stops being a calendar and becomes a bar chart,
    // and letting it scroll a little is the better failure.
    tab.style.setProperty('--claude-hour-h', `${Math.max(16, (cap - headH - 2) / 24)}px`);
  } else {
    tab.style.removeProperty('--claude-hour-h');
  }
  paintViewToggles();
}

function paintViewToggles() {
  $('claudeFitToggle')?.setAttribute('aria-pressed', String(fitMode));
  $('claudeFitToggle')?.classList.toggle('on', fitMode);
  $('claudeHistToggle')?.setAttribute('aria-pressed', String(histMode));
  $('claudeHistToggle')?.classList.toggle('on', histMode);
  document.querySelector('.claude-cal-shell')?.classList.toggle('is-hist', histMode);
  if (!histMode) $('claudeHistNote').textContent = '';
}

/**
 * Show/hide the master-only "จองแบบเงียบ" toggle for the CURRENT account.
 * Re-run on every entry (not just once at wire()) because the account switcher
 * swaps the signed-in user without reloading the page — a holdsMaster() read
 * taken once at wire() would leave the toggle visible to a non-master who
 * switched in, or hidden from a master who did. The send-time gate re-checks
 * holdsMaster() regardless, so this is purely the visible-control half.
 */
function paintSilentToggle() {
  const master = holdsMaster();
  $('claudeSilentWrap')?.classList.toggle('d-none', !master);
  if ($('claudeSilent')) $('claudeSilent').checked = master && lsGet(LS_SILENT) === '1';
}

/**
 * The measured log for the week on screen, fetched once.
 *
 * Both the collapsible panel and the calendar overlay need it, and two fetches
 * of one payload would be two answers to "which week are we looking at" — the
 * class this repo pays for most. Cached against the week it belongs to, so
 * browsing weeks re-reads and browsing back does not.
 */
async function ensureUsage({ force = false } = {}) {
  const wk = board?.week?.starts_at || null;
  if (!force && usageData && usageWeek === wk) return usageData;
  const { data, error } = await dbRest('/rpc/get_claude_usage_log', {
    method: 'POST',
    body: { p_at: (weekAnchor || new Date()).toISOString() },
  });
  if (error) throw new Error(error.message || `HTTP ${error.status}`);
  usageData = data;
  usageWeek = wk;
  return data;
}

/**
 * ข้อตกลง — opened by the button, and BY ITSELF the first time an account
 * reaches this pane or whenever TERMS_VERSION moves.
 *
 * Acceptance is a localStorage key and nothing more, and the modal says as much
 * by having one button. Storing it server-side would make it look like a
 * signature the owner could audit, which is a promise this does not keep — the
 * honest object here is a reminder that the rules exist and where to re-read
 * them.
 */
function openTerms() {
  const el = $('claudeTermsModal');
  if (!el) return;
  // The reset moment is a SETTING (claude_settings.week_reset_dow/time), so the
  // ข้อตกลง has to READ it rather than repeat it. A rule sheet that says
  // Wednesday while the database says Sunday is worse than no rule sheet.
  if (board?.week?.ends_at) {
    $('claudeTermsReset').textContent =
      `ทุกวัน${THAI_DOW_FULL[weekEnd().getDay()]} ${hhmm(weekEnd())} น.`;
  }
  $('claudeTermsVer').textContent = `ฉบับ ${TERMS_VERSION}`;
  // ONE instance, reused — constructing a second Modal over an already-open one
  // stacks a backdrop that never clears (mistakes.md, frontend-ui).
  termsRef = termsRef || new window.bootstrap.Modal(el);
  termsRef.show();
}

/** Has this device seen the current text? */
const termsSeen = () => lsGet(LS_TERMS) === TERMS_VERSION;

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
  // THIS CARD DESCRIBES THE WEEK ON SCREEN, and every number in it comes from
  // `board.week`, which the server scoped to exactly that week (0156).
  //
  // It used to read `right_now`, which is a fact about NOW — so browsing two
  // weeks ahead still printed "287 / 700% ใช้ไปแล้วจริง" for a pool that will
  // have reset twice before that week starts. Reported as "in next next week,
  // it still show ใช้ไปแล้วจริง value, which it would be reset by then".
  //
  // A future week measures NULL, not 0: a zero draws an empty bar and reads as
  // "nothing used yet", which is the same bug wearing a plausible number.
  const measuredUsed = board.week.measured_used_pct;
  const haveMeasured = measuredUsed != null;
  const isCurrent = board.week.is_current !== false;

  // ── THE THREE STATES, NAMED ────────────────────────────────────────────
  // "ใช้ไปแล้ว …% จองไว้ …% ว่าง …%" — asked for in exactly those words, and
  // they are the three the pool actually has. They add up to the pool by
  // construction, which is the only reason three separate figures are readable
  // instead of three numbers to reconcile:
  //
  //   ใช้ไปแล้ว = MEASURED. What Claude says the account really spent.
  //   จองไว้    = RESERVED. Blocks that have not finished yet. A block that has
  //               already run is NOT counted here — its cost is inside ใช้ไปแล้ว
  //               and counting it twice is the 0158 bug one layer up.
  //   ว่าง      = what is left over, i.e. nobody's.
  //
  // Without a measurement (a future week) there is no ใช้ไปแล้ว to state, so it
  // says so rather than drawing a zero — a zero reads as a reading — and จองไว้
  // becomes every booking in that week, none of which has run.
  const usedReal = haveMeasured ? Number(measuredUsed) : null;
  const bookedPct = haveMeasured ? Number(board.week.reserved_pct) : used;
  const freeLeft = haveMeasured
    ? Math.max(0, Number(board.week.measured_left_pct) - bookedPct)
    : Math.max(0, pool - bookedPct);

  $('claudeWeekUsed').textContent = haveMeasured ? Math.round(usedReal) : '—';
  $('claudeWeekPool').textContent = pool;
  $('claudeWeekWhat').textContent = haveMeasured
    ? 'ใช้ไปแล้ว'
    : (isCurrent ? 'ยังไม่มีข้อมูลใช้จริง' : 'ยังไม่ถึงสัปดาห์นั้น');
  $('claudeWeekUsedBlock').classList.toggle('is-unknown', !haveMeasured);

  $('claudeWeekBooked').innerHTML =
    `<span class="claude-week-fig">${pctText(bookedPct)}</span>`
    + '<div class="claude-week-fig-k">จองไว้</div>';
  $('claudeWeekBooked').title =
    `มีผู้จองไว้แล้วและยังไม่ได้ใช้ ${pctText(bookedPct)} จากโควตาสัปดาห์ ${pool}%`;

  // ว่าง IS ALWAYS GREEN, and that is a colour-key decision rather than a
  // cosmetic one. The three figures key to the three bar segments by colour, so
  // if "ว่าง" turned amber when it ran low it would be the same colour as
  // "จองไว้" and the key would say two things at once. The running-low signal
  // moves onto the sub-line, which is not part of the key.
  const freeSessions = freeLeft / board.settings.session_pool_pct;
  const freeTone = freeSessions >= 1 ? '' : freeSessions > 0 ? ' is-low' : ' is-none';
  $('claudeWeekFree').className = 'claude-week-fig-block is-free';
  $('claudeWeekFree').innerHTML =
    `<span class="claude-week-fig">${pctText(freeLeft)}</span>`
    + `<span class="claude-week-of${freeTone}"> = ${freeSessions.toFixed(1)} เซสชัน</span>`
    + '<div class="claude-week-fig-k">ว่าง</div>';

  $('claudeWeekLabel').textContent =
    `${fullDate(weekStart())} ${hhmm(weekStart())} – ${fullDate(weekEnd())} ${hhmm(weekEnd())}`;
  $('claudeResetAt').textContent = stampLabel(weekEnd());

  const left = weekEnd().getTime() - Date.now();
  $('claudeResetIn').textContent = left > 0
    ? `(อีก ${Math.floor(left / DAY_MS)} วัน ${Math.floor((left % DAY_MS) / HOUR_MS)} ชม.)`
    : '';

  // THE BAR IS THE SAME THREE STATES, in the same order as the figures above
  // it: spent (measured), promised to somebody, free. The per-person split
  // survives inside the promised segment and in the legend, so whose claim it
  // is stays visible without being the first thing read.
  const measured = haveMeasured;

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
  // The free remainder gets a segment of its own rather than being whatever the
  // track happens to look like. Three states, three colours, and the figures
  // above key to them: clay = used, ฝ่าย/amber = booked, green = free.
  seg(freeLeft, 'is-free-seg', null, `ว่าง — ${pctText(freeLeft)}`);
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

  // THE LEGEND IS ONLY THE PEOPLE NOW.
  //
  // It used to restate ใช้ไปแล้ว and ว่าง underneath figures that had just said
  // the same two numbers a centimetre above, so the card printed each of them
  // twice and neither copy was clearly the one attached to the bar. The three
  // figures carry a colour key of their own (see .claude-week-fig-block::before)
  // and sit in the SAME left-to-right order as the bar's segments, which is what
  // ties a number to its stripe at any width — an in-bar label cannot, because a
  // segment is 2% wide as often as it is 50%.
  //
  // What is left here is the one thing the figures genuinely cannot say: WHOSE
  // the middle number is.
  const legend = $('claudeLegend');
  const people = [...perPending.entries()].sort((a, b) => b[1].pct - a[1].pct);
  legend.innerHTML = people.length
    ? '<span class="claude-legend-k">จองไว้โดย</span>'
      + people.map(([name, v]) => '<span class="claude-legend-item">'
        + `<span class="claude-swatch" style="background:${v.color}"></span>`
        + `${escHtml(name)} · <b>${v.pct}%</b></span>`).join('')
    : '<span class="claude-legend-k">ยังไม่มีการจองในสัปดาห์นี้</span>';

  paintMeasured();
}

// ============================================================
// The measurement on/off switch (migration 0167)
// ============================================================

/**
 * The status pill: is the account's usage actually being measured?
 *
 * VISIBLE TO EVERYONE WITH THE `claude` GRANT, not only to admins. The state
 * this replaced is the argument: for three days the reporter posted an alert
 * into Discord four times a day and the board went on drawing a four-day-old
 * reading, and nobody looking at the page could tell. Whether the numbers are
 * live is a fact about the page, not an administrative detail.
 *
 * Only a vp_admin / dev / master gets a working button — mirroring
 * `claude_settings_write`, so nobody is handed a form whose save is refused.
 * Re-evaluated on every refresh() rather than once at wire(): the account
 * switcher changes the signed-in user without reloading the page.
 */
function paintMonitor() {
  const btn = $('claudeMonitor');
  if (!btn) return;
  const st = monitorState(board);
  const may = canEditMonitor({ role: getRole(), master: holdsMaster() });

  btn.hidden = false;
  btn.classList.toggle('is-off', !st.enabled);
  btn.disabled = !may;
  // A pill nobody can press is not a button, and announcing it as one sends a
  // screen reader looking for an action that is not there.
  btn.setAttribute('aria-disabled', String(!may));

  const age = st.enabled ? '' : pauseAge(st.changedAt);
  btn.innerHTML = st.enabled
    ? '<i class="bi bi-activity" aria-hidden="true"></i><span>ติดตามการใช้งานจริงอยู่</span>'
    : '<i class="bi bi-pause-circle" aria-hidden="true"></i>'
      + `<span>หยุดติดตามชั่วคราว${age ? ` · ${escHtml(age)}` : ''}</span>`;
  btn.title = st.enabled
    ? (may ? 'ตัวเลข “ใช้จริง” กำลังอัปเดตทุก 15 นาที — กดเพื่อหยุดชั่วคราว'
           : 'ตัวเลข “ใช้จริง” กำลังอัปเดตทุก 15 นาที')
    : (st.note || 'หยุดติดตามการใช้งานจริงไว้ชั่วคราว');
}

/** Open the dialog, with the fields set from the state we are leaving. */
function openMonitorDialog() {
  const st = monitorState(board);
  // The reason box starts holding the CURRENT reason when pausing is not what
  // is about to happen — resuming keeps it so the Discord notice can say what
  // it had been off for, and editing a live pause should not make you retype
  // the sentence you already wrote.
  $('claudeMonitorReason').value = st.note;
  paintMonitorDialog();
  const el = $('claudeMonitorModal');
  // ONE instance, reused. `new bootstrap.Modal(el).show()` on an already-open
  // modal stacks a second backdrop that nothing removes
  // (docs/mistakes/frontend-ui.md).
  monitorRef = monitorRef || new window.bootstrap.Modal(el);
  monitorRef.show();
}

/**
 * Everything in the dialog that depends on state, in one function called from
 * both open and every keystroke.
 *
 * Two passes over one control is a bug class this pane has already paid for
 * (the second pass silently unlocked a checkbox the first had locked), so the
 * save button's label, colour and disabled state are all decided here and
 * nowhere else.
 */
function paintMonitorDialog() {
  const st = monitorState(board);
  const turningOff = st.enabled;                 // the dialog always flips it
  const reason = $('claudeMonitorReason').value.trim();
  const save = $('claudeMonitorSave');

  $('claudeMonitorTitle').textContent = turningOff
    ? 'หยุดติดตามการใช้งานจริงชั่วคราว'
    : 'กลับมาติดตามการใช้งานจริง';

  $('claudeMonitorLede').textContent = turningOff
    ? 'ระบบจะหยุดอ่านข้อมูลการใช้งานจากบัญชี Claude และตัวเลข “ใช้จริง” '
      + 'จะหายไปจากกระดาน — ทุกคนยังจองช่วงเวลาได้ตามปกติ'
    : 'ระบบจะกลับไปอ่านข้อมูลการใช้งานจากบัญชี Claude ทุก 15 นาที '
      + 'และตัวเลข “ใช้จริง” จะกลับมาแสดงอีกครั้ง';

  // The reason belongs to the OFF direction. On resume it is shown as
  // read-only context in the lede instead of asking for it again.
  $('claudeMonitorReasonWrap').hidden = !turningOff;

  const warn = $('claudeMonitorWarn');
  if (turningOff) {
    warn.className = 'claude-mon-warn mt-3 is-note';
    warn.innerHTML = '<i class="bi bi-info-circle" aria-hidden="true"></i>'
      + '<span>ถ้าหยุดนานเกิน 12 วัน สิทธิ์เข้าถึงบัญชี Claude จะหมดอายุ '
      + 'และตอนเปิดกลับมาต้อง ssh เข้าเซิร์ฟเวอร์เพื่อ <code>claude login</code> อีกครั้ง</span>';
  } else if (pauseNeedsRelogin(st.changedAt)) {
    // Not a guess: this is exactly the condition the reporter's header
    // describes, and telling somebody afterwards is a post-mortem.
    warn.className = 'claude-mon-warn mt-3 is-warn';
    warn.innerHTML = '<i class="bi bi-exclamation-triangle" aria-hidden="true"></i>'
      + `<span>หยุดมานาน ${escHtml(pauseAge(st.changedAt))} — `
      + 'สิทธิ์เข้าถึงน่าจะหมดอายุแล้ว ถ้าเปิดแล้วตัวเลขไม่กลับมาภายใน 15 นาที '
      + 'ต้อง ssh เข้าเซิร์ฟเวอร์แล้วรัน <code>claude login</code></span>';
  } else {
    warn.className = 'claude-mon-warn mt-3 d-none';
    warn.innerHTML = '';
  }

  save.className = `btn btn-sm ${turningOff ? 'btn-warning' : 'btn-success'}`;
  save.textContent = turningOff ? 'หยุดติดตาม' : 'เปิดการติดตาม';
  save.disabled = turningOff && reason.length < 3;
}

/**
 * Write the switch, then announce it.
 *
 * `return=representation` and a row count, NOT a bare 204. RLS does not raise
 * on a refused UPDATE — it matches zero rows and PostgREST answers success — so
 * without this an account that fails `claude_settings_write` would change
 * nothing and still post "measurement paused" into Discord. Same rule as the
 * app's delete guard, and the reason `delete-guard.test.js` exists.
 */
async function saveMonitor() {
  const st = monitorState(board);
  const turningOff = st.enabled;
  const reason = $('claudeMonitorReason').value.trim();
  const save = $('claudeMonitorSave');
  if (turningOff && reason.length < 3) return;
  if (save.disabled) return;
  save.disabled = true;

  // The note is KEPT on resume rather than cleared: it is what the
  // "กลับมาแล้ว" notice reports as the thing it had been off for, and the row
  // is the only place it lives.
  const patch = turningOff
    ? { monitoring_enabled: false, monitoring_note: reason }
    : { monitoring_enabled: true };

  const { data, error } = await dbRest('/claude_settings?id=eq.true', {
    method: 'PATCH',
    body: patch,
    prefer: 'return=representation',
  });
  if (error) {
    save.disabled = false;
    $('claudeMonitorWarn').className = 'claude-mon-warn mt-3 is-warn';
    $('claudeMonitorWarn').textContent = `บันทึกไม่สำเร็จ: ${error.message || error.status}`;
    return;
  }
  if (!Array.isArray(data) || data.length === 0) {
    save.disabled = false;
    $('claudeMonitorWarn').className = 'claude-mon-warn mt-3 is-warn';
    $('claudeMonitorWarn').textContent =
      'บันทึกไม่สำเร็จ — บัญชีนี้ไม่มีสิทธิ์เปลี่ยนการตั้งค่านี้';
    return;
  }

  monitorRef?.hide();
  // The age is taken from the state BEFORE the write: after it, the stamp is
  // "just now" by construction and "หยุดไปนาน 0 นาที" would be a reading.
  const since = turningOff ? '' : pauseAge(st.changedAt);
  await refresh();
  notifyMonitor(turningOff ? 'monitor-off' : 'monitor-on', turningOff ? reason : st.note, since);
}

/**
 * Fire-and-forget into the same Discord channel the bookings use.
 *
 * Announced for the same reason a cancelled booking is: it changes what
 * everybody else can rely on. Somebody reading a percentage on this board
 * tomorrow deserves to have been told that the percentage stopped moving —
 * and Discord is where people are, not this page.
 *
 * NOT gated on the silent-booking toggle. That switch exists so a dev testing
 * the booking form does not ring a channel full of students; pausing the whole
 * account's measurement is not a test action, and it is exactly the kind of
 * thing that must not happen quietly.
 */
function notifyMonitor(mode, note, since) {
  sendNotify('claude', {
    mode,
    who: personName(board?.me) || getUser()?.name || '',
    note: note || '',
    since: since || '',
  });
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

  // These two gauges are the live windows AS THEY STAND NOW — including their
  // real reset instants. Under a week that is not this one they would be read
  // as that week's, which is the same confusion of scopes 0156 fixed one card
  // up. Say which week they belong to instead of drawing them silently.
  if (board.week.is_current === false) {
    host.innerHTML = '<div class="claude-measured-elsewhere">'
      + '<i class="bi bi-clock-history" aria-hidden="true"></i>'
      + '<span>ตัวเลข “ใช้จริง” เป็นของสัปดาห์ปัจจุบันเสมอ — '
      + 'กดปุ่ม <strong>สัปดาห์นี้</strong> เพื่อกลับไปดู</span></div>';
    return;
  }

  // PAUSED ON PURPOSE (0167). Ordered BEFORE the "no sample" branch, because
  // both are true at once while paused and only one of them is useful: "nobody
  // ever set this up" is wrong and sends an admin to the server to fix
  // something that is not broken.
  //
  // THE GAUGES ARE NOT DRAWN, not even greyed. A meter with a number in it is a
  // reading, and the last one taken before a pause stops being true the moment
  // the account is used again — which is precisely what a pause makes likely.
  // This page has refused to print a stale figure since 0154 ("deliberately
  // blank rather than zero, because a zero reads as a reading"); a frozen 61%
  // is the same mistake wearing a plausible number.
  const mon = monitorState(board);
  if (!mon.enabled) {
    const age = pauseAge(mon.changedAt);
    const by = mon.by ? personName(mon.by) : '';
    host.innerHTML =
      '<div class="claude-measured-paused">'
      + '<i class="bi bi-pause-circle" aria-hidden="true"></i>'
      + '<div><b>หยุดติดตามการใช้งานจริงชั่วคราว</b><br>'
      + 'ตัวเลขด้านบนคือสิ่งที่ทุกคนจองไว้ ไม่ใช่สิ่งที่ใช้ไปจริง — '
      + 'ยังจองช่วงเวลาได้ตามปกติ'
      + (mon.note ? `<div class="claude-measured-why">เหตุผล: ${escHtml(mon.note)}</div>` : '')
      // WHO, only when there is a who. A pause set from the server (the first
      // one was) has no auth.uid() for the trigger to stamp, and "หยุดโดย
      // ไม่ทราบชื่อ" is worse than silence — it invites the reader to wonder
      // who that is. The age still says everything useful on its own.
      + (by
          ? `<div class="claude-measured-who">หยุดโดย ${escHtml(by)}`
            + `${age ? ` · ${escHtml(age)}ที่แล้ว` : ''}</div>`
          : (age ? `<div class="claude-measured-who">หยุดไปแล้ว ${escHtml(age)}</div>` : ''))
      + '</div></div>';
    return;
  }

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
  // How old a reading may be before it is announced as stuck. The number comes
  // from claude_settings.sample_stale_minutes, published in the board payload
  // since 0167 — it used to be a hardcoded 35 here while the DATABASE went on
  // believing the newest sample for ever, so the page could say "ข้อมูลค้าง"
  // over a figure the SQL underneath was still treating as current. One
  // threshold, one home.
  const stale = age > staleAfterMs(board);

  // NO reconciliation here any more. It printed booked-vs-actual on the WEEKLY
  // window's 0–100 scale, directly under a bar reading 287 / 700 in session
  // percent — the same comparison twice, in two units, one card apart. It now
  // lives once, in the measured log, in the unit the rest of the feature uses.
  // Two numbers that mean the same thing and do not match is worse than one.

  host.innerHTML =
    '<div class="claude-measured-head">'
    + '<b>ใช้จริง</b><span class="text-muted">วัดจาก Claude โดยตรง</span>'
    // Everything on this page is a reading taken up to 15 minutes ago. This is
    // the account's own live page — the authority the numbers here come from —
    // so anyone who doubts a figure can check it at source rather than argue
    // with the board. rel=noopener because target=_blank without it hands the
    // opened page a handle on this one.
    + '<a class="claude-src-link" href="https://claude.ai/settings/usage"'
    + ' target="_blank" rel="noopener noreferrer"'
    + ' title="เปิดหน้าการใช้งานจริงของบัญชี Claude">'
    + '<i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>ดูที่ Claude</a>'
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
    c.querySelectorAll('.claude-gap,.claude-bk,.claude-dead,.claude-nowline,'
      + '.claude-sel,.claude-free,.claude-hist,.claude-hist-peak,.claude-hist-reset')
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

  // ── "how much may I take if I start HERE" ─────────────────────────────
  //
  // A capacity gauge in its OWN LANE down the left of each day, never over the
  // blocks. The first version put a 6px bar at left:0 while session frames
  // start at 2px and bookings at 9px, so on any day with a booking the three
  // stacked into a striped mess and the label sat on the block's edge —
  // reported as "the rails it got overlap with the booking making it look
  // weird". The lane is now reserved in the stylesheet and everything else
  // starts after it.
  //
  // Segments come from claude_free_windows() — the same claude_free_now() the
  // hero panel prints, evaluated one second INSIDE each band (0157), so a band
  // means "start anywhere in here and you may take this much" and its END is
  // the LATEST START that still earns the previous, larger number.
  //
  // Only the current week has any: for a later week the weekly remainder is not
  // knowable yet, and a plausible-looking number would be a lie.

  // Where the blocks are, per column, so a label can decline to sit on one.
  const occupied = new Map();
  board.bookings.forEach((bk) => {
    splitAcrossDays(new Date(bk.starts_at).getTime(), new Date(bk.ends_at).getTime())
      .forEach((sg) => {
        if (!occupied.has(sg.i)) occupied.set(sg.i, []);
        occupied.get(sg.i).push([sg.sMin, sg.eMin]);
      });
  });
  // ── the 5-hour windows, and the part of each that nobody has claimed ───
  //
  // A window is opened by a booking and runs five hours; the blocks inside it
  // share its one 100%. What is interesting is therefore not the window — it is
  // the part of it that is still OPEN TO SOMEBODY: unbooked TIME, with unbooked
  // PERCENT to go with it. Both halves have to be there.
  //
  //   3 hours at 75%, in a 5-hour window  → 2 hours and 25% left. Fillable.
  //   3 hours at 100%                     → 2 hours and NOTHING left.
  //   5 hours at 70%                      → 30% left and no time to use it in.
  //
  // The owner stated the last one exactly: *"if that person book any% like 70%
  // 100% full 5 hours, you dont need to show dash line because no one would be
  // able to fill in during that period"*. A mark over a stretch nobody can book
  // is decoration that has to be reasoned about before it can be dismissed.
  const windowsMs = [];   // [startMs, endMs) per window, for carving the rail
  const gaps = [];        // {s, e, free, winEnd} — what is still fillable
  const bookedMs = board.bookings.map((b) => [
    new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime(),
  ]);
  board.sessions.forEach((sn) => {
    const ws = new Date(sn.starts_at).getTime();
    const we = new Date(sn.ends_at).getTime();
    windowsMs.push([ws, we]);
    const free = pool - sn.used_pct;
    carve(ws, we, bookedMs.filter(([bs, be]) => bs < we && be > ws))
      .forEach(([s, e]) => gaps.push({ s, e, free, winEnd: we }));
  });

  // The rail is carved against the WHOLE window, not just the blocks in it.
  //
  // Its question is "start here and take this much WITHOUT booking", and inside
  // a window that question already has two better answers on screen: the block
  // says who holds this minute, and the dashed box says how much of the window
  // is left and until when. Reported as *"it shouldnt show the rail as 100% in
  // that 25%, it shouldnt show yellow"* — 0161 fixed the number (it was reading
  // 100 where the guard said 25), and this stops the rail restating it in a
  // third visual language two pixels away.
  const inWindow = new Map();
  windowsMs.forEach(([s, e]) => {
    splitAcrossDays(s, e).forEach((sg) => {
      if (!inWindow.has(sg.i)) inWindow.set(sg.i, []);
      inWindow.get(sg.i).push([sg.sMin, sg.eMin]);
    });
  });

  const fws = mergeBands(board.free_windows || []);
  fws.forEach((fw, wi) => {
    const free = Math.round(Number(fw.free_pct));
    // A band whose successor is worth LESS ends at a deadline: start by then
    // and you still get this much. That is the single most useful thing the
    // rail knows, and the geometry alone does not say it out loud.
    const next = fws[wi + 1];
    const isDeadline = next != null && Math.round(Number(next.free_pct)) < free;
    const s = new Date(fw.starts_at).getTime();
    const e = new Date(fw.ends_at).getTime();
    const until = new Date(fw.ends_at);
    const parts = splitAcrossDays(s, e);
    parts.forEach((seg, idx) => {
      const col = colFor(seg.i);
      if (!col) return;

      // THE RAIL MEANS "FREE TO USE WITHOUT BOOKING", so it must not be drawn
      // over a block somebody holds. Reported: "why there's 50% rails in the
      // period that has people book 08.00-13.00, the rail mean free use".
      //
      // The number was arithmetically right — a session begun inside their
      // block shares it and 50% is what they left — but it is the wrong answer
      // to the question the rail asks, and it invites exactly the collision
      // booking exists to prevent. That time already carries two better
      // statements: the block says who holds it, and the session frame's tag
      // says how much of that session is left.
      // The stretch somebody HOLDS gets its own mark rather than a gap. A gap
       // reads as "no data"; this reads as "not yours to start in". It is
       // deliberately NOT red — red in this lane already means "no quota left
       // at all", which is a different fact, and one that would be alarming
       // about a perfectly normal booking.
      (occupied.get(seg.i) || []).forEach(([bs, be]) => {
        const hs = Math.max(bs, seg.sMin);
        const he = Math.min(be, seg.eMin);
        if (he <= hs) return;
        const h = document.createElement('div');
        h.className = 'claude-free is-held';
        h.style.top = `${yForMin(hs)}px`;
        h.style.height = `${Math.max(2, yForMin(he) - yForMin(hs))}px`;
        h.title = 'ช่วงนี้มีคนจองไว้แล้ว — ดูรายละเอียดที่กล่องการจอง';
        col.appendChild(h);
      });

      carve(seg.sMin, seg.eMin, inWindow.get(seg.i)).forEach(([ps, pe], pi) => {
      const el = document.createElement('div');
      // FOUR steps, not two: 98% and 25% used to be the same amber, which is
      // what made them indistinguishable. Thresholds are about what a reader
      // can DO with it: essentially a whole session · most of one · a scrap ·
      // none. The percentage printed beside the band carries the precision.
      el.className = 'claude-free'
        + (free <= 0 ? ' is-none'
          : free >= pool * 0.9 ? ' is-full'
          : free >= pool * 0.4 ? ' is-part'
          : ' is-low');
      el.style.top = `${yForMin(ps)}px`;
      el.style.height = `${Math.max(2, yForMin(pe) - yForMin(ps))}px`;
      // The band's END is a DEADLINE, not just where the colour changes: start
      // by then and you still get this much. Saying it is most of the value.
      el.title = free > 0
        ? `เริ่มใช้ได้ถึง ${hhmm(until)} จะได้ ${free}% โดยไม่ต้องจอง`
          + (fw.bound_by === 'week'
            ? ` — จำกัดด้วยโควตาสัปดาห์ ที่เหลือรวม ${pctText(fw.week_free_pct)}`
            : ' — จำกัดด้วยเซสชัน 5 ชม. ช่วงนั้น')
        : 'ช่วงนี้ไม่เหลือโควตาให้ใช้โดยไม่จอง';

      // Label the first day-segment, and any CONTINUATION long enough to read
      // as its own band — labelling only idx 0 left a whole column drawing a
      // 968px ribbon with nothing on it. But never where a block already is:
      // that collision is what made the rail look broken.
      // Carving already removed every block, so a surviving piece cannot clash
      // with one — the label just needs room to be read.
      const tall = pe - ps >= 45;
      if ((pi === 0 && (idx === 0 || pe - ps >= 180)) && tall) {
        const tag = document.createElement('span');
        tag.className = 'claude-free-tag';
        tag.textContent = free > 0 ? `${free}%` : 'เต็ม';
        el.appendChild(tag);
      }
      // The deadline goes on the piece that actually ENDS where the band ends.
      // The previous test was an arithmetic expression that reduced to "true
      // for a single-day band" and to a string comparison between a Postgres
      // `+00:00` timestamp and JS `.toISOString()` — which never matches — so
      // on a band spanning midnight the mark landed at 00:00 wearing a label
      // that said 03:00. Compare the instants.
      const pieceEndsBand = idx === parts.length - 1
        && dayColumns()[seg.i].getTime() + pe * MIN_MS >= e - MIN_MS;
      if (isDeadline && tall && pieceEndsBand) {
        const dl = document.createElement('span');
        dl.className = 'claude-free-deadline';
        dl.textContent = `เริ่มถึง ${hhmm(until)}`;
        el.appendChild(dl);
      }
      col.appendChild(el);
      });
    });
  });

  // ── the fillable remainder, as a box you could put a booking in ──────────
  //
  // WHY A DASHED BOX AND NOT THE OLD BRACKET. The bracket framed the whole
  // 5-hour window, blocks included, and hung a tag off the bottom saying how
  // much was left. It described the window; people are trying to answer a
  // different question — *can I put something here, and how much?* A dashed
  // outline is the shape every calendar already uses for "an empty slot", and
  // it is drawn over EXACTLY the time that is still free, so its geometry is
  // the answer rather than a caption about a bigger rectangle.
  //
  // OPEN AT THE TOP, three sides. A window is opened BY a booking, so a gap
  // always sits below one, and leaving that edge off says the two are one pot —
  // this is the rest of the block above it, not a separate thing.
  //
  // RED WHEN THERE IS NOTHING LEFT. Asked for exactly: *"if people book 100%
  // 16.00-19.00 just show the dashline as red"*. The time is free and the quota
  // is not, which is a real state and an easy one to walk into; a box that
  // looked the same as a fillable one would invite the booking the guard is
  // about to refuse.
  //
  // NOTHING AT ALL when the window has no free time — see the comment where
  // `gaps` is built.
  gaps.forEach((g) => {
    const none = g.free <= 0;
    const parts = splitAcrossDays(g.s, g.e);
    parts.forEach((seg, idx) => {
      const col = colFor(seg.i);
      if (!col) return;
      const el = document.createElement('div');
      // The bottom edge is the window's REAL end, so a gap running past
      // midnight must not draw one at 24:00 — that would read as the window
      // closing there.
      el.className = 'claude-gap' + (none ? ' is-none' : '')
        + (idx < parts.length - 1 ? ' is-cut-b' : '');
      el.style.top = `${yForMin(seg.sMin)}px`;
      el.style.height = `${Math.max(6, yForMin(seg.eMin) - yForMin(seg.sMin))}px`;
      el.title = none
        ? `รอบ 5 ชั่วโมงนี้ถูกจองครบ ${pool}% แล้ว — ช่วงนี้ว่างแต่จองเพิ่มไม่ได้`
          + ` (รอบนี้ถึง ${hhmm(new Date(g.winEnd))})`
        : `ช่วงนี้ยังจองได้อีก ${g.free}% — เป็นโควตาที่เหลือของรอบ 5 ชั่วโมง`
          + ` ที่จบเวลา ${hhmm(new Date(g.winEnd))}`;
      // The tag goes on the LAST day-segment, so a gap crossing midnight
      // labels the end of the WINDOW rather than the end of Tuesday.
      const tall = seg.eMin - seg.sMin >= 26;
      if (idx === parts.length - 1 && tall) {
        const tag = document.createElement('div');
        tag.className = 'claude-gap-tag';
        // "ถึง HH:MM" is dropped by CSS on a narrow column — a 110px day cannot
        // carry "ว่าง 25% · ถึง 21:00" without clipping it mid-number, and a
        // clipped number reads as a wrong one rather than a short one.
        tag.innerHTML = none ? 'เต็ม'
          : `ว่าง ${g.free}%`
            + `<span class="claude-gap-until"> · ถึง ${escHtml(hhmm(new Date(g.winEnd)))}</span>`;
        el.appendChild(tag);
      }
      col.appendChild(el);
    });
  });

  // ── "ใช้จริง" overlay ─────────────────────────────────────────────────
  if (histMode) paintHistory();

  board.bookings.forEach((b) => {
    const s = new Date(b.starts_at).getTime();
    const e = new Date(b.ends_at).getTime();
    splitAcrossDays(s, e).forEach((seg) => {
      const col = colFor(seg.i);
      if (!col) return;
      const el = document.createElement('button');
      el.type = 'button';
      const h = Math.max(18, yForMin(seg.eMin) - yForMin(seg.sMin) - 2);
      const tier = bookingLayout(h);
      el.className = `claude-bk is-${tier}` + (b.is_mine ? ' is-mine' : '');
      el.style.setProperty('--claude-c', personColor(b.person));
      el.style.top = `${yForMin(seg.sMin)}px`;
      el.style.height = `${h}px`;
      const range = `${hhmm(new Date(b.starts_at))}–${hhmm(new Date(b.ends_at))}`;
      el.title = `${personName(b.person)} · ${range} · ${b.pct}% — ${b.purpose}`;
      // WHAT A BLOCK SAYS, and what it no longer says.
      //
      // The RANGE, not just the start. It used to print "16:00" and the end
      // time was dropped at every width, on the reasoning that the block's
      // HEIGHT is its duration. The owner read the block and asked for the end
      // anyway — *"it shows only 16.00 not 16.00-21:00"* — and they are right:
      // height is duration only if you can find the hour lines behind three
      // other layers, and a booking is a claim on a STRETCH, which is two
      // numbers. So the range gets a line of its own rather than fighting the
      // percentage for one, which is what made it not fit before ("10:00–11:45"
      // wants 77px and "100%" another 34, against a ~90px card).
      //
      // The REASON is gone from the face of the block. It was the thing pushing
      // the name into an ellipsis, it is never the question somebody scanning a
      // week is asking, and it is one tap away in the modal — and still in the
      // tooltip. Asked for: *"with name, no need for reason why booking"*.
      //
      // escHtml on the name: it is user text, and a renderer that interpolated
      // raw user text into innerHTML is an entry in this repo's mistakes log.
      // The time and the percentage are numbers this module formatted itself.
      const pctCell = `<span class="claude-bk-p">${b.pct}%</span>`;
      el.innerHTML = tier === 'micro'
        // Too short for a name: the range and the percentage stack, each on a
        // line of its own. Side by side they wanted 86px of a 71px card — see
        // bookingLayout(). The name goes to the tooltip; a clipped name is
        // worse than no name.
        ? `<span class="claude-bk-t">${range}</span>${pctCell}`
        : `<span class="claude-bk-t">${range}</span>`
          + `<span class="claude-bk-head"><span class="claude-bk-n">`
          + `${escHtml(shortName(b.person))}</span>${pctCell}</span>`;
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

/**
 * When Claude was ACTUALLY being used, drawn on the calendar beside what people
 * booked.
 *
 * ── WHAT CHANGED, AND WHY IT HAD TO ──────────────────────────────────────
 * This used to draw one bar per 15-minute sample, its WIDTH the CUMULATIVE
 * five-hour reading. That is the integral: a staircase climbing to 97% and
 * sawtoothing back. It answers "what did the gauge say at 12:15", which nobody
 * asks, and it was reported once already as unreadable ("i don't understand
 * ใช้จริง overlay that shows 93% 97% etc").
 *
 * It now draws the DERIVATIVE — the stretches where the reading ROSE, each
 * carrying the percentage that went in during it. Asked for with worked
 * examples: *"if actual people use at 10.07, your last detect at 10.00 found
 * nothing, 10.15 found 3% … show it as 10.07-10.15 as 3%"*.
 *
 * ── THE ARITHMETIC IS NOT HERE ───────────────────────────────────────────
 * `claude_usage_runs()` (migration 0162) computes it, because a rise's left
 * edge depends on the 5-hour window's opening instant and that is the same
 * derivation the booking guard uses. A second copy in JavaScript is the class
 * this repo pays for most — 0161 was exactly that bug, one layer down. This
 * renders `usageData.runs` and adds nothing to it.
 *
 * ── THE THREE STATES A RUN CAN BE IN, AND WHY EACH IS DRAWN DIFFERENTLY ───
 * The picture must not claim more precision than the polling has.
 *
 *   exact_start  the run begins at the window's OWN opening instant — the first
 *                message. Known to the minute, not to the poll. Gets a solid
 *                cap, because it is the only edge on this overlay that is a
 *                measurement rather than a bound.
 *   inferred     the run begins at a poll: usage started somewhere in the 15
 *                minutes before it. Feathered top, so it reads as "about here".
 *   unknown      the reporter was DOWN and the rise could be anywhere in the
 *                gap. Hatched, and labelled as missing rather than as usage —
 *                measured for real on the window of 15 Aug 23:30, first polled
 *                at 01:04 already reading 75%.
 *
 * ITS OWN LANE, never over the blocks. The rail on the left already cost this
 * feature one report — *"the rails it got overlap with the booking making it
 * look weird"* — so it is the answer here too. `.is-hist` on the shell narrows
 * the blocks to make room; without that class the lane does not exist and
 * nothing has to move.
 *
 * TOGGLED OFF BY DEFAULT. It is a second layer over a grid already carrying
 * three, and a page that shows everything at once shows nothing.
 */
function paintHistory() {
  const runs = usageData?.runs || [];
  if (!runs.length) {
    $('claudeHistNote').textContent = usageData
      ? 'ยังไม่มีข้อมูลการใช้จริงในสัปดาห์นี้'
      : 'กำลังโหลดข้อมูลการใช้จริง…';
    return;
  }
  // The overlay has to say what a block MEANS before its numbers mean anything.
  // "N%" on a calendar that already shows three other percentages is noise.
  $('claudeHistNote').innerHTML =
    '<b>แถบสีดินเผาด้านขวาของแต่ละวัน</b> คือช่วงที่มีคน<b>ใช้งานจริง</b> '
    + '<b>+N%</b> คือโควตาที่ใช้ไป<b>ในช่วงนั้น</b> (ไม่ใช่ยอดสะสม) '
    + 'ส่วน <b>รวม N%</b> ที่เส้นแบ่งคือยอดรวมของรอบ 5 ชั่วโมงนั้นทั้งรอบ '
    + 'ช่วงที่ไม่มีแถบคือไม่มีใครใช้ '
    + '<span class="claude-hist-key"><i class="hk-exact"></i>ขีดทึบด้านบน = '
    + 'เวลาที่เริ่มใช้จริง คำนวณจากเวลารีเซ็ตของรอบ 5 ชั่วโมง '
    + '<i class="hk-fuzzy"></i>ขอบจาง = รู้แค่ว่าเริ่มในช่วง 15 นาทีนั้น '
    + '<i class="hk-unknown"></i>ลายทแยง = ระบบเก็บข้อมูลไม่ทำงานช่วงนั้น</span>';

  // ── ONE occupancy map for EVERY label this overlay puts in a column ──────
  //
  // Two kinds land here — a run's "ใช้ N%" and a window's reset total — and they
  // collide precisely when it matters most: a window that resets at 20:00 while
  // the next one opens at 20:00 puts both at the same pixel, and "ใช้ 55%"
  // printed over "96%" makes BOTH unreadable. Measured on the live payload.
  // Tracking only run-vs-run (the first version) cannot see it, because the two
  // labels come from different loops.
  //
  // Nudge down to the first free slot, never overlap, and drop the label
  // entirely rather than shift it somewhere it would describe the wrong minute.
  // The tooltip carries every number, so a dropped label loses nothing but a
  // glance.
  const LABEL_H = 15;
  const taken = new Map();

  // ── which runs belong to which window ────────────────────────────────────
  // Needed to answer "does this window's total say anything its runs do not".
  // When a window holds exactly ONE run, the run's rise IS the window's total,
  // so printing both put the same number on the calendar twice — and where a
  // window reset as the next one opened, the two labels landed on the same
  // minute with different denominators: "96" over "ใช้ 55%". Reported as
  // *"it also show like 96 with 55% thats weird"*.
  const runsByWin = new Map();
  runs.forEach((r) => {
    if (r.kind !== 'used' || !r.win_reset) return;
    const k = new Date(r.win_reset).getTime();
    runsByWin.set(k, (runsByWin.get(k) || []).concat(r));
  });
  /** First free top at or below `want`, within `limit`, or null. */
  function place(colIdx, want, limit) {
    const rows = taken.get(colIdx) || [];
    let y = want;
    for (let guard = 0; guard < 40; guard++) {
      const hit = rows.find(([t, b]) => y < b && y + LABEL_H > t);
      if (!hit) break;
      y = hit[1];
    }
    if (y > limit) return null;
    rows.push([y, y + LABEL_H]);
    taken.set(colIdx, rows);
    return y;
  }

  // ── where each observed 5-hour window ENDED ──────────────────────────────
  // A tick at the reset with what that window burned in total. The runs say
  // when; this says which pot they came out of and how full it got — which is
  // the number the booking side of the board is denominated in.
  //
  // `partial` windows are marked: we joined them after they had already been
  // used, so their total is a floor, not a reading.
  (usageData.windows || []).forEach((w) => {
    const at = new Date(w.resets_at).getTime();
    const seg = splitAcrossDays(at, at + MIN_MS)[0];
    if (!seg) return;
    const col = colFor(seg.i);
    if (!col) return;
    // ── SAY NOTHING THE RUNS HAVE ALREADY SAID ────────────────────────────
    // One run, its rise equal to the window's peak, and nothing missing from
    // the front of the window: the total is that run and the run is labelled.
    // A second pill carrying the identical number is where "96 with 55%" came
    // from — it is not extra information, it is the same fact competing with
    // its neighbour for the same pixel.
    const rs = runsByWin.get(new Date(w.resets_at).getTime()) || [];
    if (!w.partial && rs.length === 1
        && Math.round(Number(rs[0].pct)) === Math.round(Number(w.peak_pct))) return;
    // It marks a hard instant, so it may not be nudged — it takes its slot and
    // a run label that wanted the same one moves instead.
    const y = yForMin(seg.sMin);
    const rows = taken.get(seg.i) || [];
    rows.push([y - LABEL_H / 2, y + LABEL_H / 2]);
    taken.set(seg.i, rows);
    const el = document.createElement('div');
    el.className = 'claude-hist-reset';
    el.style.top = `${y}px`;
    el.textContent = `รวม ${w.partial ? '≥' : ''}${Math.round(Number(w.peak_pct))}%`;
    el.title = `รอบ 5 ชั่วโมง ${hhmm(new Date(w.starts_at))}–${hhmm(new Date(w.resets_at))}`
      + ` — ใช้ไปทั้งหมด ${w.partial ? 'อย่างน้อย ' : ''}${Math.round(Number(w.peak_pct))}%`
      + (w.partial ? ' (เริ่มเก็บข้อมูลหลังรอบนี้เริ่มไปแล้ว)' : '');
    col.appendChild(el);
  });

  runs.forEach((r) => {
    const s = new Date(r.from).getTime();
    const e = new Date(r.to).getTime();
    const pct = Math.round(Number(r.pct));
    const unknown = r.kind === 'unknown';
    const parts = splitAcrossDays(s, e);
    parts.forEach((seg, idx) => {
      const col = colFor(seg.i);
      if (!col) return;
      const top = yForMin(seg.sMin);
      // 3px floor: a run can be four minutes long (a window that opened and was
      // polled almost at once) and a zero-height div is a run that happened and
      // cannot be seen.
      const h = Math.max(3, yForMin(seg.eMin) - yForMin(seg.sMin));
      const el = document.createElement('div');
      el.className = 'claude-hist'
        + (unknown ? ' is-unknown' : '')
        // The caps belong to the run's real ends, so a run split across midnight
        // must not draw them at 00:00 on both pieces.
        + (idx === 0 && r.exact_start && !unknown ? ' is-exact' : '')
        + (idx > 0 ? ' is-cont' : '')
        + (idx === parts.length - 1 && r.open_ended ? ' is-open' : '');
      el.style.top = `${top}px`;
      el.style.height = `${h}px`;
      el.title = unknown
        ? `ไม่มีข้อมูลช่วง ${hhmm(new Date(s))}–${hhmm(new Date(e))} `
          + `(ระบบเก็บข้อมูลไม่ทำงาน) — มีการใช้ ${pct}% ที่ไหนสักช่วงนี้ `
          + 'แต่บอกเวลาที่แน่นอนไม่ได้'
        : `ใช้จริง ${hhmm(new Date(s))}–${hhmm(new Date(e))} — ${pct}% ของรอบ 5 ชั่วโมง`
          + (r.exact_start
            ? ' · เริ่มใช้เวลานี้พอดี (คำนวณจากเวลารีเซ็ตของรอบ)'
            : ' · เริ่มใช้ช่วง 15 นาทีก่อนหน้านี้')
          + (r.win_start
            ? ` · รอบ ${hhmm(new Date(r.win_start))}–${hhmm(new Date(r.win_reset))}`
            : '')
          + (r.open_ended ? ' · อาจยังใช้อยู่' : '');
      col.appendChild(el);

      // Label the FIRST day-segment only — a run crossing midnight is one run
      // and one number, not two.
      // A label may sit anywhere inside the run it describes, but not past it —
      // below its own block it would point at the wrong stretch of the day.
      if (idx === 0 && h >= 14) {
        const y = place(seg.i, top, top + h - LABEL_H);
        if (y != null) {
          const tag = document.createElement('div');
          tag.className = 'claude-hist-peak' + (unknown ? ' is-unknown' : '');
          tag.style.top = `${y}px`;
          // "+" because it is a RISE, not a level. "ใช้ 96%" beside a window
          // total of "96%" read as the same statement twice; "+96%" cannot.
          tag.textContent = unknown ? `? +${pct}%` : `+${pct}%`;
          col.appendChild(tag);
        }
      }
    });
  });

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

  // THE SESSION EDGE IS NO LONGER A WALL (migration 0159). It used to be: a
  // block crossing one was refused as "straddling", because its percentage
  // could not be said to belong to one window. Under the window rule it can —
  // every window the block touches is checked to have room for it — and
  // dropping the wall is what makes the legal pair 50% at 06:00 + 50% at 08:00
  // bookable in BOTH orders instead of only one.
  //
  // What remains are the three walls that are still real: five hours, the next
  // person's block, and the weekly reset.

  // Nothing may overlap an existing block — the exclusion constraint. Doing
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
  pending.puck?.remove();
  pending = null;
}

/**
 * The "I am counting" mark, at the point being pressed.
 *
 * The first version tinted the WHOLE COLUMN while the timer ran, and the owner
 * read it exactly as it looks: *"it highlights the entire column"* — a day
 * being selected, not a press being measured. Feedback for a press has to be
 * AT the press: a bar on the minute under the finger that fills over HOLD_MS,
 * so it says both "this registered" and "keep holding, this long".
 *
 * The duration comes from HOLD_MS through a custom property rather than being
 * written again in the stylesheet — an animation that disagrees with the timer
 * it depicts is worse than no animation.
 */
function holdPuck(seed) {
  const el = document.createElement('div');
  el.className = 'claude-hold';
  el.style.top = `${yForMin(seed.start)}px`;
  el.style.setProperty('--claude-hold-ms', `${HOLD_MS}ms`);
  seed.col.appendChild(el);
  return el;
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
      seedNow.puck?.remove();
      pending = null;
      // A hold with no drag is already a complete gesture, so it produces a
      // real block rather than the 15-minute sliver a stray tap used to make.
      beginDrag({ ...seedNow, cur: seedNow.start + HOLD_MIN }, ev, true);
      // Android/desktop honour this; iOS ignores it silently. The visible
      // change of state is what actually tells everyone the hold took.
      navigator.vibrate?.(12);
    }, HOLD_MS),
  };
  pending.puck = holdPuck(seed);
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

  // A new form must not inherit the previous range's server answer. The key
  // would usually catch it; clearing is the version that cannot be reasoned
  // about wrongly.
  limits = null;
  limitsKey = null;
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
 * Ask the SERVER how much this range may claim.
 *
 * WHY NOT EIGHT LINES OF JAVASCRIPT. This form used to project `board.sessions`
 * locally to guess the cap. Migration 0159 made the rule a chain over windows
 * with a measured window in it, and a second implementation of that in the
 * browser is precisely the drift this repo pays for most — so
 * `claude_booking_limits()` is the one implementation and this reads it.
 *
 * Called on a RANGE change only, never on the slider: `max_pct` does not depend
 * on the percentage being asked for, so dragging costs nothing. Debounced,
 * sequenced, and keyed to the range it describes — a late reply for a range
 * somebody has already changed must not cap the slider at the wrong number,
 * which is the failure mode that would be invisible.
 */
const rangeKey = (s, e) => `${s.getTime()}|${e.getTime()}|${editing?.id || ''}`;

function scheduleLimits() {
  clearTimeout(limitsTimer);
  limitsTimer = setTimeout(fetchLimits, 200);
}

async function fetchLimits() {
  const { s, e } = formRange();
  const key = rangeKey(s, e);
  const seq = ++limitsSeq;
  try {
    const { data, error } = await dbRest('/rpc/claude_booking_limits', {
      method: 'POST',
      body: {
        p_start: s.toISOString(),
        p_end: e.toISOString(),
        p_id: editing?.id || null,
      },
    });
    if (error) throw new Error(error.message || `HTTP ${error.status}`);
    if (seq !== limitsSeq) return;              // a later edit already won
    // AN ANSWER OF THE WRONG SHAPE IS NOT AN ANSWER. `max_pct` drives the
    // slider's ceiling through Number(), and `Number(undefined)` is NaN —
    // which is not caught by the `cap <= 0` branch below it (every comparison
    // with NaN is false), so it flowed all the way to the label and printed
    // "จองได้สูงสุด NaN%". Seen in a browser probe where the RPC was stubbed;
    // in production the same thing happens to any response that is not the
    // object this expects. Refusing it here keeps the form on "กำลังตรวจสอบ…"
    // and re-asks, which is what "we do not know yet" should look like.
    if (!data || typeof data !== 'object' || !Number.isFinite(Number(data.max_pct))) {
      throw new Error('claude_booking_limits returned an unusable shape');
    }
    limits = data;
    limitsKey = key;
  } catch (err) {
    if (seq !== limitsSeq) return;
    console.warn('claude: limits lookup failed:', err);
    // Leave `limits` alone rather than clearing it: the previous answer is
    // closer to the truth than no answer, and the database has the final word
    // on save regardless.
  }
  if (seq === limitsSeq) recalc();
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
  const key = rangeKey(s, e);
  const fresh = limits && limitsKey === key;
  if (!fresh) scheduleLimits();

  // Until the server answers, the ceiling is the pool. It cannot be anything
  // else that is honest — a guess here would be the second implementation this
  // was written to avoid — and the save path is validated server-side anyway.
  // Belt as well as braces: `fresh` now implies a validated shape, but a NaN
  // reaching the slider is silent and prints as a number, so neither of these
  // may ever be NaN.
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const cap = fresh ? Math.max(0, num(limits.max_pct, pool)) : pool;
  const sessMax = fresh ? num(limits.session_max_pct, pool) : pool;

  const slider = $('claudePct');
  slider.max = String(Math.max(5, cap));
  if (Number(slider.value) > cap) slider.value = String(Math.max(5, cap));
  const pct = Number(slider.value);

  $('claudePctVal').textContent = `${pct}%`;
  $('claudePctMax').textContent = !fresh
    ? 'กำลังตรวจสอบโควตาช่วงนี้…'
    : cap <= 0
      ? 'ช่วงนี้ไม่เหลือโควตาให้จอง'
      : limits.bound_by === 'week'
        ? `จองได้สูงสุด ${cap}% (โควตาสัปดาห์เหลือเท่านี้)`
        : limits.bound_by === 'open_window'
          ? 'ช่วงนี้จองไม่ได้ — รอบนี้เริ่มไปแล้ว'
          : limits.bound_by === 'live'
            ? `จองได้สูงสุด ${cap}% (ขณะนี้มีผู้กำลังใช้งานอยู่)`
            : `จองได้สูงสุด ${cap}%`;

  // percent chips
  $('claudePctChips').innerHTML = '';
  [10, 25, 50, 75, 100].filter((v) => v <= Math.max(5, cap)).forEach((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'claude-chip' + (v === pct ? ' on' : '');
    b.textContent = `${v}%`;
    b.addEventListener('click', () => { slider.value = String(v); recalc(); });
    $('claudePctChips').appendChild(b);
  });

  // ── the ledger ────────────────────────────────────────────────────────
  // The 5-hour window this block would sit in comes from the server too: it is
  // the TIGHTEST of the windows the range touches, which is the one the cap
  // came from and therefore the one worth naming.
  const win = fresh ? limits.window : null;
  const winStart = win ? new Date(win.starts_at) : s;
  const winEnd = win ? new Date(win.ends_at) : new Date(s.getTime() + sessionMs());
  const already = fresh ? Number(win ? win.load_pct : 0) : 0;
  const weekAfter = board.week.used_pct - (editing ? editing.pct : 0) + pct;

  $('claudeLedger').innerHTML = [
    ledgerRow('ช่วงที่จอง', `${hhmm(s)} – ${hhmm(e)} · ${durLabel(e - s)}`),
    ledgerRow('รอบ 5 ชม. ที่ใช้ร่วมกัน',
      `${hhmm(winStart)} – ${hhmm(winEnd)}`
      + (win && win.kind === 'live' ? ' (กำลังใช้อยู่)' : win && win.kind === 'new' ? ' (รอบใหม่)' : '')),
    ledgerRow('รอบนี้หลังจอง', fresh ? `${already + pct}% / ${pool}%` : '…',
      fresh && already + pct > pool ? 'bad' : 'good'),
    ledgerRow('เหลือให้คนอื่นจอง', fresh ? `${Math.max(0, sessMax - pct)}%` : '…'),
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
        : `จองได้ครั้งละไม่เกิน ${maxMin / 60} ชั่วโมง`;
    notes.push(noteHtml('info',
      `${why} จึงจองได้ถึง <strong>${escHtml(hhmm(continuation.start))}</strong> ก่อน`
      + `<br>กด “${escHtml($('claudeSave').textContent)}” แล้วระบบจะเปิดฟอร์มให้จองช่วง `
      + `<strong>${escHtml(hhmm(continuation.start))}–${escHtml(hhmm(continuation.end))}</strong>`
      + ' ต่อให้ทันที'));
  }

  // WHO YOU ARE SHARING WITH. A cap with no name beside it reads as the system
  // being difficult; naming the people in the same 5-hour pot turns it into a
  // fact anyone can act on — and into a conversation they can have.
  if (fresh && win && (limits.share_with || []).length) {
    const who = limits.share_with
      .map((b) => `<b>${escHtml(personName(b.person))}</b> ${b.pct}% `
        + `(${hhmm(new Date(b.starts_at))}–${hhmm(new Date(b.ends_at))})`)
      .join(' · ');
    notes.push(noteHtml('info',
      `ช่วงนี้อยู่ใน<strong>รอบ 5 ชั่วโมงเดียวกัน</strong>กับ ${who} `
      + `จึงแบ่งโควตา ${pool}% ก้อนเดียวกัน`
      + (win.clear_before
        ? `<br>หากเริ่มใช้ไม่เกิน <strong>${escHtml(stampLabel(new Date(win.clear_before)))}</strong> `
          + 'จะได้โควตาเต็มโดยไม่ต้องแบ่ง'
        : '')));
  }
  // AN OPEN WINDOW IS NOT A CAPACITY PROBLEM, so it must not be reported as
  // one. "เหลือ 0%" would send somebody to change the percentage, and no
  // percentage works. Lead with what is true — this stretch belongs to whoever
  // is in it — and give both ways forward.
  const openWin = fresh ? limits.open_window : null;
  if (openWin) {
    notes.push(noteHtml('crit',
      `ช่วงนี้อยู่ในรอบ 5 ชั่วโมงที่<strong>มีคนเริ่มใช้ไปแล้ว</strong> `
      + `(ใช้ไป ${Math.round(Number(openWin.used_pct))}%) `
      + 'รอบนี้เป็นของคนที่เริ่มก่อน จึงจองแทรกไม่ได้'
      + `<br>จองได้ตั้งแต่ <strong>${escHtml(stampLabel(new Date(openWin.ends_at)))}</strong> `
      + 'เป็นต้นไป หรือถ้าจะใช้ตอนนี้เลยก็ได้โดยไม่ต้องจอง (ใช้ร่วมกัน)'));
  } else if (fresh && win && win.kind === 'live') {
    notes.push(noteHtml('info',
      'ขณะนี้มีผู้กำลังใช้งาน Claude อยู่ และรอบ 5 ชั่วโมงจะรีเซ็ตเวลา '
      + `<strong>${escHtml(hhmm(winEnd))}</strong>`));
  }

  // ── START ON TIME ─────────────────────────────────────────────────────
  // Only when it actually costs somebody something: a block inside five hours
  // after this one ends is the person whose reset your lateness moves. Saying
  // it every time would train people to ignore it.
  if (fresh && limits.next_up) {
    const n = limits.next_up;
    notes.push(noteHtml('warn',
      `<b>${escHtml(personName(n.person))}</b> จองต่อจากช่วงนี้เวลา `
      + `<strong>${escHtml(stampLabel(new Date(n.starts_at)))}</strong> `
      + `กรุณาเริ่มใช้งานเวลา <strong>${escHtml(hhmm(s))}</strong> ให้ตรงเวลา `
      + 'เนื่องจากรอบ 5 ชั่วโมงเริ่มนับจากข้อความแรกที่ส่ง '
      + 'หากเริ่มช้า ผู้จองรายถัดไปจะต้องรอนานขึ้นเท่านั้น'));
  }

  if (fresh && cap <= 0) {
    notes.push(noteHtml('crit',
      'ช่วงนี้จองไม่ได้ เนื่องจากรอบ 5 ชั่วโมงที่ครอบช่วงนี้ถูกจองเต็มแล้ว '
      + (win?.clear_before
        ? `กรุณาเริ่มไม่เกิน <strong>${escHtml(stampLabel(new Date(win.clear_before)))}</strong> `
          + 'หรือเลื่อนไปหลังรอบนี้'
        : 'กรุณาเลื่อนเวลาเริ่ม')));
  } else if (fresh && pct > cap) {
    notes.push(noteHtml('crit',
      `เกินโควตาที่จองได้ ${pct - cap}% กรุณาลดเหลือ ${cap}% หรือเลือกช่วงเวลาอื่น`));
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

  // Only a CRITICAL note blocks the save. The continuation and share notes are
  // information about boundaries the form has already respected — disabling
  // ยืนยัน on them would refuse the very booking it just made legal.
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
    notifyBooking(wasEdit ? 'edit' : 'new', saved);

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

/**
 * ยกเลิกการจอง, not ลบการจอง.
 *
 * The row really is deleted, so "ลบ" was accurate about the mechanism and wrong
 * about the act: what a person is doing here is giving a slot back, and the
 * word for that is ยกเลิก. It also makes the right thing sound normal — the
 * ข้อตกลง asks people who are not going to use a block to release it, and
 * nobody feels invited to "delete" their own booking.
 */
async function removeBooking() {
  if (!editing) return;
  // askConfirm and not askDelete: askDelete hardcodes the word ลบ in both the
  // title and the button, and the whole point here is that this is a cancel.
  const ok = await askConfirm({
    title: 'ยกเลิกการจองนี้?',
    body: `${stampLabel(new Date(editing.starts_at))}–${hhmm(new Date(editing.ends_at))}`
      + ` · ${editing.pct}% · ${editing.purpose}`
      + '\nช่วงเวลานี้จะว่างให้ผู้อื่นจองได้ และระบบจะแจ้งเตือนใน Discord',
    // NOT 'ยกเลิกการจอง'. askConfirm's dismiss button is a hardcoded, shared
    // 'ยกเลิก', so that label put two buttons starting with the same word side
    // by side — one meaning "back out", one meaning "do it". Seen in the
    // rendered dialog, not in the source. The action shares no word with the
    // dismissal now, and says what actually happens.
    yes: 'คืนช่วงเวลานี้',
  });
  if (!ok) return;
  // Captured BEFORE the delete: once the row is gone it is off the board, and
  // the notification would have nobody's name in it.
  const gone = { ...editing };
  const person = editing.person || null;
  const { data, error } = await dbRest(`/claude_bookings?id=eq.${gone.id}`, {
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
      noteHtml('crit', 'ยกเลิกไม่สำเร็จ — บัญชีนี้อาจไม่มีสิทธิ์ยกเลิกการจองนี้');
    return;
  }
  modalRef?.hide();
  editing = null;
  await refresh();
  // A cancel is the notification that matters most: it is the one that hands
  // quota BACK, and nobody finds out by staring at a page they already closed.
  notifyBooking('cancel', gone, person);
}

/**
 * Fire-and-forget, exactly like PR / VS. The queue serialises and logs it; a
 * dropped notification must never block or fail a write that succeeded.
 *
 * ALL THREE WRITES NOTIFY, not just the first. A booking is a claim on a shared
 * thing, so the interesting events are exactly the ones that CHANGE what other
 * people can have: somebody taking a slot, somebody moving it, somebody giving
 * it back. Announcing only the first meant a cancelled block stayed "taken" in
 * everyone's head until they happened to reopen the page — which is the worst
 * of the three, because it is the one that hands quota back.
 *
 * `person` is resolved from the board when it can be, and passed in explicitly
 * for a cancel: by the time the row is gone, so is its entry on the board.
 */
function notifyBooking(mode, row, personOverride = null) {
  if (!row) return;
  const b = board.bookings.find((x) => x.id === row.id);
  const person = personOverride || b?.person || board.me || null;
  const s = new Date(row.starts_at);
  const e = new Date(row.ends_at);
  const sn = board.sessions.find((x) => (x.booking_ids || []).includes(row.id));
  const pool = board.settings.session_pool_pct;
  // Who is pushed back by a late start, so the Discord line can say it too —
  // the board is not the only place people read this.
  const nextUp = board.bookings
    .filter((x) => x.id !== row.id
      && new Date(x.starts_at).getTime() >= e.getTime()
      && new Date(x.starts_at).getTime() < s.getTime() + sessionMs())
    .sort((x, y) => new Date(x.starts_at) - new Date(y.starts_at))[0];

  // The booking is already written; this is only the Discord line. Checked at
  // SEND time rather than captured at save time so a cancel is as silent as the
  // booking it cancels.
  if (holdsMaster() && $('claudeSilent')?.checked) return;

  sendNotify('claude', {
    mode,                                   // 'new' | 'edit' | 'cancel'
    who: person ? personName(person) : (getUser()?.name || ''),
    dept: person ? personDept(person) : '',
    roles: (person?.postings || []).map((p) => p.node).filter(Boolean).join(' · '),
    when: `${fullDate(s)} ${hhmm(s)}–${hhmm(e)}`,
    duration: durLabel(e - s),
    pct: row.pct,
    sessionLeft: mode === 'cancel'
      ? null
      : (sn ? Math.max(0, pool - sn.used_pct) : pool - row.pct),
    purpose: row.purpose,
    weekUsed: board.week.used_pct,
    weekPool: board.week.pool_pct,
    nextUp: nextUp
      ? `${personName(nextUp.person)} ${hhmm(new Date(nextUp.starts_at))}`
      : null,
  });
}
