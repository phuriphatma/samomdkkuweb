// ==============================================
// SHOP PRODUCTS — Browse grid, filter bar, launch strip, detail modal
//
// All user-text fields (name, sub, desc, color label) are escaped before
// going into innerHTML — same XSS-class rule as the PR / VS renderers
// (see .claude/rules/mistakes.md).
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import {
  SHOP_SOURCES, SHOP_TYPES, SHOP_SORT,
  findSource, thb, fmtDate,
} from './data.js';
import { listProducts, listActiveBatches } from './api.js';
import { addItem } from './state.js';

let cache = { products: [], batch: null, loaded: false };

const filters = { source: 'all', type: 'all', sort: 'newest', search: '' };

// Listeners to switch the parent view to "orders" (set up by index.js).
let onGoOrders = () => {};
export function setShopNavigators({ goOrders }) { onGoOrders = goOrders || onGoOrders; }

// ---------------------------------------------------------------------
// Mount: populate filter chips, attach search/sort handlers
// ---------------------------------------------------------------------
export function mountShopBrowse() {
  const sourceHost = document.getElementById('shopSourceChips');
  const typeHost   = document.getElementById('shopTypeChips');
  const sortSel    = document.getElementById('shopSortSelect');
  const search     = document.getElementById('shopSearchInput');

  if (sourceHost) {
    sourceHost.innerHTML = SHOP_SOURCES.map((s) =>
      `<button type="button" class="chip ${s.id === filters.source ? 'is-active' : ''}" data-src="${s.id}" data-source-id="${s.id}">
        ${s.id !== 'all' ? '<span class="chip-dot"></span>' : ''}
        ${escHtml(s.label)}
      </button>`).join('');
    sourceHost.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-source-id]');
      if (!btn) return;
      filters.source = btn.dataset.sourceId;
      sourceHost.querySelectorAll('.chip').forEach((el) =>
        el.classList.toggle('is-active', el.dataset.sourceId === filters.source));
      renderGrid();
    });
  }
  if (typeHost) {
    typeHost.innerHTML = SHOP_TYPES.map((t) =>
      `<button type="button" class="chip ${t.id === filters.type ? 'is-active' : ''}" data-type-id="${t.id}">
        <i class="bi ${escHtml(t.icon)}"></i> ${escHtml(t.label)}
      </button>`).join('');
    typeHost.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-type-id]');
      if (!btn) return;
      filters.type = btn.dataset.typeId;
      typeHost.querySelectorAll('.chip').forEach((el) =>
        el.classList.toggle('is-active', el.dataset.typeId === filters.type));
      renderGrid();
    });
  }
  if (sortSel) {
    sortSel.innerHTML = SHOP_SORT.map((s) =>
      `<option value="${s.id}">${escHtml(s.label)}</option>`).join('');
    sortSel.value = filters.sort;
    sortSel.addEventListener('change', () => { filters.sort = sortSel.value; renderGrid(); });
  }
  if (search) {
    search.addEventListener('input', () => {
      filters.search = search.value;
      renderGrid();
    });
  }

  // Click-through on grid + launch strip → open detail modal.
  const grid = document.getElementById('shopProductGrid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.add-btn');
      const card = e.target.closest('[data-product-id]');
      if (!card) return;
      const product = cache.products.find((p) => p.id === card.dataset.productId);
      if (!product) return;
      e.preventDefault();
      openProductModal(product);
      if (addBtn) e.stopPropagation();
    });
  }
  const strip = document.getElementById('shopLaunchStrip');
  if (strip) {
    strip.addEventListener('click', (e) => {
      const card = e.target.closest('[data-product-id]');
      if (!card) return;
      const product = cache.products.find((p) => p.id === card.dataset.productId);
      if (product) openProductModal(product);
    });
  }
}

// ---------------------------------------------------------------------
// Reload from server, then render
// ---------------------------------------------------------------------
export async function reloadShop() {
  try {
    const [products, batches] = await Promise.all([
      listProducts({ activeOnly: true }),
      listActiveBatches().catch(() => []),
    ]);
    cache.products = products;
    cache.batch = batches[0] || null;
    cache.loaded = true;
    renderBanner();
    renderLaunches();
    renderGrid();
  } catch (e) {
    console.error('[shop/products] reload failed:', e);
    cache.loaded = true;
    const grid = document.getElementById('shopProductGrid');
    if (grid) {
      grid.innerHTML = `<div class="text-danger small p-3">โหลดสินค้าล้มเหลว: ${escHtml(e.message || e)}</div>`;
    }
  }
}

