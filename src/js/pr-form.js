// ==============================================
// PR FORM — Submission Logic, Visibility, Dates
// ==============================================

import { GAS_API_URL } from './config.js';
import { getIsPrAccountVerified } from './pr-auth.js';

let lastJobType = '';

// --------------------------------------------------
// Form Visibility & Conditional Fields
// --------------------------------------------------

export function updateFormVisibility() {
  const departmentSelect = document.getElementById('department');
  const igPostCheckbox = document.getElementById('plat1');
  const igStoryCheckbox = document.getElementById('plat2');
  const contactInput = document.getElementById('contactInput');
  const contactReqStar = document.getElementById('contactReqStar');
  const contactOptionalText = document.getElementById('contactOptionalText');
  const jobType1 = document.getElementById('jobType1');
  const labelJobType1 = document.getElementById('labelJobType1');
  const jobType2 = document.getElementById('jobType2');
  const regularPostingChannel = document.getElementById('regularPostingChannel');
  const projectDepartmentSection = document.getElementById('projectDepartmentSection');
  const projectPostingFormat = document.getElementById('projectPostingFormat');
  const copostWithSection = document.getElementById('copostWithSection');

  const isProject = departmentSelect.value === 'โครงการอื่นๆ';
  const isIgSelected = igPostCheckbox.checked || igStoryCheckbox.checked;

  if (isProject) {
    contactInput.setAttribute('required', 'required');
    contactReqStar.classList.remove('d-none');
    contactOptionalText.classList.add('d-none');
    jobType2.checked = true;
    jobType1.disabled = true;
    labelJobType1.classList.add('disabled');
  } else {
    contactInput.removeAttribute('required');
    contactReqStar.classList.add('d-none');
    contactOptionalText.classList.remove('d-none');
    jobType1.disabled = false;
    labelJobType1.classList.remove('disabled');
  }

  if (isProject) {
    regularPostingChannel.classList.add('d-none');
    document.getElementsByName('postingChannel').forEach((el) => el.removeAttribute('required'));
    projectDepartmentSection.classList.remove('d-none');
    document.getElementById('projectAccount').setAttribute('required', 'required');
    if (isIgSelected) {
      projectPostingFormat.classList.remove('d-none');
    } else {
      projectPostingFormat.classList.add('d-none');
      document.getElementsByName('projectFormat').forEach((el) => { el.checked = false; });
      copostWithSection.classList.add('d-none');
      document.getElementById('copostWith').removeAttribute('required');
    }
  } else {
    projectDepartmentSection.classList.add('d-none');
    document.getElementById('projectAccount').removeAttribute('required');
    document.getElementsByName('projectFormat').forEach((el) => el.removeAttribute('required'));
    document.getElementById('copostWith').removeAttribute('required');
    if (isIgSelected) {
      regularPostingChannel.classList.remove('d-none');
      document.getElementsByName('postingChannel').forEach((el) => el.setAttribute('required', 'required'));
    } else {
      regularPostingChannel.classList.add('d-none');
      document.getElementsByName('postingChannel').forEach((el) => { el.removeAttribute('required'); el.checked = false; });
    }
  }
  applyDateRules();
}

export function toggleProjectFormatCopost() {
  const copostInput = document.getElementById('copostWith');
  const copostChecked = document.getElementById('projFormat3').checked;
  const copostWithSection = document.getElementById('copostWithSection');
  if (copostChecked) {
    copostWithSection.classList.remove('d-none');
    copostInput.setAttribute('required', 'required');
  } else {
    copostWithSection.classList.add('d-none');
    copostInput.removeAttribute('required');
    copostInput.value = '';
  }
}

export function toggleOtherPlatformReason() {
  const anyChecked = document.querySelectorAll('input[name="otherPlatform"]:checked').length > 0;
  const section = document.getElementById('otherPlatformReasonSection');
  const textarea = document.getElementById('otherPlatformReason');
  if (anyChecked) {
    section.classList.remove('d-none');
    textarea.setAttribute('required', 'required');
  } else {
    section.classList.add('d-none');
    textarea.removeAttribute('required');
    textarea.value = '';
  }
}

