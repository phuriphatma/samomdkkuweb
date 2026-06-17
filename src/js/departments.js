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
// Tools-per-dept config is the single source of truth — adding a tool
// = one line below. The same definitions are mirrored into
// tab-tools.html so the launcher search picks them up.
// ==============================================

import { escHtml } from './utils.js';

// Each tool is either:
//   { kind: 'tab',      tabId: 'pills-pr-tab', icon, name, desc, color }
//   { kind: 'external', href: 'https://...',   icon, name, desc, color }
//   { kind: 'path',     path: '/projects-view', icon, name, desc, color }
//
// Color uses the same --tool-color CSS var the launcher already styles
// from.
const DEPT_DEFS = {
  admin: {
    eyebrow: 'Department',
    title: 'ฝ่ายบริหารองค์กร',
    icon: 'bi-shield',
    colorVar: '--dept-admin',
    tools: [
      { kind: 'tab', tabId: 'pills-shop-tab', icon: 'bi-bag-heart',
        name: 'ร้านค้า SAMO', desc: 'สั่งซื้อเสื้อ ของที่ระลึก และอื่นๆ',
        color: 'var(--brand-orange)' },
      { kind: 'path', path: '/projects-view', icon: 'bi-folder2',
        name: 'หนังสือโครงการ (มุมมองทั่วไป)',
        desc: 'ดูสถานะหนังสือโครงการที่ SAMO ส่งให้เจ้าหน้าที่ — อ่านอย่างเดียว',
        color: 'var(--brand-primary)' },
    ],
  },
  digital: {
    eyebrow: 'Department',
    title: 'ฝ่ายดิจิทัลและสื่อสารองค์กร',
    icon: 'bi-megaphone',
    colorVar: '--dept-digital',
    tools: [
      { kind: 'tab', tabId: 'pills-pr-tab', icon: 'bi-megaphone-fill',
        name: 'PR Form', desc: 'ฝากงานประชาสัมพันธ์ลง IG / FB ของคณะ',
        color: 'var(--pink-400)' },
    ],
  },
  academic: {
    eyebrow: 'Department',
    title: 'ฝ่ายวิชาการ',
    icon: 'bi-book',
    colorVar: '--dept-academic',
    tools: [
      { kind: 'external', href: 'https://mdkkusamo-acaddatabase.notion.site/MDKKU-SAMO-Academic-Database-222c27821bb280e28e4dfed25056ec14',
        icon: 'bi-journals',
        name: 'SAMO Resource Database (Notion)',
        desc: 'ฐานข้อมูลทรัพยากรการเรียนรู้ของฝ่ายวิชาการ',
        color: 'var(--dept-academic)' },
      { kind: 'external', href: 'https://mseb.md.kku.ac.th/main',
        icon: 'bi-card-checklist',
        name: 'MDKKU Self Exam Bank',
        desc: 'คลังข้อสอบสำหรับฝึกทำด้วยตนเอง',
        color: 'var(--dept-academic)' },
    ],
  },
  strategy: {
    eyebrow: 'Department',
    title: 'ฝ่ายยุทธศาสตร์และพัฒนาองค์กร',
    icon: 'bi-puzzle',
    colorVar: '--dept-strategy',
    tools: [
      { kind: 'tab', tabId: 'pills-vitalsound-tab', icon: 'bi-clipboard2-pulse',
        name: 'VitalSound', desc: 'ส่งคำร้องเรียน / ข้อเสนอแนะให้สโมสร',
        color: 'var(--vs-accent)' },
      { kind: 'external', href: 'https://samomdkkupassport.pages.dev/',
        icon: 'bi-patch-check',
        name: 'SAMO Passport',
        desc: 'เก็บหน่วยกิจกรรมและตรวจสอบสถานะของคุณ',
        color: 'var(--brand-orange)' },
    ],
  },
  media: {
    eyebrow: 'Department',
    title: 'ฝ่ายเวชนิทัศน์',
    icon: 'bi-camera',
    colorVar: '--dept-media',
    tools: [
      { kind: 'external', href: 'https://ge161892.my.canva.site/mdikku', icon: 'bi-globe2',
        name: 'MDI Website', desc: 'เว็บไซต์ของฝ่ายเวชนิทัศน์',
        color: 'var(--dept-media)' },
    ],
  },
  rt: {
    eyebrow: 'Department',
    title: 'ฝ่ายรังสีเทคนิค',
    icon: 'bi-stars',
    colorVar: '--dept-projects',
    tools: [
      { kind: 'external', href: 'https://rtkkustudent.com/lander', icon: 'bi-globe2',
        name: 'RT Website', desc: 'เว็บไซต์ของฝ่ายรังสีเทคนิค',
        color: 'var(--dept-projects)' },
    ],
  },
};

let activeDept = null;

function renderToolCard(tool) {
  const inner = `
    <span class="launcher-tool-icon"><i class="bi ${escHtml(tool.icon)}"></i></span>
    <span class="launcher-tool-body">
      <span class="launcher-tool-name">${escHtml(tool.name)}</span>
      <span class="launcher-tool-desc">${escHtml(tool.desc)}</span>
    </span>
    <i class="bi ${tool.kind === 'external' ? 'bi-box-arrow-up-right' : 'bi-arrow-right'} launcher-tool-arrow" aria-hidden="true"></i>
  `;
  const styleAttr = `style="--tool-color: ${escHtml(tool.color || 'var(--brand-primary)')};"`;
  if (tool.kind === 'external') {
    return `<a class="launcher-tool" ${styleAttr} href="${escHtml(tool.href)}" target="_blank" rel="noopener">${inner}</a>`;
  }
  if (tool.kind === 'path') {
    return `<a class="launcher-tool" ${styleAttr} href="${escHtml(tool.path)}"
              data-dept-tool-path="${escHtml(tool.path)}">${inner}</a>`;
  }
  // tab
  return `<button type="button" class="launcher-tool" ${styleAttr}
             data-dept-tool-tab="${escHtml(tool.tabId)}">${inner}</button>`;
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

  const toolsRoot = document.getElementById('deptsDetailTools');
  if (toolsRoot) {
    toolsRoot.innerHTML = def.tools.map(renderToolCard).join('');
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
