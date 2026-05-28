// ==============================================
// ADMIN-MAIN.JS — entry point for the operator app at /admin/
// Mirrors src/js/main.js but only imports admin-only modules.
// Same Supabase auth, same dbRest helpers, same modals.
// Shares the auth session with the public app (supabase-js
// persists in localStorage on the same origin).
// ==============================================

import { QUILL_TOOLBAR } from './config.js';
import { uploadImageToDrive } from './uploads.js';

// Auth (shared with public)
import { initAuth, onAuthChange, signOut as samoSignOut, signInWithPassword, registerWithPassword, signInWithGoogle, getUser as authGetUser, userCanAccess } from './auth.js';

// Announcements / Creator
import { initAnnouncements, loadAnnouncements, publishAnnouncement, cancelEdit, setCreatorMode } from './announcements.js';

// PR Staff
import { fetchPRStaffTickets, filterPRStaffTickets, enterPRStaffDashboard, openPRStaffModal, submitPRStaffAction, deletePRStaffAction, openManageAgentsModal, addNewAgent, removeAgent, addPRStaffAssignee, removePRStaffAssignee } from './pr-staff.js';

// VS Staff
import { fetchStaffTickets, enterVSStaffDashboard, openStaffModalByIndex, submitStaffAction, deleteCurrentVSTicket, setVsKanbanHideEmpty } from './vs-staff.js';

// Shop admin
import { initShop, openShopAdmin } from './shop/index.js';

// Projects
import { initProjects, enterProjectsWorkspace } from './projects/index.js';

// ==============================================
// QUILL — creator only (no VS form in admin)
// ==============================================

const Size = Quill.import('attributors/style/size');
Size.whitelist = ['10px', '12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px', '32px'];
Quill.register(Size, true);

function makeQuillImageHandler(quillRef) {
  return function imageHandler() {
    const quill = quillRef();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.click();
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const range = quill.getSelection(true);
      quill.insertText(range.index, 'กำลังอัปโหลดรูป…', { italic: true, color: '#94a3b8' });
      const placeholderLength = 'กำลังอัปโหลดรูป…'.length;
      try {
        const url = await uploadImageToDrive(file);
        quill.deleteText(range.index, placeholderLength);
        quill.insertEmbed(range.index, 'image', url, 'user');
        quill.setSelection(range.index + 1);
      } catch (err) {
        quill.deleteText(range.index, placeholderLength);
        alert('อัปโหลดรูปไม่สำเร็จ: ' + (err.message || err));
      }
    };
  };
}

let creatorQuillRef = null;
const creatorQuill = new Quill('#creatorQuillEditor', {
  theme: 'snow',
  placeholder: 'เขียนรายละเอียดประกาศของคุณที่นี่...',
  modules: {
    toolbar: {
      container: QUILL_TOOLBAR,
      handlers: { image: makeQuillImageHandler(() => creatorQuillRef) },
    },
  },
});
creatorQuillRef = creatorQuill;

initAnnouncements(creatorQuill);

// ==============================================
// CREATOR HELPERS — needed by tab-creator.html onclick handlers
// ==============================================

window.onCreatorThumbPicked = async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const preview = document.getElementById('creatorThumbPreview');
  const clearBtn = document.getElementById('creatorThumbClearBtn');
  const urlInput = document.getElementById('creatorThumbUrl');
  if (preview) preview.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm text-secondary"></div><div class="small text-muted mt-2">กำลังอัปโหลด…</div></div>';
  try {
    const url = await uploadImageToDrive(file);
    if (urlInput) urlInput.value = url;
    if (preview) preview.innerHTML = `<img src="${url}" alt="thumbnail">`;
    if (clearBtn) clearBtn.classList.remove('d-none');
  } catch (err) {
    if (preview) preview.innerHTML = '<i class="bi bi-exclamation-triangle text-danger fs-3"></i><span class="text-danger small mt-2">อัปโหลดล้มเหลว</span>';
    alert('อัปโหลดรูปปกไม่สำเร็จ: ' + (err.message || err));
  } finally {
    event.target.value = '';
  }
};

