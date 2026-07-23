// ==============================================
// home-stats.js — the "SAMO by the numbers" social-proof strip on the
// public landing page. Pulls curated aggregate counts from the
// public_stats() RPC (migration 0065) and renders animated count-up
// tiles. All numbers are real, live, and cached in-memory per page load.
//
// Design intent: this is the first proof a visitor (and the boss) sees
// that real people use the portal — so it animates in on scroll, uses
// the brand palette per tile, and leads with the growth number.
// ==============================================

import { dbRest } from './db.js';

// Which stats to show, in order. `value` maps the public_stats() jsonb
// into a display number (some are computed from multiple fields).
const TILES = [
  {
    key: 'users',
    value: (s) => s.users,
    label: 'สมาชิกที่ลงทะเบียน',
    icon: 'bi-people-fill',
    accent: 'var(--brand-primary, #105922)',
  },
  {
    key: 'requests',
    value: (s) => s.requests,
    label: 'คำขอ PR &amp; VitalSound',
    icon: 'bi-megaphone-fill',
    accent: 'var(--pink-500, #d6336c)',
  },
  {
    key: 'works',
    value: (s) => (s.projects || 0) + (s.documents || 0),
    label: 'โครงการและเอกสาร',
    icon: 'bi-folder-fill',
    accent: 'var(--vs-accent, #0d9488)',
  },
  {
    key: 'growth',
    value: (s) => s.new_users_7d,
    label: 'สมาชิกใหม่ใน 7 วัน',
    icon: 'bi-graph-up-arrow',
    accent: 'var(--brand-orange, #FF6F30)',
    highlight: true,
  },
];

let started = false;

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

/** Animate a number element from 0 → target over ~1.1s. */
function countUp(el, target) {
  const dur = 1100;
  const start = performance.now();
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  function frame(now) {
    const t = Math.min((now - start) / dur, 1);
    el.textContent = fmt(target * easeOutCubic(t));
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = fmt(target);
  }
  requestAnimationFrame(frame);
}

function render(container, stats) {
  const tiles = TILES.map((t, i) => {
    const n = Number(t.value(stats) || 0);
    return `
      <div class="home-stat-tile${t.highlight ? ' is-highlight' : ''}"
           style="--stat-accent:${t.accent}; --stat-delay:${i * 90}ms">
        <span class="home-stat-icon"><i class="bi ${t.icon}"></i></span>
        <span class="home-stat-num" data-target="${n}">0</span>
        <span class="home-stat-label">${t.label}</span>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="home-stats-inner">
      <header class="home-stats-head">
        <span class="home-stats-eyebrow"><span class="home-stats-dot"></span> สถิติการใช้งานจริง</span>
        <h2>SAMO Portal ในตัวเลข</h2>
        <p>ชุมชนนักศึกษาแพทย์ มข. ที่กำลังเติบโตทุกวัน</p>
      </header>
      <div class="home-stats-grid">${tiles}</div>
    </div>`;

  // Count-up when the grid scrolls into view (once).
  const grid = container.querySelector('.home-stats-grid');
  const run = () => {
    if (grid.dataset.ran) return;
    grid.dataset.ran = '1';
    container.querySelectorAll('.home-stat-num').forEach((el) => {
      countUp(el, Number(el.dataset.target || 0));
    });
    grid.classList.add('is-in');
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { run(); io.disconnect(); } });
    }, { threshold: 0.35 });
    io.observe(grid);
  } else {
    run();
  }
  // Fallback: if the visitor deep-linked to another tab, home is hidden at
  // load and the observer may never fire (display:none → 0 numbers, which
  // reads as "nobody uses this"). Force the count-up when the home tab is
  // shown. run() is idempotent (dataset.ran guard), so double-firing is safe.
  document.addEventListener('shown.bs.tab', (e) => {
    if (e.target?.id === 'pills-home-tab') run();
  });
}

/** Fetch curated public counts and render the strip. Best-effort:
 *  on any failure the section stays hidden (never a broken empty box). */
export async function initHomeStats() {
  const container = document.getElementById('homeStats');
  if (!container || started) return;
  started = true;
  try {
    const { data, error } = await dbRest('/rpc/public_stats', {
      method: 'POST', body: {}, timeout: 8000,
    });
    if (error || !data) { started = false; return; }
    const stats = Array.isArray(data) ? data[0] : data;
    if (!stats || !stats.users) { started = false; return; }
    render(container, stats);
    container.classList.remove('d-none');
  } catch {
    started = false;
  }
}
