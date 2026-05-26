// ==============================================
// MAIN.JS — Entry Point
// Initializes all modules, Quill editors, and
// attaches exported functions to window for
// inline onclick handlers in HTML.
// ==============================================

// main.css is loaded via a parser-blocking <link> tag in index.html (not
// imported here) so the styles arrive in the first paint, not after the JS
// module evaluates. Eliminates the dev-mode FOUC.
import { QUILL_TOOLBAR } from './config.js';
import { uploadImageToDrive } from './uploads.js';

// --- Module Imports ---
import { initAuth, onAuthChange, signOut as samoSignOut, signInWithPassword, registerWithPassword, signInWithGoogle, getUser as authGetUser } from './auth.js';
import { initAnnouncements, loadAnnouncements, publishAnnouncement, viewAnnouncement, cancelEdit, editCurrentAnnouncement, deleteCurrentAnnouncement } from './announcements.js';
import { initPrAuth, handlePrGoogleLogin, logoutGoogle, forceShowGoogleAuth, togglePrAccountFields } from './pr-auth.js';
import { initPrForm, togglePrMode, updateFormVisibility, toggleProjectFormatCopost, toggleOtherPlatformReason, applyDateRules, syncPublishDate } from './pr-form.js';
import { trackPRTicket, refreshPRTicketDashboard, loadPRHistory, openPRTicketDetail, logoutPRTrack } from './pr-tracking.js';
import { fetchPRStaffTickets, filterPRStaffTickets, enterPRStaffDashboard, openPRStaffModal, submitPRStaffAction, deletePRStaffAction, openManageAgentsModal, addNewAgent, removeAgent, addPRStaffAssignee, removePRStaffAssignee } from './pr-staff.js';
import { initVsForm, toggleVitalSoundMode, toggleVsAccountFields, verifyAccount, toggleEmergency, setIsAccountVerified } from './vs-form.js';
import { trackWithTicketId, loginToViewHistory, submitUserRemark, openTicketDetail, logoutTrack } from './vs-tracking.js';
import { fetchStaffTickets, enterVSStaffDashboard, openStaffModalByIndex, submitStaffAction } from './vs-staff.js';
import { initShop, openShopAdmin } from './shop/index.js';
import { initProjects } from './projects/index.js';

// ==============================================
// QUILL SETUP
// ==============================================

const Size = Quill.import('attributors/style/size');
Size.whitelist = ['10px', '12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px', '32px'];
Quill.register(Size, true);

// Custom image handler: when the user clicks the image icon in the toolbar,
// open a file picker, upload the image to Drive, then insert the returned URL
// at the cursor. This bypasses Quill's default base64 embedding which would
// otherwise inflate the announcement HTML to MB and break the POST.
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
      // Insert a placeholder while uploading
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
let vsQuillRef = null;

const creatorQuill = new Quill('#creatorQuillEditor', {
  theme: 'snow',
  placeholder: 'เขียนรายละเอียดประกาศของคุณที่นี่... สามารถคลุมดำข้อความเพื่อทำตัวหนา และกดไอคอน 🖼️ เพื่อแทรกรูปภาพได้',
  modules: {
    toolbar: {
      container: QUILL_TOOLBAR,
      handlers: { image: makeQuillImageHandler(() => creatorQuillRef) },
    },
  },
});
creatorQuillRef = creatorQuill;

const vsQuill = new Quill('#vsQuillEditor', {
  theme: 'snow',
  placeholder: 'อธิบายปัญหา หรือข้อเสนอแนะที่นี่... (รองรับการแนบภาพ/ลิงก์)',
  modules: {
    toolbar: {
      container: QUILL_TOOLBAR,
      handlers: { image: makeQuillImageHandler(() => vsQuillRef) },
    },
  },
});
vsQuillRef = vsQuill;

// ==============================================
// INITIALIZE MODULES
// ==============================================

initAnnouncements(creatorQuill);
initVsForm(vsQuill);