window.clearCreatorThumb = () => {
  const preview = document.getElementById('creatorThumbPreview');
  const urlInput = document.getElementById('creatorThumbUrl');
  const clearBtn = document.getElementById('creatorThumbClearBtn');
  if (preview) preview.innerHTML = '<i class="bi bi-image fs-1"></i><span class="text-muted small mt-2">ยังไม่ได้เลือกรูปปก</span>';
  if (urlInput) urlInput.value = '';
  if (clearBtn) clearBtn.classList.add('d-none');
};

// Window-exposed handlers used by inline onclick=""
window.samoSignOut = samoSignOut;
window.samoGoogleSignIn = async () => {
  try { await signInWithGoogle(); }
  catch (e) { alert('เปิดหน้า Google ไม่สำเร็จ: ' + (e.message || e)); }
};
window.samoPasswordSignIn = async () => {
  const username = document.getElementById('signinLoginUsername').value;
  const password = document.getElementById('signinLoginPassword').value;
  const alert = document.getElementById('signinLoginAlert');
  const btn = document.getElementById('signinLoginBtn');
  alert.classList.add('d-none');
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังตรวจสอบ...';
  try { await signInWithPassword(username, password); }
  catch (e) { alert.textContent = e.message || 'เข้าสู่ระบบไม่สำเร็จ'; alert.classList.remove('d-none'); }
  finally { btn.disabled = false; btn.innerHTML = original; }
};
window.samoPasswordRegister = async () => {
  const username = document.getElementById('signinRegisterUsername').value;
  const password = document.getElementById('signinRegisterPassword').value;
  const confirm = document.getElementById('signinRegisterConfirm').value;
  const alert = document.getElementById('signinRegisterAlert');
  const btn = document.getElementById('signinRegisterBtn');
  alert.classList.add('d-none');
  if (password !== confirm) { alert.textContent = 'รหัสผ่านไม่ตรงกัน'; alert.classList.remove('d-none'); return; }
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังสมัคร...';
  try { await registerWithPassword(username, password); }
  catch (e) { alert.textContent = e.message || 'สมัครสมาชิกไม่สำเร็จ'; alert.classList.remove('d-none'); }
  finally { btn.disabled = false; btn.innerHTML = original; }
};
window.samoShowSigninScreen = (screen) => {
  const login = document.getElementById('signinLoginScreen');
  const register = document.getElementById('signinRegisterScreen');
  if (!login || !register) return;
  const showRegister = screen === 'register';
  login.classList.toggle('d-none', showRegister);
  register.classList.toggle('d-none', !showRegister);
  document.getElementById('signinLoginAlert')?.classList.add('d-none');
  document.getElementById('signinRegisterAlert')?.classList.add('d-none');
};

// Announcements (creator side)
window.loadAnnouncements = loadAnnouncements;
window.publishAnnouncement = publishAnnouncement;
window.cancelEdit = cancelEdit;
window.setCreatorMode = setCreatorMode;
// Stub: viewAnnouncement is public-only; from admin we navigate to the
// public reader. (Could also surface a preview-modal here later.)
window.viewAnnouncement = (id) => {
  if (id) location.href = '/#article/' + encodeURIComponent(id);
  else location.href = '/';
};
// editCurrentAnnouncement / deleteCurrentAnnouncement get called from
// the public reader page (admin pre-loads announcements list in
// the creator pane only when the user clicks "เขียนประกาศ").
window.editCurrentAnnouncement = () => location.href = '/admin/#creator';
window.deleteCurrentAnnouncement = () => {};

// PR Staff
window.fetchPRStaffTickets = fetchPRStaffTickets;
window.filterPRStaffTickets = filterPRStaffTickets;
window.openPRStaffModal = openPRStaffModal;
window.submitPRStaffAction = submitPRStaffAction;
window.deletePRStaffAction = deletePRStaffAction;
window.openManageAgentsModal = openManageAgentsModal;
window.addNewAgent = addNewAgent;
window.removeAgent = removeAgent;
window.addPRStaffAssignee = addPRStaffAssignee;
window.removePRStaffAssignee = removePRStaffAssignee;

