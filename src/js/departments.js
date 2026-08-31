// ==============================================
// DEPARTMENTS — `ฝ่าย` tab drill-down
//
// Level 1 (grid): 10 dept cards, copied verbatim (icon/color/text) from
//                 the original "Our Departments" section that used to
//                 live inside tab-about.html.
// Level 2 (detail): per-ฝ่าย tool list. Tools reuse the .launcher-tool
//                 component so visual consistency carries over from
//                 the เครื่องมือ tab.
//
// TOOLS LIVE IN src/data/tools.js, not here. This file holds only what is
// specific to the ฝ่าย PAGE — title, icon, colour, and the Guidebook/Canva
// resource cards. The tool list used to be duplicated by hand into
// tab-tools.html; both now render from the registry (docs/DEPT-TOOLS.md §2).
// ==============================================

import { escHtml } from './utils.js';
import { convertDriveUrl } from './uploads.js';
import { toolsForDept } from '../data/tools.js';
import { renderToolCards } from './tool-card.js';

const DEPT_DEFS = {
  admin: {
    eyebrow: 'Department',
    title: 'ฝ่ายบริหารองค์กร',
    icon: 'bi-shield',
    colorVar: '--dept-admin',
    // Announcement-style resource cards (cover image/video + title) that open
    // an external link in a new tab. Covers live in /public/dept-admin/.
    cards: [
      { href: 'https://canva.link/vjavei9c6thy5wl', eyebrow: 'Guidebook',
        title: 'Guidebook เหรัญญิก SAMO69',
        cover: '/dept-admin/treasurer-guidebook.png', cta: 'เปิดใน Canva' },
      { href: 'https://canva.link/hlmz649y2e7se85', eyebrow: 'Guidebook',
        title: 'Guidebook ฝ่ายเอกสาร SAMO69',
        cover: '/dept-admin/document-guidebook.png', cta: 'เปิดใน Canva' },
      { href: 'https://canva.link/1ej1lt111zjy079', eyebrow: 'Workflow',
        title: 'Project Workflow SAMO69',
        video: '/dept-admin/project-workflow.mp4', cta: 'เปิดใน Canva' },
      { href: 'https://docs.google.com/forms/d/e/1FAIpQLSc2J4O7sUcUYjNpPeFhbRZMreIBaAAVggUS7U0oFMX7KF_fxQ/viewform?pli=1',
        eyebrow: 'Google Form', title: 'Project 1st Step SAMO69',
        desc: 'Google form แจ้งการทำโครงการ',
        cover: '/dept-admin/project-1st-step.png', cta: 'เปิดฟอร์ม' },
    ]
  },
  digital: {
    eyebrow: 'Department',
    title: 'ฝ่ายดิจิทัลและสื่อสารองค์กร',
    icon: 'bi-megaphone',
    colorVar: '--dept-digital',
  },
  academic: {
    eyebrow: 'Department',
    title: 'ฝ่ายวิชาการ',
    icon: 'bi-book',
    colorVar: '--dept-academic',
  },
  strategy: {
    eyebrow: 'Department',
    title: 'ฝ่ายยุทธศาสตร์และพัฒนาองค์กร',
    icon: 'bi-puzzle',
    colorVar: '--dept-strategy',
  },
  media: {
    eyebrow: 'Department',
    title: 'ฝ่ายเวชนิทัศน์',
    icon: 'bi-camera',
    colorVar: '--dept-media',
  },
  rt: {
    eyebrow: 'Department',
    title: 'ฝ่ายรังสีเทคนิค',
    icon: 'bi-stars',
    colorVar: '--dept-projects',
  },
};

let activeDept = null;

// Announcement-style card (cover image OR looping muted video + title) that
// opens an external link in a new tab. Mirrors renderNewsCard from
// announcements.js so it reads the same as the ประกาศ listing.
function renderNewsLinkCard(card) {
  const media = card.video
    ? `<video src="${escHtml(card.video)}" muted loop autoplay playsinline preload="metadata" aria-hidden="true"></video>`
    : `<img src="${escHtml(convertDriveUrl(card.cover))}" alt="" loading="lazy">`;
  return `
    <a class="news-card" href="${escHtml(card.href)}" target="_blank" rel="noopener">
      <div class="news-card-media">${media}</div>
      <div class="news-card-body">
        ${card.eyebrow ? `<span class="news-eyebrow">${escHtml(card.eyebrow)}</span>` : ''}
        <h4 class="news-card-title">${escHtml(card.title)}</h4>
        ${card.desc ? `<p class="news-card-desc">${escHtml(card.desc)}</p>` : ''}
        <div class="news-meta">
          <span class="news-meta-cta">${escHtml(card.cta || 'เปิดลิงก์')} <i class="bi bi-box-arrow-up-right"></i></span>
        </div>
      </div>
    </a>
  `;
}