// ---------------------------------------------------------------------
// Render: pickup banner
// ---------------------------------------------------------------------
function renderBanner() {
  const host = document.getElementById('shopPickupBanner');
  if (!host) return;
  const b = cache.batch;
  if (!b) { host.innerHTML = ''; return; }
  const dates = Array.isArray(b.dates) ? b.dates.join(' · ') : '';
  host.innerHTML = `
    <div class="pickup-banner">
      <div>
        <div class="pb-kicker"><i class="bi bi-megaphone-fill me-1"></i> ประกาศจาก SAMO Shop</div>
        <h3 class="pb-title">${escHtml(b.title)}</h3>
        <div class="pb-meta">
          <span><b>รับได้ที่:</b> ${escHtml(b.location)}</span>
          ${dates ? `<span>·</span><span><b>วันที่:</b> ${escHtml(dates)}</span>` : ''}
          ${b.hours ? `<span>·</span><span><b>เวลา:</b> ${escHtml(b.hours)}</span>` : ''}
        </div>
      </div>
      <button class="pb-cta" id="shopPickupBannerCta">
        <i class="bi bi-box-arrow-right me-1"></i> ดูคำสั่งซื้อของฉัน
      </button>
    </div>`;
  host.querySelector('#shopPickupBannerCta')?.addEventListener('click', () => onGoOrders());
}

// ---------------------------------------------------------------------
// Render: launch strip (latest is_new products)
// ---------------------------------------------------------------------
function renderLaunches() {
  const host = document.getElementById('shopLaunchStrip');
  if (!host) return;
  const list = cache.products.filter((p) => p.is_new).slice(0, 5);
  if (list.length === 0) { host.innerHTML = ''; return; }
  host.innerHTML = list.map((p) => `
    <div class="launch-card" data-product-id="${escHtml(p.id)}">
      <div class="launch-thumb" style="${launchThumbStyle(p)}"></div>
      <div class="flex-grow-1" style="min-width:0;">
        <div class="lc-name text-truncate">${escHtml(p.name)}<span class="lc-new">NEW</span></div>
        <div class="lc-date">${fmtDate(p.added_at)} · ฿${thb(p.price)}</div>
      </div>
    </div>`).join('');
}

function launchThumbStyle(p) {
  if (p.image_url) {
    return `background-image: url('${safeUrl(p.image_url)}'); background-size: cover; background-position: center;`;
  }
  const h = Number(p.hue) || 220;
  return `background: repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 4px, hsl(${h} 28% 90%) 4px 8px);`;
}

// ---------------------------------------------------------------------
// Render: filtered product grid
// ---------------------------------------------------------------------
function renderGrid() {
  const grid = document.getElementById('shopProductGrid');
  const empty = document.getElementById('shopProductEmpty');
  const count = document.getElementById('shopResultCount');
  if (!grid) return;

  let list = cache.products.slice();
  if (filters.source !== 'all') list = list.filter((p) => p.source === filters.source);
  if (filters.type   !== 'all') list = list.filter((p) => p.type === filters.type);
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    list = list.filter((p) =>
      (p.name || '').toLowerCase().includes(q) || (p.sub || '').toLowerCase().includes(q));
  }
  switch (filters.sort) {
    case 'price-asc':  list.sort((a, b) => a.price - b.price); break;
    case 'price-desc': list.sort((a, b) => b.price - a.price); break;
    case 'popular':    list.sort((a, b) => (b.popularity || 0) - (a.popularity || 0)); break;
    default:           list.sort((a, b) =>
      new Date(b.added_at || 0) - new Date(a.added_at || 0));
  }
  if (count) count.textContent = String(list.length);
  if (empty) empty.classList.toggle('d-none', list.length > 0);
  grid.innerHTML = list.map(productCardHtml).join('');
}