export function togglePrMode() {
  const isSubmit = document.getElementById('prModeSubmit').checked;
  const isTrack = document.getElementById('prModeTrack').checked;
  document.getElementById('prSubmitSection').classList.toggle('d-none', !isSubmit);
  document.getElementById('prTrackSection').classList.toggle('d-none', !isTrack);
}

// --------------------------------------------------
// Date/Time Helpers
// --------------------------------------------------

const publishDatePart = () => document.getElementById('publishDatePart');
const publishTimePart = () => document.getElementById('publishTimePart');
const publishDateHidden = () => document.getElementById('publishDate');

export function syncPublishDate() {
  const dp = publishDatePart();
  const tp = publishTimePart();
  const hid = publishDateHidden();
  if (dp.value && tp.value) {
    hid.value = dp.value + 'T' + tp.value;
  } else {
    hid.value = '';
  }
}

function clampTimeToAllowed(d) {
  const h = d.getHours();
  const m = d.getMinutes();
  if (h < 8) { d.setHours(8, 0, 0, 0); }
  else if (h > 22 || (h === 22 && m > 0)) {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  }
  return d;
}

function setDateTimeInputs(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  publishDatePart().value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  publishTimePart().value = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  syncPublishDate();
}

function getDateTimeFromInputs() {
  const dp = publishDatePart();
  const tp = publishTimePart();
  if (!dp.value || !tp.value) return null;
  return new Date(dp.value + 'T' + tp.value);
}

export function applyDateRules() {
  const now = new Date();
  const deadlineRush = document.getElementById('deadlineRush');
  const prReviewSection = document.getElementById('prReviewSection');
  const rushReason = document.getElementById('rushReason');
  const dateHelper = document.getElementById('dateHelper');
  const isRush = deadlineRush.checked;
  const checkedJobType = document.querySelector('input[name="jobType"]:checked');
  const currentJobType = checkedJobType ? checkedJobType.value : '';
  const jobTypeChanged = currentJobType !== lastJobType && lastJobType !== '';
  lastJobType = currentJobType;

  let defaultDate = new Date(now);
  let normalMinDate = new Date(now);

  if (currentJobType === 'New content') {
    defaultDate.setDate(defaultDate.getDate() + 15);
    normalMinDate.setDate(normalMinDate.getDate() + 15);
  } else if (currentJobType === 'Ready to post') {
    defaultDate.setDate(defaultDate.getDate() + 1);
    normalMinDate.setDate(normalMinDate.getDate() + 1);
  }

  clampTimeToAllowed(defaultDate);
  let actualMinDate = new Date(now);
  const pad = (n) => n.toString().padStart(2, '0');

  if (isRush) {
    prReviewSection.classList.remove('d-none');
    rushReason.setAttribute('required', 'required');
    actualMinDate = new Date(now);
    publishDatePart().min = `${actualMinDate.getFullYear()}-${pad(actualMinDate.getMonth() + 1)}-${pad(actualMinDate.getDate())}`;
    dateHelper.innerHTML = "<i class='bi bi-rocket-takeoff me-1'></i> Submit for PR Review: เลือกระบุวันที่ต้องการได้เลย <span class='fw-normal text-muted'>(เลือกเวลาได้เฉพาะ 08:00-22:00)</span>";
    dateHelper.className = 'text-danger mt-2 d-block fw-bold';
  } else {
    prReviewSection.classList.add('d-none');
    rushReason.removeAttribute('required');
    rushReason.value = '';
    rushReason.style.height = 'auto';
    actualMinDate = new Date(normalMinDate);
    publishDatePart().min = `${actualMinDate.getFullYear()}-${pad(actualMinDate.getMonth() + 1)}-${pad(actualMinDate.getDate())}`;

    if (currentJobType === 'New content') {
      dateHelper.innerHTML = "<i class='bi bi-info-circle me-1'></i> เกณฑ์ปกติ: +15 วันจากวันนี้ (สามารถแก้ไขเลือกวันหลังจากนี้ได้) <span class='fw-normal text-muted'>(เลือกเวลาได้เฉพาะ 08:00-22:00)</span>";
      dateHelper.className = 'text-pink-custom mt-2 d-block fw-bold';
    } else if (currentJobType === 'Ready to post') {
      dateHelper.innerHTML = "<i class='bi bi-info-circle me-1'></i> เกณฑ์ปกติ: +1 วันจากวันนี้ (สามารถแก้ไขเลือกวันหลังจากนี้ได้) <span class='fw-normal text-muted'>(เลือกเวลาได้เฉพาะ 08:00-22:00)</span>";
      dateHelper.className = 'text-pink-custom mt-2 d-block fw-bold';
    } else {
      dateHelper.innerHTML = "<i class='bi bi-info-circle me-1'></i> กรุณาเลือกรูปแบบงานก่อน <span class='fw-normal text-muted'>(เลือกเวลาได้เฉพาะ 08:00-22:00)</span>";
      dateHelper.className = 'text-muted mt-2 d-block';
    }
  }

  if (checkedJobType) {
    const currentVal = getDateTimeFromInputs();
    if (jobTypeChanged || !currentVal || currentVal < actualMinDate) {
      setDateTimeInputs(defaultDate);
    }
  } else {
    publishDatePart().value = '';
    publishTimePart().value = '';
    publishDateHidden().value = '';
  }
}