// ==============================================
// ATTACH FUNCTIONS TO WINDOW
// (Required for inline onclick="" handlers in HTML)
// ==============================================

// Announcements
window.loadAnnouncements = loadAnnouncements;
window.publishAnnouncement = publishAnnouncement;
window.viewAnnouncement = viewAnnouncement;
window.cancelEdit = cancelEdit;
window.editCurrentAnnouncement = editCurrentAnnouncement;
window.deleteCurrentAnnouncement = deleteCurrentAnnouncement;

// Global Auth
window.samoSignOut = samoSignOut;
window.samoGoogleSignIn = async () => {
  try {
    await signInWithGoogle();
  } catch (e) {
    alert('เปิดหน้า Google ไม่สำเร็จ: ' + (e.message || e));
  }
};

// Creator thumbnail picker
window.onCreatorThumbPicked = async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const preview = document.getElementById('creatorThumbPreview');
  const clearBtn = document.getElementById('creatorThumbClearBtn');
  const urlInput = document.getElementById('creatorThumbUrl');
  if (preview) {
    preview.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm text-secondary"></div><div class="small text-muted mt-2">กำลังอัปโหลด…</div></div>';
  }
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
  if (preview) {
    preview.innerHTML = '<i class="bi bi-image fs-1"></i><span class="text-muted small mt-2">ยังไม่ได้เลือกรูปปก</span>';
  }
  if (urlInput) urlInput.value = '';
  if (clearBtn) clearBtn.classList.add('d-none');
};

// Sign-in modal: toggle between login and register screens
window.samoShowSigninScreen = (screen) => {
  const login = document.getElementById('signinLoginScreen');
  const register = document.getElementById('signinRegisterScreen');
  if (!login || !register) return;
  const showRegister = screen === 'register';
  login.classList.toggle('d-none', showRegister);
  register.classList.toggle('d-none', !showRegister);
  // Clear stale alerts/inputs when switching
  document.getElementById('signinLoginAlert')?.classList.add('d-none');
  document.getElementById('signinRegisterAlert')?.classList.add('d-none');
};

