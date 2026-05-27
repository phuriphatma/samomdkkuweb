// ==============================================
// SHOP ADMIN — Orders, slip verify, delivery checklist, batches, products, QR
//
// Mounted inside #adminShopSection within tab-admin.html. Driven by the
// existing openAdminSection('shop') hook (added in main.js).
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { dbRest } from '../db.js';
import { getUser } from '../auth.js';
import {
  thb, fmtDate, fmtDateTime, STAGES_ORDER, STAGES_META,
  SHOP_SOURCES, SHOP_TYPES, findSource, slugify,
  STOCK_STATUSES, STOCK_STATUS_META, stockKey, totalStock,
  batchDateEntries,
} from './data.js';
import {
  listAllOrders, updateOrderStatus,
  listProducts, upsertProduct, deleteProduct,
  listAllBatches, upsertBatch, closeBatch,
  getSettings, saveSettings,
  listPickupRecords, upsertPickupRecord, resolvePickupIssue, deletePickupRecord,
} from './api.js';
import { uploadShopFile } from './uploads.js';
import { showShopToast } from './products.js';
import { invalidateSettingsCache } from './checkout.js';

const state = {
  tab: 'orders',
  orders: [],
  products: [],
  batches: [],
  settings: null,
  pickupRecords: [],   // for the delivery tab
  ordersFilter: 'all',
  ordersSearch: '',
  verifyIdx: 0,
  productEditor: null,
  batchEditor: null,
  deliveryExpanded: new Set(),
};

const ISSUE_LABELS = {
  wrong_size: 'ผิดไซส์',
  damaged:    'สินค้าเสียหาย',
  missing:    'หาย/ขาด',
  other:      'อื่น ๆ',
};

let mounted = false;
function ensureMounted() {
  if (mounted) return;
  mounted = true;

  // Tab switcher
  document.getElementById('shopAdminTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shop-admin-tab]');
    if (!btn) return;
    setTab(btn.dataset.shopAdminTab);
  });

  // Status filter
  const sel = document.getElementById('shopAdminOrdersStatus');
  if (sel) {
    sel.innerHTML = '<option value="all">สถานะทั้งหมด</option>'
      + Object.entries(STAGES_META).map(([k, m]) => `<option value="${k}">${escHtml(m.label)}</option>`).join('');
    sel.addEventListener('change', () => { state.ordersFilter = sel.value; renderOrdersTable(); });
  }
  const search = document.getElementById('shopAdminOrdersSearch');
  if (search) {
    search.addEventListener('input', () => { state.ordersSearch = search.value.toLowerCase(); renderOrdersTable(); });
  }
  document.getElementById('shopAdminOrdersRefresh')?.addEventListener('click', refreshOrders);

  // Orders click → modal
  document.getElementById('shopAdminOrdersTbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('[data-order-id]');
    if (!tr) return;
    openOrderModal(tr.dataset.orderId);
  });

  // Auto-save the internal admin note when the modal closes.
  const orderModalEl = document.getElementById('shopAdminOrderModal');
  if (orderModalEl) {
    orderModalEl.addEventListener('hidden.bs.modal', persistAdminNoteIfChanged);
  }

  // Batches
  document.getElementById('shopAdminBatchesNew')?.addEventListener('click', () => {
    state.batchEditor = blankBatch();
    renderBatches();
  });

  // Products
  document.getElementById('shopAdminProductsNew')?.addEventListener('click', () => {
    state.productEditor = blankProduct();
    renderProductEditor();
  });

  // QR Settings save
  document.getElementById('shopAdminQRSave')?.addEventListener('click', saveSettingsForm);
  document.getElementById('shopAdminQRFile')?.addEventListener('change', onQRFileChosen);

  // Delivery refresh button
  document.getElementById('shopAdminDeliveryRefresh')?.addEventListener('click', refreshDelivery);
}

function setTab(name) {
  state.tab = name;
  document.querySelectorAll('#shopAdminTabs [data-shop-admin-tab]').forEach((b) =>
    b.classList.toggle('is-active', b.dataset.shopAdminTab === name));
  document.querySelectorAll('#adminShopSection [data-shop-admin-pane]').forEach((p) =>
    p.classList.toggle('d-none', p.dataset.shopAdminPane !== name));

  if (name === 'orders')   refreshOrders();
  if (name === 'verify')   renderVerifyQueue();
  if (name === 'delivery') refreshDelivery();
  if (name === 'batches')  refreshBatches();
  if (name === 'products') refreshProducts();
  if (name === 'qr')       loadSettingsIntoForm();
}

/** Entry point — call from main.js when the shop admin section opens. */
export async function openShopAdmin() {
  ensureMounted();
  setTab(state.tab || 'orders');
}

// ---------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------
async function refreshOrders() {
  try {
    state.orders = await listAllOrders();
    renderStats();
    renderOrdersTable();
  } catch (e) {
    showShopToast(`โหลดคำสั่งซื้อล้มเหลว: ${e.message || e}`, 'error');
  }
}

function renderStats() {
  const host = document.getElementById('shopAdminStats');
  if (!host) return;
  const review = state.orders.filter((o) => o.status === 'review').length;
  const produce = state.orders.filter((o) => o.status === 'produce').length;
  const ready = state.orders.filter((o) => o.status === 'ready').length;
  const revenue = state.orders
    .filter((o) => o.status !== 'pending' && o.status !== 'cancel')
    .reduce((s, o) => s + (Number(o.total) || 0), 0);
  host.innerHTML = `
    <div class="stat-card is-warning">
      <div class="stat-label">รอตรวจสลิป</div>
      <div class="stat-value">${review}<span class="stat-suffix">รายการ</span></div>
      <div class="stat-delta" style="color:var(--status-cancel)">รอจัดการ</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">กำลังผลิต</div>
      <div class="stat-value">${produce}<span class="stat-suffix">รายการ</span></div>
    </div>
    <div class="stat-card is-ready">
      <div class="stat-label">พร้อมรับ</div>
      <div class="stat-value">${ready}<span class="stat-suffix">รายการ</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-label">รายรับสะสม (ไม่รวมยกเลิก/รอชำระ)</div>
      <div class="stat-value">฿${thb(revenue)}</div>
    </div>`;
}

function renderOrdersTable() {
  const tbody = document.getElementById('shopAdminOrdersTbody');
  if (!tbody) return;
  let list = state.orders.slice();
  if (state.ordersFilter !== 'all') list = list.filter((o) => o.status === state.ordersFilter);
  if (state.ordersSearch) {
    list = list.filter((o) =>
      (o.id || '').toLowerCase().includes(state.ordersSearch)
      || (o.buyer_label || '').toLowerCase().includes(state.ordersSearch));
  }
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">ไม่มีรายการ</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((o) => {
    const items = Array.isArray(o.items) ? o.items : [];
    const qty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
    const initial = (o.buyer_label || '?').slice(0, 1);
    return `
      <tr class="is-clickable" data-order-id="${escHtml(o.id)}">
        <td>
          <div class="order-id">#${escHtml(o.id)}</div>
          <div class="small text-muted">${fmtDate(o.placed_at)}</div>
        </td>
        <td>
          <div class="row-customer">
            <span class="ravatar">${escHtml(initial)}</span>
            <div>
              <div class="rname">${escHtml(o.buyer_label || '—')}</div>
              <div class="rsub">${escHtml(o.buyer_id || '')}</div>
            </div>
          </div>
        </td>
        <td><span class="small text-muted">${items.length} sku · ${qty} ชิ้น</span></td>
        <td><span style="font-weight:700;">฿${thb(o.total)}</span></td>
        <td>
          ${o.slip_url
            ? `<span class="text-success small"><i class="bi bi-check-circle-fill me-1"></i> ส่งแล้ว</span>`
            : `<span class="text-muted small"><i class="bi bi-dash-circle me-1"></i> ยังไม่ส่ง</span>`}
        </td>
        <td>${statusPillSmall(o.status)}</td>
        <td><i class="bi bi-chevron-right"></i></td>
      </tr>`;
  }).join('');
}

