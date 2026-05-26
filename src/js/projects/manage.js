// ==============================================
// PROJECTS MANAGE — settings + doc-type lookup admin
//
// Mounted into #pills-projects [data-projects-pane="manage"]. Both
// vp_admin and uni_staff can read; only vp_admin/dev can persist
// (RLS enforces). The form just disables save for read-only viewers.
// ==============================================

import { escHtml } from '../utils.js';
import { upsertDocType, saveSettings } from './api.js';

let onChanged = () => {};
let state = { docTypes: [], settings: null, role: null };

export function mountManage({ onChanged: cb } = {}) {
  if (typeof cb === 'function') onChanged = cb;

  const settingsForm = document.getElementById('projectSettingsForm');
  settingsForm?.addEventListener('submit', onSaveSettings);

  const docTypeForm = document.getElementById('projectDocTypeForm');
  docTypeForm?.addEventListener('submit', onAddDocType);

  document.getElementById('projectDocTypeList')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-projects-doctype-toggle]');
    if (!btn) return;
    const id = btn.dataset.projectsDoctypeToggle;
    const next = btn.dataset.projectsDoctypeActive !== '1';
    try {
      await upsertDocType({ id, label_th: btn.dataset.projectsDoctypeLabel, is_active: next });
      onChanged();
    } catch (err) {
      alert(err.message || 'อัปเดตประเภทไม่สำเร็จ');
    }
  });
}

export function renderManage(next) {
  state = { ...state, ...next };
  renderSettings();
  renderDocTypes();
}

function renderSettings() {
  const s = state.settings || {};
  const canEdit = state.role === 'vp_admin' || state.role === 'dev';
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value || ''; };
  const check = (id, value) => { const el = document.getElementById(id); if (el) el.checked = !!value; };
  set('projectSettingsUniEmail',         s.uni_staff_email);
  set('projectSettingsUniLabel',         s.uni_staff_label || 'พี่นิค');
  set('projectSettingsVpLabel',          s.vp_admin_label || 'รองนายกฝ่ายบริหาร');
  check('projectSettingsUniInApp',       s.notify_uni_in_app !== false);
  check('projectSettingsUniEmailNotify', s.notify_uni_email !== false);
  check('projectSettingsVpInApp',        s.notify_vp_in_app !== false);
  check('projectSettingsVpDiscord',      s.notify_vp_discord !== false);

  document.getElementById('projectSettingsSubmit')?.toggleAttribute('disabled', !canEdit);
  document.getElementById('projectSettingsReadonlyHint')?.classList.toggle('d-none', canEdit);
}

function renderDocTypes() {
  const list = document.getElementById('projectDocTypeList');
  if (!list) return;
  const types = (state.docTypes || []).slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.label_th.localeCompare(b.label_th));
  if (types.length === 0) {
    list.innerHTML = '<div class="text-muted small py-2">ยังไม่มีประเภทหนังสือ</div>';
    return;
  }
  const canEdit = state.role === 'vp_admin' || state.role === 'dev';
  list.innerHTML = types.map((t) => `
    <div class="projects-doctype-row ${t.is_active ? '' : 'is-disabled'}">
      <div class="projects-doctype-info">
        <span class="projects-doctype-label">${escHtml(t.label_th)}</span>
        <code class="projects-doctype-id">${escHtml(t.id)}</code>
      </div>
      ${canEdit ? `<button type="button" class="btn btn-sm ${t.is_active ? 'btn-ghost' : 'btn-primary-soft'}"
        data-projects-doctype-toggle="${escHtml(t.id)}"
        data-projects-doctype-active="${t.is_active ? '1' : '0'}"
        data-projects-doctype-label="${escHtml(t.label_th)}">
        ${t.is_active ? '<i class="bi bi-eye-slash me-1"></i>ปิดใช้งาน' : '<i class="bi bi-eye me-1"></i>เปิดใช้งาน'}
      </button>` : ''}
    </div>
  `).join('');
}

async function onSaveSettings(e) {
  e.preventDefault();
  const btn = document.getElementById('projectSettingsSubmit');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึก…';
  try {
    const patch = {
      uni_staff_email:   document.getElementById('projectSettingsUniEmail').value.trim(),
      uni_staff_label:   document.getElementById('projectSettingsUniLabel').value.trim() || 'พี่นิค',
      vp_admin_label:    document.getElementById('projectSettingsVpLabel').value.trim() || 'รองนายกฝ่ายบริหาร',
      notify_uni_in_app: document.getElementById('projectSettingsUniInApp').checked,
      notify_uni_email:  document.getElementById('projectSettingsUniEmailNotify').checked,
      notify_vp_in_app:  document.getElementById('projectSettingsVpInApp').checked,
      notify_vp_discord: document.getElementById('projectSettingsVpDiscord').checked,
    };
    await saveSettings(patch);
    flashOk(btn, orig);
    onChanged();
  } catch (err) {
    btn.innerHTML = orig;
    alert(err.message || 'บันทึกการตั้งค่าไม่สำเร็จ');
  } finally {
    btn.disabled = false;
  }
}

async function onAddDocType(e) {
  e.preventDefault();
  const idInput = document.getElementById('projectDocTypeNewId');
  const labelInput = document.getElementById('projectDocTypeNewLabel');
  const id = (idInput.value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const label = (labelInput.value || '').trim();
  if (!id) { alert('กรุณากรอก slug (a-z, 0-9, -)'); return; }
  if (!label) { alert('กรุณากรอกชื่อภาษาไทย'); return; }
  const btn = document.getElementById('projectDocTypeAddBtn');
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>...';
  try {
    await upsertDocType({ id, label_th: label, is_active: true, sort_order: 100 });
    idInput.value = '';
    labelInput.value = '';
    onChanged();
  } catch (err) {
    alert(err.message || 'เพิ่มไม่สำเร็จ');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

function flashOk(btn, originalHtml) {
  btn.innerHTML = '<i class="bi bi-check2 me-1"></i>บันทึกแล้ว';
  setTimeout(() => { btn.innerHTML = originalHtml; }, 1400);
}
