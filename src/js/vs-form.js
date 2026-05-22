// ==============================================
// VS FORM — Vital Sound Report Submission
// ==============================================

import { GAS_VITAL_SOUND_URL } from './config.js';
import { db } from './db.js';
import { getUser as authGetUser } from './auth.js';
import { sendNotify } from './notify.js';

// ----------------------------------------------------
// Ticket ID generator — matches the legacy "VS-YYMMDD-HHMM" format
// so old and new tickets look the same in URLs and history.
// ----------------------------------------------------
function generateVSTicketId() {
  const d = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  return `VS-${(d.getFullYear() % 100)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
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
  isAccountVerified = false;
  document.getElementById('vsUsername').disabled = false;
  document.getElementById('vsPassword').disabled = false;
  document.getElementById('verifySuccessText').classList.add('d-none');
  document.getElementById('verifyFailText').classList.add('d-none');

  const accMode = document.querySelector('input[name="vsAccountMode"]:checked').value;
  const fieldsBox = document.getElementById('vsAccountFields');
  const btnVerify = document.getElementById('btnVerifyAccount');

  if (accMode === 'create' || accMode === 'login') {
    fieldsBox.classList.remove('d-none');
    btnVerify.disabled = false;
    btnVerify.className = 'btn btn-outline-danger w-100';
    btnVerify.innerHTML = accMode === 'create' ? 'สร้างบัญชี' : 'ตรวจสอบบัญชี';
  } else {
    fieldsBox.classList.add('d-none');
    isAccountVerified = true;
  }
}

// --------------------------------------------------
// Account Verification
// --------------------------------------------------

export async function verifyAccount() {
  const accMode = document.querySelector('input[name="vsAccountMode"]:checked').value;
  const user = document.getElementById('vsUsername').value.trim();
  const pass = document.getElementById('vsPassword').value.trim();
  const btn = document.getElementById('btnVerifyAccount');
  const failText = document.getElementById('verifyFailText');
  const successText = document.getElementById('verifySuccessText');

  failText.classList.add('d-none');
  successText.classList.add('d-none');

  if (!user || !pass) { failText.innerText = 'กรุณากรอก Username และ Password ให้ครบถ้วน'; failText.classList.remove('d-none'); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

  try {
    const res = await fetch(GAS_VITAL_SOUND_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'verifyAccount', mode: accMode, username: user, password: pass }),
    });
    const result = await res.json();
    if (result.success) {
      isAccountVerified = true;
      document.getElementById('vsUsername').disabled = true;
      document.getElementById('vsPassword').disabled = true;
      btn.innerHTML = '<i class="bi bi-check-lg"></i> ตรวจสอบผ่าน';
      btn.classList.replace('btn-outline-danger', 'btn-success');
      successText.classList.remove('d-none');
    } else {
      failText.innerHTML = `<i class="bi bi-x-circle-fill"></i> ${result.message}`;
      failText.classList.remove('d-none');
      btn.disabled = false;
      btn.innerText = accMode === 'create' ? 'สร้างบัญชี' : 'ตรวจสอบบัญชี';
    }
  } catch (e) {
    failText.innerText = 'การเชื่อมต่อล้มเหลว กรุณาลองใหม่';
    failText.classList.remove('d-none');
    btn.disabled = false;
    btn.innerText = accMode === 'create' ? 'สร้างบัญชี' : 'ตรวจสอบบัญชี';
  }
}

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
    const { error: insertErr } = await db.from('vs_tickets').insert(row);
    if (insertErr) throw insertErr;

    // Fire-and-forget Discord notify via the unified helper.
    if (!skipDiscord) {
      sendNotify('vs', {
        mode: 'submit',
        ticketId,
        vsProblem: contentHtml,
        department: responsibleDept,
        isEmergency,
        vsSilentNotify: silentNotify,
        requestedDept: customerRequestedDept,
      }).catch(() => { /* already warned in notify.js */ });
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
