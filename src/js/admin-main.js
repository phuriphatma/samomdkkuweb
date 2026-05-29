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
import { initAnnouncements, loadAnnouncements, publishAnnouncement, cancelEdit, setCreatorMode, editAnnouncement, deleteEditingAnnouncement } from './announcements.js';

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

// --------------------------------------------------
// Cover-image cropper (16:9, Cropper.js)
//
// Pick a file → open the modal with Cropper.js, lock the crop box to
// 16:9 → user pans/zooms → "ใช้รูปนี้" → canvas.toBlob → upload.
// "ยกเลิก" leaves the existing cover untouched.
// --------------------------------------------------

let _activeCropper = null;
let _pendingCropFileName = 'cover.jpg';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

function dataUrlToDimensions(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

function destroyActiveCropper() {
  if (_activeCropper) {
    try { _activeCropper.destroy(); } catch { /* noop */ }
    _activeCropper = null;
  }
}

window.onCreatorThumbPicked = async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  _pendingCropFileName = file.name || 'cover.jpg';

  const hint = document.getElementById('creatorThumbHint');
  const cropImg = document.getElementById('creatorCropperImage');
  const cropHint = document.getElementById('creatorCropperHint');
  const modalEl = document.getElementById('creatorCropperModal');

  if (hint) hint.innerHTML = '';

  let dataUrl;
  try {
    dataUrl = await fileToDataUrl(file);
  } catch (err) {
    alert((err && err.message) || 'อ่านไฟล์ไม่สำเร็จ');
    event.target.value = '';
    return;
  }

  const dims = await dataUrlToDimensions(dataUrl);
  if (cropHint && dims) {
    let warning = '';
    if (dims.width < 1200) {
      warning = ` <span class="text-warning"><i class="bi bi-info-circle"></i> รูปต้นฉบับกว้าง ${dims.width}px (แนะนำ ≥1200px) — ลองภาพใหญ่กว่านี้เพื่อความคมชัด</span>`;
    }
    cropHint.innerHTML = `ลากเพื่อจัดวางส่วนสำคัญของภาพ — กรอบล็อกที่สัดส่วน 16:9 อัตโนมัติ.${warning}`;
  }

  destroyActiveCropper();
  if (cropImg) cropImg.src = dataUrl;

  // Open the modal; init Cropper.js after `shown.bs.modal` so the
  // image element is laid out with real dimensions.
  if (!modalEl || !window.bootstrap) {
    alert('ไม่สามารถเปิดหน้าตัดรูปได้');
    event.target.value = '';
    return;
  }
  const modal = window.bootstrap.Modal.getOrCreateInstance(modalEl);
  modalEl.addEventListener('shown.bs.modal', () => {
    if (!window.Cropper || !cropImg) return;
    _activeCropper = new window.Cropper(cropImg, {
      aspectRatio: 16 / 9,
      viewMode: 1,        // restrict crop box to within the canvas
      autoCropArea: 1,    // start with the largest 16:9 fit
      background: false,
      movable: true,
      zoomable: true,
      scalable: false,
      rotatable: false,
      responsive: true,
      checkOrientation: false,
    });
  }, { once: true });
  modalEl.addEventListener('hidden.bs.modal', () => {
    destroyActiveCropper();
    if (cropImg) cropImg.src = '';
  }, { once: true });
  modal.show();
  // Reset the file input so re-selecting the same file still fires change.
  event.target.value = '';
};

