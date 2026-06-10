// ==============================================
// ADMIN-MAIN.JS — entry point for the operator app at /admin/
// Mirrors src/js/main.js but only imports admin-only modules.
// Same Supabase auth, same dbRest helpers, same modals.
// Shares the auth session with the public app (supabase-js
// persists in localStorage on the same origin).
// ==============================================

import { startBuildCheck } from './build-check.js';
startBuildCheck();   // run before anything else — see build-check.js header
import { QUILL_TOOLBAR } from './config.js';
import { uploadImageToDrive } from './uploads.js';

// Auth (shared with public)
import { initAuth, onAuthChange, signOut as samoSignOut, signInWithPassword, registerWithPassword, signInWithGoogle, getUser as authGetUser, userCanAccess, authReady, hasPersistedSession } from './auth.js';
import { mountAccountSwitch, openSwitcher as openAccountSwitcher } from './account-switch.js';
import { initProfileModal, openProfileModal } from './profile.js';
import { copyText } from './utils.js';

// Announcements / Creator
import { initAnnouncements, loadAnnouncements, publishAnnouncement, cancelEdit, setCreatorMode, editAnnouncement, deleteEditingAnnouncement, renderAnnouncementOrderList, saveAnnouncementOrder, togglePinAnnouncement } from './announcements.js';

// PR Staff
import { fetchPRStaffTickets, filterPRStaffTickets, enterPRStaffDashboard, openPRStaffModal, submitPRStaffAction, deletePRStaffAction, openManageAgentsModal, addNewAgent, removeAgent, addPRStaffAssignee, removePRStaffAssignee } from './pr-staff.js';

// VS Staff
import { fetchStaffTickets, enterVSStaffDashboard, openStaffModalByIndex, submitStaffAction, deleteCurrentVSTicket, setVsKanbanHideEmpty } from './vs-staff.js';

// Shop admin
import { initShop, openShopAdmin, openShopAdminOrder } from './shop/index.js';

// Projects
import { initProjects, enterProjectsWorkspace } from './projects/index.js';

// SAMO Team (org tree)
import { initTeam, enterTeamWorkspace } from './team/index.js';

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
window.samoOpenProfile = openProfileModal;
// Multi-account chooser (Gmail-style). Particularly handy for staff
// who jump between dev / vp_admin / uni_staff seats during testing.
window.samoSwitchAccount = () => openAccountSwitcher();
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
  order:    { pane: 'order',    title: 'ลำดับการแสดงประกาศ', sub: 'จัดเรียงลำดับ ปักหมุดโพสต์เด่น และแก้ไขประกาศ' },
  team:     { pane: 'team',     title: 'ทีม SAMO',          sub: 'จัดการโครงสร้างตำแหน่งและสมาชิกในองค์กร' },
};