// --------------------------------------------------
// Wire up event listeners (called from main.js)
// --------------------------------------------------

export function initPrForm() {
  const departmentSelect = document.getElementById('department');
  const igPostCheckbox = document.getElementById('plat1');
  const igStoryCheckbox = document.getElementById('plat2');
  const deadlineNormal = document.getElementById('deadlineNormal');
  const deadlineRush = document.getElementById('deadlineRush');
  const jobTypeRadios = document.querySelectorAll('.job-type-radio');

  departmentSelect.addEventListener('change', updateFormVisibility);
  igPostCheckbox.addEventListener('change', updateFormVisibility);
  igStoryCheckbox.addEventListener('change', updateFormVisibility);
  deadlineNormal.addEventListener('change', applyDateRules);
  deadlineRush.addEventListener('change', applyDateRules);
  jobTypeRadios.forEach((radio) => radio.addEventListener('change', applyDateRules));

  // Auto-resize textareas
  document.querySelectorAll('textarea').forEach((textarea) => {
    textarea.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = this.scrollHeight + 'px';
    });
  });

  // Publish date sync
  document.getElementById('publishDatePart').addEventListener('change', syncPublishDate);
  document.getElementById('publishTimePart').addEventListener('change', function () {
    if (this.value) {
      const parts = this.value.split(':');
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (h < 8) this.value = '08:00';
      else if (h > 22 || (h === 22 && m > 0)) this.value = '22:00';
    }
    syncPublishDate();
  });

  // PR form submit
  document.getElementById('prForm').addEventListener('submit', handlePrFormSubmit);

  // Initialize form state
  updateFormVisibility();
}

// --------------------------------------------------
// Form Submit Handler
// --------------------------------------------------