// Confirm button inside the cropper modal — extract the cropped canvas,
// turn it into a JPEG blob, upload, then write the resulting URL into
// the creator form.
async function confirmCropAndUpload() {
  if (!_activeCropper) return;
  const preview = document.getElementById('creatorThumbPreview');
  const clearBtn = document.getElementById('creatorThumbClearBtn');
  const urlInput = document.getElementById('creatorThumbUrl');
  const confirmBtn = document.getElementById('creatorCropperConfirm');
  const modalEl = document.getElementById('creatorCropperModal');

  // Output a max-2000px-wide canvas (≈4MP) — good print/retina quality
  // but keeps the upload size reasonable.
  const canvas = _activeCropper.getCroppedCanvas({
    maxWidth: 2000,
    maxHeight: 1125,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  });
  if (!canvas) {
    alert('ตัดภาพไม่สำเร็จ ลองอีกครั้ง');
    return;
  }

  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังอัปโหลด…';
  }
  if (preview) preview.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm text-secondary"></div><div class="small text-muted mt-2">กำลังอัปโหลด…</div></div>';

  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('แปลงภาพไม่สำเร็จ'))), 'image/jpeg', 0.9);
    });
    const fileForUpload = new File([blob], _pendingCropFileName.replace(/\.(png|webp|gif|bmp)$/i, '.jpg') || 'cover.jpg', { type: 'image/jpeg' });
    const url = await uploadImageToDrive(fileForUpload);
    if (urlInput) urlInput.value = url;
    if (preview) preview.innerHTML = `<img src="${url}" alt="thumbnail">`;
    if (clearBtn) clearBtn.classList.remove('d-none');
    // Hint slot below the preview: confirm it's the cropped 16:9.
    const hint = document.getElementById('creatorThumbHint');
    if (hint) hint.innerHTML = `<i class="bi bi-check-circle me-1 text-success"></i>ตัดกรอบ 16:9 เรียบร้อย (${canvas.width}×${canvas.height})`;

    if (modalEl && window.bootstrap) {
      window.bootstrap.Modal.getOrCreateInstance(modalEl).hide();
    }
  } catch (err) {
    if (preview) preview.innerHTML = '<i class="bi bi-exclamation-triangle text-danger fs-3"></i><span class="text-danger small mt-2">อัปโหลดล้มเหลว</span>';
    alert('อัปโหลดรูปปกไม่สำเร็จ: ' + (err.message || err));
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>ใช้รูปนี้';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('creatorCropperConfirm')
    ?.addEventListener('click', confirmCropAndUpload);
});

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
// Edit from inside the admin creator: looks up the post by the viewer's
// current id and fills the form. Public site's "edit" button on the
// article reader navigates here as /admin/#creator/{id};
// tryCreatorDeepLink picks that up on entry.
window.editCurrentAnnouncement = () => editAnnouncement();
// Delete the article currently loaded into the editor form. Wired to
// the in-form "ลบประกาศนี้" button (visible only when editing).
window.deleteEditingAnnouncement = deleteEditingAnnouncement;
// Public-reader's delete button isn't reachable inside admin (no
// article reader here), but keep a no-op so any stray HTML reference
// doesn't ReferenceError.
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

/** Handle `#creator/{id}` deep-link: navigate to the creator pane and
 *  pre-populate the form with that article. Returns true if it routed,
 *  false to let the caller fall back to the section-only behavior. */
async function tryCreatorDeepLink(hash) {
  const m = /^creator\/([^/]+)$/.exec(hash);
  if (!m) return false;
  const id = decodeURIComponent(m[1]);
  showAdminSide('creator');
  try {
    await loadAnnouncements();
    const ok = editAnnouncement(id);
    if (!ok) {
      console.warn('[admin-main] /creator/' + id + ' — article not found in loaded list');
    }
  } catch (e) {
    console.warn('[admin-main] creator deep-link load failed:', e?.message || e);
  }
  return true;
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

    // Initial section: read hash, else default landing.
    // `#creator/{id}` is a deep-link from the public reader's "edit"
    // button — route to the creator pane and pre-populate the form.
    const rawHash = location.hash.replace(/^#/, '');
    tryCreatorDeepLink(rawHash).then((routed) => {
      if (routed) return;
      showAdminSide(SECTION_META[rawHash] ? rawHash : 'landing');
    });

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