function statusPillSmall(status) {
  const meta = STAGES_META[status] || STAGES_META.pending;
  return `
    <span class="status-pill" data-status="${escHtml(status)}">
      <span class="pulse"></span>
      <i class="bi ${escHtml(meta.icon)}"></i>
      <span>${escHtml(meta.label)}</span>
    </span>`;
}

let modalOrder = null;
function openOrderModal(orderId) {
  const o = state.orders.find((x) => x.id === orderId);
  if (!o) return;
  modalOrder = o;
  const idEl = document.getElementById('shopAdminOrderModalId');
  const body = document.getElementById('shopAdminOrderModalBody');
  if (idEl) idEl.textContent = `#${o.id}`;
  if (body) body.innerHTML = orderModalBodyHtml(o);

  body.querySelectorAll('[data-set-status]').forEach((btn) => {
    btn.addEventListener('click', () => modalAction(btn.dataset.setStatus));
  });

  const approve = document.getElementById('shopAdminOrderModalApprove');
  const reject  = document.getElementById('shopAdminOrderModalReject');
  const primary = footerPrimaryFor(o.status);
  const secondary = footerSecondaryFor(o.status);
  if (approve) {
    approve.className = primary ? `btn ${primary.cls}` : 'btn btn-success d-none';
    approve.innerHTML = primary ? primary.html : '';
    approve.onclick = primary ? () => modalAction(primary.next, primary.cancelReason) : null;
    approve.classList.toggle('d-none', !primary);
  }
  if (reject) {
    reject.className = secondary ? `btn ${secondary.cls}` : 'btn btn-outline-danger d-none';
    reject.innerHTML = secondary ? secondary.html : '';
    reject.onclick = secondary ? () => modalAction(secondary.next, secondary.cancelReason) : null;
    reject.classList.toggle('d-none', !secondary);
  }

  const inst = window.bootstrap?.Modal.getOrCreateInstance(document.getElementById('shopAdminOrderModal'));
  inst?.show();
}

function footerPrimaryFor(status) {
  switch (status) {
    case 'review':  return { next: 'paid',    cls: 'btn-success', html: '<i class="bi bi-check2-circle me-1"></i> อนุมัติสลิป → "ชำระแล้ว"' };
    case 'paid':    return { next: 'produce', cls: 'btn-shop',    html: '<i class="bi bi-tools me-1"></i> เริ่มผลิต' };
    case 'produce': return { next: 'ready',   cls: 'btn-success', html: '<i class="bi bi-box-seam me-1"></i> ผลิตเสร็จ → พร้อมรับ' };
    case 'ready':   return { next: 'done',    cls: 'btn-success', html: '<i class="bi bi-bag-check me-1"></i> ลูกค้ามารับแล้ว' };
    default:        return null;
  }
}
function footerSecondaryFor(status) {
  if (status === 'review') return { next: 'cancel', cancelReason: 'admin rejected slip', cls: 'btn-outline-danger', html: '<i class="bi bi-x-circle me-1"></i> ปฏิเสธสลิป' };
  if (status === 'pending' || status === 'paid' || status === 'produce') {
    return { next: 'cancel', cancelReason: 'admin cancelled', cls: 'btn-outline-danger', html: '<i class="bi bi-x-circle me-1"></i> ยกเลิกคำสั่งซื้อ' };
  }
  return null;
}

function orderModalBodyHtml(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  return `
    <div class="row g-3">
      <div class="col-md-7">
        <h5>ลูกค้า</h5>
        <div class="d-flex align-items-center gap-3 p-3 bg-light rounded mb-3">
          <span class="ravatar" style="width:44px; height:44px; font-size:.9rem;
                background:var(--shop-100); color:var(--shop-700);
                display:inline-flex; align-items:center; justify-content:center;
                border-radius:50%; font-weight:600;">
            ${escHtml((o.buyer_label || '?').slice(0, 1))}
          </span>
          <div>
            <div style="font-weight:600;">${escHtml(o.buyer_label || '—')}</div>
            <div class="small text-muted">${escHtml(o.buyer_id || '')}</div>
          </div>
        </div>

        <h5>รายการสินค้า</h5>
        ${items.map((it) => `
          <div class="d-flex gap-3 align-items-center py-2"
               style="border-bottom: 1px solid var(--shop-ink-100, #ebecee);">
            <div class="flex-grow-1">
              <div style="font-weight:600;">${escHtml(it.product_id)}</div>
              <div class="small text-muted">
                ${it.size && it.size !== 'F' ? `ไซส์ ${escHtml(it.size)}` : 'Unisex'}
                ${it.color ? ` · ${escHtml(it.color)}` : ''}
              </div>
            </div>
            <div style="min-width:60px; text-align:right;">× ${it.qty}</div>
            <div style="min-width:80px; text-align:right; font-weight:700;">฿${thb((Number(it.unit_price) || 0) * (Number(it.qty) || 0))}</div>
          </div>`).join('')}
        <div class="d-flex justify-content-between mt-3" style="font-size:1.1rem; font-weight:700;">
          <span>ยอดรวม</span>
          <span style="color:var(--shop-700);">฿${thb(o.total)}</span>
        </div>

        ${o.buyer_note ? `<h5 class="mt-4">หมายเหตุจากลูกค้า</h5><div class="small bg-light rounded p-2">${escHtml(o.buyer_note)}</div>` : ''}
      </div>
      <div class="col-md-5">
        <h5>สลิปการโอน</h5>
        <div class="slip-thumb">
          ${o.slip_url
            ? `<a href="${safeUrl(o.slip_url)}" target="_blank" rel="noreferrer">
                 <img src="${safeUrl(o.slip_url)}" alt="slip" />
               </a>`
            : `<div class="text-center"><i class="bi bi-x-octagon fs-1"></i>
               <div class="mt-1">ยังไม่ได้รับสลิป</div></div>`}
        </div>
        ${o.slip_uploaded_at ? `<div class="small text-muted mb-3">อัปโหลด ${fmtDateTime(o.slip_uploaded_at)}</div>` : ''}

        <h5>สถานะปัจจุบัน</h5>
        <div class="mb-3">${statusPillSmall(o.status)}</div>

        <h5>เปลี่ยนสถานะ</h5>
        <div class="d-flex flex-wrap gap-2">
          ${STAGES_ORDER.map((s) => `
            <button type="button" class="chip ${o.status === s ? 'is-active' : ''}" data-set-status="${s}">
              <i class="bi ${escHtml(STAGES_META[s].icon)}"></i> ${escHtml(STAGES_META[s].label)}
            </button>`).join('')}
          <button type="button" class="chip" data-set-status="cancel"
                  style="background:var(--status-cancel-bg); color:var(--status-cancel);">
            <i class="bi bi-x-circle"></i> ยกเลิก
          </button>
        </div>

        <h5 class="mt-3">หมายเหตุภายใน admin</h5>
        <textarea id="shopAdminOrderModalNote" class="form-control" rows="3"
          placeholder="ระบุหมายเหตุ — บันทึกพร้อมเมื่อเปลี่ยนสถานะหรือกดปุ่มในแถบล่าง">${escHtml(o.admin_note || '')}</textarea>
      </div>
    </div>`;
}

async function persistAdminNoteIfChanged() {
  if (!modalOrder) return;
  const noteEl = document.getElementById('shopAdminOrderModalNote');
  if (!noteEl) { modalOrder = null; return; }
  const next = noteEl.value;
  const current = modalOrder.admin_note || '';
  if (next === current) { modalOrder = null; return; }
  try {
    const idEsc = encodeURIComponent(modalOrder.id);
    const { error } = await dbRest(
      `/shop_orders?id=eq.${idEsc}`,
      { method: 'PATCH', body: { admin_note: next }, prefer: 'return=minimal' },
    );
    if (error) throw new Error(error.message || 'บันทึกหมายเหตุไม่สำเร็จ');
    const row = state.orders.find((x) => x.id === modalOrder.id);
    if (row) row.admin_note = next;
  } catch (e) {
    console.warn('[shop/admin] persistAdminNote failed:', e);
  } finally {
    modalOrder = null;
  }
}

