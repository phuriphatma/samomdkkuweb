// ==============================================
// SHOP CHECKOUT — Order summary + PromptPay QR + slip upload
//
// Slip uploads land in Drive at `SAMO_Shop/Slips/<YYYY-MM>/<orderId>_*`.
// The order id only exists after `createOrder` succeeds, so the rename
// flow is: upload with a temporary filename → create order → done. The
// stored filename includes the buyer id + timestamp so it stays unique
// even before the order id is known.
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import { getUser } from '../auth.js';
import { thb } from './data.js';
import { getCart, cartSubtotal, clearCart } from './state.js';
import { getSettings, createOrder } from './api.js';
import { uploadShopFile, slipFolderForNow } from './uploads.js';
import { getProductMap, ensureProductsLoaded } from './cart.js';
import { showShopToast } from './products.js';

let onAfterPlace = () => {};
let onBack = () => {};
let settingsCache = null;

const state = {
  slipFile: null,
  slipPreviewUrl: null,
  buyerNote: '',
  agree: false,
};

export function setCheckoutNavigators({ goShop, afterPlace }) {
  onBack = goShop || onBack;
  onAfterPlace = afterPlace || onAfterPlace;
}

export async function mountCheckout() {
  const back = document.getElementById('shopCheckoutBack');
  if (back) back.addEventListener('click', () => onBack());
}

/** Show the checkout view (called by index.js when sub-nav switches). */
export async function renderCheckout() {
  const user = getUser();
  const gate = document.getElementById('shopCheckoutAuthGate');
  const body = document.getElementById('shopCheckoutBody');
  if (!gate || !body) return;

  if (!user) {
    gate.classList.remove('d-none');
    body.classList.add('d-none');
    return;
  }
  gate.classList.add('d-none');
  body.classList.remove('d-none');

  await ensureProductsLoaded();
  if (!settingsCache) {
    try { settingsCache = await getSettings(); } catch { settingsCache = null; }
  }
  body.innerHTML = renderHtml();
  wireEvents();
}