async function handlePrFormSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const btnText = document.getElementById('btnText');
  const btnLoading = document.getElementById('btnLoading');
  const alertBox = document.getElementById('alertBox');
  const accMode = document.querySelector('input[name="prAccountMode"]:checked')
    ? document.querySelector('input[name="prAccountMode"]:checked').value
    : 'guest';

  if (accMode === 'google' && !getIsPrAccountVerified()) {
    alertBox.innerHTML = '<i class="bi bi-exclamation-circle-fill me-1"></i> กรุณาเข้าสู่ระบบด้วย Google Account ก่อนยืนยันส่งงาน';
    alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  // Validate project format if visible
  const projFormatSection = document.getElementById('projectPostingFormat');
  if (projFormatSection && !projFormatSection.classList.contains('d-none')) {
    const checkedFormats = document.querySelectorAll('input[name="projectFormat"]:checked');
    if (checkedFormats.length === 0) {
      alertBox.innerHTML = '<i class="bi bi-exclamation-circle-fill me-1"></i> กรุณาเลือกรูปแบบการลงสื่ออย่างน้อย 1 ช่อง';
      alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
  }

  syncPublishDate();

  // Validate publish time 08:00-22:00
  const pubDateVal = document.getElementById('publishDate').value;
  if (pubDateVal) {
    const pubDate = new Date(pubDateVal);
    const pubH = pubDate.getHours();
    const pubM = pubDate.getMinutes();
    if (pubH < 8 || pubH > 22 || (pubH === 22 && pubM > 0)) {
      alertBox.innerHTML = '<i class="bi bi-clock-fill me-1"></i> เวลาที่เลือกต้องอยู่ระหว่าง 08:00-22:00 เท่านั้น';
      alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
  }

  const fileInput = document.getElementById('fileUpload');
  btn.disabled = true; btnText.classList.add('d-none'); btnLoading.classList.remove('d-none');
  alertBox.className = 'alert d-none shadow-sm';

  // Check file sizes
  if (fileInput.files.length > 0) {
    for (let i = 0; i < fileInput.files.length; i++) {
      if (fileInput.files[i].size > 35 * 1024 * 1024) {
        alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
        alertBox.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-2"></i> รูปที่ ${i + 1} ขนาดเกิน 35MB กรุณาใช้ลิงก์ G-Drive แนบแทน`;
        btn.disabled = false; btnText.classList.remove('d-none'); btnLoading.classList.add('d-none');
        return;
      }
    }
  }

  const targetUrl = GAS_API_URL;
  let uploadedUrls = [];

  // Sequential file upload
  if (fileInput.files.length > 0) {
    for (let i = 0; i < fileInput.files.length; i++) {
      const file = fileInput.files[i];
      btnLoading.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> กำลังอัปโหลดรูปที่ ${i + 1}/${fileInput.files.length}...`;
      try {
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.readAsDataURL(file);
        });
        const uploadRes = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'uploadPRFile', fileName: file.name, mimeType: file.type, fileData: base64 }),
        });
        const uploadResult = await uploadRes.json();
        if (uploadResult.success) {
          uploadedUrls.push(uploadResult.fileUrl);
        } else {
          throw new Error(uploadResult.message);
        }
      } catch (err) {
        alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
        alertBox.innerHTML = `<i class="bi bi-x-circle-fill me-2 fs-5"></i> การอัปโหลดรูปที่ ${i + 1} ล้มเหลว กรุณาลองใหม่`;
        btn.disabled = false; btnText.classList.remove('d-none'); btnLoading.classList.add('d-none');
        return;
      }
    }
  }

  // Submit form data with uploaded URLs
  btnLoading.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> กำลังสร้าง Ticket งาน...';

  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData.entries());
  data.platform = formData.getAll('platform');
  data.otherPlatform = formData.getAll('otherPlatform');
  data.projectFormat = formData.getAll('projectFormat');
  data.action = 'submitPR';
  data.prAccountMode = accMode;
  data.prSubmitterEmail = document.getElementById('prGoogleUserEmail').value || 'Guest';
  data.uploadedUrls = uploadedUrls;
  // Dev-only: when checked, the backend skips the Discord webhook entirely.
  // Field is gated by .dev-only-feature visibility but we send the value
  // regardless — the backend treats "not present" as false.
  data.skipDiscord = document.getElementById('skipDiscord')?.checked === true;

  try {
    const response = await fetch(targetUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(data) });
    const result = await response.json();
    alertBox.classList.remove('d-none');
    if (result.success) {
      alertBox.classList.add('alert-success');
      alertBox.innerHTML = `<i class="bi bi-check-circle-fill me-2 fs-5"></i> ส่งงานสำเร็จ! <strong>Ticket ID: ${result.ticketId}</strong>`;
      if (accMode === 'guest') alert(`โปรดบันทึกรหัสนี้ไว้ติดตามสถานะ:\n${result.ticketId}`);
      document.getElementById('prForm').reset();
      updateFormVisibility();
      toggleOtherPlatformReason();
    } else {
      alertBox.classList.add('alert-danger');
      alertBox.innerHTML = `<i class="bi bi-x-circle-fill me-2 fs-5"></i> ${result.message}`;
    }
  } catch (error) {
    alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
    alertBox.innerHTML = '<i class="bi bi-wifi-off me-2 fs-5"></i> เชื่อมต่อล้มเหลว';
  } finally {
    btn.disabled = false; btnText.classList.remove('d-none'); btnLoading.classList.add('d-none');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