async function modalAction(nextStatus, cancelReason) {
  if (!modalOrder) return;
  const noteEl = document.getElementById('shopAdminOrderModalNote');
  const adminNote = noteEl ? noteEl.value : undefined;
  try {
    await updateOrderStatus(modalOrder.id, nextStatus, {
      label: STAGES_META[nextStatus]?.label || nextStatus,
      cancelReason,
      adminNote,
    });
    showShopToast(`อัปเดต #${modalOrder.id} → ${STAGES_META[nextStatus]?.label || nextStatus}`, 'success');
    modalOrder = null;
    const inst = window.bootstrap?.Modal.getInstance(document.getElementById('shopAdminOrderModal'));
    inst?.hide();
    await refreshOrders();
    if (state.tab === 'verify') renderVerifyQueue();
    if (state.tab === 'delivery') refreshDelivery();
  } catch (e) {
    showShopToast(`อัปเดตล้มเหลว: ${e.message || e}`, 'error');
  }
}

// ---------------------------------------------------------------------
// Verify queue (one-at-a-time review)
// ---------------------------------------------------------------------
function renderVerifyQueue() {
  const host = document.getElementById('shopAdminVerifyHost');
  if (!host) return;
  const queue = state.orders.filter((o) => o.status === 'review');
  if (queue.length === 0) {
    host.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-check2-all"></i>
        <h4>ไม่มีสลิปรอตรวจ</h4>
        <p>ยอดเยี่ยม! ตามดูใหม่อีกครั้งเมื่อมีคำสั่งซื้อเข้า</p>
      </div>`;
    return;
  }
  const idx = Math.max(0, Math.min(state.verifyIdx, queue.length - 1));
  state.verifyIdx = idx;
  const current = queue[idx];
  const items = Array.isArray(current.items) ? current.items : [];

  host.innerHTML = `
    <div class="d-flex justify-content-between align-items-center mb-3">
      <div>
        <h5 class="font-prompt mb-0" style="font-weight:700;">ตรวจสลิปทีละรายการ</h5>
        <p class="text-muted mb-0 small">รายการ ${idx + 1} จาก ${queue.length}</p>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-ghost btn-sm" id="shopVerifyPrev" ${idx === 0 ? 'disabled' : ''}>
          <i class="bi bi-chevron-left"></i> ก่อนหน้า
        </button>
        <button class="btn btn-ghost btn-sm" id="shopVerifyNext" ${idx >= queue.length - 1 ? 'disabled' : ''}>
          ถัดไป <i class="bi bi-chevron-right"></i>
        </button>
      </div>
    </div>

    <div class="admin-detail-card">
      <div class="row g-3">
        <div class="col-md-6">
          <h5>สลิปที่อัปโหลด</h5>
          <div class="slip-thumb" style="min-height: 360px; max-width:100%;">
            ${current.slip_url
              ? `<a href="${safeUrl(current.slip_url)}" target="_blank" rel="noreferrer">
                   <img src="${safeUrl(current.slip_url)}" alt="slip" /></a>`
              : `<div class="text-center"><i class="bi bi-x-octagon fs-1"></i>
                 <div class="mt-1">ไม่มีรูปสลิป</div></div>`}
          </div>
        </div>
        <div class="col-md-6">
          <h5>เปรียบเทียบยอด</h5>
          <table class="table table-sm">
            <tbody>
              <tr><th class="text-muted" style="font-weight:500;">คำสั่งซื้อ</th><td>#${escHtml(current.id)}</td></tr>
              <tr><th class="text-muted" style="font-weight:500;">ลูกค้า</th><td>${escHtml(current.buyer_label || '—')}</td></tr>
              <tr><th class="text-muted" style="font-weight:500;">ยอดที่ต้องโอน</th><td><b>฿${thb(current.total)}</b></td></tr>
              <tr><th class="text-muted" style="font-weight:500;">เวลาส่งสลิป</th><td>${current.slip_uploaded_at ? fmtDateTime(current.slip_uploaded_at) : '—'}</td></tr>
            </tbody>
          </table>

          <h5 class="mt-3">รายการ</h5>
          ${items.map((it) => `
            <div class="d-flex justify-content-between py-1 small">
              <span>${escHtml(it.product_id)} <span class="text-muted">× ${it.qty}</span></span>
              <span>฿${thb((Number(it.unit_price) || 0) * (Number(it.qty) || 0))}</span>
            </div>`).join('')}

          <div class="d-flex gap-2 mt-3">
            <button class="btn btn-success flex-grow-1" id="shopVerifyApprove">
              <i class="bi bi-check2-circle me-1"></i> อนุมัติ
            </button>
            <button class="btn btn-outline-danger" id="shopVerifyReject">
              <i class="bi bi-x-circle me-1"></i> ปฏิเสธ
            </button>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('shopVerifyPrev')?.addEventListener('click', () => { state.verifyIdx = Math.max(0, idx - 1); renderVerifyQueue(); });
  document.getElementById('shopVerifyNext')?.addEventListener('click', () => { state.verifyIdx = Math.min(queue.length - 1, idx + 1); renderVerifyQueue(); });
  document.getElementById('shopVerifyApprove')?.addEventListener('click', async () => {
    try {
      await updateOrderStatus(current.id, 'paid', { label: STAGES_META.paid.label });
      showShopToast('อนุมัติสลิป — ย้ายไป "ชำระแล้ว"', 'success');
      await refreshOrders();
      renderVerifyQueue();
    } catch (e) { showShopToast(`ล้มเหลว: ${e.message || e}`, 'error'); }
  });
  document.getElementById('shopVerifyReject')?.addEventListener('click', async () => {
    try {
      await updateOrderStatus(current.id, 'cancel', { label: 'ยกเลิก — สลิปไม่ผ่าน', cancelReason: 'admin rejected slip' });
      showShopToast('ปฏิเสธสลิปแล้ว', 'warn');
      await refreshOrders();
      renderVerifyQueue();
    } catch (e) { showShopToast(`ล้มเหลว: ${e.message || e}`, 'error'); }
  });
}

// ---------------------------------------------------------------------
// Delivery — pickup checklist for ready orders
// ---------------------------------------------------------------------
async function refreshDelivery() {
  try {
    const [orders, products] = await Promise.all([
      listAllOrders(),
      listProducts({ activeOnly: false }),
    ]);
    state.orders = orders;
    state.products = products;
    const ids = orders.filter((o) => o.status === 'ready' || o.status === 'done').map((o) => o.id);
    state.pickupRecords = ids.length ? await listPickupRecords({ orderIds: ids }).catch(() => []) : [];
    renderDelivery();
  } catch (e) {
    showShopToast(`โหลดข้อมูลการส่งมอบล้มเหลว: ${e.message || e}`, 'error');
  }
}

function renderDelivery() {
  const host = document.getElementById('shopAdminDeliveryHost');
  if (!host) return;
  const ready = state.orders.filter((o) => o.status === 'ready');
  const recordsByItem = new Map();
  for (const r of state.pickupRecords) recordsByItem.set(r.order_item_id, r);

  // Summary metrics
  let pickedUp = 0, totalItems = 0, openIssues = 0;
  for (const o of ready) {
    const items = Array.isArray(o.items) ? o.items : [];
    for (const it of items) {
      totalItems++;
      const r = recordsByItem.get(it.id);
      if (r && !r.issue_type) pickedUp++;
      if (r && r.issue_type && !r.resolved_at) openIssues++;
    }
  }
  const issuesAll = state.pickupRecords.filter((r) => r.issue_type);

  host.innerHTML = `
    <div class="admin-stats mb-3">
      <div class="stat-card is-ready">
        <div class="stat-label">รอส่งมอบ</div>
        <div class="stat-value">${ready.length}<span class="stat-suffix">คำสั่งซื้อ</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">ส่งมอบแล้ว / ทั้งหมด (ชิ้น)</div>
        <div class="stat-value">${pickedUp}<span class="stat-suffix">/ ${totalItems}</span></div>
      </div>
      <div class="stat-card is-warning">
        <div class="stat-label">ปัญหาค้าง</div>
        <div class="stat-value">${openIssues}<span class="stat-suffix">รายการ</span></div>
      </div>
    </div>

    <h5 class="font-prompt mb-3" style="font-weight:700;">
      <i class="bi bi-clipboard-check me-1"></i> รายการรอส่งมอบ
    </h5>
    ${ready.length === 0
      ? `<div class="empty-state"><i class="bi bi-emoji-smile"></i><h4>ไม่มีคำสั่งซื้อรอส่งมอบ</h4></div>`
      : ready.map((o) => deliveryOrderCardHtml(o, recordsByItem)).join('')}

    ${issuesAll.length ? `
      <h5 class="font-prompt mt-4 mb-3" style="font-weight:700;">
        <i class="bi bi-exclamation-triangle me-1 text-warning"></i> ปัญหาที่บันทึกไว้
      </h5>
      ${issuesAll.map((r) => issueRowHtml(r)).join('')}
    ` : ''}
  `;

  // Wire interactions
  host.querySelectorAll('[data-delivery-toggle]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.dataset.deliveryToggle;
      if (state.deliveryExpanded.has(id)) state.deliveryExpanded.delete(id);
      else state.deliveryExpanded.add(id);
      renderDelivery();
    });
  });

  host.querySelectorAll('[data-pickup-tick]').forEach((cb) => {
    cb.addEventListener('change', () => handleTick(cb));
  });

  host.querySelectorAll('[data-pickup-issue]').forEach((btn) => {
    btn.addEventListener('click', () => promptIssue(btn.dataset.pickupIssue.split('|')));
  });

  host.querySelectorAll('[data-pickup-undo]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const recId = Number(btn.dataset.pickupUndo);
      if (!confirm('ยกเลิกการบันทึกการรับสินค้านี้?')) return;
      try { await deletePickupRecord(recId); refreshDelivery(); }
      catch (e) { showShopToast(`ยกเลิกไม่สำเร็จ: ${e.message || e}`, 'error'); }
    });
  });

  host.querySelectorAll('[data-pickup-resolve]').forEach((btn) => {
    btn.addEventListener('click', () => promptResolve(Number(btn.dataset.pickupResolve)));
  });

  host.querySelectorAll('[data-delivery-finish]').forEach((btn) => {
    btn.addEventListener('click', () => finishOrderPickup(btn.dataset.deliveryFinish));
  });
}