// Sign-in modal: username/password handlers
window.samoPasswordSignIn = async () => {
  const username = document.getElementById('signinLoginUsername').value;
  const password = document.getElementById('signinLoginPassword').value;
  const alert = document.getElementById('signinLoginAlert');
  const btn = document.getElementById('signinLoginBtn');
  alert.classList.add('d-none');
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังตรวจสอบ...';
  try {
    await signInWithPassword(username, password);
    // Auth subscriber will close the modal.
  } catch (e) {
    alert.textContent = e.message || 'เข้าสู่ระบบไม่สำเร็จ';
    alert.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
};

// Admin tab navigation — landing + PR/VS/Shop sub-sections.
window.showAdminLanding = () => {
  document.getElementById('adminLanding')?.classList.remove('d-none');
  document.getElementById('adminPRSection')?.classList.add('d-none');
  document.getElementById('adminVSSection')?.classList.add('d-none');
  document.getElementById('adminShopSection')?.classList.add('d-none');
};

window.openAdminSection = async (which) => {
  document.getElementById('adminLanding')?.classList.add('d-none');
  document.getElementById('adminPRSection')?.classList.toggle('d-none', which !== 'pr');
  document.getElementById('adminVSSection')?.classList.toggle('d-none', which !== 'vs');
  document.getElementById('adminShopSection')?.classList.toggle('d-none', which !== 'shop');
  if (which === 'pr') {
    await enterPRStaffDashboard();
  } else if (which === 'vs') {
    await enterVSStaffDashboard();
  } else if (which === 'shop') {
    await openShopAdmin();
  }
};

window.onVSAdminRoleChange = async () => {
  // Refetch tickets for the newly-selected VS staff role.
  await enterVSStaffDashboard();
};

// VS track: load history using the global auth identity. VS submission/
// lookup is still on GAS in Phase 1, keyed by (username, password). We
// pass the same synthesized pair we used at submit time (email/@username
// + auth user UUID). Phase 3 migrates VS storage to Supabase and the
// password becomes irrelevant — auth.uid() is the FK.
window.loadVSHistoryFromAuth = () => {
  const alertBox = document.getElementById('trackAlert');
  const user = authGetUser();
  if (!user) return;

  const synthUser = user.email || (user.username ? `@${user.username}` : '');
  const synthPass = user.id || '';

  if (!synthUser || !synthPass) {
    if (alertBox) {
      alertBox.classList.remove('d-none');
      alertBox.innerHTML = 'ข้อมูลการเข้าสู่ระบบไม่สมบูรณ์ กรุณา'
        + '<a href="#" onclick="event.preventDefault(); samoSignOut();" class="alert-link">ออกจากระบบ</a>'
        + ' แล้วเข้าสู่ระบบใหม่อีกครั้ง';
    }
    return;
  }

  const u = document.getElementById('trackUsername');
  const p = document.getElementById('trackPassword');
  if (u) u.value = synthUser;
  if (p) p.value = synthPass;
  loginToViewHistory();
};

window.trackWithTicketIdFromAuth = () => {
  const input = document.getElementById('trackTicketIdAuth');
  const fallback = document.getElementById('trackTicketId');
  if (input && fallback) fallback.value = input.value;
  trackWithTicketId();
};

// About Us: activate the about tab and scroll to the given section anchor.
// The CSS scroll-margin-top on .about-section keeps the heading clear of
// the sticky navbar. Mark aboutDropdown .active because #pills-about-tab is
// hidden — Bootstrap's tab-system .active would land on the invisible button.
window.goToAbout = (sectionId) => {
  const btn = document.getElementById('pills-about-tab');
  if (btn && window.bootstrap) window.bootstrap.Tab.getOrCreateInstance(btn).show();
  document.getElementById('aboutDropdown')?.classList.add('active');
  requestAnimationFrame(() => {
    const target = document.getElementById(sectionId);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
};

window.samoPasswordRegister = async () => {
  const username = document.getElementById('signinRegisterUsername').value;
  const password = document.getElementById('signinRegisterPassword').value;
  const confirm = document.getElementById('signinRegisterConfirm').value;
  const alert = document.getElementById('signinRegisterAlert');
  const btn = document.getElementById('signinRegisterBtn');
  alert.classList.add('d-none');
  if (password !== confirm) {
    alert.textContent = 'รหัสผ่านไม่ตรงกัน';
    alert.classList.remove('d-none');
    return;
  }
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังสมัคร...';
  try {
    await registerWithPassword(username, password);
    // Auth subscriber will close the modal.
  } catch (e) {
    alert.textContent = e.message || 'สมัครสมาชิกไม่สำเร็จ';
    alert.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
};

// PR Auth
window.handlePrGoogleLogin = handlePrGoogleLogin;
window.logoutGoogle = logoutGoogle;
window.forceShowGoogleAuth = forceShowGoogleAuth;
window.togglePrAccountFields = togglePrAccountFields;

// PR Form
window.togglePrMode = togglePrMode;
window.toggleProjectFormatCopost = toggleProjectFormatCopost;
window.toggleOtherPlatformReason = toggleOtherPlatformReason;

// PR Tracking
window.trackPRTicket = trackPRTicket;
window.refreshPRTicketDashboard = refreshPRTicketDashboard;
window.loadPRHistory = loadPRHistory;
window.openPRTicketDetail = openPRTicketDetail;
window.logoutPRTrack = logoutPRTrack;

// PR Staff (login/logout removed — admin tab is gated by global auth)
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

// VS Form
window.toggleVitalSoundMode = toggleVitalSoundMode;
window.toggleVsAccountFields = toggleVsAccountFields;
window.verifyAccount = verifyAccount;
window.toggleEmergency = toggleEmergency;

// VS Tracking
window.trackWithTicketId = trackWithTicketId;
window.loginToViewHistory = loginToViewHistory;
window.submitUserRemark = submitUserRemark;
window.openTicketDetail = openTicketDetail;
window.logoutTrack = logoutTrack;

// VS Staff (login/logout removed — admin tab is gated by global auth)
window.fetchStaffTickets = fetchStaffTickets;
window.openStaffModalByIndex = openStaffModalByIndex;
window.submitStaffAction = submitStaffAction;

// ==============================================
// DOM CONTENT LOADED
// ==============================================

// Close the mobile offcanvas whenever the user actions any control inside it
// (pill tab switch, modal trigger, anchor link). We close in JS rather than
// using data-bs-dismiss because that doesn't reliably fire when combined with
// other data-bs-* attributes — and our tab switches use onclick now.
document.addEventListener('click', (e) => {
  const trigger = e.target.closest('.offcanvas-body button, .offcanvas-body a.nav-link');
  if (!trigger) return;
  const offcanvasEl = trigger.closest('.offcanvas');
  if (!offcanvasEl) return;
  const inst = window.bootstrap?.Offcanvas.getOrCreateInstance(offcanvasEl);
  if (inst) inst.hide();
});

// Bootstrap's tab JS auto-opens (and keeps open) the parent dropdown when an
// inner tab activates — so clicking "PR Form" inside เครื่องมือ leaves the
// dropdown stuck open. Bootstrap does this by directly setting .show on the
// .dropdown-menu, bypassing the Dropdown API — so we strip it manually on
// both the menu and the toggle, and reset aria-expanded.
document.addEventListener('shown.bs.tab', (e) => {
  document.querySelectorAll('.samo-navbar .dropdown-menu.show').forEach((menu) => {
    menu.classList.remove('show');
  });
  document.querySelectorAll('.samo-navbar .dropdown-toggle.show').forEach((toggle) => {
    toggle.classList.remove('show');
  });
  document.querySelectorAll('.samo-navbar [data-bs-toggle="dropdown"][aria-expanded="true"]').forEach((toggle) => {
    toggle.setAttribute('aria-expanded', 'false');
  });

  // Mirror Bootstrap's .active on the aboutDropdown trigger: #pills-about-tab
  // is the hidden canonical button so Bootstrap can't visibly mark it. Only
  // goToAbout adds .active; clear it whenever any other tab takes over.
  if (e.target?.id !== 'pills-about-tab') {
    document.getElementById('aboutDropdown')?.classList.remove('active');
  }

  // When the Admin tab opens, auto-route single-role users straight to their
  // dashboard (skipping the landing). Dev sees the landing so they can pick.
  if (e.target?.id === 'pills-admin-tab') {
    // Auto-route single-role staff straight to their dashboard. The
    // previous version read localStorage('samoUser') which was never
    // written (leftover from pre-Supabase) — so role was always null
    // and this fell through. authGetUser() is the canonical source.
    const role = authGetUser()?.role || null;
    const landingVisible = !document.getElementById('adminLanding')?.classList.contains('d-none');
    if (landingVisible) {
      if (role === 'pr_staff') window.openAdminSection('pr');
      else if (role === 'vs_staff') window.openAdminSection('vs');
      else if (role === 'shop_admin') window.openAdminSection('shop');
    }
  }
});

// Activate a tab by the desktop tab button's ID. Used from places that
// aren't part of the main tablist (mobile offcanvas, home cards) — routing
// through the canonical tab button means Bootstrap sees the full tablist
// and correctly deactivates the previously-active pane.
window.activateTab = (tabBtnId) => {
  const btn = document.getElementById(tabBtnId);
  if (!btn || !window.bootstrap) return;
  window.bootstrap.Tab.getOrCreateInstance(btn).show();
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

function roleBadgeClass(role) {
  if (role === 'pr_staff')   return 'bg-warning text-dark';
  if (role === 'vs_staff')   return 'bg-info text-dark';
  if (role === 'shop_admin') return 'bg-orange-subtle text-warning border border-warning-subtle';
  if (role === 'vp_admin')   return 'bg-success';
  if (role === 'uni_staff')  return 'bg-primary';
  if (role === 'dev')        return 'bg-dark';
  return 'd-none';
}

// Scroll the home announcements carousel by one card width. Direction is
// -1 (prev) or +1 (next).
window.scrollHomeAnnounce = (direction) => {
  const grid = document.getElementById('homeAnnouncementsGrid');
  if (!grid) return;
  const firstCard = grid.querySelector('.home-announce-card');
  const step = (firstCard ? firstCard.offsetWidth : grid.clientWidth * 0.85) + 16;
  grid.scrollBy({ left: step * direction, behavior: 'smooth' });
};

document.addEventListener('DOMContentLoaded', () => {
  // Load announcements
  loadAnnouncements();

  // Track previous auth identity so we can distinguish "real" auth
  // transitions (sign in / out / role change) from background events
  // like token refresh. Several UI side-effects only make sense on a
  // real transition — e.g. resetting the admin tab back to its
  // landing page would be wrong on a 25-min token refresh because it
  // would yank the user out of the kanban they were working in.
  let prevAuthKey = '__init__';

  // Subscribe navbar + home page + sign-in modal to global auth state.
  onAuthChange((user) => {
    const role = user?.role || null;
    // Identity-and-role fingerprint. Different value = real transition.
    const authKey = user ? `${user.id}|${role}` : '<signed-out>';
    const isTransition = authKey !== prevAuthKey;
    prevAuthKey = authKey;

    // Navbar (desktop)
    const navOut = document.getElementById('navAuthSignedOut');
    const navIn = document.getElementById('navAuthSignedIn');
    if (navOut && navIn) {
      navOut.classList.toggle('d-none', !!user);
      navIn.classList.toggle('d-none', !user);
      if (user) {
        const pic = document.getElementById('navUserPic');
        const name = document.getElementById('navUserName');
        const nameDropdown = document.getElementById('navUserNameDropdown');
        const dept = document.getElementById('navUserDept');
        const email = document.getElementById('navUserEmail');
        const roleBadge = document.getElementById('navUserRoleBadge');
        if (pic) pic.src = user.picture || '';
        if (name) name.textContent = user.name || user.username || '';
        if (nameDropdown) nameDropdown.textContent = user.name || user.username || '';
        if (dept) dept.textContent = user.department || (user.email ? '' : (user.username || ''));
        if (email) email.textContent = user.email || (user.method === 'password' ? `@${user.username}` : '');
        if (roleBadge) {
          const label = roleLabel(role);
          if (label) {
            roleBadge.textContent = label;
            roleBadge.className = `badge ms-1 ${roleBadgeClass(role)}`;
          } else {
            roleBadge.className = 'badge ms-1 d-none';
          }
        }
      }
    }

    // Mobile offcanvas auth buttons
    document.getElementById('mobileAuthSignedOut')?.classList.toggle('d-none', !!user);
    document.getElementById('mobileAuthSignedIn')?.classList.toggle('d-none', !user);

    // Role-gated nav items + admin landing cards
    const isStaffRole = role === 'pr_staff' || role === 'vs_staff' || role === 'shop_admin' || role === 'dev';
    document.getElementById('navAdminItem')?.classList.toggle('d-none', !isStaffRole);
    document.getElementById('mobileAdminItem')?.classList.toggle('d-none', !isStaffRole);
    document.querySelectorAll('[data-role-only]').forEach((el) => {
      const allowed = el.getAttribute('data-role-only').split(/\s+/);
      el.classList.toggle('d-none', !role || !allowed.includes(role));
    });
    // Reset admin tab to landing ONLY on a real auth transition (sign
    // in, sign out, or role change). Plain token-refresh events also
    // fire onAuthChange — without this guard, the user gets ejected
    // from whichever admin section they were working in every 25 min.
    if (isTransition && typeof window.showAdminLanding === 'function') {
      window.showAdminLanding();
    }

    // Dev-only features
    document.querySelectorAll('.dev-only-feature').forEach((el) => {
      el.classList.toggle('d-none', role !== 'dev');
    });

    // Home page
    const homeOut = document.getElementById('homeAuthSignedOut');
    const homeIn = document.getElementById('homeAuthSignedIn');
    if (homeOut && homeIn) {
      homeOut.classList.toggle('d-none', !!user);
      homeIn.classList.toggle('d-none', !user);
      if (user) {
        const homeName = document.getElementById('homeUserName');
        const homeDept = document.getElementById('homeUserDept');
        if (homeName) homeName.textContent = user.name || user.username || '';
        if (homeDept) homeDept.textContent = user.department || roleLabel(role) || 'ยังไม่ได้ระบุฝ่าย';
      }
    }

    // PR form auth wrapper: hide whenever the user is signed in (the global
    // identity is enough — no need to ask again in the form). pr-auth.js
    // already keeps the hidden submitter inputs in sync.
    document.getElementById('prFormAuthWrapper')?.classList.toggle('d-none', !!user);

    // VS track section: swap signed-in/signed-out blocks
    const vsTrackIn = document.getElementById('vsTrackLoggedIn');
    const vsTrackOut = document.getElementById('vsTrackLoggedOut');
    if (vsTrackIn && vsTrackOut) {
      vsTrackIn.classList.toggle('d-none', !user);
      vsTrackOut.classList.toggle('d-none', !!user);
      if (user) {
        const display = user.email || user.username || '';
        const el = document.getElementById('vsTrackUserDisplay');
        if (el) el.textContent = display;
      }
    }

    // VS form auth wrapper. Visibility is idempotent (toggle every time)
    // but the input mutations below would clobber whatever the user is
    // typing if a token-refresh event fires mid-edit — so only run them
    // on a real transition.
    const vsWrapper = document.getElementById('vsFormAuthWrapper');
    if (vsWrapper) {
      vsWrapper.classList.toggle('d-none', !!user);
      if (isTransition) {
        if (user) {
          const vsLoginRadio = document.getElementById('vsAccLogin');
          const vsUser = document.getElementById('vsUsername');
          const vsPass = document.getElementById('vsPassword');
          const synthUser = user.email || (user.username ? `@${user.username}` : '');
          const synthPass = user.id || '';
          if (vsLoginRadio) vsLoginRadio.checked = true;
          if (vsUser) vsUser.value = synthUser;
          if (vsPass) vsPass.value = synthPass;
          setIsAccountVerified(true);
        } else {
          setIsAccountVerified(false);
          // Reset to guest mode so a signed-out user sees the default option.
          const vsGuestRadio = document.getElementById('vsAccGuest');
          if (vsGuestRadio) vsGuestRadio.checked = true;
        }
      }
    }

    // Auto-close sign-in modal — only on the transition to signed-in.
    // Without this guard, every token refresh would close the modal even
    // if the user had re-opened it for some reason.
    if (isTransition && user) {
      const modalEl = document.getElementById('signinModal');
      if (modalEl && window.bootstrap) {
        const inst = window.bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
      }
    }
  });

  // PR form reflects global auth state into its own DOM
  initPrAuth();

  // Restore the Supabase auth session (it's persisted in localStorage by
  // the supabase-js client). Async, but we don't await — subscribers will
  // be notified when the session is ready.
  initAuth();

  // Initialize PR form event listeners
  initPrForm();

  // Initialize the SAMO Shop tab. Wires the sub-nav, cart FAB, and lazy
  // loaders. Data is only fetched when the user actually opens the tab.
  initShop();

  // Initialize the project-tracking tab. Wires sub-nav, bell, hash
  // routing, and the create/send modal. Visibility and data load are
  // gated by role (vp_admin / uni_staff / dev) inside the module.
  initProjects();
});