function productCardHtml(p) {
  const src = findSource(p.source);
  const sizes = Array.isArray(p.sizes) ? p.sizes : [];
  const colors = Array.isArray(p.colors) ? p.colors : [];
  return `
    <div class="product-card" data-product-id="${escHtml(p.id)}">
      <div class="product-thumb">
        ${p.image_url
          ? `<img class="product-thumb-img" src="${safeUrl(p.image_url)}" alt="${escHtml(p.name)}" loading="lazy" />`
          : `<div class="stripe-placeholder"><span>PRODUCT · ${escHtml(p.id)}</span></div>`}
        <div class="ribbons">
          ${p.is_new ? '<span class="ribbon-new">NEW</span>' : ''}
          ${p.is_presale ? '<span class="ribbon-presale">PRESALE</span>' : ''}
        </div>
      </div>
      <div class="product-body">
        <span class="product-source" data-src="${escHtml(p.source)}">
          <span class="src-dot"></span> ${escHtml(src?.label || p.source)}
        </span>
        <div class="product-name">${escHtml(p.name)}</div>
        <div class="product-meta">
          <span>${escHtml(p.sub || '')}</span>
          ${sizes.length > 1 ? `<span class="dot"></span><span>${sizes.length} ไซส์</span>` : ''}
          ${colors.length > 1 ? `<span class="dot"></span><span>${colors.length} สี</span>` : ''}
        </div>
        <div class="product-foot">
          <span class="product-price">
            <span class="baht">฿</span>${thb(p.price)}
          </span>
          <button type="button" class="add-btn" aria-label="Add to cart">
            <i class="bi bi-plus-lg"></i>
          </button>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// Product detail modal — Bootstrap modal in modal-shop-product.html
// ---------------------------------------------------------------------
const modalState = { product: null, size: 'F', color: null, fit: 'unisex', qty: 1 };

function openProductModal(product) {
  const sizes = Array.isArray(product.sizes) ? product.sizes : ['F'];
  const colors = Array.isArray(product.colors) ? product.colors : [];
  const fits = Array.isArray(product.fits) ? product.fits : ['unisex'];
  modalState.product = product;
  modalState.size = sizes[0] || 'F';
  modalState.color = colors[0]?.id || null;
  modalState.fit = fits[0] || 'unisex';
  modalState.qty = 1;

  // Header
  const header = document.getElementById('shopProductModalHeader');
  if (header) {
    const src = findSource(product.source);
    header.innerHTML = `
      <span class="product-source" data-src="${escHtml(product.source)}">
        <span class="src-dot"></span> ${escHtml(src?.label || product.source)}
      </span>
      <h5 class="modal-title font-prompt mt-1" id="shopProductModalTitle" style="font-weight:700;">
        ${escHtml(product.name)}
      </h5>`;
  }
  // Hero
  const hero = document.getElementById('shopProductModalHero');
  if (hero) {
    hero.innerHTML = '';
    hero.style.backgroundImage = '';
    if (product.image_url) {
      hero.style.backgroundImage = `url('${safeUrl(product.image_url)}')`;
    } else {
      const h = Number(product.hue) || 220;
      hero.style.background = `repeating-linear-gradient(135deg, hsl(${h} 30% 96%) 0 6px, hsl(${h} 28% 90%) 6px 12px)`;
    }
  }
  setText('shopProductModalSub',   product.sub || '');
  setText('shopProductModalPrice', thb(product.price));
  setText('shopProductModalDesc',  product.description || '');

  const presaleBox  = document.getElementById('shopProductModalPresale');
  const presaleNote = document.getElementById('shopProductModalPresaleNote');
  if (presaleBox && presaleNote) {
    presaleBox.classList.toggle('d-none', !product.is_presale);
    presaleNote.textContent = product.presale_note || '';
  }

  renderFitOptions(fits);
  renderSizeOptions(sizes);
  renderColorOptions(colors);
  renderQty();
  renderOOS();

  const inst = window.bootstrap?.Modal.getOrCreateInstance(
    document.getElementById('shopProductModal'),
    { backdrop: true },
  );
  inst?.show();

  document.getElementById('shopProductModalQtyMinus')?.replaceWith(rebuildBtn('shopProductModalQtyMinus', '−', () => {
    modalState.qty = Math.max(1, modalState.qty - 1); renderQty();
  }));
  document.getElementById('shopProductModalQtyPlus')?.replaceWith(rebuildBtn('shopProductModalQtyPlus', '+', () => {
    modalState.qty = Math.min(99, modalState.qty + 1); renderQty();
  }));

  const addBtn = document.getElementById('shopProductModalAdd');
  if (addBtn) {
    addBtn.onclick = () => {
      if (isOOS()) return;
      addItem({
        productId: product.id,
        size: modalState.size,
        color: modalState.color,
        fit: modalState.fit,
        qty: modalState.qty,
        price: Number(product.price) || 0,
      });
      inst?.hide();
      showShopToast(`เพิ่ม "${product.name}" ลงตะกร้าแล้ว`, 'success');
    };
  }
}

function renderFitOptions(fits) {
  const group = document.getElementById('shopProductModalFitGroup');
  const host  = document.getElementById('shopProductModalFitOptions');
  if (!group || !host) return;
  group.classList.toggle('d-none', fits.length <= 1);
  host.innerHTML = fits.map((f) =>
    `<button type="button" class="variant-btn ${modalState.fit === f ? 'is-selected' : ''}" data-fit="${escHtml(f)}">
       ${f === 'men' ? 'ชาย' : f === 'women' ? 'หญิง' : 'Unisex'}
     </button>`).join('');
  host.onclick = (e) => {
    const btn = e.target.closest('[data-fit]');
    if (!btn) return;
    modalState.fit = btn.dataset.fit;
    host.querySelectorAll('.variant-btn').forEach((el) =>
      el.classList.toggle('is-selected', el.dataset.fit === modalState.fit));
    renderOOS();
  };
}
function renderSizeOptions(sizes) {
  const group = document.getElementById('shopProductModalSizeGroup');
  const host  = document.getElementById('shopProductModalSizeOptions');
  if (!group || !host) return;
  group.classList.toggle('d-none', sizes.length <= 1);
  host.innerHTML = sizes.map((s) =>
    `<button type="button" class="variant-btn ${modalState.size === s ? 'is-selected' : ''}" data-size="${escHtml(s)}">
       ${escHtml(s)}
     </button>`).join('');
  host.onclick = (e) => {
    const btn = e.target.closest('[data-size]');
    if (!btn) return;
    modalState.size = btn.dataset.size;
    host.querySelectorAll('.variant-btn').forEach((el) =>
      el.classList.toggle('is-selected', el.dataset.size === modalState.size));
    renderOOS();
  };
}
function renderColorOptions(colors) {
  const group = document.getElementById('shopProductModalColorGroup');
  const host  = document.getElementById('shopProductModalColorOptions');
  const label = document.getElementById('shopProductModalColorLabel');
  if (!group || !host) return;
  group.classList.toggle('d-none', colors.length <= 1);
  host.innerHTML = colors.map((c) =>
    `<button type="button" class="variant-swatch ${modalState.color === c.id ? 'is-selected' : ''}"
             data-color="${escHtml(c.id)}" style="background: ${escHtml(c.hex || '#ccc')};"
             aria-label="${escHtml(c.label || c.id)}" title="${escHtml(c.label || c.id)}">
     </button>`).join('');
  if (label) {
    const found = colors.find((c) => c.id === modalState.color);
    label.textContent = found?.label || '';
  }
  host.onclick = (e) => {
    const btn = e.target.closest('[data-color]');
    if (!btn) return;
    modalState.color = btn.dataset.color;
    host.querySelectorAll('.variant-swatch').forEach((el) =>
      el.classList.toggle('is-selected', el.dataset.color === modalState.color));
    if (label) {
      const found = colors.find((c) => c.id === modalState.color);
      label.textContent = found?.label || '';
    }
    renderOOS();
  };
}
function renderQty() {
  const qty = document.getElementById('shopProductModalQty');
  if (qty) qty.value = String(modalState.qty);
  const addLabel = document.getElementById('shopProductModalAddLabel');
  const product = modalState.product;
  if (addLabel && product) {
    addLabel.textContent = `เพิ่มลงตะกร้า · ฿${thb((Number(product.price) || 0) * modalState.qty)}`;
  }
}
function renderOOS() {
  const box = document.getElementById('shopProductModalOOS');
  const addBtn = document.getElementById('shopProductModalAdd');
  const oos = isOOS();
  if (box) box.classList.toggle('d-none', !oos);
  if (addBtn) addBtn.disabled = oos;
}
function isOOS() {
  const p = modalState.product;
  if (!p) return false;
  const matrix = p.stock_matrix || {};
  const key = `${modalState.size}-${modalState.color}-${modalState.fit}`;
  return matrix[key] === 0;
}

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '';
}
function rebuildBtn(id, label, onclick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = id;
  btn.textContent = label;
  btn.onclick = onclick;
  return btn;
}

/**
 * Lightweight toast — Bootstrap toast container is already in index.html
 * for VS/PR forms; reuse it for the shop too. Falls back to a console log
 * if the host element isn't present (e.g. unit test).
 */
export function showShopToast(message, variant = 'success') {
  let host = document.getElementById('shopToastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'shopToastHost';
    host.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    host.style.zIndex = '1090';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast align-items-center text-bg-light border-0 show';
  el.setAttribute('role', 'status');
  el.style.borderLeft = `4px solid ${
    variant === 'success' ? 'var(--brand-accent)' :
    variant === 'warn'    ? 'var(--brand-orange)' :
    'var(--status-cancel, #91272b)'
  }`;
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body" style="font-size:.9rem">${escHtml(message)}</div>
      <button type="button" class="btn-close me-2 m-auto" aria-label="Close"></button>
    </div>`;
  host.appendChild(el);
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.btn-close').addEventListener('click', close);
  setTimeout(close, 3500);
}
