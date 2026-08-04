// ==============================================
// changelog.js — renders the public release-notes page (/updates) from
// src/data/changelog.js, and stamps the current version into the footer bar.
//
// Everything here is static data bundled at build time: no network call, so the
// page cannot half-render or show a spinner that never resolves.
//
// MOTION: every entrance is driven by IntersectionObserver adding a class, and
// the animation itself is CSS. There is deliberately NO scroll listener — a
// scroll-linked progress bar is the obvious way to build the "line draws itself
// as you read" effect and it janks on exactly the mid-range phones this site is
// read on. Per-release segments that fill when they come into view give the
// same impression for free. All of it collapses under prefers-reduced-motion.
// ==============================================

import { RELEASES, LATEST, AREAS, CHANGE_TYPES, LEVELS, MAJOR_STORY } from '../data/changelog.js';
import { escHtml } from './utils.js';

const $ = (id) => document.getElementById(id);

// Type order inside a release. `new` first because it is what people came for.
const TYPE_ORDER = ['new', 'improved', 'fixed'];

let filter = 'all';
let painted = false;
let io = null;

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** 2026-07-24 → "24 ก.ค. 2569". The site is Thai; the data is ISO. */
export function thaiDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  const [, y, mo, d] = m;
  return `${Number(d)} ${THAI_MONTHS_SHORT[Number(mo) - 1]} ${Number(y) + 543}`;
}

