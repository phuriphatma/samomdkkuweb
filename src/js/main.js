// ==============================================
// MAIN.JS — Entry Point
// Initializes all modules, Quill editors, and
// attaches exported functions to window for
// inline onclick handlers in HTML.
// ==============================================

import '../main.css';
import { QUILL_TOOLBAR } from './config.js';

// --- Module Imports ---
import { initAnnouncements, loadAnnouncements, publishAnnouncement, viewAnnouncement, cancelEdit, editCurrentAnnouncement } from './announcements.js';
import { initPrAuth, handlePrGoogleLogin, logoutGoogle, forceShowGoogleAuth, togglePrAccountFields } from './pr-auth.js';
import { initPrForm, togglePrMode, updateFormVisibility, toggleProjectFormatCopost, toggleOtherPlatformReason, applyDateRules, syncPublishDate } from './pr-form.js';
import { trackPRTicket, refreshPRTicketDashboard, loadPRHistory, openPRTicketDetail, logoutPRTrack } from './pr-tracking.js';
import { initPrStaffRemember, loginPRStaff, logoutPRStaff, fetchPRStaffTickets, openPRStaffModal, submitPRStaffAction, deletePRStaffAction, openManageAgentsModal, addNewAgent, removeAgent, addPRStaffAssignee, removePRStaffAssignee } from './pr-staff.js';
import { initVsForm, toggleVitalSoundMode, toggleVsAccountFields, verifyAccount, toggleEmergency } from './vs-form.js';
import { trackWithTicketId, loginToViewHistory, submitUserRemark, openTicketDetail, logoutTrack } from './vs-tracking.js';
import { initVsStaffRemember, loginStaff, logoutStaff, fetchStaffTickets, openStaffModalByIndex, submitStaffAction } from './vs-staff.js';

// ==============================================
// QUILL SETUP
// ==============================================

const Size = Quill.import('attributors/style/size');
Size.whitelist = ['10px', '12px', '13px', '14px', '15px', '16px', '18px', '20px', '24px', '32px'];
Quill.register(Size, true);

const creatorQuill = new Quill('#creatorQuillEditor', {
  theme: 'snow',
  placeholder: 'เขียนรายละเอียดประกาศของคุณที่นี่... สามารถคลุมดำข้อความเพื่อทำตัวหนา และกดไอคอน 🖼️ เพื่อแทรกรูปภาพได้',
  modules: { toolbar: QUILL_TOOLBAR },
});

const vsQuill = new Quill('#vsQuillEditor', {
  theme: 'snow',
  placeholder: 'อธิบายปัญหา หรือข้อเสนอแนะที่นี่... (รองรับการแนบภาพ/ลิงก์)',
  modules: { toolbar: QUILL_TOOLBAR },
});

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

// PR Staff
window.loginPRStaff = loginPRStaff;
window.logoutPRStaff = logoutPRStaff;
window.fetchPRStaffTickets = fetchPRStaffTickets;
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

// VS Staff
window.loginStaff = loginStaff;
window.logoutStaff = logoutStaff;
window.fetchStaffTickets = fetchStaffTickets;
window.openStaffModalByIndex = openStaffModalByIndex;
window.submitStaffAction = submitStaffAction;

// ==============================================
// DOM CONTENT LOADED
// ==============================================

document.addEventListener('DOMContentLoaded', () => {
  // Load announcements
  loadAnnouncements();

  // Restore Google auth state
  initPrAuth();

  // Restore staff remember-me
  initPrStaffRemember();
  initVsStaffRemember();

  // Initialize PR form event listeners
  initPrForm();
});
