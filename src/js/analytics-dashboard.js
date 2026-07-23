// ==============================================
// analytics-dashboard.js — the staff-only "สถิติการใช้งาน" admin section.
// Fetches analytics_overview(days) (migration 0065) and renders KPI tiles
// + time-series bar charts + top-tabs / role breakdowns. Pure DOM/CSS
// rendering (no chart library) to keep the bundle lean.
//
// Data sources: the RPC combines the real engagement tables (users,
// pr/vs tickets, projects, documents, orders) with analytics_events. The
// engagement numbers are populated immediately; the session/visitor and
// top-tab panels fill in as the cookieless tracker (analytics.js) collects
// data after deploy.
// ==============================================

import { dbRest } from './db.js';
import { escHtml } from './utils.js';

let wired = false;
let lastDays = 30;

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

/** Vertical bar chart from a [{d,n}] daily series (CSS bars, responsive). */
function barChart(series, color) {
  const pts = Array.isArray(series) ? series : [];
  const total = pts.reduce((a, p) => a + Number(p.n || 0), 0);
  if (!pts.length || total === 0) {
    return `<div class="an-chart-empty">ยังไม่มีข้อมูลในช่วงนี้ — จะเริ่มแสดงเมื่อมีการใช้งาน</div>`;
  }
  const max = Math.max(1, ...pts.map((p) => Number(p.n || 0)));
  const bars = pts.map((p) => {
    const h = Math.round((Number(p.n || 0) / max) * 100);
    const label = escHtml(`${p.d} · ${fmt(p.n)}`);
    return `<div class="an-bar" style="--h:${h}%;--bar:${color}" title="${label}"><span class="an-bar-val">${p.n > 0 ? fmt(p.n) : ''}</span></div>`;
  }).join('');
  return `<div class="an-bars" role="img" aria-label="กราฟรายวัน">${bars}</div>`;
}

/** Horizontal ranked bars from [{label,n}]. */
function rankBars(rows, color, mapLabel = (x) => x) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) return `<div class="an-chart-empty">ยังไม่มีข้อมูล</div>`;
  const max = Math.max(1, ...items.map((r) => Number(r.n || 0)));
  return `<div class="an-rank">${items.map((r) => {
    const w = Math.round((Number(r.n || 0) / max) * 100);
    // r.label (path / role) can be attacker-controlled — analytics_events
    // is anon-INSERTable, so an injected path must never reach innerHTML raw.
    const disp = escHtml(String(mapLabel(r.label) ?? ''));
    return `<div class="an-rank-row">
      <span class="an-rank-label" title="${disp}">${disp}</span>
      <span class="an-rank-track"><span class="an-rank-fill" style="width:${w}%;background:${color}"></span></span>
      <span class="an-rank-n">${fmt(r.n)}</span>
    </div>`;
  }).join('')}</div>`;
}

const ROLE_TH = {
  user: 'นักศึกษา', vp_admin: 'VP-Admin', dev: 'Dev', pr_staff: 'PR Staff',
  vs_staff: 'VS Staff', uni_staff: 'Uni Staff', shop_admin: 'Shop Admin', sa_prof: 'อาจารย์',
};
const TAB_TH = {
  'tab:home': 'หน้าแรก', 'tab:pr': 'PR', 'tab:vitalsound': 'VitalSound', 'tab:shop': 'ร้านค้า',
  'tab:announcements': 'ประกาศ', 'tab:about': 'เกี่ยวกับ', 'tab:tools': 'เครื่องมือ',
  'tab:departments': 'ฝ่าย', 'tab:team': 'ทีม', 'tab:projects-view': 'ติดตามโครงการ',
};

function tile(num, label, sub, accent) {
  return `<div class="an-kpi" style="--kpi:${accent}">
    <span class="an-kpi-num">${fmt(num)}</span>
    <span class="an-kpi-label">${label}</span>
    ${sub ? `<span class="an-kpi-sub">${sub}</span>` : ''}
  </div>`;
}

