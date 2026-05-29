// ==============================================
// VS FORM — Vital Sound Report Submission
// ==============================================

import { GAS_VITAL_SOUND_URL } from './config.js';
import { getUser as authGetUser } from './auth.js';
import { sendNotify } from './notify.js';

// ----------------------------------------------------
// Ticket ID generator — VS-YYMMDD-HHMM-XXX. The trailing 3-char random
// suffix prevents collisions when two submissions land in the same
// minute. Without it, the idempotent-insert retry path treats the
// second submitter's PK conflict (409) as "first attempt succeeded"
// and silently drops their data.
// ----------------------------------------------------
function generateVSTicketId() {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 3; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `VS-${(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${suffix}`;
}

// Idempotent VS insert via raw fetch (see pr-form.js rationale).
async function insertVSTicketIdempotent(row) {
  const TIMEOUT_MS = 12000;
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

  let accessToken = ANON_KEY;
  try {
    const projectRef = (SUPABASE_URL || '').match(/\/\/([^.]+)\./)?.[1];
    const stored = projectRef ? localStorage.getItem(`sb-${projectRef}-auth-token`) : null;
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.access_token) accessToken = parsed.access_token;
    }
  } catch { /* ignore — use anon */ }

  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  const url = `${SUPABASE_URL}/rest/v1/vs_tickets`;
  const bodyText = JSON.stringify(row);

  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyText,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return;
      if (attempt > 1 && res.status === 409) {
        console.warn('[vs] retry detected first attempt succeeded; ticket exists');
        return;
      }
      const errText = await res.text().catch(() => '');
      throw new Error(`PostgREST ${res.status}: ${errText.substring(0, 200)}`);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt === 2) break;
      const why = e.name === 'AbortError' ? 'timeout' : (e.message || e);
      console.warn(`[vs] insert attempt ${attempt} failed (${why}); retrying`);
    }
  }
  const msg = (lastErr && lastErr.message) || String(lastErr);
  if (/timeout|abort/i.test(msg) || lastErr?.name === 'AbortError') {
    throw new Error('การส่งใช้เวลานานเกินไป กรุณาลองอีกครั้งหรือเช็คการเชื่อมต่อ');
  }
  throw lastErr;
}

let isAccountVerified = false;
let vsQuill = null;

export function setIsAccountVerified(value) {
  isAccountVerified = !!value;
}

export function initVsForm(quillInstance) {
  vsQuill = quillInstance;
  document.getElementById('vitalSoundForm').addEventListener('submit', handleVsFormSubmit);
}

// --------------------------------------------------
// Mode Toggle
// --------------------------------------------------

export function toggleVitalSoundMode() {
  const isReport = document.getElementById('vsModeReport').checked;
  const isTrack = document.getElementById('vsModeTrack').checked;
  document.getElementById('vsReportSection').classList.toggle('d-none', !isReport);
  document.getElementById('vsTrackSection').classList.toggle('d-none', !isTrack);
}

// --------------------------------------------------
// Account Fields Toggle
// --------------------------------------------------

export function toggleVsAccountFields() {
  // Two-option pattern (guest / login) — mirrors the PR form. The
  // legacy "create anonymous account" flow is gone. Login here means
  // "use the signed-in Google identity"; the auth subscriber in
  // main.js handles the post-login state by hiding the wrapper
  // entirely and auto-populating the hidden synth fields.
  const accMode = document.querySelector('input[name="vsAccountMode"]:checked').value;
  const nudge = document.getElementById('vsGoogleAuthContainer');

  if (accMode === 'guest') {
    nudge?.classList.add('d-none');
    isAccountVerified = true;
  } else {
    // login → show the "open sign-in modal" nudge. Once the user
    // signs in, main.js hides the whole wrapper so this nudge
    // never re-appears in the same submit.
    nudge?.classList.remove('d-none');
    isAccountVerified = false;
  }
}

// --------------------------------------------------
// Account Verification
// --------------------------------------------------

// No-op now that the manual create/verify UI is gone. Authentication
// for VS goes through the global Google sign-in modal; main.js sets
// isAccountVerified=true post-sign-in. Kept exported so the window.*
// shim in main.js doesn't error.
export async function verifyAccount() {}

// --------------------------------------------------
// Emergency Toggle
// --------------------------------------------------

