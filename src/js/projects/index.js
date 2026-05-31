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
import { listProjects, listDocTypes, getSettings, listMyDocViews } from './api.js';
import {
  mountInbox, renderInbox, openProjectDetail, openDocumentDetail,
  setServerDocViews, migrateLocalSeenAtToServer,
} from './inbox.js';
import { mountSendFlow, openCreateProject, openSendDocument } from './send.js';
import { mountManage, renderManage } from './manage.js';
import { mountNotifications, refreshNotificationBell } from './notifications.js';

let initialised = false;
let initialDataLoaded = false;
let currentRole = null;
let currentUser = null;  // full user object — needed for permission check (post-0010)
let view = 'inbox';            // 'inbox' | 'manage'
let tabActive = false;
let cache = {
  projects: [],
  docTypes: [],
  settings: null,
};

/** Allowed to use the projects module?
 *  - dev / uni_staff: always (role default)
 *  - vp_admin: only if their permissions[] includes 'projects'
 *    (so only the อุปนายกฝ่ายบริหารองค์กร account opts in — the
 *    other 9 VPs see VS for their dept but not Projects). */
function isAllowed(user) {
  if (!user) return false;
  if (user.role === 'dev' || user.role === 'uni_staff') return true;
  if (user.role === 'vp_admin'
      && Array.isArray(user.permissions)
      && user.permissions.includes('projects')) return true;
  return false;
}