function deliveryOrderCardHtml(o, recordsByItem) {
  const items = Array.isArray(o.items) ? o.items : [];
  const isOpen = state.deliveryExpanded.has(o.id);
  const total = items.length;
  const picked = items.filter((it) => {
    const r = recordsByItem.get(it.id);
    return r && !r.issue_type;
  }).length;
  const allPicked = total > 0 && picked === total;

  return `
    <div class="delivery-card">
      <button type="button" class="delivery-head" data-delivery-toggle="${escHtml(o.id)}">
        <div>
          <div class="d-flex align-items-center gap-2">
            <span class="order-id">#${escHtml(o.id)}</span>
            <span class="status-pill" data-status="ready"><span class="pulse"></span><i class="bi bi-box-seam"></i> พร้อมรับ</span>
          </div>
          <div class="small text-muted mt-1">
            ${escHtml(o.buyer_label || '—')} · ${escHtml(o.buyer_id || '')}
          </div>
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="delivery-progress ${allPicked ? 'is-done' : ''}">${picked} / ${total} ส่งมอบแล้ว</span>
          <i class="bi ${isOpen ? 'bi-chevron-up' : 'bi-chevron-down'}"></i>
        </div>
      </button>
      ${isOpen ? `
        <div class="delivery-body">
          ${items.map((it) => deliveryItemRowHtml(o, it, recordsByItem.get(it.id))).join('')}
          ${allPicked ? `
            <div class="d-flex justify-content-end mt-3">
              <button class="btn btn-success btn-sm" data-delivery-finish="${escHtml(o.id)}">
                <i class="bi bi-bag-check me-1"></i> ปิดคำสั่งซื้อ → "รับสินค้าแล้ว"
              </button>
            </div>` : ''}
        </div>` : ''}
    </div>`;
}

function deliveryItemRowHtml(o, item, record) {
  const p = state.products.find((x) => x.id === item.product_id);
  const isPicked = !!(record && !record.issue_type);
  const hasIssue = !!(record && record.issue_type);
  return `
    <div class="delivery-row ${hasIssue ? 'has-issue' : ''} ${isPicked ? 'is-picked' : ''}">
      <label class="delivery-tick">
        <input type="checkbox" data-pickup-tick="${escHtml(o.id)}|${item.id}" ${isPicked ? 'checked' : ''} ${hasIssue ? 'disabled' : ''} />
        <span></span>
      </label>
      <div class="flex-grow-1" style="min-width:0;">
        <div style="font-weight:600;">${escHtml(p?.name || item.product_id)}</div>
        <div class="small text-muted">
          ${item.size && item.size !== 'F' ? `ไซส์ ${escHtml(item.size)}` : 'Unisex'}
          ${item.color ? ` · ${escHtml(item.color)}` : ''}
          · จำนวน ${item.qty}
        </div>
        ${record?.recipient_name ? `<div class="small text-success mt-1"><i class="bi bi-person-check me-1"></i>รับโดย ${escHtml(record.recipient_name)} · ${fmtDateTime(record.picked_up_at)}</div>` : ''}
        ${hasIssue ? `
          <div class="small text-danger mt-1">
            <i class="bi bi-exclamation-triangle me-1"></i>
            ปัญหา: ${escHtml(ISSUE_LABELS[record.issue_type] || record.issue_type)}
            ${record.issue_note ? ` · ${escHtml(record.issue_note)}` : ''}
            ${record.resolved_at
              ? ` · <span class="text-success">แก้ไขแล้ว${record.resolution ? ': ' + escHtml(record.resolution) : ''}</span>`
              : ''}
          </div>` : ''}
      </div>
      <div class="d-flex flex-column gap-1 align-items-end" style="white-space:nowrap;">
        ${!record ? `
          <button class="btn btn-outline-warning btn-sm" data-pickup-issue="${escHtml(o.id)}|${item.id}">
            <i class="bi bi-flag me-1"></i> บันทึกปัญหา
          </button>` : ''}
        ${record && !record.issue_type ? `
          <button class="btn btn-ghost btn-sm" data-pickup-undo="${record.id}">
            <i class="bi bi-arrow-counterclockwise"></i> ยกเลิก
          </button>` : ''}
        ${hasIssue && !record.resolved_at ? `
          <button class="btn btn-success btn-sm" data-pickup-resolve="${record.id}">
            <i class="bi bi-check2 me-1"></i> แก้ไขแล้ว
          </button>` : ''}
      </div>
    </div>`;
}

function issueRowHtml(r) {
  const order = state.orders.find((o) => o.id === r.order_id);
  const item = (order?.items || []).find((it) => it.id === r.order_item_id);
  const productName = state.products.find((p) => p.id === item?.product_id)?.name || item?.product_id || '—';
  return `
    <div class="delivery-row has-issue ${r.resolved_at ? 'is-resolved' : ''}">
      <i class="bi bi-flag-fill text-warning" style="font-size:1.2rem;"></i>
      <div class="flex-grow-1" style="min-width:0;">
        <div style="font-weight:600;">#${escHtml(r.order_id)} · ${escHtml(productName)}</div>
        <div class="small text-muted">
          ${escHtml(ISSUE_LABELS[r.issue_type] || r.issue_type)}
          ${r.issue_note ? ` · ${escHtml(r.issue_note)}` : ''}
          · บันทึก ${fmtDateTime(r.created_at)}
        </div>
        ${r.resolved_at
          ? `<div class="small text-success mt-1"><i class="bi bi-check2-circle me-1"></i>แก้ไขแล้ว · ${escHtml(r.resolution || '')}</div>`
          : ''}
      </div>
      ${!r.resolved_at ? `
        <button class="btn btn-success btn-sm" data-pickup-resolve="${r.id}">
          <i class="bi bi-check2 me-1"></i> แก้ไขแล้ว
        </button>` : ''}
    </div>`;
}