export function toggleEmergency() {
  const isEmergency = document.getElementById('vsEmergency').checked;
  const deptSelect = document.getElementById('vsDepartment');
  const seOption = deptSelect.querySelector('option[value="SE"]');
  if (isEmergency) {
    seOption.disabled = true;
    if (deptSelect.value === 'SE') deptSelect.value = 'อุปนายกฝ่ายบริหารองค์กร';
    document.getElementById('reqDeptStar').style.display = 'inline';
  } else {
    seOption.disabled = false;
    document.getElementById('reqDeptStar').style.display = 'none';
  }
}

// --------------------------------------------------
// Form Submission
// --------------------------------------------------

async function handleVsFormSubmit(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const ogText = btn.innerHTML;
  const alertBox = document.getElementById('reportAlertBox');
  alertBox.classList.add('d-none');

  const accMode = document.querySelector('input[name="vsAccountMode"]:checked').value;
  if ((accMode === 'create' || accMode === 'login') && !isAccountVerified) {
    alertBox.innerHTML = '<i class="bi bi-exclamation-circle-fill me-1"></i> กรุณากดปุ่มเพื่อยืนยันบัญชีให้เรียบร้อยก่อนกดยืนยันส่งปัญหา';
    alertBox.classList.remove('d-none'); window.scrollTo({ top: 0, behavior: 'smooth' }); return;
  }

  const contentHtml = vsQuill.root.innerHTML;
  const contentText = vsQuill.getText().trim();
  if (contentText.length === 0) {
    alertBox.innerHTML = '<i class="bi bi-exclamation-circle-fill me-1"></i> กรุณาระบุรายละเอียดปัญหาในกล่องข้อความ';
    alertBox.classList.remove('d-none'); window.scrollTo({ top: 0, behavior: 'smooth' }); return;
  }

  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังส่งข้อมูล...'; btn.disabled = true;

  const formData = new FormData(e.target);
  const submitter = authGetUser();
  const submitterLabel = submitter
    ? (submitter.email || (submitter.username ? `@${submitter.username}` : ''))
    : '';
  const isEmergency = formData.get('vsEmergency') === 'true';
  const customerRequestedDept = formData.get('vsDepartment') || 'SE';
  // Same routing logic as the legacy GAS: emergency → straight to the
  // selected dept; normal → SE triage first regardless of user selection.
  const responsibleDept = isEmergency ? customerRequestedDept : 'SE';
  const initialStatus = isEmergency ? 'กำลังรออุปนายกพิจารณา (ด่วน)' : 'รอ SE รับเรื่อง';

  const ticketId = generateVSTicketId();
  const row = {
    id: ticketId,
    display_name: formData.get('vsName') || 'Anonymous',
    year: formData.get('vsYear') || '-',
    submitter_id: submitter?.id || null,
    submitter_label: submitterLabel || null,
    problem: contentHtml,
    target_dept: responsibleDept,
    requested_dept: customerRequestedDept,
    status: initialStatus,
    is_emergency: isEmergency,
    remarks: [],
  };

  const silentNotify = formData.get('vsSilentNotify') === 'true';
  const skipDiscord = document.getElementById('vsSkipDiscord')?.checked === true;

  try {
    await insertVSTicketIdempotent(row);

    // Fire-and-forget Discord notify via the unified helper
    // (fetch + keepalive — see notify.js for why not sendBeacon).
    if (!skipDiscord) {
      sendNotify('vs', {
        mode: 'submit',
        ticketId,
        vsProblem: contentHtml,
        department: responsibleDept,
        isEmergency,
        vsSilentNotify: silentNotify,
        requestedDept: customerRequestedDept,
      });
    }

    if (!submitter) {
      alert(`✅ ส่งข้อมูลสำเร็จ!\n\nโปรดบันทึกหมายเลขนี้ไว้ติดตามสถานะ:\n${ticketId}\n\n* หากลืมจะไม่สามารถกลับมาดูสถานะได้`);
    } else {
      alert(`✅ สำเร็จ! ระบบบันทึกปัญหาของคุณเรียบร้อยแล้ว\nTicket ID: ${ticketId}`);
    }
    e.target.reset(); vsQuill.setText('');
    document.getElementById('vsAccGuest').checked = true;
    toggleVsAccountFields(); toggleEmergency();
  } catch (error) {
    alertBox.innerHTML = `<i class="bi bi-wifi-off me-1"></i> บันทึกไม่สำเร็จ: ${error.message || error}`;
    alertBox.classList.remove('d-none');
  }
  finally { btn.innerHTML = ogText; btn.disabled = false; window.scrollTo({ top: 0, behavior: 'smooth' }); }
}
