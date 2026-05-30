// ==============================================
// SHOP ORDERS — My Orders view
//
// Shows the signed-in user's orders with a timeline + filter chips.
// Pickup callout + contact-fallback appear for orders in 'ready' state.
// ==============================================

import { escHtml, safeUrl, orderIdChipHtml } from '../utils.js';
import { getUser } from '../auth.js';
import { thb, fmtDateTime, STAGES_ORDER, STAGES_META, statusMetaFor, batchDateEntries } from './data.js';
import { listMyOrders, listActiveBatches, getSettings, setOrderSlip } from './api.js';
import { ensureProductsLoaded, getProductMap } from './cart.js';
import { uploadShopFile, slipFolderForNow } from './uploads.js';
import { showShopToast } from './products.js';
import { showOrderQrModal } from './qr.js';

const state = {
  orders: [],
  batches: [],
  contact: { gmail: '', instagram: '' },
  filter: 'all',
  loaded: false,
};

// Customer orders view has no filter chips — most users have a
// handful of orders and scroll-to-find is faster than tap-to-filter.
// The state.filter field is kept so external callers (sub-nav badges)
// don't break, but render() always shows everything.

export async function mountOrdersView() {
  // Re-upload slip flow for slip_mismatch orders. Delegated to the
  // orders-list container so the handler survives every re-render.
  const list = document.getElementById('shopOrdersList');
  // "Show QR" button → opens the customer QR modal for that order.
  if (list && !list.dataset.qrBound) {
    list.dataset.qrBound = '1';
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-show-qr]');
      if (!btn) return;
      e.preventDefault();
      const o = state.orders.find((x) => x.id === btn.dataset.showQr);
      if (o) showOrderQrModal(o);
    });
  }
  if (list && !list.dataset.reuploadBound) {
    list.dataset.reuploadBound = '1';
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-reupload-order]');
      if (!btn) return;
      const orderId = btn.dataset.reuploadOrder;
      const input = list.querySelector(`input[data-reupload-file="${CSS.escape(orderId)}"]`);
      input?.click();
    });
    list.addEventListener('change', async (e) => {
      const input = e.target.closest('input[data-reupload-file]');
      if (!input) return;
      const orderId = input.dataset.reuploadFile;
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      await handleSlipReupload(orderId, file);
    });
  }
}

async function handleSlipReupload(orderId, file) {
  if (file.size > 5 * 1024 * 1024) {
    showShopToast('ไฟล์ใหญ่เกิน 5 MB', 'warn');
    return;
  }
  const user = getUser();
  if (!user) { showShopToast('กรุณาเข้าสู่ระบบก่อน', 'warn'); return; }
  const btn = document.querySelector(`[data-reupload-order="${CSS.escape(orderId)}"]`);
  const originalHTML = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังอัปโหลด…';
  }
  try {
    const ext = (file.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
    const slipName = `${user.id}_${Date.now()}.${ext}`;
    const folder = slipFolderForNow(new Date());
    const slipUrl = await uploadShopFile(file, folder, { fileName: slipName });
    await setOrderSlip(orderId, slipUrl);
    showShopToast('ส่งสลิปใหม่แล้ว — รอ admin ตรวจสอบ', 'success');
    await renderOrdersView();
  } catch (err) {
    console.error('[shop/orders] reupload slip failed:', err);
    showShopToast(`ส่งสลิปไม่สำเร็จ: ${err.message || err}`, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHTML || '<i class="bi bi-cloud-upload me-1"></i> อัปโหลดสลิปใหม่';
    }
  }
}

/** Show / refresh. Called when the orders sub-nav is activated. */
export async function renderOrdersView() {
  const user = getUser();
  const gate = document.getElementById('shopOrdersAuthGate');
  if (!user) {
    if (gate) gate.classList.remove('d-none');
    document.getElementById('shopOrdersList').innerHTML = '';
    document.getElementById('shopOrdersFilterRow').innerHTML = '';
    document.getElementById('shopOrdersEmpty')?.classList.add('d-none');
    document.getElementById('shopOrdersReadyCount')?.classList.add('d-none');
    return;
  }
  if (gate) gate.classList.add('d-none');

  await ensureProductsLoaded();
  try {
    const [orders, batches, settings] = await Promise.all([
      listMyOrders(user.id),
      listActiveBatches().catch(() => []),
      getSettings().catch(() => null),
    ]);
    state.orders = orders;
    state.batches = batches || [];
    if (settings) {
      state.contact = {
        gmail: settings.contact_gmail || '',
        instagram: settings.contact_instagram || '',
      };
    }
    state.loaded = true;
    render();
  } catch (e) {
    console.error('[shop/orders] load failed:', e);
    document.getElementById('shopOrdersList').innerHTML =
      `<div class="text-danger small p-3">โหลดคำสั่งซื้อล้มเหลว: ${escHtml(e.message || e)}</div>`;
  }
}