/** "กรกฎาคม 2569" — the sticky divider between months. */
export function thaiMonth(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return `${THAI_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
}

/** Releases matching the active audience filter. */
export function visibleReleases(releases, aud) {
  return aud === 'all' ? releases.slice() : releases.filter((r) => r.audience === aud);
}

/** Whole weeks the project has been running, for the hero. */
export function spanWeeks(releases) {
  if (!releases.length) return 0;
  const ts = releases.map((r) => new Date(`${r.date}T00:00:00Z`).getTime());
  return Math.max(1, Math.round((Math.max(...ts) - Math.min(...ts)) / (7 * 86400000)));
}

function areaChips(areas) {
  return (areas || []).map((key) => {
    const a = AREAS[key];
    if (!a) return '';
    return `<span class="cl-area"><i class="bi ${a.icon}" aria-hidden="true"></i>${escHtml(a.label)}</span>`;
  }).join('');
}

function changeGroup(type, items) {
  if (!items.length) return '';
  const t = CHANGE_TYPES[type];
  return `
    <div class="cl-group cl-group--${type}">
      <h4 class="cl-group-head">
        <i class="bi ${t.icon}" aria-hidden="true"></i>${escHtml(t.label)}
        <span class="cl-group-n">${items.length}</span>
      </h4>
      <ul class="cl-changes">
        ${items.map((c, i) => `<li style="--j:${i}">${escHtml(c.text)}</li>`).join('')}
      </ul>
    </div>`;
}

function releaseCard(r, i, showMonth) {
  const lvl = LEVELS[r.level] || LEVELS.minor;
  const groups = TYPE_ORDER
    .map((t) => changeGroup(t, r.changes.filter((c) => c.type === t)))
    .join('');
  const divider = showMonth
    ? `<li class="cl-monthmark" aria-hidden="true"><span>${escHtml(thaiMonth(r.date))}</span></li>`
    : '';
  return `${divider}
    <li class="cl-release cl-release--${escHtml(r.level)}" id="v${escHtml(r.version)}" style="--i:${i}">
      <span class="cl-node" aria-hidden="true"></span>
      <div class="cl-rail">
        <a class="cl-version" href="#v${escHtml(r.version)}"
           aria-label="ลิงก์ไปยังเวอร์ชัน ${escHtml(r.version)}">v${escHtml(r.version)}</a>
        <span class="cl-level" title="${escHtml(lvl.hint)}">${escHtml(lvl.label)}</span>
        <time class="cl-date" datetime="${escHtml(r.date)}">${escHtml(thaiDate(r.date))}</time>
      </div>
      <div class="cl-body">
        <div class="cl-areas">${areaChips(r.areas)}</div>
        ${MAJOR_STORY[r.version]
          ? `<p class="cl-story"><i class="bi bi-flag-fill" aria-hidden="true"></i>${escHtml(MAJOR_STORY[r.version])}</p>`
          : ''}
        <h3 class="cl-release-title">${escHtml(r.title)}</h3>
        ${r.summary ? `<p class="cl-summary">${escHtml(r.summary)}</p>` : ''}
        ${groups}
      </div>
    </li>`;
}

/** (Re)attach the entrance observer to whatever is currently in the list. */
function observe(list) {
  if (io) io.disconnect();
  if (!('IntersectionObserver' in window)) {
    list.querySelectorAll('.cl-release, .cl-monthmark').forEach((el) => el.classList.add('is-in'));
    return;
  }
  io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      io.unobserve(e.target); // one-way: re-animating on scroll-up is nausea, not delight
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
  list.querySelectorAll('.cl-release, .cl-monthmark').forEach((el) => io.observe(el));
}

function paint() {
  const list = $('clList');
  const count = $('clCount');
  if (!list) return;
  const rows = visibleReleases(RELEASES, filter);

  let lastMonth = null;
  list.innerHTML = rows.map((r, i) => {
    const m = r.date.slice(0, 7);
    const show = m !== lastMonth;
    lastMonth = m;
    // Stagger ONLY the first screenful. Every card below the fold reveals on its
    // own as it scrolls in, so a stagger delay there is not a cascade — it is a
    // fixed lag between "I scrolled to it" and "it appeared", on every card.
    return releaseCard(r, i < 5 ? i : 0, show);
  }).join('');

  if (count) {
    count.textContent = rows.length === RELEASES.length
      ? `ทั้งหมด ${RELEASES.length} เวอร์ชัน`
      : `${rows.length} จาก ${RELEASES.length} เวอร์ชัน`;
  }
  observe(list);
}

function heroStat(value, label, suffix = '') {
  return `
    <div class="cl-herostat">
      <dt class="cl-herostat-num" data-count="${value}" data-suffix="${suffix}">0${suffix}</dt>
      <dd class="cl-herostat-label">${escHtml(label)}</dd>
    </div>`;
}

function paintHero() {
  const host = $('clHeroStats');
  if (!host) return;
  const changes = RELEASES.reduce((n, r) => n + r.changes.length, 0);
  const majors = RELEASES.filter((r) => r.level === 'major').length;
  host.innerHTML = `
    ${heroStat(RELEASES.length, 'Releases')}
    ${heroStat(majors, 'Major releases')}
    ${heroStat(changes, 'Changes')}
    ${heroStat(spanWeeks(RELEASES), 'Weeks')}`;
}

let heroAnimated = false;

/**
 * Run the hero entrance. Separate from paintHero because on a DIRECT load of
 * /updates the paint happens while the pane is still display:none — the
 * count-up would run to completion unseen and the reader would arrive at
 * static numbers. That is the most likely way someone opens this page, since
 * it is the link people share.
 */
function animateHero() {
  const host = $('clHeroStats');
  if (!host || heroAnimated) return;
  heroAnimated = true;

  const ease = (t) => 1 - (1 - t) ** 3;
  host.querySelectorAll('[data-count]').forEach((el, i) => {
    const target = Number(el.dataset.count || 0);
    const suffix = el.dataset.suffix || '';
    const start = performance.now() + i * 90;
    const step = (now) => {
      const t = Math.min(Math.max((now - start) / 900, 0), 1);
      el.textContent = Math.round(target * ease(t)) + suffix;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  host.closest('.cl-hero')?.classList.add('is-in');
}

/** Slide the filter indicator under the active button. */
function moveFilterPill() {
  const pill = $('clFilterPill');
  const active = document.querySelector('.cl-filter.is-active');
  if (!pill || !active) return;
  pill.style.width = `${active.offsetWidth}px`;
  pill.style.transform = `translateX(${active.offsetLeft}px)`;
}

/** The version chip in the footer bar — present on every page, and the quietest
 *  possible entry point into this page. */
function stampFooterVersion() {
  const host = document.querySelector('.samo-footer-meta');
  if (!host) return;
  host.innerHTML = `MDKKU SAMO Portal
    <a class="samo-footer-version" href="/updates"
       onclick="event.preventDefault(); window.openUpdates && window.openUpdates();"
       title="ดูบันทึกการเปลี่ยนแปลงทั้งหมด">v${escHtml(LATEST.version)}</a>`;
}

export function initChangelog() {
  stampFooterVersion();

  const tab = $('pills-updates');
  if (!tab) return;

  document.querySelectorAll('[data-cl-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.clFilter;
      document.querySelectorAll('[data-cl-filter]').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
      });
      moveFilterPill();
      paint();
    });
  });
  window.addEventListener('resize', moveFilterPill);

  // Paint on first reveal rather than at boot: this tab is off-screen for most
  // visits, and there is no reason for its ~20 cards to be in the DOM until
  // someone actually opens it.
  const ensure = () => {
    if (painted) return;
    painted = true;
    paintHero();
    paint();
  };

  /**
   * Anything that needs real geometry, re-run every time the tab is shown.
   *
   * A deep link to /updates paints BEFORE the router activates the tab, so at
   * paint time the pane is still display:none — `offsetWidth`/`offsetLeft` are
   * 0 (the filter pill collapses to nothing) and the IntersectionObserver sees
   * no intersections (every release stays at opacity 0). Both have to be redone
   * once the pane actually has a box. `observe()` re-observes from scratch and
   * `is-in` is additive, so this is safe to run repeatedly.
   */
  const refresh = () => {
    moveFilterPill();
    animateHero();
    const list = $('clList');
    if (list && painted) observe(list);
  };

  document.addEventListener('shown.bs.tab', (e) => {
    if (e.target?.id !== 'pills-updates-tab') return;
    ensure();
    requestAnimationFrame(refresh);
  });
  // Deep link straight to /updates. The path router activates the tab a
  // microtask later, which DOES fire shown.bs.tab and therefore refresh() —
  // painting here just means the cards exist before that happens.
  if (tab.classList.contains('active') || location.pathname === '/updates') {
    ensure();
    requestAnimationFrame(refresh);
  }
}