async function handleTick(cb) {
  const [orderId, itemIdStr] = cb.dataset.pickupTick.split('|');
  const orderItemId = Number(itemIdStr);
  if (!cb.checked) {
    // The undo path is via the dedicated button; un-checking just bounces.
    cb.checked = true;
    return;
  }
  const name = prompt('ชื่อผู้มารับ (เว้นว่างได้ ถ้าเป็นเจ้าของคำสั่งซื้อเอง):', '');
  if (name === null) { cb.checked = false; return; }
  try {
    const me = getUser();
    await upsertPickupRecord({
      order_id: orderId,
      order_item_id: orderItemId,
      picked_up_by_admin: me?.id || null,
      recipient_name: name.trim() || null,
      picked_up_at: new Date().toISOString(),
      issue_type: null,
      issue_note: null,
    });
    showShopToast('บันทึกการรับสินค้าแล้ว', 'success');
    refreshDelivery();
  } catch (e) {
    cb.checked = false;
    showShopToast(`บันทึกไม่สำเร็จ: ${e.message || e}`, 'error');
  }
}

async function promptIssue(parts) {
  const [orderId, itemIdStr] = parts;
  const orderItemId = Number(itemIdStr);
  const typeRaw = prompt('ระบุประเภทปัญหา (wrong_size / damaged / missing / other):', 'wrong_size');
  if (!typeRaw) return;
  const type = typeRaw.trim().toLowerCase();
  if (!['wrong_size', 'damaged', 'missing', 'other'].includes(type)) {
    showShopToast('ประเภทไม่ถูกต้อง — ต้องเป็น wrong_size / damaged / missing / other', 'warn');
    return;
  }
  const note = prompt('รายละเอียดเพิ่มเติม (เช่น "ต้องการเปลี่ยนเป็นไซส์ L"):', '');
  if (note === null) return;
  try {
    const me = getUser();
    await upsertPickupRecord({
      order_id: orderId,
      order_item_id: orderItemId,
      picked_up_by_admin: me?.id || null,
      recipient_name: null,
      picked_up_at: new Date().toISOString(),
      issue_type: type,
      issue_note: note.trim() || null,
    });
    showShopToast('บันทึกปัญหาแล้ว', 'success');
    refreshDelivery();
  } catch (e) {
    showShopToast(`บันทึกไม่สำเร็จ: ${e.message || e}`, 'error');
  }
}

async function promptResolve(recordId) {
  const resolution = prompt('สรุปการแก้ไข (เช่น "เปลี่ยนเป็นไซส์ L แล้ว เมื่อ 28 พ.ค."):', '');
  if (resolution === null) return;
  if (!resolution.trim()) {
    showShopToast('กรุณาระบุการแก้ไข', 'warn');
    return;
  }
  try {
    await resolvePickupIssue(recordId, resolution.trim());
    showShopToast('แก้ไขปัญหาแล้ว', 'success');
    refreshDelivery();
  } catch (e) {
    showShopToast(`บันทึกไม่สำเร็จ: ${e.message || e}`, 'error');
  }
}

async function finishOrderPickup(orderId) {
  if (!confirm(`ปิดคำสั่งซื้อ #${orderId} เป็น "รับสินค้าแล้ว"?`)) return;
  try {
    await updateOrderStatus(orderId, 'done', { label: STAGES_META.done.label });
    showShopToast(`ปิด #${orderId} แล้ว`, 'success');
    refreshDelivery();
  } catch (e) {
    showShopToast(`ปิดคำสั่งซื้อไม่สำเร็จ: ${e.message || e}`, 'error');
  }
}

// ---------------------------------------------------------------------
// Batches — multi-date with per-date hours; edit anytime
// ---------------------------------------------------------------------
function blankBatch() {
  return {
    id: null,
    title: '',
    location: '',
    dates_full: [{ date: '', hours: '' }],
    product_ids: [],
    note: '',
    is_active: true,
  };
}

async function refreshBatches() {
  try {
    const [batches, products] = await Promise.all([listAllBatches(), listProducts({ activeOnly: false })]);
    state.batches = batches;
    state.products = products;
    renderBatches();
  } catch (e) {
    showShopToast(`โหลดประกาศล้มเหลว: ${e.message || e}`, 'error');
  }
}

function renderBatches() {
  const creator = document.getElementById('shopAdminBatchesCreator');
  const list = document.getElementById('shopAdminBatchesList');
  if (!creator || !list) return;

  creator.innerHTML = state.batchEditor ? batchEditorHtml(state.batchEditor) : '';
  if (state.batchEditor) wireBatchEditor();

  const active = state.batches.filter((b) => b.is_active);
  const closed = state.batches.filter((b) => !b.is_active);
  list.innerHTML = `
    <h6 class="text-muted text-uppercase small mt-3">ประกาศที่ใช้งานอยู่</h6>
    ${active.length === 0 ? '<div class="text-muted small">— ไม่มี —</div>' : active.map((b) => batchCardHtml(b, true)).join('')}
    ${closed.length ? `
      <h6 class="text-muted text-uppercase small mt-4">ประกาศก่อนหน้า</h6>
      ${closed.map((b) => batchCardHtml(b, false)).join('')}` : ''}`;

  list.querySelectorAll('[data-batch-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.batchEdit);
      const b = state.batches.find((x) => x.id === id);
      if (!b) return;
      state.batchEditor = {
        ...b,
        dates_full: batchDateEntries(b).length ? batchDateEntries(b) : [{ date: '', hours: '' }],
      };
      renderBatches();
    });
  });
  list.querySelectorAll('[data-batch-close]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await closeBatch(Number(btn.dataset.batchClose));
        showShopToast('ปิดประกาศแล้ว', 'success');
        refreshBatches();
      } catch (e) { showShopToast(`ปิดประกาศล้มเหลว: ${e.message || e}`, 'error'); }
    });
  });
  list.querySelectorAll('[data-batch-reopen]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await upsertBatch({ id: Number(btn.dataset.batchReopen), is_active: true });
        showShopToast('เปิดประกาศอีกครั้งแล้ว', 'success');
        refreshBatches();
      } catch (e) { showShopToast(`เปิดประกาศล้มเหลว: ${e.message || e}`, 'error'); }
    });
  });
}

function batchCardHtml(b, isActive) {
  const entries = batchDateEntries(b);
  return `
    <div class="batch-card" ${isActive ? '' : 'style="opacity:.75;"'}>
      <div>
        <div class="b-name">${escHtml(b.title)} ${isActive ? '' : '<span class="badge bg-secondary-subtle text-secondary border ms-1">ปิดแล้ว</span>'}</div>
        <div class="b-meta mt-1">
          ${b.location ? `<i class="bi bi-geo-alt me-1"></i> ${escHtml(b.location)}` : ''}
        </div>
        ${entries.length ? `
          <div class="b-meta mt-1">
            ${entries.map((e) => `
              <span class="b-date-chip">
                <i class="bi bi-calendar3"></i> ${escHtml(e.date)}${e.hours ? ` <span class="opacity-75">· ${escHtml(e.hours)}</span>` : ''}
              </span>`).join('')}
          </div>` : ''}
        ${(b.product_ids || []).length ? `
          <div class="b-meta mt-1">
            <i class="bi bi-tag me-1"></i> ${(b.product_ids || []).map((pid) => escHtml(productName(pid))).join(', ')}
          </div>` : ''}
        ${b.note ? `<div class="b-meta mt-1"><i class="bi bi-info-circle me-1"></i>${escHtml(b.note)}</div>` : ''}
      </div>
      <div class="d-flex flex-column gap-2">
        <button class="btn btn-ghost btn-sm" data-batch-edit="${b.id}">
          <i class="bi bi-pencil me-1"></i> แก้ไข
        </button>
        ${isActive
          ? `<button class="btn btn-outline-danger btn-sm" data-batch-close="${b.id}"><i class="bi bi-archive me-1"></i> ปิดประกาศ</button>`
          : `<button class="btn btn-outline-success btn-sm" data-batch-reopen="${b.id}"><i class="bi bi-arrow-counterclockwise me-1"></i> เปิดอีกครั้ง</button>`}
      </div>
    </div>`;
}