// VS Staff
window.fetchStaffTickets = fetchStaffTickets;
window.openStaffModalByIndex = openStaffModalByIndex;
window.submitStaffAction = submitStaffAction;
window.deleteCurrentVSTicket = deleteCurrentVSTicket;
window.setVsKanbanHideEmpty = setVsKanbanHideEmpty;
window.onVSAdminRoleChange = async () => { await enterVSStaffDashboard(); };
// (per-VP summary chips removed; the dropdown filter is the single
// source of truth now and drives both list + kanban views.)

// ==============================================
// SIDEBAR SECTION SWITCHING
// ==============================================

// data-admin-side="landing|pr|vs|shop|projects|creator"
// Section panes carry data-admin-pane="landing|admin|projects|creator".
// pr/vs/shop all use the "admin" pane and additionally call
// openAdminSection(which) to drive the legacy adminXSection toggles.

const SECTION_META = {
  landing:  { pane: 'landing',  title: 'ภาพรวม Admin',     sub: 'เลือกระบบที่ต้องการจัดการจากเมนูซ้าย' },
  pr:       { pane: 'admin',    title: 'PR Management',    sub: 'จัดการคำขอประชาสัมพันธ์' },
  vs:       { pane: 'admin',    title: 'VitalSound',       sub: 'ติดตามและตอบกลับการแจ้งปัญหา' },
  shop:     { pane: 'admin',    title: 'SAMO Shop',        sub: 'คำสั่งซื้อ ตรวจสลิป สินค้า' },
  projects: { pane: 'projects', title: 'หนังสือโครงการ',   sub: 'ส่ง / รับ / ติดตามหนังสือโครงการ' },
  creator:  { pane: 'creator',  title: 'เขียนประกาศ',       sub: 'สร้างและเผยแพร่ประกาศลงบอร์ดสาธารณะ' },
};

function showAdminSide(which) {
  const meta = SECTION_META[which] || SECTION_META.landing;

  // Mark sidebar item active
  document.querySelectorAll('#adminSideNav [data-admin-side]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.adminSide === which);
  });

  // Show only the target pane
  document.querySelectorAll('[data-admin-pane]').forEach((p) => {
    p.classList.toggle('d-none', p.dataset.adminPane !== meta.pane);
  });

  // Top-bar title + subtitle
  const t = document.getElementById('adminTopTitle');
  const s = document.getElementById('adminTopSub');
  if (t) t.textContent = meta.title;
  if (s) s.textContent = meta.sub;

  // Trigger the legacy admin sub-section toggle for PR/VS/Shop
  if (which === 'pr' || which === 'vs' || which === 'shop') {
    document.getElementById('adminPRSection')?.classList.toggle('d-none', which !== 'pr');
    document.getElementById('adminVSSection')?.classList.toggle('d-none', which !== 'vs');
    document.getElementById('adminShopSection')?.classList.toggle('d-none', which !== 'shop');
    if (which === 'pr')   enterPRStaffDashboard();
    else if (which === 'vs')  enterVSStaffDashboard();
    else if (which === 'shop') openShopAdmin();
  }

  // Projects' lazy first-load was wired to Bootstrap's shown.bs.tab in
  // the public app. Admin uses the sidebar directly, so we have to
  // trigger the load explicitly here — otherwise the inbox is blank
  // until the user creates a project (which calls reloadProjects).
  if (which === 'projects') {
    enterProjectsWorkspace();
  }

  // Mirror in the URL hash so admin sub-pages are bookmarkable.
  const want = which === 'landing' ? '' : '#' + which;
  if (location.hash !== want) history.replaceState(null, '', location.pathname + want);
}

// Public function — sidebar buttons and legacy onclicks call these.
window.openAdminSection = (which) => showAdminSide(which);
window.showAdminLanding = () => showAdminSide('landing');

// ==============================================
// AUTH GATE + BOOT
// ==============================================