function render(body, d) {
  const t = d.totals || {};
  const a = d.active || {};
  const signupsSum = (d.signups_by_day || []).reduce((s, p) => s + Number(p.n || 0), 0);
  const reqSum = (d.requests_by_day || []).reduce((s, p) => s + Number(p.n || 0), 0);
  const gen = d.generated_at ? new Date(d.generated_at).toLocaleString('th-TH') : '';

  body.innerHTML = `
    <div class="an-kpis">
      ${tile(t.users, 'สมาชิกทั้งหมด', 'ลงทะเบียนสะสม', 'var(--brand-primary,#105922)')}
      ${tile(signupsSum, `สมาชิกใหม่ (${d.range_days} วัน)`, 'ในช่วงที่เลือก', 'var(--brand-orange,#FF6F30)')}
      ${tile(a.sessions_wau, 'ผู้เข้าใช้ / สัปดาห์', 'เซสชันไม่ซ้ำ (WAU)', 'var(--vs-accent,#0d9488)')}
      ${tile(a.sessions_mau, 'ผู้เข้าใช้ / เดือน', 'เซสชันไม่ซ้ำ (MAU)', '#6366f1')}
      ${tile(t.requests, 'คำขอทั้งหมด', `PR ${fmt(t.pr)} · VS ${fmt(t.vs)}`, 'var(--pink-500,#d6336c)')}
      ${tile(reqSum, `คำขอ (${d.range_days} วัน)`, 'PR + VitalSound', '#0ea5e9')}
    </div>

    <div class="an-grid">
      <div class="an-card an-card--wide">
        <div class="an-card-head"><h3>สมาชิกใหม่รายวัน</h3><span>รวม ${fmt(signupsSum)} คน</span></div>
        ${barChart(d.signups_by_day, 'var(--brand-orange,#FF6F30)')}
      </div>
      <div class="an-card an-card--wide">
        <div class="an-card-head"><h3>คำขอรายวัน (PR + VS)</h3><span>รวม ${fmt(reqSum)} รายการ</span></div>
        ${barChart(d.requests_by_day, 'var(--pink-500,#d6336c)')}
      </div>
      <div class="an-card an-card--wide">
        <div class="an-card-head"><h3>ผู้เข้าใช้งานรายวัน</h3><span>เซสชันไม่ซ้ำ / วัน</span></div>
        ${barChart(d.visitors_by_day, 'var(--vs-accent,#0d9488)')}
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3>แท็บที่ใช้บ่อย</h3></div>
        ${rankBars((d.top_paths || []).map((p) => ({ label: p.path, n: p.n })), 'var(--brand-primary,#105922)', (l) => TAB_TH[l] || l)}
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3>สัดส่วนบทบาทผู้ใช้</h3></div>
        ${rankBars((d.roles || []).map((r) => ({ label: r.role, n: r.n })), '#6366f1', (l) => ROLE_TH[l] || l)}
      </div>
    </div>
    <p class="an-foot">อัปเดตล่าสุด ${gen} · ข้อมูลผู้เข้าใช้งาน/แท็บเริ่มเก็บหลังเผยแพร่ระบบสถิติ</p>
  `;
}

async function load(days) {
  const body = document.getElementById('analyticsBody');
  if (!body) return;
  lastDays = days;
  body.innerHTML = `<div class="an-loading"><span class="spinner-border spinner-border-sm"></span> กำลังโหลดสถิติ…</div>`;
  const { data, error } = await dbRest('/rpc/analytics_overview', {
    method: 'POST', body: { days }, timeout: 12000,
  });
  if (error || !data) {
    body.innerHTML = `<div class="an-error">โหลดสถิติไม่สำเร็จ${error?.message ? ` — ${String(error.message).slice(0, 140)}` : ''}</div>`;
    return;
  }
  render(body, Array.isArray(data) ? data[0] : data);
}

/** Wire the range selector + refresh button once. */
export function initAnalyticsDashboard() {
  if (wired) return;
  wired = true;
  document.getElementById('analyticsRange')?.addEventListener('change', (e) => {
    load(Number(e.target.value) || 30);
  });
  document.getElementById('analyticsRefresh')?.addEventListener('click', () => load(lastDays));
}

/** Called on section entry — (re)load the current range. */
export function enterAnalytics() {
  const sel = document.getElementById('analyticsRange');
  load(Number(sel?.value) || 30);
}