function renderHtml() {
  const cart = getCart();
  const subtotal = cartSubtotal();
  const itemsTotal = cart.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const products = getProductMap();
  const collector = {
    name: settingsCache?.promptpay_name || 'ผู้รับเงิน SAMO',
    id:   settingsCache?.promptpay_id   || '—',
    qr:   settingsCache?.promptpay_qr_url || '',
    instructions: settingsCache?.instructions || '',
  };

  if (cart.length === 0) {
    return `
      <div class="empty-state">
        <i class="bi bi-bag"></i>
        <h4>ยังไม่มีสินค้าในตะกร้า</h4>
        <p>กลับไปเลือกสินค้าก่อนนะ</p>
        <button class="btn btn-shop mt-3" id="shopCheckoutBackToShop">กลับไปร้าน</button>
      </div>`;
  }

  return `
    <div>
      <div class="checkout-panel mb-3">
        <h4><span class="step-num">1</span> ตรวจสอบรายการ</h4>
        ${cart.map((it, i) => {
          const p = products[it.productId];
          const name = p?.name || it.productId;
          const colors = Array.isArray(p?.colors) ? p.colors : [];
          const colorLabel = colors.find((c) => c.id === it.color)?.label || it.color || '';
          const variantParts = [
            ...(it.size && it.size !== 'F' ? [`ไซส์ ${it.size}`] : []),
            ...(colors.length > 1 && colorLabel ? [colorLabel] : []),
            `จำนวน ${it.qty}`,
          ];
          return `
            <div class="d-flex gap-3 align-items-center py-2"
                 style="border-bottom: ${i < cart.length - 1 ? '1px solid var(--shop-ink-100, #ebecee)' : 'none'};">
              <div style="width:36px; height:48px; border-radius:6px; flex:0 0 auto;
                          ${miniThumbStyle(p)}"></div>
              <div class="flex-grow-1">
                <div style="font-weight:600;">${escHtml(name)}</div>
                <div class="small text-muted">${escHtml(variantParts.join(' · '))}</div>
              </div>
              <div style="font-weight:700;">฿${thb(it.price * it.qty)}</div>
            </div>`;
        }).join('')}
      </div>

      <div class="checkout-panel mb-3">
        <h4><span class="step-num">2</span> หมายเหตุเพิ่มเติม</h4>
        <p class="small text-muted mb-2">
          <i class="bi bi-info-circle me-1"></i>
          จุดและเวลานัดรับ admin จะแจ้งให้ทราบในประกาศการรับสินค้า (ดูที่หน้าร้านค้าและ "คำสั่งซื้อของฉัน")
        </p>
        <textarea id="shopCheckoutNote" class="form-control" rows="2"
          placeholder="หมายเหตุเพิ่มเติม (ถ้ามี) — เช่น สลักชื่อ, รับแทนเพื่อน, ฯลฯ">${escHtml(state.buyerNote)}</textarea>
      </div>

      <div class="checkout-panel">
        <h4><span class="step-num">3</span> อัปโหลดสลิปการโอน</h4>
        <div id="shopSlipDrop" class="slip-drop ${state.slipFile ? 'is-filled' : ''}">
          ${state.slipFile ? `
            <i class="bi bi-check2-circle"></i>
            <div class="slip-filename">${escHtml(state.slipFile.name)}</div>
            <div class="slip-hint">คลิกเพื่อเปลี่ยนไฟล์อื่น</div>
            ${state.slipPreviewUrl ? `
              <img src="${state.slipPreviewUrl}" alt="slip preview" class="mt-2 rounded"
                style="max-height:180px; max-width:100%; object-fit:contain;" />` : ''}` : `
            <i class="bi bi-cloud-upload"></i>
            <div class="mt-2" style="font-weight:600; color:var(--shop-ink-900);">
              ลากสลิปการโอนมาวาง หรือคลิกเพื่อเลือกไฟล์
            </div>
            <div class="slip-hint">รองรับไฟล์ภาพ jpg / png · ขนาดไม่เกิน 5 MB</div>`}
          <input id="shopSlipFile" type="file" accept="image/*" hidden />
        </div>
        <div class="form-check mt-3">
          <input id="shopCheckoutAgree" class="form-check-input" type="checkbox" ${state.agree ? 'checked' : ''} />
          <label class="form-check-label small" for="shopCheckoutAgree">
            ข้าพเจ้าได้ตรวจสอบรายการและจำนวนเงินก่อนโอนแล้ว ยอมรับนโยบายการคืน/ยกเลิกของ SAMO Shop
          </label>
        </div>
      </div>
    </div>

    <div>
      <div class="qr-card mb-3">
        <div class="qr-img">
          ${collector.qr
            ? `<img src="${safeUrl(collector.qr)}" alt="PromptPay QR" />`
            : promptpayPlaceholderSvg(200)}
        </div>
        <div class="qr-label">PromptPay</div>
        <div class="qr-name">${escHtml(collector.name)}</div>
        <div class="qr-label font-mono">${escHtml(collector.id)}</div>
        <div class="qr-amount">
          <span class="baht">฿</span>${thb(subtotal)}
        </div>
        <button type="button" class="qr-copy" id="shopCopyAmount">
          <i class="bi bi-clipboard me-1"></i> คัดลอกจำนวนเงิน
        </button>
        ${collector.instructions ? `
          <hr/>
          <div class="text-start small text-muted" style="white-space:pre-wrap;">${escHtml(collector.instructions)}</div>` : ''}
      </div>

      <div class="checkout-panel">
        <h4 style="font-size:1rem; margin-bottom:.75rem;">สรุปคำสั่งซื้อ</h4>
        <div class="summary-line">
          <span>${itemsTotal} ชิ้น</span>
          <span>฿${thb(subtotal)}</span>
        </div>
        <div class="summary-line">
          <span>ค่าจัดส่ง</span>
          <span class="text-muted">รับเอง · ฟรี</span>
        </div>
        <div class="summary-line grand">
          <span>ยอดที่ต้องโอน</span>
          <span class="amount">฿${thb(subtotal)}</span>
        </div>
        <button type="button" class="btn btn-shop w-100 mt-3" id="shopPlaceOrderBtn"
                ${(!state.slipFile || !state.agree) ? 'disabled' : ''}>
          <i class="bi bi-send-check me-1"></i> ส่งสลิป & สั่งซื้อ
        </button>
        <div class="small text-muted mt-2 text-center ${state.slipFile ? 'd-none' : ''}">
          <i class="bi bi-info-circle me-1"></i> อัปโหลดสลิปก่อนจึงจะกดสั่งซื้อได้
        </div>
      </div>
    </div>`;
}

function miniThumbStyle(p) {
  if (p?.image_url) {
    return `background-image: url('${escHtml(p.image_url)}'); background-size: cover; background-position: center;`;
  }
  const h = Number(p?.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}

function wireEvents() {
  document.getElementById('shopCheckoutBackToShop')?.addEventListener('click', () => onBack());

  const note = document.getElementById('shopCheckoutNote');
  if (note) note.addEventListener('input', () => { state.buyerNote = note.value; });

  const drop = document.getElementById('shopSlipDrop');
  const file = document.getElementById('shopSlipFile');
  if (drop && file) {
    drop.addEventListener('click', () => file.click());
    drop.addEventListener('dragover', (e) => e.preventDefault());
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f) onSlipChosen(f);
    });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (f) onSlipChosen(f);
    });
  }

  const agree = document.getElementById('shopCheckoutAgree');
  if (agree) {
    agree.addEventListener('change', () => {
      state.agree = agree.checked;
      // toggle the place button without a full re-render
      const place = document.getElementById('shopPlaceOrderBtn');
      if (place) place.disabled = !state.slipFile || !state.agree;
    });
  }

  document.getElementById('shopCopyAmount')?.addEventListener('click', async () => {
    const subtotal = cartSubtotal();
    try {
      await navigator.clipboard.writeText(String(subtotal));
      showShopToast('คัดลอกจำนวนเงินแล้ว', 'success');
    } catch { showShopToast('คัดลอกไม่สำเร็จ — ลองทำเอง', 'warn'); }
  });

  document.getElementById('shopPlaceOrderBtn')?.addEventListener('click', placeOrder);
}