const BOOT_GATE   = () => document.getElementById('adminBootGate');
const AUTH_GATE   = () => document.getElementById('adminAuthGate');
const APP_ROOT    = () => document.getElementById('adminAppRoot');

function showBoot()    { BOOT_GATE()?.classList.remove('d-none'); AUTH_GATE()?.classList.add('d-none'); APP_ROOT()?.classList.add('d-none'); }
function showAuthGate(){ BOOT_GATE()?.classList.add('d-none');   AUTH_GATE()?.classList.remove('d-none'); APP_ROOT()?.classList.add('d-none'); }
function showApp()     { BOOT_GATE()?.classList.add('d-none');   AUTH_GATE()?.classList.add('d-none');   APP_ROOT()?.classList.remove('d-none'); }

const STAFF_ROLES = ['pr_staff', 'vs_staff', 'shop_admin', 'vp_admin', 'uni_staff', 'dev'];

// Features the admin sidebar / landing surfaces. Keyed by data-admin-side.
// Each value is the permission key passed to userCanAccess().
const SIDE_FEATURE = {
  landing:  null,         // landing is always available when signed in as staff
  pr:       'pr',
  vs:       'vs',
  shop:     'samoshop',
  projects: 'projects',
  creator:  'creator',
};

function roleLabel(role) {
  if (role === 'pr_staff')   return 'PR Staff';
  if (role === 'vs_staff')   return 'VS Staff';
  if (role === 'shop_admin') return 'Shop Admin';
  if (role === 'vp_admin')   return 'VP-Admin';
  if (role === 'uni_staff')  return 'Uni Staff';
  if (role === 'dev')        return 'Dev';
  return '';
}

// Sidebar toggle — one button, two modes:
//   ≥768px: collapse the sidebar to icon-only and persist in localStorage
//   <768px: open/close the sidebar drawer (full overlay with backdrop)
// Defined at module scope so initBeforeDom (below) can call it after the
// DOM resolves but before auth resolves.
const SIDEBAR_COLLAPSED_KEY = 'samoAdminSidebarCollapsed';
const isMobileViewport = () => window.matchMedia('(max-width: 767.98px)').matches;

