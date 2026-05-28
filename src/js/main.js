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
import { loadAnnouncements, viewAnnouncement, closeArticleView } from './announcements.js';
import { initPrAuth, handlePrGoogleLogin, logoutGoogle, forceShowGoogleAuth, togglePrAccountFields } from './pr-auth.js';
import { initPrForm, togglePrMode, updateFormVisibility, toggleProjectFormatCopost, toggleOtherPlatformReason, applyDateRules, syncPublishDate } from './pr-form.js';
import { trackPRTicket, refreshPRTicketDashboard, loadPRHistory, openPRTicketDetail, logoutPRTrack } from './pr-tracking.js';
import { initVsForm, toggleVitalSoundMode, toggleVsAccountFields, verifyAccount, toggleEmergency, setIsAccountVerified } from './vs-form.js';
import { trackWithTicketId, loginToViewHistory, submitUserRemark, openTicketDetail, logoutTrack } from './vs-tracking.js';
import { initShop } from './shop/index.js';

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

let vsQuillRef = null;

// The public app only initialises Quill for the VS form. The creator
// (announcement-writing) Quill lives in the admin app (admin-main.js)
// since /admin/ is where staff publish.
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

initVsForm(vsQuill);

// ==============================================
// ATTACH FUNCTIONS TO WINDOW
// (Required for inline onclick="" handlers in HTML)
// ==============================================

// Announcements (read-only on public site)
window.loadAnnouncements = loadAnnouncements;
window.viewAnnouncement = viewAnnouncement;
window.closeArticleView = closeArticleView;
// Staff who click "edit"/"delete" on a public article jump to /admin/.
window.editCurrentAnnouncement = () => { location.href = '/admin/#creator'; };
window.deleteCurrentAnnouncement = () => { location.href = '/admin/#creator'; };