/** Render just the ready-count pill in the sub-nav (called by index.js after load). */
export function refreshReadyCountBadge() {
  const badge = document.getElementById('shopOrdersReadyCount');
  if (!badge) return;
  const ready = state.orders.filter((o) => o.status === 'ready').length;
  badge.textContent = String(ready);
  badge.classList.toggle('d-none', ready === 0);
}

function render() {
  const row = document.getElementById('shopOrdersFilterRow');
  const list = document.getElementById('shopOrdersList');
  const empty = document.getElementById('shopOrdersEmpty');
  if (!list || !empty) return;

  // Drop the filter chip row entirely (per UX request).
  if (row) row.innerHTML = '';

  empty.classList.toggle('d-none', state.orders.length > 0);
  list.innerHTML = state.orders.map(orderCardHtml).join('');

  refreshReadyCountBadge();
}

function orderCardHtml(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const total = items.reduce((s, it) => s + (Number(it.unit_price) || 0) * (Number(it.qty) || 0), 0) + (Number(o.fee) || 0);
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const batch = o.pickup_batch_id ? state.batches.find((b) => b.id === o.pickup_batch_id) : null;
  const products = getProductMap();

  return `
    <div class="order-card" data-status="${escHtml(o.status)}">
      <div class="order-head">
        <div class="d-flex flex-column">
          <span class="order-id">${orderIdChipHtml(o.id)}</span>
          <span class="order-date">สั่งเมื่อ ${fmtDateTime(o.placed_at)}</span>
        </div>
        ${statusPillHtml(o)}
      </div>

      ${progressTrackHtml(o)}

      <div class="order-items-row">
        ${items.map((it) => {
          const p = products[it.product_id];
          return `
            <div class="order-mini">
              <div class="om-thumb" style="${miniThumbStyle(p)}"></div>
              <span>${escHtml(p?.name || it.product_id)}</span>
              ${it.size && it.size !== 'F' ? `<span class="text-muted small">(${escHtml(it.size)})</span>` : ''}
              <span class="om-qty">× ${it.qty}</span>
            </div>`;
        }).join('')}
      </div>

      <div class="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
        <div class="d-flex flex-wrap gap-3 align-items-center">
          <span class="text-muted small">${totalQty} ชิ้น</span>
          <button type="button" class="btn btn-link p-0 small text-decoration-none"
                  data-show-qr="${escHtml(o.id)}">
            <i class="bi bi-qr-code me-1"></i> แสดง QR
          </button>
          ${o.slip_url ? `
            <a href="${safeUrl(o.slip_url)}" target="_blank" rel="noreferrer" class="small text-decoration-none">
              <i class="bi bi-receipt me-1"></i> ดูสลิปที่ส่ง
            </a>` : ''}
          ${o.cancel_reason ? `<span class="small text-danger"><i class="bi bi-info-circle me-1"></i>${escHtml(o.cancel_reason)}</span>` : ''}
        </div>
        <span style="font-weight:700; font-size:1.05rem; font-family:Prompt;">
          รวม ฿${thb(total)}
        </span>
      </div>

      ${o.status === 'ready' && batch ? `
        <div class="order-pickup-callout">
          <i class="bi bi-box-seam"></i>
          <div>
            <div class="opc-title">พร้อมรับสินค้าแล้ว · ${escHtml(batch.location)}</div>
            <div class="opc-dates">
              ${batchDateEntries(batch).map((e) => `
                <span class="opc-date">
                  ${escHtml(e.date)}${e.hours ? ` · <span class="opc-date-time">${escHtml(e.hours)}</span>` : ''}
                </span>`).join('')}
            </div>
          </div>
          <i class="bi bi-arrow-right-circle fs-4 text-success"></i>
        </div>` : ''}

      ${(o.status === 'ready' && (state.contact.gmail || state.contact.instagram)) ? `
        <div class="contact-fallback">
          <i class="bi bi-info-circle text-warning fs-5"></i>
          <div class="flex-grow-1">
            <div style="font-weight:600; color:var(--shop-ink-900);">มารับไม่ทันทุกวัน?</div>
            <div class="small text-muted">ทักมาที่ช่องทางต่อไปนี้เพื่อนัดรับเพิ่มได้</div>
          </div>
          <div class="cf-icons">
            ${state.contact.gmail ? `<a href="mailto:${safeUrl('mailto:' + state.contact.gmail)}"><i class="bi bi-envelope"></i> Gmail</a>` : ''}
            ${state.contact.instagram ? `<a href="${safeUrl('https://instagram.com/' + state.contact.instagram.replace(/^@/, ''))}" target="_blank" rel="noreferrer"><i class="bi bi-instagram"></i> ${escHtml(state.contact.instagram)}</a>` : ''}
          </div>
        </div>` : ''}

      ${reuploadCalloutHtml(o)}
    </div>`;
}