function productName(id) {
  return state.products.find((p) => p.id === id)?.name || id;
}

function batchEditorHtml(b) {
  return `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <h5 class="text-accent"><i class="bi bi-megaphone me-1"></i> ${b.id ? 'แก้ไข' : 'สร้าง'}ประกาศการรับสินค้า</h5>
      <div class="row g-3">
        <div class="col-md-6">
          <label class="small text-muted mb-1">สินค้าที่ผลิตเสร็จ (เลือกได้มากกว่าหนึ่ง)</label>
          <select id="shopBatchProducts" class="form-select" multiple size="5">
            ${state.products.map((p) => `<option value="${escHtml(p.id)}" ${(b.product_ids || []).includes(p.id) ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">หัวเรื่องประกาศ</label>
          <input id="shopBatchTitle" class="form-control" value="${escHtml(b.title)}"
            placeholder="เช่น เสื้อ RT69 รอบที่ 1 ผลิตเสร็จแล้ว!" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">จุดรับ</label>
          <input id="shopBatchLocation" class="form-control" value="${escHtml(b.location || '')}" placeholder="เช่น ห้องสโมสรนักศึกษาฯ ชั้น 1" />
        </div>
        <div class="col-md-6 d-flex align-items-end">
          <div class="form-check">
            <input id="shopBatchActive" class="form-check-input" type="checkbox" ${b.is_active ? 'checked' : ''} />
            <label for="shopBatchActive" class="form-check-label">เปิดแสดงในหน้าร้าน</label>
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">วันที่และเวลารับ (เพิ่มได้หลายวัน แต่ละวันมีเวลาแยก)</label>
          <div id="shopBatchDateRows" class="d-flex flex-column gap-2">
            ${b.dates_full.map((e, i) => batchDateRowHtml(e, i)).join('')}
          </div>
          <button type="button" class="btn btn-ghost btn-sm mt-2" id="shopBatchAddDate">
            <i class="bi bi-plus-lg"></i> เพิ่มวัน
          </button>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">หมายเหตุ (ไม่บังคับ)</label>
          <textarea id="shopBatchNote" class="form-control" rows="2" placeholder="เช่น กรุณานำบัตรนักศึกษามาด้วย">${escHtml(b.note || '')}</textarea>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-3">
        <button type="button" class="btn btn-ghost" id="shopBatchCancel">ยกเลิก</button>
        <button type="button" class="btn btn-shop" id="shopBatchSave">
          <i class="bi bi-megaphone me-1"></i> ${b.id ? 'บันทึก' : 'ประกาศ'}
        </button>
      </div>
    </div>`;
}

function batchDateRowHtml(entry, idx) {
  return `
    <div class="batch-date-row d-flex gap-2 align-items-center" data-batch-row="${idx}">
      <div class="input-group input-group-sm" style="max-width:220px;">
        <span class="input-group-text bg-white"><i class="bi bi-calendar3"></i></span>
        <input type="text" class="form-control" data-batch-date-idx="${idx}" value="${escHtml(entry.date)}" placeholder="เช่น 27 พ.ค." />
      </div>
      <div class="input-group input-group-sm" style="max-width:220px;">
        <span class="input-group-text bg-white"><i class="bi bi-clock"></i></span>
        <input type="text" class="form-control" data-batch-hours-idx="${idx}" value="${escHtml(entry.hours)}" placeholder="เช่น 10:00–17:00 น." />
      </div>
      <button type="button" class="btn btn-ghost btn-sm text-danger" data-batch-remove-row="${idx}" title="ลบวันนี้">
        <i class="bi bi-trash3"></i>
      </button>
    </div>`;
}

function wireBatchEditor() {
  const b = state.batchEditor;
  document.getElementById('shopBatchCancel')?.addEventListener('click', () => { state.batchEditor = null; renderBatches(); });
  document.getElementById('shopBatchAddDate')?.addEventListener('click', () => {
    collectBatchEditorState();
    b.dates_full.push({ date: '', hours: '' });
    renderBatches();
  });
  document.querySelectorAll('[data-batch-remove-row]').forEach((btn) => {
    btn.addEventListener('click', () => {
      collectBatchEditorState();
      const i = Number(btn.dataset.batchRemoveRow);
      b.dates_full.splice(i, 1);
      if (b.dates_full.length === 0) b.dates_full.push({ date: '', hours: '' });
      renderBatches();
    });
  });
  document.getElementById('shopBatchSave')?.addEventListener('click', async () => {
    collectBatchEditorState();
    if (!b.title) { showShopToast('กรุณากรอกหัวเรื่อง', 'warn'); return; }
    const cleanDates = b.dates_full.filter((e) => e.date.trim());
    if (cleanDates.length === 0) { showShopToast('กรุณาระบุวันรับอย่างน้อย 1 วัน', 'warn'); return; }
    const payload = {
      id: b.id,
      title: b.title,
      location: b.location,
      dates_full: cleanDates,
      // Legacy mirror for older readers — single dates[] without hours per item.
      dates: cleanDates.map((e) => e.date),
      hours: cleanDates[0]?.hours || '',
      product_ids: b.product_ids,
      note: b.note,
      is_active: b.is_active,
    };
    try {
      await upsertBatch(payload);
      showShopToast('บันทึกประกาศแล้ว', 'success');
      state.batchEditor = null;
      refreshBatches();
    } catch (e) { showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error'); }
  });
}

function collectBatchEditorState() {
  const b = state.batchEditor;
  if (!b) return;
  b.title = document.getElementById('shopBatchTitle')?.value.trim() || '';
  b.location = document.getElementById('shopBatchLocation')?.value.trim() || '';
  b.note = document.getElementById('shopBatchNote')?.value.trim() || '';
  b.is_active = !!document.getElementById('shopBatchActive')?.checked;
  const ms = document.getElementById('shopBatchProducts');
  b.product_ids = ms ? Array.from(ms.selectedOptions).map((o) => o.value) : [];
  const newDates = [];
  b.dates_full.forEach((_, i) => {
    const d = document.querySelector(`[data-batch-date-idx="${i}"]`)?.value || '';
    const h = document.querySelector(`[data-batch-hours-idx="${i}"]`)?.value || '';
    newDates.push({ date: d.trim(), hours: h.trim() });
  });
  b.dates_full = newDates.length ? newDates : [{ date: '', hours: '' }];
}

// ---------------------------------------------------------------------
// Products — drop fit, add stock_status, add stock matrix editor
// ---------------------------------------------------------------------
function blankProduct() {
  return {
    id: '',
    name: '',
    sub: '',
    description: '',
    type: 'apparel-shirt',
    source: 'md',
    price: 0,
    sizes: ['S', 'M', 'L', 'XL'],
    colors: [{ id: 'black', label: 'ดำ', hex: '#1a1a1a' }],
    fits: ['unisex'],
    hue: 220,
    image_url: '',
    is_new: true,
    is_presale: false,
    presale_note: '',
    popularity: 0,
    is_active: true,
    stock_status: 'available',
    stock_matrix: {},
    _imageFile: null,
  };
}

async function refreshProducts() {
  try {
    state.products = await listProducts({ activeOnly: false });
    renderProductsTable();
    renderProductEditor();
  } catch (e) { showShopToast(`โหลดสินค้าล้มเหลว: ${e.message || e}`, 'error'); }
}

function renderProductsTable() {
  const tbody = document.getElementById('shopAdminProductsTbody');
  if (!tbody) return;
  if (state.products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">ยังไม่มีสินค้า</td></tr>`;
    return;
  }
  tbody.innerHTML = state.products.map((p) => {
    const stockSum = totalStock(p.stock_matrix);
    return `
    <tr>
      <td>
        <div class="d-flex gap-2 align-items-center">
          <div style="width:28px; height:36px; border-radius:4px; flex:0 0 auto; ${miniStyle(p)}"></div>
          <div>
            <div style="font-weight:600;">${escHtml(p.name)}</div>
            <div class="small text-muted">${escHtml(p.sub || '')}</div>
          </div>
        </div>
      </td>
      <td>
        <span class="product-source" data-src="${escHtml(p.source)}">
          <span class="src-dot"></span> ${escHtml(findSource(p.source)?.label || p.source)}
        </span>
      </td>
      <td><b>฿${thb(p.price)}</b></td>
      <td>
        <span class="small text-muted">${(p.sizes || []).length} × ${(p.colors || []).length}</span>
        ${stockSum !== null ? `<div class="small">รวม ${stockSum} ชิ้น</div>` : '<div class="small text-muted">ไม่ระบุ</div>'}
      </td>
      <td>
        ${p.is_active
          ? `<span class="badge bg-success-subtle text-success border border-success-subtle">เปิดขาย</span>`
          : `<span class="badge bg-secondary-subtle text-secondary border">ปิด</span>`}
        ${p.is_presale ? `<span class="badge bg-warning-subtle text-warning border ms-1">Preorder</span>` : ''}
        ${p.stock_status && p.stock_status !== 'available'
          ? `<span class="badge ${STOCK_STATUS_META[p.stock_status]?.badgeCls || ''} ms-1">${escHtml(STOCK_STATUS_META[p.stock_status]?.label || p.stock_status)}</span>`
          : ''}
      </td>
      <td>
        <button class="btn btn-sm btn-ghost" data-product-edit="${escHtml(p.id)}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-ghost text-danger" data-product-delete="${escHtml(p.id)}"><i class="bi bi-trash3"></i></button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-product-edit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = state.products.find((x) => x.id === btn.dataset.productEdit);
      if (p) { state.productEditor = { ...p, _imageFile: null, stock_matrix: { ...(p.stock_matrix || {}) } }; renderProductEditor(); }
    });
  });
  tbody.querySelectorAll('[data-product-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`ลบสินค้า ${btn.dataset.productDelete}?`)) return;
      try {
        await deleteProduct(btn.dataset.productDelete);
        showShopToast('ลบสินค้าแล้ว', 'success');
        refreshProducts();
      } catch (e) { showShopToast(`ลบไม่สำเร็จ: ${e.message || e}`, 'error'); }
    });
  });
}

function renderProductEditor() {
  const host = document.getElementById('shopAdminProductEditor');
  if (!host) return;
  if (!state.productEditor) { host.innerHTML = ''; return; }
  const p = state.productEditor;
  host.innerHTML = `
    <div class="admin-detail-card mb-3" style="border:1.5px solid var(--shop-300);">
      <h5 class="text-accent"><i class="bi bi-pencil-square me-1"></i> ${p.id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้าใหม่'}</h5>
      <div class="row g-3">
        <div class="col-md-4">
          <label class="small text-muted mb-1">รหัสสินค้า (id)</label>
          <input id="shopProdId" class="form-control font-mono" value="${escHtml(p.id)}" ${p.id ? 'disabled' : ''} placeholder="auto-generate ถ้าว่าง" />
        </div>
        <div class="col-md-8">
          <label class="small text-muted mb-1">ชื่อสินค้า</label>
          <input id="shopProdName" class="form-control" value="${escHtml(p.name)}" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">คำบรรยายย่อ</label>
          <input id="shopProdSub" class="form-control" value="${escHtml(p.sub || '')}" />
        </div>
        <div class="col-md-3">
          <label class="small text-muted mb-1">ราคา (บาท)</label>
          <input id="shopProdPrice" type="number" min="0" class="form-control" value="${Number(p.price) || 0}" />
        </div>
        <div class="col-md-3">
          <label class="small text-muted mb-1">Hue สี placeholder</label>
          <input id="shopProdHue" type="number" min="0" max="360" class="form-control" value="${Number(p.hue) || 220}" />
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">แหล่งที่มา</label>
          <select id="shopProdSource" class="form-select">
            ${SHOP_SOURCES.filter((s) => s.id !== 'all').map((s) =>
              `<option value="${s.id}" ${p.source === s.id ? 'selected' : ''}>${escHtml(s.label)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">ประเภท</label>
          <select id="shopProdType" class="form-select">
            ${SHOP_TYPES.filter((t) => t.id !== 'all').map((t) =>
              `<option value="${t.id}" ${p.type === t.id ? 'selected' : ''}>${escHtml(t.label)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-4">
          <label class="small text-muted mb-1">สถานะสต็อก</label>
          <select id="shopProdStockStatus" class="form-select">
            ${STOCK_STATUSES.map((s) =>
              `<option value="${s}" ${p.stock_status === s ? 'selected' : ''}>${escHtml(STOCK_STATUS_META[s]?.label || s)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">ไซส์ (คั่นด้วยจุลภาค — เช่น S,M,L,XL หรือ F สำหรับ free-size)</label>
          <input id="shopProdSizes" class="form-control" value="${escHtml((p.sizes || []).join(','))}" />
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">สี (JSON array — [{id,label,hex}, ...])</label>
          <input id="shopProdColors" class="form-control font-mono" value='${escHtml(JSON.stringify(p.colors || []))}' />
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">รายละเอียด</label>
          <textarea id="shopProdDesc" class="form-control" rows="3">${escHtml(p.description || '')}</textarea>
        </div>
        <div class="col-md-6">
          <label class="small text-muted mb-1">รูปสินค้า</label>
          <div class="d-flex gap-3 align-items-center">
            ${p.image_url ? `<img src="${safeUrl(p.image_url)}" alt="" style="width:80px; height:100px; object-fit:cover; border-radius:6px; border:1px solid var(--shop-ink-100, #ebecee);" />` : ''}
            <label class="btn btn-ghost btn-sm mb-0">
              <i class="bi bi-cloud-upload me-1"></i> ${p.image_url ? 'เปลี่ยนรูป' : 'อัปโหลดรูป'}
              <input id="shopProdImageFile" type="file" accept="image/*" hidden />
            </label>
            ${p._imageFile ? `<span class="small text-muted">${escHtml(p._imageFile.name)} (รอบันทึก)</span>` : ''}
          </div>
        </div>
        <div class="col-md-6 d-flex align-items-end gap-3 flex-wrap">
          <div class="form-check">
            <input id="shopProdIsNew" class="form-check-input" type="checkbox" ${p.is_new ? 'checked' : ''} />
            <label for="shopProdIsNew" class="form-check-label">NEW</label>
          </div>
          <div class="form-check">
            <input id="shopProdIsPresale" class="form-check-input" type="checkbox" ${p.is_presale ? 'checked' : ''} />
            <label for="shopProdIsPresale" class="form-check-label">Preorder</label>
          </div>
          <div class="form-check">
            <input id="shopProdIsActive" class="form-check-input" type="checkbox" ${p.is_active ? 'checked' : ''} />
            <label for="shopProdIsActive" class="form-check-label">เปิดขาย</label>
          </div>
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">หมายเหตุ Preorder</label>
          <input id="shopProdPresaleNote" class="form-control" value="${escHtml(p.presale_note || '')}" placeholder="เช่น ผลิตเสร็จ 20 มิ.ย. 2026" />
        </div>
        <div class="col-12">
          <label class="small text-muted mb-1">สต็อกต่อไซส์ × สี</label>
          <div id="shopProdStockMatrix">${stockMatrixHtml(p)}</div>
          <div class="small text-muted mt-1">
            ตั้งค่า "0" สำหรับตัวเลือกที่หมด — เว้นว่างไว้แปลว่ายังไม่ระบุ
          </div>
        </div>
      </div>
      <div class="d-flex justify-content-end gap-2 mt-3">
        <button type="button" class="btn btn-ghost" id="shopProdCancel">ยกเลิก</button>
        <button type="button" class="btn btn-shop" id="shopProdSave">
          <i class="bi bi-save me-1"></i> บันทึก
        </button>
      </div>
    </div>`;

  document.getElementById('shopProdImageFile')?.addEventListener('change', (e) => {
    p._imageFile = e.target.files?.[0] || null;
    renderProductEditor();
  });

  // Re-render the matrix when sizes/colors change (so admin can dial in stock
  // immediately after editing variants).
  document.getElementById('shopProdSizes')?.addEventListener('change', refreshMatrixOnly);
  document.getElementById('shopProdColors')?.addEventListener('change', refreshMatrixOnly);

  document.getElementById('shopProdCancel')?.addEventListener('click', () => { state.productEditor = null; renderProductEditor(); });
  document.getElementById('shopProdSave')?.addEventListener('click', saveProductForm);
}

function refreshMatrixOnly() {
  const p = state.productEditor;
  if (!p) return;
  // pull live values, replace in-memory + re-render only the matrix area
  p.sizes  = (document.getElementById('shopProdSizes')?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(document.getElementById('shopProdColors')?.value || '[]');
    if (Array.isArray(parsed)) p.colors = parsed;
  } catch { /* ignore until save */ }
  const host = document.getElementById('shopProdStockMatrix');
  if (host) host.innerHTML = stockMatrixHtml(p);
}

function stockMatrixHtml(p) {
  const sizes = (p.sizes && p.sizes.length) ? p.sizes : ['F'];
  const colors = (p.colors && p.colors.length) ? p.colors : [{ id: 'default', label: 'มาตรฐาน', hex: '#ccc' }];
  const matrix = p.stock_matrix || {};
  return `
    <div class="stock-matrix">
      <table class="stock-matrix-table">
        <thead>
          <tr>
            <th></th>
            ${sizes.map((s) => `<th>${escHtml(s)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${colors.map((c) => `
            <tr>
              <th>
                <span class="stock-color-swatch" style="background:${escHtml(c.hex || '#ccc')};"></span>
                ${escHtml(c.label || c.id)}
              </th>
              ${sizes.map((s) => {
                const k = stockKey(s, c.id);
                const v = matrix[k];
                return `<td>
                  <input type="number" min="0" class="form-control form-control-sm"
                    data-stock-key="${escHtml(k)}"
                    value="${v === undefined || v === null ? '' : Number(v)}"
                    placeholder="-" />
                </td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function readStockMatrix() {
  const matrix = {};
  document.querySelectorAll('[data-stock-key]').forEach((el) => {
    const k = el.dataset.stockKey;
    const raw = el.value.trim();
    if (raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    matrix[k] = Math.floor(n);
  });
  return matrix;
}

async function saveProductForm() {
  const e = state.productEditor;
  if (!e) return;
  const name = document.getElementById('shopProdName')?.value.trim() || '';
  if (!name) { showShopToast('กรุณากรอกชื่อสินค้า', 'warn'); return; }

  let colors;
  try {
    colors = JSON.parse(document.getElementById('shopProdColors')?.value || '[]');
    if (!Array.isArray(colors)) throw new Error();
  } catch { showShopToast('รูปแบบสี (JSON) ไม่ถูกต้อง', 'warn'); return; }

  const payload = {
    id: e.id || `p-${slugify(name)}-${Math.floor(Math.random() * 999)}`,
    name,
    sub: document.getElementById('shopProdSub')?.value.trim() || null,
    description: document.getElementById('shopProdDesc')?.value || null,
    source: document.getElementById('shopProdSource')?.value || 'md',
    type: document.getElementById('shopProdType')?.value || 'apparel-shirt',
    price: Math.max(0, Number(document.getElementById('shopProdPrice')?.value) || 0),
    hue: Math.max(0, Math.min(360, Number(document.getElementById('shopProdHue')?.value) || 220)),
    sizes: (document.getElementById('shopProdSizes')?.value || '').split(',').map((s) => s.trim()).filter(Boolean),
    fits: ['unisex'],
    colors,
    is_new: !!document.getElementById('shopProdIsNew')?.checked,
    is_presale: !!document.getElementById('shopProdIsPresale')?.checked,
    is_active: !!document.getElementById('shopProdIsActive')?.checked,
    stock_status: document.getElementById('shopProdStockStatus')?.value || 'available',
    stock_matrix: readStockMatrix(),
    presale_note: document.getElementById('shopProdPresaleNote')?.value.trim() || null,
    image_url: e.image_url || null,
  };

  const btn = document.getElementById('shopProdSave');
  const original = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึก…'; }

  try {
    if (e._imageFile) {
      const ext = (e._imageFile.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
      const fileName = `${slugify(name)}_${Date.now()}.${ext}`;
      payload.image_url = await uploadShopFile(e._imageFile, `SAMO_Shop/Products/${payload.id}`, { fileName });
    }
    await upsertProduct(payload);
    showShopToast('บันทึกสินค้าแล้ว', 'success');
    state.productEditor = null;
    refreshProducts();
  } catch (err) {
    showShopToast(`บันทึกล้มเหลว: ${err.message || err}`, 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = original || 'บันทึก'; }
  }
}

function miniStyle(p) {
  if (p?.image_url) return `background-image: url('${escHtml(p.image_url)}'); background-size: cover; background-position: center;`;
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}

// ---------------------------------------------------------------------
// QR settings
// ---------------------------------------------------------------------
async function loadSettingsIntoForm() {
  try {
    state.settings = await getSettings();
  } catch (e) { showShopToast(`โหลดการตั้งค่าล้มเหลว: ${e.message || e}`, 'error'); return; }
  const s = state.settings || {};
  setVal('shopAdminQRName', s.promptpay_name);
  setVal('shopAdminQRId', s.promptpay_id);
  setVal('shopAdminQRInstructions', s.instructions);
  setVal('shopAdminQRContactGmail', s.contact_gmail);
  setVal('shopAdminQRContactInstagram', s.contact_instagram);
  const preview = document.getElementById('shopAdminQRPreview');
  if (preview) {
    if (s.promptpay_qr_url) {
      preview.innerHTML = `<img src="${safeUrl(s.promptpay_qr_url)}" alt="PromptPay QR" />`;
    } else {
      preview.innerHTML = `<div class="text-center"><i class="bi bi-qr-code fs-1 text-muted"></i><div class="mt-1">ยังไม่ได้อัปโหลด</div></div>`;
    }
  }
}

function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }

async function onQRFileChosen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showShopToast('ไฟล์ใหญ่เกิน 5 MB', 'warn'); return; }
  const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'png').toLowerCase();
  const fileName = `promptpay_${Date.now()}.${ext}`;
  try {
    const url = await uploadShopFile(file, 'SAMO_Shop/QR', { fileName });
    const patch = { promptpay_qr_url: url };
    await saveSettings(patch);
    invalidateSettingsCache();
    state.settings = { ...(state.settings || {}), ...patch };
    const preview = document.getElementById('shopAdminQRPreview');
    if (preview) preview.innerHTML = `<img src="${safeUrl(url)}" alt="PromptPay QR" />`;
    showShopToast('อัปโหลด QR สำเร็จ', 'success');
  } catch (err) {
    showShopToast(`อัปโหลด QR ล้มเหลว: ${err.message || err}`, 'error');
  } finally {
    e.target.value = '';
  }
}

async function saveSettingsForm() {
  const patch = {
    promptpay_name: document.getElementById('shopAdminQRName')?.value || '',
    promptpay_id: document.getElementById('shopAdminQRId')?.value || '',
    instructions: document.getElementById('shopAdminQRInstructions')?.value || '',
    contact_gmail: document.getElementById('shopAdminQRContactGmail')?.value || '',
    contact_instagram: document.getElementById('shopAdminQRContactInstagram')?.value || '',
  };
  try {
    await saveSettings(patch);
    invalidateSettingsCache();
    state.settings = { ...(state.settings || {}), ...patch };
    showShopToast('บันทึกการตั้งค่าแล้ว', 'success');
  } catch (e) { showShopToast(`บันทึกล้มเหลว: ${e.message || e}`, 'error'); }
}