// Global Auth
window.samoSignOut = samoSignOut;
window.samoGoogleSignIn = async () => {
  try {
    await signInWithGoogle();
  } catch (e) {
    alert('เปิดหน้า Google ไม่สำเร็จ: ' + (e.message || e));
  }
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

// Admin / projects handlers no longer live in the public bundle —
// they're in /admin/. If something on the public site references them
// (e.g. a hardcoded onclick), redirect to /admin/.
window.showAdminLanding = () => { location.href = '/admin/'; };
window.openAdminSection = (which) => { location.href = '/admin/#' + which; };
window.openManageAgentsModal = () => { location.href = '/admin/#pr'; };

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

// About Us: activate the about tab (hidden tab button — reachable only via
// footer / mobile offcanvas links) and scroll to the given section anchor.
// The CSS scroll-margin-top on .about-section keeps the heading clear of
// the sticky navbar.
window.goToAbout = (sectionId) => {
  const btn = document.getElementById('pills-about-tab');
  if (btn && window.bootstrap) window.bootstrap.Tab.getOrCreateInstance(btn).show();
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

// PR Staff handlers moved to /admin/. Anything that still touches these
// (legacy modal triggers) jumps to the admin app.
window.fetchPRStaffTickets = () => { location.href = '/admin/#pr'; };
window.filterPRStaffTickets = () => {};
window.openPRStaffModal = () => { location.href = '/admin/#pr'; };
window.submitPRStaffAction = () => {};
window.deletePRStaffAction = () => {};
window.addNewAgent = () => {};
window.removeAgent = () => {};
window.addPRStaffAssignee = () => {};
window.removePRStaffAssignee = () => {};

// VS Form (PUBLIC — visitor submits a problem report)
window.toggleVitalSoundMode = toggleVitalSoundMode;
window.toggleVsAccountFields = toggleVsAccountFields;
window.verifyAccount = verifyAccount;
window.toggleEmergency = toggleEmergency;

// VS Tracking (PUBLIC — visitor checks status of their own ticket)
window.trackWithTicketId = trackWithTicketId;
window.loginToViewHistory = loginToViewHistory;
window.submitUserRemark = submitUserRemark;
window.openTicketDetail = openTicketDetail;
window.logoutTrack = logoutTrack;

// VS Staff handlers moved to /admin/.
window.fetchStaffTickets = () => { location.href = '/admin/#vs'; };
window.openStaffModalByIndex = () => { location.href = '/admin/#vs'; };
window.submitStaffAction = () => {};
window.onVSAdminRoleChange = () => {};

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
  // The user-profile dropdown is the only dropdown left in the navbar.
  // Bootstrap's tab JS sometimes leaves .show stuck on a dropdown when an
  // inner tab activated it (legacy paths) — sweep it defensively so the
  // menu can't end up open-but-empty after a programmatic tab switch.
  document.querySelectorAll('.samo-navbar .dropdown-menu.show').forEach((menu) => {
    menu.classList.remove('show');
  });
  document.querySelectorAll('.samo-navbar .dropdown-toggle.show').forEach((toggle) => {
    toggle.classList.remove('show');
  });
  document.querySelectorAll('.samo-navbar [data-bs-toggle="dropdown"][aria-expanded="true"]').forEach((toggle) => {
    toggle.setAttribute('aria-expanded', 'false');
  });

  // Content-display tabs (about/tools/announcements) should start at the
  // top so the visitor sees the hero, not whatever scroll Y they were at
  // on the previous tab. App tabs (admin/projects) have their own hash
  // routing that scrolls to specific items — don't override those.
  if (e.target?.id === 'pills-about-tab'
      || e.target?.id === 'pills-tools-tab'
      || e.target?.id === 'pills-announcements-tab') {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // (Admin and Projects are no longer tabs in the public app — they live
  // at /admin/. Workspace-mode chrome-hide is gone with them.)
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

// (Legacy exitWorkspace removed — admin app at /admin/ has its own
// "กลับสู่หน้าหลัก" link that hrefs to / directly.)

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

// ==============================================
// TOOLS LAUNCHER — search + chip filter.
// Scales to 100+ tools because logic operates on data-* attributes;
// adding a new tool means dropping a button into tab-tools.html.
// ==============================================

let _launcherFilter = 'all';

window.setLauncherFilter = (cat) => {
  _launcherFilter = cat;
  document.querySelectorAll('.launcher-chip').forEach((chip) => {
    chip.classList.toggle('is-active', chip.dataset.filter === cat);
  });
  applyLauncherFilters();
};

window.filterLauncher = () => applyLauncherFilters();

window.resetLauncher = () => {
  const input = document.getElementById('launcherSearchInput');
  if (input) input.value = '';
  window.setLauncherFilter('all');
};

function applyLauncherFilters() {
  const q = (document.getElementById('launcherSearchInput')?.value || '').trim().toLowerCase();
  const cat = _launcherFilter;
  let visibleTotal = 0;

  document.querySelectorAll('.launcher-section').forEach((section) => {
    // role-gated sections (currently #launcherSectionStaff) keep their
    // d-none from auth gating; we only flip is-hidden for filter state.
    const tools = section.querySelectorAll('.launcher-tool');
    let visibleInSection = 0;

    tools.forEach((tool) => {
      // role-gated tools start hidden (d-none) until auth wakes them up.
      // Skip those entirely — keep them invisible regardless of filter.
      if (tool.classList.contains('d-none')) return;

      const cats = (tool.dataset.cats || '').split(/\s+/).filter(Boolean);
      const name = (tool.dataset.name || '').toLowerCase();

      const matchesCat = cat === 'all' || cats.includes(cat);
      const matchesQuery = !q || name.includes(q) || (tool.querySelector('.launcher-tool-name')?.textContent || '').toLowerCase().includes(q);

      const show = matchesCat && matchesQuery;
      tool.classList.toggle('is-hidden', !show);
      if (show) visibleInSection += 1;
    });

    section.classList.toggle('is-hidden', visibleInSection === 0);
    visibleTotal += visibleInSection;
  });

  document.getElementById('launcherEmpty')?.classList.toggle('d-none', visibleTotal > 0);
}

// Apply role-gated launcher visibility: each tool with data-roles="…" shows
// only when the current role is in the whitelist. Section visibility tracks
// "any visible tool inside" so an empty section disappears.
function applyLauncherRoleGating(role) {
  // Show the staff chip + section if the user has any data-roles tool they qualify for.
  let staffVisible = false;
  document.querySelectorAll('.launcher-tool[data-roles]').forEach((tool) => {
    const allowed = tool.dataset.roles.split(/\s+/).filter(Boolean);
    const ok = !!role && allowed.includes(role);
    tool.classList.toggle('d-none', !ok);
    if (ok && tool.closest('#launcherSectionStaff')) staffVisible = true;
  });
  document.getElementById('launcherSectionStaff')?.classList.toggle('d-none', !staffVisible);
  document.getElementById('launcherChipStaff')?.classList.toggle('d-none', !staffVisible);
  // Re-apply the current filter so visible counts stay correct.
  applyLauncherFilters();
}

// "/" keyboard shortcut focuses the launcher search when the tools tab is open.
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  // Don't hijack while typing into an existing input/textarea/contenteditable.
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (document.getElementById('pills-tools')?.classList.contains('active')) {
    const search = document.getElementById('launcherSearchInput');
    if (search) { e.preventDefault(); search.focus(); }
  }
});

// About sub-nav — highlight whichever section is currently in view.
// Triggered once after DOM load; observer is cheap to leave running.
function initAboutSubnav() {
  const links = document.querySelectorAll('.about-subnav-link[data-about-target]');
  if (!links.length) return;
  const sections = Array.from(links)
    .map((a) => document.getElementById(a.dataset.aboutTarget))
    .filter(Boolean);
  if (!sections.length) return;

  const linkFor = (id) => document.querySelector(`.about-subnav-link[data-about-target="${id}"]`);
  const setActive = (id) => {
    links.forEach((l) => l.classList.toggle('is-active', l.dataset.aboutTarget === id));
  };

  // Pick the section whose top is closest to (but past) the sub-nav baseline.
  // rootMargin pulls the activation line below the sticky nav.
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) setActive(visible[0].target.id);
    },
    { rootMargin: '-180px 0px -55% 0px', threshold: [0, 0.1, 0.5] },
  );
  sections.forEach((s) => observer.observe(s));

  // Clicking jumps via goToAbout which already calls scrollIntoView — but
  // visually pre-select so the highlight doesn't lag the scroll.
  links.forEach((a) => {
    a.addEventListener('click', () => setActive(a.dataset.aboutTarget));
  });
  // Mark `linkFor` as used for readers; intentionally no further wiring.
  void linkFor;
}

