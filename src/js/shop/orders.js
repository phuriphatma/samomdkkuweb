// ==============================================
// SHOP ORDERS — My Orders view
//
// Shows the signed-in user's orders with a timeline + filter chips.
// Pickup callout + contact-fallback appear for orders in 'ready' state.
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { getUser } from '../auth.js';
import { thb, fmtDateTime, STAGES_ORDER, STAGES_META } from './data.js';
import { listMyOrders, listActiveBatches, getSettings } from './api.js';
import { ensureProductsLoaded, getProductMap } from './cart.js';

const state = {
  orders: [],
  batches: [],
  contact: { gmail: '', instagram: '' },
  filter: 'all',
  loaded: false,
};

const FILTERS = [
  { id: 'all',     label: 'ทั้งหมด' },
  { id: 'pending', label: 'รอชำระ' },
  { id: 'review',  label: 'ตรวจสลิป' },
  { id: 'paid',    label: 'ชำระแล้ว' },
  { id: 'produce', label: 'กำลังผลิต' },
  { id: 'ready',   label: 'พร้อมรับ' },
  { id: 'done',    label: 'รับแล้ว' },
];

export async function mountOrdersView() {
  // Filter chip row is rebuilt on each render — wire delegated click.
  const row = document.getElementById('shopOrdersFilterRow');
  if (row) {
    row.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-order-filter]');
      if (!chip) return;
      state.filter = chip.dataset.orderFilter;
      render();
    });
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
  if (!row || !list || !empty) return;

  // Counts
  const counts = { all: state.orders.length };
  for (const o of state.orders) counts[o.status] = (counts[o.status] || 0) + 1;
  row.innerHTML = FILTERS.map((f) => `
    <button type="button" class="chip ${state.filter === f.id ? 'is-active' : ''}" data-order-filter="${f.id}">
      ${escHtml(f.label)}
      <b style="font-weight:600; opacity:.7;">${counts[f.id] || 0}</b>
    </button>`).join('');

  const filtered = state.filter === 'all'
    ? state.orders
    : state.orders.filter((o) => o.status === state.filter);

  empty.classList.toggle('d-none', filtered.length > 0);
  list.innerHTML = filtered.map(orderCardHtml).join('');

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
          <span class="order-id">#${escHtml(o.id)}</span>
          <span class="order-date">สั่งเมื่อ ${fmtDateTime(o.placed_at)}</span>
        </div>
        ${statusPillHtml(o.status)}
      </div>

      ${progressTrackHtml(o.status)}

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
        <span class="text-muted small">${totalQty} ชิ้น</span>
        <span style="font-weight:700; font-size:1.05rem; font-family:Prompt;">
          รวม ฿${thb(total)}
        </span>
      </div>

      ${o.status === 'ready' && batch ? `
        <div class="order-pickup-callout">
          <i class="bi bi-box-seam"></i>
          <div>
            <div class="opc-title">พร้อมรับสินค้าแล้ว · ${escHtml(batch.location)}</div>
            ${batch.hours ? `<div class="opc-meta">เวลารับ ${escHtml(batch.hours)}</div>` : ''}
            <div class="opc-dates">
              ${(Array.isArray(batch.dates) ? batch.dates : []).map((d) => `<span class="opc-date">${escHtml(d)}</span>`).join('')}
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
    </div>`;
}

function statusPillHtml(status) {
  const meta = STAGES_META[status] || STAGES_META.pending;
  return `
    <span class="status-pill" data-status="${escHtml(status)}">
      <span class="pulse"></span>
      <i class="bi ${escHtml(meta.icon)}"></i>
      <span>${escHtml(meta.label)}</span>
    </span>`;
}

function progressTrackHtml(status) {
  if (status === 'cancel') {
    return `
      <div class="progress-track" style="grid-template-columns: 1fr;">
        <div class="progress-step is-cancel"><span class="pdot"></span>คำสั่งซื้อถูกยกเลิก</div>
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