function showDept(deptKey) {
  const def = DEPT_DEFS[deptKey];
  if (!def) return;
  activeDept = deptKey;
  const grid = document.getElementById('deptsLevelGrid');
  const detail = document.getElementById('deptsLevelDetail');
  if (!grid || !detail) return;
  grid.classList.add('d-none');
  detail.classList.remove('d-none');

  const header = document.getElementById('deptsDetailHeader');
  if (header) {
    header.style.setProperty('--dept-color', `var(${def.colorVar})`);
  }
  const eyebrow = document.getElementById('deptsDetailEyebrow');
  if (eyebrow) eyebrow.textContent = def.eyebrow;
  const titleEl = document.getElementById('deptsDetailTitle');
  if (titleEl) {
    titleEl.innerHTML = `<i class="bi ${escHtml(def.icon)} me-2" style="color: var(${escHtml(def.colorVar)});"></i>${escHtml(def.title)}`;
  }
  const lead = document.getElementById('deptsDetailLead');
  if (lead) lead.textContent = `เครื่องมือของ${def.title}`;

  renderToolCards(document.getElementById('deptsDetailTools'), toolsForDept(deptKey));

  // Announcement-style resource cards (optional, per-dept).
  const cardsRoot = document.getElementById('deptsDetailCards');
  if (cardsRoot) {
    if (def.cards && def.cards.length) {
      cardsRoot.innerHTML = def.cards.map(renderNewsLinkCard).join('');
      cardsRoot.classList.remove('d-none');
    } else {
      cardsRoot.innerHTML = '';
      cardsRoot.classList.add('d-none');
    }
  }

  // Hash sync — so refresh + share work.
  if (location.hash !== `#dept/${deptKey}`) {
    history.pushState(null, '', `/departments#dept/${deptKey}`);
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
}

function backToGrid() {
  activeDept = null;
  const grid = document.getElementById('deptsLevelGrid');
  const detail = document.getElementById('deptsLevelDetail');
  if (grid && detail) {
    grid.classList.remove('d-none');
    detail.classList.add('d-none');
  }
  if (location.hash.startsWith('#dept/')) {
    history.pushState(null, '', '/departments');
  }
  window.scrollTo({ top: 0, behavior: 'auto' });
}

export function initDepartments() {
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-dept-open]');
    if (open) {
      e.preventDefault();
      showDept(open.dataset.deptOpen);
      return;
    }
    if (e.target.closest('#deptsBackToGrid')) {
      e.preventDefault();
      backToGrid();
      return;
    }
    const tabBtn = e.target.closest('[data-dept-tool-tab]');
    if (tabBtn) {
      e.preventDefault();
      if (typeof window.activateTab === 'function') {
        window.activateTab(tabBtn.dataset.deptToolTab);
      }
      return;
    }
    const pathLink = e.target.closest('[data-dept-tool-path]');
    if (pathLink) {
      e.preventDefault();
      if (typeof window.navigateTo === 'function') {
        window.navigateTo(pathLink.dataset.deptToolPath);
      } else {
        location.href = pathLink.dataset.deptToolPath;
      }
    }
  });

  // Resolve #dept/<key> on first tab show + on hashchange while the
  // ฝ่าย tab is active — supports refresh / direct-link / back-button.
  const applyHash = () => {
    const m = (location.hash || '').match(/^#dept\/(\w+)/);
    if (m) showDept(m[1]); else if (activeDept) backToGrid();
  };
  document.addEventListener('shown.bs.tab', (e) => {
    if (e.target?.id === 'pills-departments-tab') applyHash();
  });
  window.addEventListener('hashchange', () => {
    const departmentsPane = document.getElementById('pills-departments');
    if (departmentsPane?.classList.contains('active')) applyHash();
  });

  // First-load: if URL is /departments#dept/admin (deep-link from somewhere
  // else), open the dept after the path-router activates the tab.
  queueMicrotask(() => {
    if (document.getElementById('pills-departments')?.classList.contains('active')) applyHash();
  });
}
