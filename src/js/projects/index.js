// ==============================================
// PROJECTS — Entry point
//
// initProjects() is called from main.js on DOMContentLoaded. It:
//   - subscribes to auth so visibility flips when a vp_admin / uni_staff
//     / dev signs in (or out)
//   - wires sub-nav buttons inside #pills-projects
//   - lazy-loads project + doc-type data on first tab show
//   - exposes openProjectsTab() so other modules / hash routing can jump in
// ==============================================

import { onAuthChange, getUser } from '../auth.js';
import { listProjects, listDocTypes, getSettings } from './api.js';
import { mountInbox, renderInbox, openProjectDetail, openDocumentDetail } from './inbox.js';
import { mountSendFlow, openCreateProject, openSendDocument } from './send.js';
import { mountManage, renderManage } from './manage.js';
import { mountNotifications, refreshNotificationBell } from './notifications.js';

const ROLES_ALLOWED = ['vp_admin', 'uni_staff', 'dev'];

let initialised = false;
let initialDataLoaded = false;
let currentRole = null;
let view = 'inbox';            // 'inbox' | 'manage'
let tabActive = false;
let cache = {
  projects: [],
  docTypes: [],
  settings: null,
};

function isAllowed(role) { return ROLES_ALLOWED.includes(role); }

function setView(next) {
  view = next;
  document.querySelectorAll('#projectsSubnav [data-projects-view]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.projectsView === next));
  document.querySelectorAll('#pills-projects [data-projects-pane]').forEach((p) =>
    p.classList.toggle('d-none', p.dataset.projectsPane !== next));
  if (next === 'inbox')  renderInbox({ projects: cache.projects, docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
  if (next === 'manage') renderManage({ docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
}

function applyRoleVisibility(role) {
  currentRole = role;
  const allowed = isAllowed(role);
  document.getElementById('navProjectsItem')?.classList.toggle('d-none', !allowed);
  document.getElementById('mobileProjectsItem')?.classList.toggle('d-none', !allowed);
  document.getElementById('navProjectsBell')?.classList.toggle('d-none', !allowed);

  // Inside the tab: the "send new" button is vp_admin/dev only; manage stays
  // for both (so uni_staff can adjust her own labels later if needed — but
  // settings RLS still blocks her from saving, the UI just shows read-only).
  document.querySelectorAll('[data-projects-role="vp_admin"]').forEach((el) => {
    const ok = role === 'vp_admin' || role === 'dev';
    el.classList.toggle('d-none', !ok);
  });
  document.querySelectorAll('[data-projects-role="uni_staff"]').forEach((el) => {
    const ok = role === 'uni_staff' || role === 'dev';
    el.classList.toggle('d-none', !ok);
  });

  // Page title / hint: differs by role
  const hint = document.getElementById('projectsRoleHint');
  if (hint) {
    if (role === 'vp_admin') hint.textContent = 'ส่งหนังสือโครงการให้เจ้าหน้าที่ และติดตามสถานะ';
    else if (role === 'uni_staff') hint.textContent = 'รับเรื่อง / อัปเดตสถานะหนังสือโครงการจาก SAMO';
    else if (role === 'dev') hint.textContent = 'Dev — เห็นทั้งสองด้านของระบบส่งหนังสือ';
    else hint.textContent = '';
  }

  // Auth-gate inside the tab (visible to non-actors)
  const gate = document.getElementById('projectsAuthGate');
  if (gate) gate.classList.toggle('d-none', allowed);
  const body = document.getElementById('projectsBody');
  if (body) body.classList.toggle('d-none', !allowed);
}

async function loadInitialData() {
  if (!isAllowed(currentRole)) return;
  try {
    const [projects, docTypes, settings] = await Promise.all([
      listProjects().catch(() => []),
      listDocTypes({ activeOnly: false }).catch(() => []),
      getSettings().catch(() => null),
    ]);
    cache.projects = projects || [];
    cache.docTypes = docTypes || [];
    cache.settings = settings;
    initialDataLoaded = true;
    if (view === 'inbox')  renderInbox({ projects: cache.projects, docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
    if (view === 'manage') renderManage({ docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
    refreshNotificationBell();
  } catch (e) {
    console.error('[projects] initial data load failed:', e);
  }
}

/** Public: re-read everything and re-render. Called after any write action.
 *  Optional { projectId, documentId } auto-opens that item in the detail
 *  pane — used after the create/send flow so the user lands on the thing
 *  they just made instead of an empty state. */
export async function reloadProjects(focus = {}) {
  const [projects, docTypes, settings] = await Promise.all([
    listProjects().catch(() => cache.projects),
    listDocTypes({ activeOnly: false }).catch(() => cache.docTypes),
    getSettings().catch(() => cache.settings),
  ]);
  cache = { projects, docTypes, settings };
  if (view === 'inbox')  renderInbox({ projects: cache.projects, docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
  if (view === 'manage') renderManage({ docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
  refreshNotificationBell();
  if (focus.documentId)      openDocumentDetail(focus.documentId);
  else if (focus.projectId)  openProjectDetail(focus.projectId);
}

export function getCachedDocTypes() { return cache.docTypes; }
export function getCachedProjects() { return cache.projects; }
export function getCachedSettings() { return cache.settings; }

function activateProjectsTab() {
  if (typeof window.activateTab === 'function') {
    window.activateTab('pills-projects-tab');
  } else {
    document.getElementById('pills-projects-tab')?.click();
  }
}

/** Public: jump to the projects tab and (optionally) open a specific item. */
export async function openProjectsTab({ projectId, documentId } = {}) {
  activateProjectsTab();
  setView('inbox');
  if (!initialDataLoaded) await loadInitialData();
  if (documentId) openDocumentDetail(documentId);
  else if (projectId) openProjectDetail(projectId);
}

function applyHashRoute() {
  const hash = window.location.hash || '';
  // #projects, #projects/PRJ-..., #projects/PRJ-.../doc/DOC-...
  if (!/^#projects(\/|$)/.test(hash)) return;
  const parts = hash.replace(/^#projects\/?/, '').split('/');
  // ['PRJ-2605-0001', 'doc', 'DOC-260526-1430-XXXX']
  if (parts[0] && parts[0] !== '') {
    const projectId = parts[0];
    const documentId = parts[1] === 'doc' ? parts[2] : null;
    openProjectsTab({ projectId, documentId });
  } else {
    openProjectsTab();
  }
}

export function initProjects() {
  if (initialised) return;
  initialised = true;

  // Sub-nav
  document.getElementById('projectsSubnav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-projects-view]');
    if (!btn) return;
    setView(btn.dataset.projectsView);
  });

  // Create-project button (VP-Admin)
  document.getElementById('projectsCreateBtn')?.addEventListener('click', () => openCreateProject());
  document.getElementById('projectsCreateFab')?.addEventListener('click', () => openCreateProject());

  mountInbox({
    onChanged: reloadProjects,
    onAddDocument: (project) => openSendDocument({ project }),
  });
  mountSendFlow({ onCreated: reloadProjects });
  mountManage({ onChanged: reloadProjects });
  mountNotifications({ onJump: ({ projectId, documentId }) => openProjectsTab({ projectId, documentId }) });

  // Auth subscriber
  onAuthChange((user) => {
    applyRoleVisibility(user?.role || null);
    if (isAllowed(user?.role) && tabActive && !initialDataLoaded) {
      loadInitialData();
    }
    if (!user) {
      cache = { projects: [], docTypes: [], settings: null };
      initialDataLoaded = false;
    }
  });

  // Lazy first load on tab show
  document.addEventListener('shown.bs.tab', async (e) => {
    if (e.target?.id === 'pills-projects-tab') {
      tabActive = true;
      if (!initialDataLoaded) {
        const grid = document.getElementById('projectsGrid');
        if (grid && grid.childElementCount === 0) {
          grid.innerHTML = `<div class="text-center text-muted py-5"><div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลด…</div>`;
        }
        await loadInitialData();
      }
    } else {
      tabActive = false;
    }
  });

  // Hash routing — deep-link into a specific project / document
  window.addEventListener('hashchange', applyHashRoute);
  // Apply once on load too, in case the page is opened with a hash already.
  if (/^#projects(\/|$)/.test(window.location.hash || '')) {
    // Defer until DOMContentLoaded path has wired everything
    setTimeout(applyHashRoute, 0);
  }
}