function setView(next) {
  view = next;
  // Admin shell wraps tab-projects.html in <section data-admin-pane="projects">,
  // not the legacy #pills-projects. The data attributes are unique to the
  // projects feature so we can match them at document scope.
  document.querySelectorAll('[data-projects-view]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.projectsView === next));
  document.querySelectorAll('[data-projects-pane]').forEach((p) =>
    p.classList.toggle('d-none', p.dataset.projectsPane !== next));
  if (next === 'inbox')  renderInbox({ projects: cache.projects, docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
  if (next === 'manage') renderManage({ docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
}

function applyRoleVisibility(user) {
  currentUser = user;
  const role = user?.role || null;
  currentRole = role;
  const allowed = isAllowed(user);
  document.getElementById('navProjectsItem')?.classList.toggle('d-none', !allowed);
  document.getElementById('mobileProjectsItem')?.classList.toggle('d-none', !allowed);
  document.getElementById('navProjectsBell')?.classList.toggle('d-none', !allowed);
  document.getElementById('navProjectsBellMobile')?.classList.toggle('d-none', !allowed);

  // The "เจ้าหน้าที่" section heading inside the avatar dropdown and the
  // mobile offcanvas should appear when ANY staff-only item is visible.
  // Recompute here too because projects role-resolution runs independently
  // of the global auth subscriber in main.js.
  const showStaffSection = allowed
    || !document.getElementById('navAdminItem')?.classList.contains('d-none');
  document.getElementById('navStaffSection')?.classList.toggle('d-none', !showStaffSection);
  document.getElementById('mobileStaffSection')?.classList.toggle('d-none', !showStaffSection);

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
  if (!isAllowed(currentUser)) return;
  try {
    // docViews join the in-flight load so the inbox renders with the
    // server-synced seenAt baked in — no second pass / re-flash.
    const [projects, docTypes, settings, docViews] = await Promise.all([
      listProjects().catch(() => []),
      listDocTypes({ activeOnly: false }).catch(() => []),
      getSettings().catch(() => null),
      currentUser?.id ? listMyDocViews(currentUser.id).catch(() => []) : Promise.resolve([]),
    ]);
    cache.projects = projects || [];
    cache.docTypes = docTypes || [];
    cache.settings = settings;
    setServerDocViews(docViews);
    initialDataLoaded = true;
    if (view === 'inbox')  renderInbox({ projects: cache.projects, docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
    if (view === 'manage') renderManage({ docTypes: cache.docTypes, settings: cache.settings, role: currentRole });
    refreshNotificationBell();
    // One-shot: push any legacy localStorage seenAt up to the server so
    // this user's other devices stop showing "many notifications" for
    // events they already ack'd here. Filtered to docs they can see so
    // the FK constraint resolves. Runs at most once per (user, device)
    // via a sentinel in localStorage.
    if (currentUser?.id) {
      const knownIds = [];
      for (const p of cache.projects) {
        for (const d of (p.documents || [])) knownIds.push(d.id);
      }
      migrateLocalSeenAtToServer(currentUser.id, knownIds).catch((err) =>
        console.warn('[projects] seenAt bulk migration failed:', err?.message || err));
    }
  } catch (e) {
    console.error('[projects] initial data load failed:', e);
  }
}

/** Public: re-read everything and re-render. Called after any write action.
 *  Optional { projectId, documentId } auto-opens that item in the detail
 *  pane — used after the create/send flow so the user lands on the thing
 *  they just made instead of an empty state. */
export async function reloadProjects(focus = {}) {
  const [projects, docTypes, settings, docViews] = await Promise.all([
    listProjects().catch(() => cache.projects),
    listDocTypes({ activeOnly: false }).catch(() => cache.docTypes),
    getSettings().catch(() => cache.settings),
    currentUser?.id ? listMyDocViews(currentUser.id).catch(() => null) : Promise.resolve(null),
  ]);
  cache = { projects, docTypes, settings };
  // Only repopulate from server when the fetch actually succeeded —
  // a transient failure shouldn't blow away the in-memory map and
  // re-flash every highlight.
  if (Array.isArray(docViews)) setServerDocViews(docViews);
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

/** Public: entry-point used by the admin app's sidebar. Same as
 *  openProjectsTab() but skips the Bootstrap-tab activation (admin
 *  doesn't use Bootstrap tabs — the sidebar drives section switching
 *  directly via showAdminSide). Ensures loadInitialData runs so the
 *  inbox isn't blank on first open. */
export async function enterProjectsWorkspace() {
  tabActive = true;
  setView('inbox');
  if (!initialDataLoaded) await loadInitialData();
}

function applyHashRoute() {
  const hash = window.location.hash || '';
  // #projects, #projects/PRJ-..., #projects/PRJ-.../doc/DOC-...
  if (!/^#projects(\/|$)/.test(hash)) return;
  const parts = hash.replace(/^#projects\/?/, '').split('/');
  // ['PRJ-K3X7', 'doc', 'DOC-AB2KX']
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

  // Sub-nav — delegate at document level so the click works from any
  // access point (inline subnav in tab-projects.html, future sidebar
  // items, etc.). `[data-projects-view]` is unique to this feature.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-projects-view]');
    if (!btn) return;
    setView(btn.dataset.projectsView);
  });

  // Create-project header button (always opens the create flow).
  // The FAB is wired inside mountInbox() so its action can flip with the
  // current view (grid → create project; detail → add doc to that project).
  document.getElementById('projectsCreateBtn')?.addEventListener('click', () => openCreateProject());

  mountInbox({
    onChanged: reloadProjects,
    onAddDocument: (project) => openSendDocument({ project }),
    onCreateProject: () => openCreateProject(),
  });
  mountSendFlow({ onCreated: reloadProjects });
  mountManage({ onChanged: reloadProjects });
  mountNotifications({ onJump: ({ projectId, documentId }) => openProjectsTab({ projectId, documentId }) });

  // Auth subscriber. Track the previous user id so we can detect a
  // genuine account switch (not just a token refresh that re-fires
  // the same user) and wipe the in-memory doc-views map — otherwise
  // account B inherits account A's "I've seen this" flags on the
  // same browser.
  let lastUserId = null;
  onAuthChange((user) => {
    applyRoleVisibility(user);
    const switched = !!user && user.id !== lastUserId;
    lastUserId = user?.id || null;
    if (switched) {
      // Drop the previous user's seenAt mirror before any render runs.
      // loadInitialData below will repopulate it from the new user's
      // project_doc_views rows.
      setServerDocViews([]);
      initialDataLoaded = false;
    }
    if (isAllowed(user) && tabActive && !initialDataLoaded) {
      loadInitialData();
    }
    if (!user) {
      cache = { projects: [], docTypes: [], settings: null };
      initialDataLoaded = false;
      setServerDocViews([]);
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

  // bfcache restore (`event.persisted === true`): iOS / iPadOS Safari
  // restores the WHOLE page from memory when the user switches back
  // to the tab, so cache.projects is whatever was in memory when they
  // left. A new comment / file added by the other side while we were
  // backgrounded is invisible until the user does something that
  // happens to refetch — and "the highlights don't show" is exactly
  // how that looks. Force a fresh fetch on every bfcache restore.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    if (!isAllowed(currentUser)) return;
    reloadProjects().catch((err) =>
      console.warn('[projects] pageshow reload failed:', err?.message || err));
  });
}