/** Show a "change/upload slip" affordance any time the customer's
 *  slip is still actionable — i.e. before the admin has verified it
 *  (pending = no slip yet, review = sent but not yet verified) and
 *  when the admin has explicitly rejected it (slip_mismatch). Once
 *  the order moves to paid/produce/ready/done/cancel etc., we hide
 *  this so a paid order can't be confused by a late "new slip".
 *
 *  This is the standard Thai e-commerce slip pattern — Shopee/Lazada/
 *  bank-transfer storefronts all let buyers replace the slip until
 *  the seller marks it OK. */
const REUPLOAD_ALLOWED = new Set(['pending', 'review', 'slip_mismatch']);

function reuploadCalloutHtml(o) {
  if (!REUPLOAD_ALLOWED.has(o.status)) return '';
  const isReject = o.status === 'slip_mismatch';
  const hasSlip = !!o.slip_url;
  const headline = isReject
    ? 'สลิปไม่ถูกต้อง'
    : hasSlip
      ? 'ส่งสลิปแล้ว — แก้ไขได้จนกว่า admin จะตรวจ'
      : 'ยังไม่ได้ส่งสลิป';
  const body = isReject
    ? 'admin ตรวจสอบแล้วพบว่าสลิปไม่ตรงกับยอดที่สั่ง โปรดอัปโหลดสลิปที่ถูกต้องอีกครั้ง'
    : hasSlip
      ? 'ถ้าโอนใหม่หรือสลิปไม่ชัด สามารถเปลี่ยนรูปได้ก่อน admin ยืนยัน'
      : 'อัปโหลดสลิปการโอนเพื่อให้ admin ตรวจสอบ';
  const btnLabel = hasSlip ? 'เปลี่ยนสลิป' : 'อัปโหลดสลิป';
  const bg = isReject
    ? 'background:#fff8e1; border:1px solid #fbcf73;'
    : 'background:#f4f7fb; border:1px solid #dfe5ee;';
  const icon = isReject ? 'bi-exclamation-triangle text-warning' : 'bi-info-circle text-primary';
  return `
    <div class="contact-fallback" style="${bg}">
      <i class="bi ${icon} fs-5"></i>
      <div class="flex-grow-1">
        <div style="font-weight:600; color:var(--shop-ink-900);">${escHtml(headline)}</div>
        <div class="small text-muted">${escHtml(body)}</div>
      </div>
      <button type="button" class="btn btn-sm ${isReject ? 'btn-warning' : 'btn-outline-primary'}"
              data-reupload-order="${escHtml(o.id)}">
        <i class="bi bi-cloud-upload me-1"></i> ${escHtml(btnLabel)}
      </button>
      <input type="file" accept="image/*" class="d-none" data-reupload-file="${escHtml(o.id)}" />
    </div>`;
}

function statusPillHtml(order) {
  const meta = statusMetaFor(order);
  const status = order?.status || 'pending';
  return `
    <span class="status-pill" data-status="${escHtml(status)}">
      <span class="pulse"></span>
      <i class="bi ${escHtml(meta.icon)}"></i>
      <span>${escHtml(meta.label)}</span>
    </span>`;
}

// Off-path single-line track. Text falls back to the canonical label
// from STAGES_META so customer / admin / filter stay in sync — only
// list overrides here when a longer phrasing reads better on the card.
const OFF_PATH_TRACKS = {
  cancel:         { cls: 'is-cancel',  text: 'คำสั่งซื้อถูกยกเลิก' },
  slip_mismatch:  { cls: 'is-cancel',  text: 'สลิปไม่ตรงกับยอด — รอการแก้ไข' },
  refund_pending: { cls: 'is-cancel',  text: 'อยู่ระหว่างดำเนินการคืนเงิน' },
  refunded:       { cls: 'is-cancel',  text: 'คืนเงินแล้ว' },
  no_show:        { cls: 'is-cancel',  text: 'ยังไม่ได้รับสินค้า' },
  exchange:       { cls: 'is-cancel',  text: 'อยู่ระหว่างการเปลี่ยนสินค้า' },
};

function progressTrackHtml(order) {
  const status = order?.status || 'pending';
  const off = OFF_PATH_TRACKS[status];
  if (off) {
    return `
      <div class="progress-track" style="grid-template-columns: 1fr;">
        <div class="progress-step ${off.cls}"><span class="pdot"></span>${escHtml(off.text)}</div>
      </div>`;
  }
  const currentIdx = STAGES_ORDER.indexOf(status);
  return `
    <div class="progress-track">
      ${STAGES_ORDER.map((stage, i) => {
        const cls = i < currentIdx ? 'is-done' : i === currentIdx ? 'is-current' : '';
        return `<div class="progress-step ${cls}"><span class="pdot"></span>${escHtml(STAGES_META[stage].label)}</div>`;
      }).join('')}
    </div>`;
}

function miniThumbStyle(p) {
  if (p?.image_url) {
    return `background-image: url('${escHtml(p.image_url)}'); background-size: cover; background-position: center;`;
  }
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}