function onSlipChosen(file) {
  if (file.size > 5 * 1024 * 1024) {
    showShopToast('ไฟล์ใหญ่เกิน 5 MB', 'warn');
    return;
  }
  state.slipFile = file;
  const reader = new FileReader();
  reader.onload = (e) => { state.slipPreviewUrl = e.target.result; renderCheckout(); };
  reader.readAsDataURL(file);
}

async function placeOrder() {
  const user = getUser();
  if (!user) { showShopToast('กรุณาเข้าสู่ระบบก่อน', 'warn'); return; }
  if (!state.slipFile) { showShopToast('อัปโหลดสลิปก่อน', 'warn'); return; }
  if (!state.agree)   { showShopToast('กรุณายอมรับเงื่อนไข', 'warn'); return; }
  const cart = getCart();
  if (cart.length === 0) { showShopToast('ตะกร้าว่าง', 'warn'); return; }

  const place = document.getElementById('shopPlaceOrderBtn');
  const originalLabel = place?.innerHTML;
  if (place) {
    place.disabled = true;
    place.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังอัปโหลดสลิป…';
  }

  try {
    const ext = (state.slipFile.name.match(/\.(\w+)$/)?.[1] || 'jpg').toLowerCase();
    const slipName = `${user.id}_${Date.now()}.${ext}`;
    const folder = slipFolderForNow(new Date());
    const slipUrl = await uploadShopFile(state.slipFile, folder, { fileName: slipName });

    if (place) place.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>กำลังบันทึกคำสั่งซื้อ…';

    const subtotal = cartSubtotal();
    const order = await createOrder({
      buyerId: user.id,
      buyerLabel: user.name || user.username || user.email || '',
      items: cart,
      subtotal,
      fee: 0,
      slipUrl,
      slipUploadedAt: new Date().toISOString(),
      pickupLocation: null,
      buyerNote: state.buyerNote,
    });

    clearCart();
    state.slipFile = null;
    state.slipPreviewUrl = null;
    state.buyerNote = '';
    state.agree = false;
    showShopToast(`สั่งซื้อ #${order.id} สำเร็จ — รอ admin ตรวจสอบสลิป`, 'success');
    onAfterPlace(order);
  } catch (e) {
    console.error('[shop/checkout] placeOrder failed:', e);
    showShopToast(`สั่งซื้อไม่สำเร็จ: ${e.message || e}`, 'error');
    if (place) {
      place.disabled = false;
      place.innerHTML = originalLabel || 'ส่งสลิป & สั่งซื้อ';
    }
  }
}

// Decorative placeholder QR when no admin-uploaded image exists yet.
// Matches the design's stub — fixed grid with three corner finders so it
// reads as a QR at a glance.
function promptpayPlaceholderSvg(size) {
  const cells = 21;
  const cs = size / cells;
  let s = 9;
  const cells2 = [];
  for (let i = 0; i < cells * cells; i++) {
    s = (s * 9301 + 49297) % 233280;
    cells2.push(s / 233280 > 0.47);
  }
  const inBox = (x, y, cx, cy) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7;
  const finder = (x, y) => inBox(x, y, 0, 0) || inBox(x, y, cells - 7, 0) || inBox(x, y, 0, cells - 7);
  let rects = '';
  cells2.forEach((on, i) => {
    const x = i % cells, y = Math.floor(i / cells);
    if (finder(x, y) || !on) return;
    rects += `<rect x="${(x * cs + .5).toFixed(2)}" y="${(y * cs + .5).toFixed(2)}" width="${(cs - 1).toFixed(2)}" height="${(cs - 1).toFixed(2)}" fill="#0d1a14"/>`;
  });
  const finders = [[0,0],[cells-7,0],[0,cells-7]].map(([fx, fy]) => `
    <g transform="translate(${fx * cs} ${fy * cs})">
      <rect width="${cs * 7}" height="${cs * 7}" fill="#0d1a14"/>
      <rect x="${cs}" y="${cs}" width="${cs * 5}" height="${cs * 5}" fill="#fff"/>
      <rect x="${cs * 2}" y="${cs * 2}" width="${cs * 3}" height="${cs * 3}" fill="#0d1a14"/>
    </g>`).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="PromptPay QR (placeholder)" role="img">
    <rect width="${size}" height="${size}" fill="#fff"/>
    ${rects}${finders}
    <g transform="translate(${size/2 - cs*2.2} ${size/2 - cs*1.2})">
      <rect width="${cs*4.4}" height="${cs*2.4}" rx="${cs*.3}" fill="#fff" stroke="#0d1a14" stroke-width="${cs*.18}"/>
      <text x="${cs*2.2}" y="${cs*1.6}" text-anchor="middle" font-family="Prompt, sans-serif" font-weight="700"
            font-size="${cs*1.3}" fill="#0066ad">pp</text>
    </g>
  </svg>`;
}

/** Force settings re-fetch (admin saved a new QR). */
export function invalidateSettingsCache() { settingsCache = null; }
