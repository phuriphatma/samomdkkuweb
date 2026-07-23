// ==============================================
// home-stats.js — the "SAMO by the numbers" social-proof strip on the
// public landing page. Pulls curated aggregate counts from the
// public_stats() RPC (migration 0065/0066) and renders:
//   1. animated count-up community tiles (members, growth, projects, depts)
//   2. two animated donut rings — PR and VitalSound service completion
//      (how many requested vs how many done), the "cool graph".
// All numbers are real and live; the strip stays hidden on any failure.
// ==============================================

import { dbRest } from './db.js';

const RING_R = 60;
const RING_C = 2 * Math.PI * RING_R; // circumference

let started = false;

// Community count-up tiles (top row).
const TILES = [
  { value: (s) => s.users,                         label: 'สมาชิกที่ลงทะเบียน', icon: 'bi-people-fill',      accent: 'var(--brand-primary, #105922)' },
  { value: (s) => s.new_users_7d,                  label: 'สมาชิกใหม่ใน 7 วัน',  icon: 'bi-graph-up-arrow',   accent: 'var(--brand-orange, #FF6F30)', highlight: true },
  { value: (s) => (s.projects || 0) + (s.documents || 0), label: 'โครงการและเอกสาร', icon: 'bi-folder-fill', accent: '#6366f1' },
  { value: (s) => s.departments,                   label: 'ฝ่ายที่ใช้งาน',       icon: 'bi-grid-3x3-gap-fill', accent: '#0ea5e9' },
];

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

/** Animate any number element (data-target) from 0 → target. */
function countUp(el, target) {
  const dur = 1200;
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

/** SVG donut ring; fills to `pct` via CSS when .is-in is set on an ancestor. */
function donut(pct, color) {
  const off = (RING_C * (1 - Math.max(0, Math.min(100, pct)) / 100)).toFixed(1);
  return `<svg class="svc-ring-svg" viewBox="0 0 140 140" aria-hidden="true">
      <circle class="svc-ring-track" cx="70" cy="70" r="${RING_R}"></circle>
      <circle class="svc-ring-fill" cx="70" cy="70" r="${RING_R}"
              style="--c:${RING_C.toFixed(1)};--off:${off};stroke:${color}"></circle>
    </svg>`;
}

function docStat(icon, label, value) {
  return `<div class="home-project-stat">
    <span class="home-project-stat-icon"><i class="bi ${icon}"></i></span>
    <span class="home-project-stat-num" data-target="${Number(value || 0)}">0</span>
    <span class="home-project-stat-label">${label}</span>
  </div>`;
}

/** หนังสือโครงการ — its own grouped panel: completion ring + all its
 *  sub-metrics together, so it reads as one domain (not mixed with PR/VS). */
function projectPanel(s) {
  const docs = Number(s.documents || 0);
  const done = Number(s.doc_completed || 0);
  const pct = docs > 0 ? Math.round((done / docs) * 100) : 0;
  const green = 'var(--brand-primary, #105922)';
  return `<div class="home-project-panel">
    <div class="home-project-head">
      <span class="home-project-icon"><i class="bi bi-folder-fill"></i></span>
      <div class="home-project-titles">
        <h3>หนังสือโครงการ</h3>
        <p>ระบบส่ง–รับ–ลงนามเอกสารโครงการ</p>
      </div>
    </div>
    <div class="home-project-body">
      <div class="svc-ring home-project-ring" style="--svc:${green}">
        ${donut(pct, green)}
        <div class="svc-ring-center">
          <span class="svc-pct"><span data-target="${pct}">0</span>%</span>
          <span class="svc-pct-label">สำเร็จ</span>
        </div>
      </div>
      <div class="home-project-stats">
        ${docStat('bi-file-earmark-text-fill', 'หนังสือทั้งหมด', docs)}
        ${docStat('bi-check-circle-fill', 'สำเร็จ', done)}
        ${docStat('bi-pen-fill', 'ลงนามแล้ว', s.doc_signed)}
        ${docStat('bi-arrow-left-right', 'ธุรกรรม', s.doc_transactions)}
        ${docStat('bi-chat-dots-fill', 'การโต้ตอบ', s.doc_interactions)}
        ${docStat('bi-diagram-3-fill', 'โครงการ', s.projects)}
      </div>
    </div>
  </div>`;
}

function serviceCard(name, icon, total, completed, color) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return `<div class="svc-card" style="--svc:${color}">
    <div class="svc-ring">
      ${donut(pct, color)}
      <div class="svc-ring-center">
        <span class="svc-pct"><span data-target="${pct}">0</span>%</span>
        <span class="svc-pct-label">เสร็จสิ้น</span>
      </div>
    </div>
    <div class="svc-meta">
      <span class="svc-name"><i class="bi ${icon}"></i> ${name}</span>
      <span class="svc-counts"><b data-target="${completed}">0</b> เสร็จสิ้น จาก <span data-target="${total}">0</span> คำขอ</span>
    </div>
  </div>`;
}

function render(container, s) {
  const tiles = TILES.map((t, i) => `
    <div class="home-stat-tile${t.highlight ? ' is-highlight' : ''}"
         style="--stat-accent:${t.accent}; --stat-delay:${i * 80}ms">
      <span class="home-stat-icon"><i class="bi ${t.icon}"></i></span>
      <span class="home-stat-num" data-target="${Number(t.value(s) || 0)}">0</span>
      <span class="home-stat-label">${t.label}</span>
    </div>`).join('');

  container.innerHTML = `
    <div class="home-stats-inner">
      <header class="home-stats-head">
        <span class="home-stats-eyebrow"><span class="home-stats-dot"></span> สถิติการใช้งานจริง</span>
        <h2>SAMO Portal ในตัวเลข</h2>
        <p>ชุมชนนักศึกษาแพทย์ มข. ที่กำลังเติบโตและให้บริการทุกวัน</p>
      </header>

      <div class="home-stats-grid">${tiles}</div>

      <div class="home-stats-services">
        <h3 class="home-services-title">งานบริการรับเรื่องนักศึกษา</h3>
        <div class="home-services-grid">
          ${serviceCard('งานประชาสัมพันธ์ (PR)', 'bi-megaphone-fill', Number(s.pr_total || 0), Number(s.pr_completed || 0), 'var(--pink-500, #d6336c)')}
          ${serviceCard('VitalSound', 'bi-clipboard2-pulse-fill', Number(s.vs_total || 0), Number(s.vs_completed || 0), 'var(--vs-accent, #0d9488)')}
        </div>
      </div>

      ${projectPanel(s)}
    </div>`;

  const inner = container.querySelector('.home-stats-inner');
  const run = () => {
    if (inner.dataset.ran) return;
    inner.dataset.ran = '1';
    inner.classList.add('is-in'); // triggers tile entrance + ring fill
    container.querySelectorAll('[data-target]').forEach((el) => countUp(el, Number(el.dataset.target || 0)));
  };

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { run(); io.disconnect(); } });
    }, { threshold: 0.2 });
    io.observe(inner);
  } else {
    run();
  }
  // Deep-link-to-other-tab fallback: home hidden at load → IO may not fire.
  // run() is idempotent, so forcing it when the home tab shows is safe.
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
    const s = Array.isArray(data) ? data[0] : data;
    if (!s || !s.users) { started = false; return; }
    render(container, s);
    container.classList.remove('d-none');
  } catch {
    started = false;
  }
}