function showAdminSide(which) {
  const meta = SECTION_META[which] || SECTION_META.landing;

  // Drop any editor popup state — a section switch always lands on a real
  // pane, never the floating editor overlay.
  document.getElementById('creatorPane')?.classList.remove('editor-overlay');
  document.body.classList.remove('editor-overlay-open');

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

  // Creator: lazy-load the announcement list + attach SortableJS so the
  // reorder panel works. Idempotent — re-entry rerenders + reattaches.
  if (which === 'creator') {
    enterCreator();
  }

  // Announcement order/pin list — its own section.
  if (which === 'order') {
    enterAnnouncementOrder();
  }

  // SAMO Team: lazy-load the org tree on first entry; idempotent thereafter.
  if (which === 'team') {
    enterTeamWorkspace();
  }

  // Mirror in the URL hash so admin sub-pages are bookmarkable. Only
  // rewrite if the existing hash doesn't already point at this section
  // (so deep links like `#projects/PRJ-XXXX/doc/DOC-Y` survive). For
  // landing, clear the hash entirely.
  if (which === 'landing') {
    if (location.hash !== '') history.replaceState(null, '', location.pathname);
  } else {
    const cur = location.hash.replace(/^#/, '');
    const first = cur.split('/')[0];
    if (first !== which) history.replaceState(null, '', location.pathname + '#' + which);
  }
}

let _orderSortableAttached = false;
let initialSectionApplied = false;
// Flipped true once auth has settled (session restored OR confirmed absent).
// Until then, a persisted-but-still-loading session keeps the boot spinner
// up instead of flashing the sign-in gate. See the onAuthChange handler.
let authSettled = false;
// Writer pane (เขียนประกาศ). Just ensure announcements are loaded so
// editAnnouncement(id) deep-links / the order section's pencil can resolve
// the post against the in-memory cache.
async function enterCreator() {
  // เขียนประกาศ is the "new post" page — start clean. (Deep-link edits via
  // `#creator/{id}` call editAnnouncement() right after this, re-filling it.)
  cancelEdit();
  try {
    await loadAnnouncements();
  } catch (e) {
    console.warn('[admin-main] creator: loadAnnouncements failed:', e?.message || e);
  }
}

// Order pane (ลำดับการแสดงประกาศ) — its own admin section below เขียนประกาศ.
// Renders the drag-reorder + pin list and attaches SortableJS once.
async function enterAnnouncementOrder() {
  const listEl = document.getElementById('announcementsOrderList');
  if (!listEl) return;
  try {
    await loadAnnouncements();
  } catch (e) {
    console.warn('[admin-main] order: loadAnnouncements failed:', e?.message || e);
  }
  renderAnnouncementOrderList(listEl);
  // Attach SortableJS once. Re-renders replace the <li> elements but
  // SortableJS works off the parent <ul> so it picks up new children.
  if (!_orderSortableAttached && window.Sortable) {
    window.Sortable.create(listEl, {
      handle: '.order-card-handle',
      draggable: '.order-card',
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      onEnd: async () => {
        const ids = Array.from(listEl.querySelectorAll('.order-card'))
          .map((el) => el.dataset.id);
        await saveAnnouncementOrder(ids);
        // saveAnnouncementOrder reloads announcements; re-render the cards.
        renderAnnouncementOrderList(listEl);
      },
    });
    _orderSortableAttached = true;
  }
}

// Open the announcement editor as a popup overlay (used when editing from the
// manage cards). The editor lives in the creator pane; we float it on top of
// whatever section is active instead of switching to it.
function openEditorOverlay() {
  const pane = document.getElementById('creatorPane');
  if (!pane) return;
  pane.classList.remove('d-none');
  pane.classList.add('editor-overlay');
  document.body.classList.add('editor-overlay-open');
  pane.scrollTop = 0;
}

// Close the editor popup + reset the form. Hides the creator pane again unless
// the creator section is itself active (inline edit via `#creator/{id}` deep
// link), in which case it stays as a normal page.
window.closeAnnouncementEditor = () => {
  const pane = document.getElementById('creatorPane');
  if (pane) {
    pane.classList.remove('editor-overlay');
    const activeSection = location.hash.replace(/^#/, '').split('/')[0];
    if (activeSection !== 'creator') pane.classList.add('d-none');
  }
  document.body.classList.remove('editor-overlay-open');
  cancelEdit();
};

// Publish / delete finished — close the popup (if open) and refresh the
// manage cards so order + pin state reflect the change.
document.addEventListener('announcement:changed', () => {
  const pane = document.getElementById('creatorPane');
  if (pane?.classList.contains('editor-overlay')) window.closeAnnouncementEditor();
  const listEl = document.getElementById('announcementsOrderList');
  if (listEl) renderAnnouncementOrderList(listEl);
});

// Exposed for clicking a manage card. Fill the editor form with that post and
// float it as a popup overlay (instead of redirecting to the เขียนประกาศ pane).
window.editAnnouncementById = (id) => {
  editAnnouncement(id);
  openEditorOverlay();
};

// Exposed for the pin chip on each manage card. togglePinAnnouncement reloads
// announcements; re-render the cards so the new pin state shows.
window.togglePinAnnouncement = async (id) => {
  const ok = await togglePinAnnouncement(id);
  if (ok) renderAnnouncementOrderList(document.getElementById('announcementsOrderList'));
};

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

const STAFF_ROLES = ['pr_staff', 'vs_staff', 'shop_admin', 'vp_admin', 'uni_staff', 'sa_prof', 'dev'];

// Features the admin sidebar / landing surfaces. Keyed by data-admin-side.
// Each value is the permission key passed to userCanAccess().
const SIDE_FEATURE = {
  landing:  null,         // landing is always available when signed in as staff
  pr:       'pr',
  vs:       'vs',
  shop:     'samoshop',
  projects: 'projects',
  creator:  'creator',
  order:    'creator',   // same gate as เขียนประกาศ — announcement management
  team:     'team',
};

function roleLabel(role) {
  if (role === 'pr_staff')   return 'PR Staff';
  if (role === 'vs_staff')   return 'VS Staff';
  if (role === 'shop_admin') return 'Shop Admin';
  if (role === 'vp_admin')   return 'VP-Admin';
  if (role === 'uni_staff')  return 'Uni Staff';
  if (role === 'sa_prof')    return 'อาจารย์';
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
      // The FIRST onAuthChange fire is synchronous on subscribe — it
      // happens before initAuth() has restored the session from storage,
      // so currentUser is null even for a signed-in user. If a session
      // token is persisted and auth hasn't settled yet, stay on the boot
      // spinner rather than flashing the sign-in gate. On slow mobile
      // connections that flash was reading as "logged out — log in again
      // on every refresh" (the bug report); iPad/desktop settle fast
      // enough that it was never visible there. authReady (below) shows
      // the gate for real if the persisted token turns out stale.
      if (!authSettled && hasPersistedSession()) return;
      clearTimeout(bootTimeout);
      // Reset so the next sign-in re-applies initial routing for the
      // new user (whose role and accessible panes may differ).
      initialSectionApplied = false;
      showAuthGate();
      return;
    }
    if (!isStaff) {
      clearTimeout(bootTimeout);
      initialSectionApplied = false;
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

    // Initial section: read hash, else default landing. Run ONCE per
    // session — subsequent onAuthChange fires (token refresh, tab
    // re-focus) must NOT yank the user back to landing or wipe out a
    // deep-link like `#projects/PRJ-XXXX`. The closure flag below
    // (initialSectionApplied) lives in the module scope so the bound
    // subscriber sees it across fires.
    //
    // Hash matching is done on the FIRST SEGMENT only so deep links
    // (`#projects/PRJ-XXXX`, `#projects/PRJ-X/doc/DOC-Y`, `#creator/<id>`)
    // resolve to the right section. Sub-routes are then re-applied by
    // each module's own hash listener (e.g. projects/index.js's
    // applyHashRoute on hashchange + initial mount).
    if (!initialSectionApplied) {
      initialSectionApplied = true;
      // /admin/?scan=<id> has its own onAuthChange subscriber (below)
      // that routes to 'shop' and opens the order modal. If we route
      // here too, the tryCreatorDeepLink().then() resolves AFTER that
      // sync route and clobbers shop back to landing — user sees the
      // order modal floating on top of the ภาพรวม Admin landing
      // pane instead of the orders table. Skip routing for the scan
      // path and let the scan subscriber own it.
      const hasScan = new URLSearchParams(window.location.search).get('scan');
      if (!hasScan) {
        const rawHash = location.hash.replace(/^#/, '');
        const first   = rawHash.split('/')[0];
        tryCreatorDeepLink(rawHash).then((routed) => {
          if (routed) return;
          showAdminSide(SECTION_META[first] ? first : 'landing');
        });
      }
    }

    // Auto-close the sign-in modal once a staff session lands
    const modalEl = document.getElementById('signinModal');
    if (modalEl && window.bootstrap) {
      const inst = window.bootstrap.Modal.getInstance(modalEl);
      if (inst) inst.hide();
    }
  });

  // Auth has settled (session restored or confirmed absent). Mark it so
  // the onAuthChange boot-stay above stops suppressing the gate, and if
  // there's still no staff user, show the sign-in gate now.
  authReady.then(() => {
    authSettled = true;
    const u = authGetUser();
    if (!u || !STAFF_ROLES.includes(u.role)) {
      clearTimeout(bootTimeout);
      showAuthGate();
    }
  });
  // Safety net: if initAuth() ever wedges (e.g. a token refresh hangs on
  // a flaky mobile network so authReady never resolves), don't trap the
  // user on the boot spinner forever — fall through to the sign-in gate
  // after a generous wait so they can re-authenticate manually.
  setTimeout(() => {
    if (authSettled) return;
    authSettled = true;
    if (!authGetUser()) { clearTimeout(bootTimeout); showAuthGate(); }
  }, 9000);

  initAuth();
  initProfileModal();
  mountAccountSwitch();
  initShop();
  initProjects();
  initTeam();

  // Deep-link: /admin/?scan=<orderId> jumps to that order's detail.
  // Waits for the first signed-in state — if signed-out, the global
  // sign-in gate kicks in and we resolve as soon as that completes.
  // onAuthChange fires synchronously on subscribe, so guard against
  // double-invocation with a done flag.
  const scanId = new URLSearchParams(window.location.search).get('scan');
  if (scanId) {
    let done = false;
    onAuthChange((u) => {
      if (done || !u) return;
      done = true;
      showAdminSide('shop');
      openShopAdminOrder(scanId);
      const url = new URL(window.location.href);
      url.searchParams.delete('scan');
      window.history.replaceState({}, '', url.toString());
    });
  }

  // Global "copy to clipboard" delegate — mirrors main.js so admin
  // surfaces (order id chips, etc.) can use [data-copy] markup.
  // stopPropagation is critical here: the orders table delegates a
  // row-click that opens the detail modal, and the copy chip is
  // INSIDE the row — without the stop, tapping copy would also pop
  // the modal.
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(btn.dataset.copy);
    if (!ok) return;
    const icon = btn.querySelector('i');
    if (icon) {
      const prev = icon.className;
      icon.className = 'bi bi-check2';
      setTimeout(() => { icon.className = prev; }, 1200);
    }
  });
});