// (Project bell removed from the public navbar — it lives only in
// /admin/ now, since notifications are operator-facing.)

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

    // Mobile offcanvas: sign-in CTA (signed-out), user strip + sign-out (signed-in)
    document.getElementById('mobileAuthSignedOut')?.classList.toggle('d-none', !!user);
    document.getElementById('mobileAuthSignedIn')?.classList.toggle('d-none', !user);
    document.getElementById('mobileSignOutItem')?.classList.toggle('d-none', !user);
    if (user) {
      const mPic  = document.getElementById('mobileUserPic');
      const mName = document.getElementById('mobileUserName');
      const mDept = document.getElementById('mobileUserDept');
      if (mPic)  mPic.src = user.picture || '';
      if (mName) mName.textContent = user.name || user.username || '';
      if (mDept) mDept.textContent = user.department || roleLabel(role) || (user.email || `@${user.username || ''}`);
    }

    // Staff role-gating: surface the "ไปยัง Admin" link in the avatar
    // dropdown and the mobile offcanvas only when the user has a staff
    // role. The admin link itself navigates to /admin/.
    const isStaffRole = role === 'pr_staff' || role === 'vs_staff' || role === 'shop_admin'
      || role === 'vp_admin' || role === 'uni_staff' || role === 'dev';
    document.getElementById('navAdminLink')?.classList.toggle('d-none', !isStaffRole);
    document.getElementById('mobileAdminLink')?.classList.toggle('d-none', !isStaffRole);

    // Generic data-role-only — kept for legacy hooks (used by the article
    // reader's edit/delete buttons that redirect to /admin/).
    document.querySelectorAll('[data-role-only]').forEach((el) => {
      const allowed = el.getAttribute('data-role-only').split(/\s+/);
      el.classList.toggle('d-none', !role || !allowed.includes(role));
    });

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

  // Initialize the SAMO Shop tab (customer side). Wires sub-nav, cart
  // FAB, and lazy loaders.
  initShop();

  // (Projects module no longer initialised on the public site — it
  // lives in /admin/.)

  // About-tab sticky sub-nav: highlight whichever section is in view.
  initAboutSubnav();
});