function initSidebarToggle() {
  const toggle    = document.getElementById('adminSidebarToggle');
  const backdrop  = document.getElementById('adminSidebarBackdrop');
  const sideNav   = document.getElementById('adminSideNav');

  // Restore desktop-collapsed state (mobile drawer always starts closed)
  if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1') {
    document.body.classList.add('workspace-sidebar-collapsed');
  }

  toggle?.addEventListener('click', () => {
    if (isMobileViewport()) {
      const next = !document.body.classList.contains('workspace-sidebar-open');
      document.body.classList.toggle('workspace-sidebar-open', next);
      toggle.setAttribute('aria-expanded', String(next));
    } else {
      const next = !document.body.classList.contains('workspace-sidebar-collapsed');
      document.body.classList.toggle('workspace-sidebar-collapsed', next);
      // aria-expanded: collapsed = false, expanded = true
      toggle.setAttribute('aria-expanded', String(!next));
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
    }
  });

  // Backdrop click closes the mobile drawer
  backdrop?.addEventListener('click', () => {
    document.body.classList.remove('workspace-sidebar-open');
    toggle?.setAttribute('aria-expanded', 'false');
  });

  // Clicking any sidebar item on mobile closes the drawer (consistent with
  // most SaaS apps — selection should commit + collapse, not just commit).
  // Covers both section buttons (data-admin-side) and external links
  // (anchors that open in a new tab).
  sideNav?.addEventListener('click', (e) => {
    if (!isMobileViewport()) return;
    if (e.target.closest('.workspace-side-item')) {
      document.body.classList.remove('workspace-sidebar-open');
      toggle?.setAttribute('aria-expanded', 'false');
    }
  });

  // If the viewport crosses the breakpoint while the drawer is open
  // (rotation, resizing devtools), reset the drawer state — the
  // collapsed-icon mode and the drawer mode shouldn't ever coexist.
  window.matchMedia('(max-width: 767.98px)').addEventListener('change', (ev) => {
    if (!ev.matches) document.body.classList.remove('workspace-sidebar-open');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initSidebarToggle();

  // Wire the gated sign-in button
  document.getElementById('adminSignInBtn')?.addEventListener('click', () => {
    const modalEl = document.getElementById('signinModal');
    if (modalEl && window.bootstrap) window.bootstrap.Modal.getOrCreateInstance(modalEl).show();
  });

  // Sidebar click delegation — every [data-admin-side] button routes
  // through showAdminSide(). Single listener so adding sidebar items
  // later just means adding a button (no extra wiring).
  document.getElementById('adminSideNav')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-admin-side]');
    if (!btn || btn.classList.contains('d-none')) return;
    showAdminSide(btn.dataset.adminSide);
  });

  // Landing-card click delegation — same idea for the big cards on the
  // overview pane. They already have inline onclick="openAdminSection(...)"
  // which is wired below, so this just exists as a fallback safety net.

  // Allow the boot gate to time out so users aren't stuck on the spinner
  // if Supabase is slow / unreachable. Show a "slow load" message rather
  // than the access-denied UI — a staff user on a slow network would
  // otherwise read "เฉพาะเจ้าหน้าที่" right before the dashboard pops in.
  const bootTimeout = setTimeout(() => {
    if (!APP_ROOT()?.classList.contains('d-none')) return;
    const gate = BOOT_GATE();
    if (gate && !gate.classList.contains('d-none')) {
      const sub = gate.querySelector('.small');
      if (sub) sub.textContent = 'โหลดช้ากว่าปกติ — ลองรีเฟรชหากค้างนาน';
    }
  }, 4000);

  onAuthChange((user) => {
    const role = user?.role || null;
    const isStaff = !!role && STAFF_ROLES.includes(role);

    if (!user) {
      clearTimeout(bootTimeout);
      showAuthGate();
      return;
    }
    if (!isStaff) {
      clearTimeout(bootTimeout);
      showAuthGate();
      return;
    }

    clearTimeout(bootTimeout);
    showApp();

    // Sidebar identity
    const pic  = document.getElementById('adminUserPic');
    const name = document.getElementById('adminUserName');
    const sub  = document.getElementById('adminUserRole');
    if (pic)  pic.src = user.picture || '';
    if (name) name.textContent = user.name || user.username || '';
    if (sub)  sub.textContent  = roleLabel(role) || user.department || '';

    // Feature-gate sidebar + landing items: a node is visible if its
    // data-admin-side / data-admin-pane feature is granted to the user
    // (via role default OR permissions array). Legacy data-role-only
    // attributes are honoured too — kept for backward compatibility,
    // but new gates should use data-admin-side which userCanAccess() owns.
    document.querySelectorAll('[data-admin-side]').forEach((el) => {
      const which = el.dataset.adminSide;
      const feature = SIDE_FEATURE[which];
      const ok = feature === null ? true : userCanAccess(feature, user);
      el.classList.toggle('d-none', !ok);
    });
    // Landing cards: each col carries data-admin-side too (or fall back
    // to the legacy data-role-only).
    document.querySelectorAll('[data-role-only]').forEach((el) => {
      // If the element ALSO has data-admin-side, skip — that path
      // already handled it above with the permission-aware check.
      if (el.hasAttribute('data-admin-side')) return;
      const allowed = el.getAttribute('data-role-only').split(/\s+/);
      el.classList.toggle('d-none', !allowed.includes(role));
    });

    // Initial section: read hash, else default landing
    const hashSection = location.hash.replace(/^#/, '');
    showAdminSide(SECTION_META[hashSection] ? hashSection : 'landing');

    // Auto-close the sign-in modal once a staff session lands
    const modalEl = document.getElementById('signinModal');
    if (modalEl && window.bootstrap) {
      const inst = window.bootstrap.Modal.getInstance(modalEl);
      if (inst) inst.hide();
    }
  });

  initAuth();
  initShop();
  initProjects();
});
