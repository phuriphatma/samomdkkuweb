// ==============================================
// SHOP PRODUCTS — Browse grid, filter bar, launch carousel, detail modal
//
// All user-text fields (name, sub, desc, color label) are escaped before
// going into innerHTML — same XSS-class rule as the PR / VS renderers
// (see .claude/rules/mistakes.md).
// ==============================================

import { escHtml, safeUrl } from '../utils.js';
import {
  SHOP_SOURCES, SHOP_TYPES, SHOP_SORT,
  findSource, thb, fmtDate, batchDateEntries,
  STOCK_STATUS_META, stockKey, totalStock,
} from './data.js';
import { listProducts, listActiveBatches, listShopBanners } from './api.js';
import { addItem } from './state.js';

let cache = { products: [], batches: [], loaded: false };

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

  // Click-through on grid + launch carousel → open detail modal.
  const grid = document.getElementById('shopProductGrid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const card = e.target.closest('[data-product-id]');
      if (!card) return;
      const product = cache.products.find((p) => p.id === card.dataset.productId);
      if (!product) return;
      e.preventDefault();
      openProductModal(product);
    });
  }
  const carousel = document.getElementById('shopLaunchCarousel');
  if (carousel) {
    carousel.addEventListener('click', (e) => {
      // Banner slide with link_url → open it (new tab if external).
      const banner = e.target.closest('[data-banner-link]');
      if (banner) {
        const href = banner.dataset.bannerLink;
        if (/^https?:\/\//i.test(href)) {
          window.open(href, '_blank', 'noopener');
        } else {
          location.href = href;
        }
        return;
      }
      // Product card → open detail modal.
      const card = e.target.closest('[data-product-id]');
      if (!card) return;
      const product = cache.products.find((p) => p.id === card.dataset.productId);
      if (product) openProductModal(product);
    });
  }
  wireCarouselArrows();
}

// ---------------------------------------------------------------------
// Reload from server, then render
// ---------------------------------------------------------------------
export async function reloadShop() {
  try {
    const [products, batches, banners] = await Promise.all([
      listProducts({ activeOnly: true }),
      listActiveBatches().catch(() => []),
      listShopBanners().catch(() => []),
    ]);
    cache.products = products;
    cache.batches = batches || [];
    cache.banners = banners || [];
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
// Render: pickup announcements (multiple cards)
// ---------------------------------------------------------------------
function renderBanner() {
  const host = document.getElementById('shopPickupBanner');
  if (!host) return;
  const list = cache.batches;
  if (!list.length) { host.innerHTML = ''; return; }
  host.innerHTML = `
    <div class="pickup-stack">
      ${list.map(pickupBannerCardHtml).join('')}
    </div>`;
  host.querySelectorAll('[data-pickup-go-orders]').forEach((btn) =>
    btn.addEventListener('click', () => onGoOrders()));
}

function pickupBannerCardHtml(b) {
  const entries = batchDateEntries(b);
  return `
    <div class="pickup-banner">
      <div>
        <div class="pb-kicker"><i class="bi bi-megaphone-fill me-1"></i> ประกาศจาก SAMO Shop</div>
        <h3 class="pb-title">${escHtml(b.title)}</h3>
        <div class="pb-meta">
          ${b.location ? `<span><b>รับได้ที่:</b> ${escHtml(b.location)}</span>` : ''}
        </div>
        ${entries.length ? `
          <div class="pb-dates">
            ${entries.map((e) => `
              <span class="pb-date">
                <i class="bi bi-calendar-event"></i> ${escHtml(e.date)}
                ${e.hours ? `<span class="pb-date-time"><i class="bi bi-clock"></i> ${escHtml(e.hours)}</span>` : ''}
              </span>`).join('')}
          </div>` : ''}
        ${b.note ? `<div class="pb-note small mt-2">${escHtml(b.note)}</div>` : ''}
      </div>
      <button class="pb-cta" data-pickup-go-orders>
        <i class="bi bi-box-arrow-right me-1"></i> ดูคำสั่งซื้อของฉัน
      </button>
    </div>`;
}

// ---------------------------------------------------------------------
// Render: launch carousel (latest is_new products, scrollable, with arrows)
// ---------------------------------------------------------------------
function renderLaunches() {
  const host = document.getElementById('shopLaunchCarousel');
  const dots = document.getElementById('shopLaunchDots');
  if (!host) return;

  // Priority 1: admin-curated banners. Priority 2 (fallback): the
  // newest `is_new` products. If we have no banners AND no flagged
  // products, fall back to the most-recently-added products so the
  // hero is never empty when there's stock to show.
  const banners = (cache.banners || []).slice(0, 10);
  let slides;
  if (banners.length > 0) {
    slides = banners.map(bannerSlideHtml);
  } else {
    const flagged = cache.products.filter((p) => p.is_new).slice(0, 10);
    const fallback = flagged.length > 0
      ? flagged
      : cache.products.slice().sort((a, b) => new Date(b.added_at || 0) - new Date(a.added_at || 0)).slice(0, 5);
    slides = fallback.map(launchCardHtml);
  }

  if (slides.length === 0) {
    host.innerHTML = '';
    if (dots) dots.innerHTML = '';
    setCarouselArrowsVisible(false);
    return;
  }
  host.innerHTML = slides.join('');
  if (dots) {
    dots.innerHTML = slides.map((_, i) =>
      `<button type="button" class="launch-dot ${i === 0 ? 'is-active' : ''}" data-dot-i="${i}" aria-label="สไลด์ที่ ${i + 1}"></button>`
    ).join('');
  }
  setCarouselArrowsVisible(slides.length > 1);
  updateCarouselArrowsState();
  updateActiveDot();
}

function bannerSlideHtml(b) {
  const link = b.link_url ? `data-banner-link="${escHtml(b.link_url)}"` : '';
  return `
    <div class="launch-big" ${link}>
      <div class="launch-big-thumb">
        ${b.image_url
          ? `<img src="${safeUrl(b.image_url)}" alt="${escHtml(b.caption || '')}" loading="lazy" />`
          : '<div class="stripe-placeholder"></div>'}
      </div>
      ${b.caption ? `
        <div class="launch-big-body">
          <div class="lb-name">${escHtml(b.caption)}</div>
        </div>` : ''}
    </div>`;
}

function launchCardHtml(p) {
  const src = findSource(p.source);
  const oos = p.stock_status === 'sold_out' || p.stock_status === 'production_closed';
  return `
    <div class="launch-big ${oos ? 'is-oos' : ''}" data-product-id="${escHtml(p.id)}">
      <div class="launch-big-thumb">
        ${p.image_url
          ? `<img src="${safeUrl(p.image_url)}" alt="${escHtml(p.name)}" loading="lazy" />`
          : `<div class="stripe-placeholder" style="background-image: repeating-linear-gradient(135deg, hsl(${Number(p.hue) || 220} 30% 96%) 0 6px, hsl(${Number(p.hue) || 220} 28% 90%) 6px 12px);"></div>`}
        <div class="ribbons">
          <span class="ribbon-new">NEW</span>
          ${p.is_presale ? '<span class="ribbon-preorder">PREORDER</span>' : ''}
          ${p.stock_status && p.stock_status !== 'available' ? `<span class="ribbon-oos">${escHtml(STOCK_STATUS_META[p.stock_status]?.ribbon || '')}</span>` : ''}
        </div>
      </div>
      <div class="launch-big-body">
        <span class="product-source" data-src="${escHtml(p.source)}">
          <span class="src-dot"></span> ${escHtml(src?.label || p.source)}
        </span>
        <div class="lb-name">${escHtml(p.name)}</div>
        <div class="lb-meta">${escHtml(p.sub || '')}</div>
        <div class="lb-foot">
          <span class="lb-price"><span class="baht">฿</span>${thb(p.price)}</span>
          <span class="lb-date small text-muted">${fmtDate(p.added_at)}</span>
        </div>
      </div>
    </div>`;
}

function wireCarouselArrows() {
  const prev = document.getElementById('shopLaunchPrev');
  const next = document.getElementById('shopLaunchNext');
  const car  = document.getElementById('shopLaunchCarousel');
  const dots = document.getElementById('shopLaunchDots');
  if (!prev || !next || !car) return;
  // Hero banner: one slide per view. Scroll by the carousel's exact
  // visible width so the snap lands cleanly on the next/prev card.
  const step = () => car.clientWidth || 1;
  prev.addEventListener('click', () => car.scrollBy({ left: -step(), behavior: 'smooth' }));
  next.addEventListener('click', () => car.scrollBy({ left:  step(), behavior: 'smooth' }));
  car.addEventListener('scroll', () => {
    updateCarouselArrowsState();
    updateActiveDot();
  }, { passive: true });
  window.addEventListener('resize', () => {
    updateCarouselArrowsState();
    updateActiveDot();
  }, { passive: true });
  // Dot click → scroll to that slide.
  if (dots) {
    dots.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dot-i]');
      if (!btn) return;
      const i = Number(btn.dataset.dotI) || 0;
      car.scrollTo({ left: i * step(), behavior: 'smooth' });
    });
  }
}

function updateActiveDot() {
  const car  = document.getElementById('shopLaunchCarousel');
  const dots = document.getElementById('shopLaunchDots');
  if (!car || !dots) return;
  const w = car.clientWidth || 1;
  const active = Math.round(car.scrollLeft / w);
  dots.querySelectorAll('.launch-dot').forEach((d, i) =>
    d.classList.toggle('is-active', i === active));
}

function setCarouselArrowsVisible(show) {
  document.getElementById('shopLaunchPrev')?.classList.toggle('d-none', !show);
  document.getElementById('shopLaunchNext')?.classList.toggle('d-none', !show);
}

function updateCarouselArrowsState() {
  const car  = document.getElementById('shopLaunchCarousel');
  const prev = document.getElementById('shopLaunchPrev');
  const next = document.getElementById('shopLaunchNext');
  if (!car || !prev || !next) return;
  prev.disabled = car.scrollLeft <= 2;
  next.disabled = car.scrollLeft + car.clientWidth >= car.scrollWidth - 2;
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
  const oos = p.stock_status === 'sold_out' || p.stock_status === 'production_closed';
  // Stock-left summary for the card. We only surface a hint when admin
  // filled in the matrix (totalStock returns null when nothing set) and
  // the product isn't already in a global OOS status (that has its own
  // ribbon). Highlight low-stock to nudge urgency.
  const total = oos ? null : totalStock(p.stock_matrix);
  const stockHint = total === null ? ''
    : total === 0 ? '<span class="product-stock-hint is-out">หมดแล้ว</span>'
    : total <= 5 ? `<span class="product-stock-hint is-low">เหลือ ${total} ชิ้น</span>`
    : `<span class="product-stock-hint">เหลือ ${total} ชิ้น</span>`;
  return `
    <div class="product-card ${oos ? 'is-oos' : ''}" data-product-id="${escHtml(p.id)}">
      <div class="product-thumb">
        ${p.image_url
          ? `<img class="product-thumb-img" src="${safeUrl(p.image_url)}" alt="${escHtml(p.name)}" loading="lazy" />`
          : `<div class="stripe-placeholder"><span>PRODUCT · ${escHtml(p.id)}</span></div>`}
        <div class="ribbons">
          ${p.is_new ? '<span class="ribbon-new">NEW</span>' : ''}
          ${p.is_presale ? '<span class="ribbon-preorder">PREORDER</span>' : ''}
          ${oos ? `<span class="ribbon-oos">${escHtml(STOCK_STATUS_META[p.stock_status]?.ribbon || '')}</span>` : ''}
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
          ${stockHint}
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// Product detail modal — Bootstrap modal in modal-shop-product.html
// ---------------------------------------------------------------------
const modalState = { product: null, size: 'F', color: null, qty: 1 };

function openProductModal(product) {
  const sizes = Array.isArray(product.sizes) ? product.sizes : ['F'];
  const colors = Array.isArray(product.colors) ? product.colors : [];
  modalState.product = product;
  // Default to the first IN-STOCK combo so the user doesn't open onto
  // a greyed-out variant they then have to manually switch off. Only
  // kicks in when the matrix is configured; otherwise first-of-array
  // is fine.
  const matrix = product.stock_matrix || {};
  const configured = Object.values(matrix).some((v) => typeof v === 'number');
  let pickedSize = sizes[0] || 'F';
  let pickedColor = colors[0]?.id || null;
  if (configured) {
    outer: for (const s of sizes) {
      for (const c of (colors.length ? colors : [{ id: 'default' }])) {
        const v = matrix[stockKey(s, c.id)];
        if (typeof v === 'number' && v > 0) { pickedSize = s; pickedColor = c.id; break outer; }
      }
    }
  }
  modalState.size = pickedSize;
  modalState.color = pickedColor;
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

  // Preorder (was "Presale") note
  const preorderBox  = document.getElementById('shopProductModalPreorder');
  const preorderNote = document.getElementById('shopProductModalPreorderNote');
  if (preorderBox && preorderNote) {
    preorderBox.classList.toggle('d-none', !product.is_presale);
    preorderNote.textContent = product.presale_note || '';
  }

  // Stock status banner (sold out / production closed)
  const statusBox = document.getElementById('shopProductModalStockStatus');
  if (statusBox) {
    const blocked = product.stock_status === 'sold_out' || product.stock_status === 'production_closed';
    statusBox.classList.toggle('d-none', !blocked);
    if (blocked) {
      const meta = STOCK_STATUS_META[product.stock_status];
      statusBox.innerHTML = `<i class="bi bi-exclamation-octagon me-1"></i> ${escHtml(meta?.label || '')}`;
    }
  }

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
      if (isBlockedForPurchase()) return;
      addItem({
        productId: product.id,
        size: modalState.size,
        color: modalState.color,
        fit: 'unisex',
        qty: modalState.qty,
        price: Number(product.price) || 0,
      });
      inst?.hide();
      showShopToast(`เพิ่ม "${product.name}" ลงตะกร้าแล้ว`, 'success');
    };
  }
}

/** Is this size entirely out across every color? Used to grey out the
 *  size button. "Entirely" = matrix configured AND every color cell for
 *  this size is either explicitly 0 or undefined. */
function isSizeAllOOS(size) {
  const p = modalState.product;
  if (!p || !matrixIsConfigured(p)) return false;
  const matrix = p.stock_matrix || {};
  const colors = Array.isArray(p.colors) && p.colors.length ? p.colors : [{ id: 'default' }];
  return colors.every((c) => {
    const v = matrix[stockKey(size, c.id)];
    return typeof v !== 'number' || v <= 0;
  });
}
function isColorAllOOS(color) {
  const p = modalState.product;
  if (!p || !matrixIsConfigured(p)) return false;
  const matrix = p.stock_matrix || {};
  const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes : ['F'];
  return sizes.every((s) => {
    const v = matrix[stockKey(s, color)];
    return typeof v !== 'number' || v <= 0;
  });
}

function renderSizeOptions(sizes) {
  const group = document.getElementById('shopProductModalSizeGroup');
  const host  = document.getElementById('shopProductModalSizeOptions');
  if (!group || !host) return;
  group.classList.toggle('d-none', sizes.length <= 1);
  host.innerHTML = sizes.map((s) => {
    const oos = isSizeAllOOS(s);
    return `<button type="button"
             class="variant-btn ${modalState.size === s ? 'is-selected' : ''} ${oos ? 'is-oos' : ''}"
             ${oos ? 'disabled' : ''} data-size="${escHtml(s)}"
             title="${oos ? 'หมดทุกสี' : escHtml(s)}">
       ${escHtml(s)}${oos ? ' <span class="small text-muted">(หมด)</span>' : ''}
     </button>`;
  }).join('');
  host.onclick = (e) => {
    const btn = e.target.closest('[data-size]:not([disabled])');
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
  host.innerHTML = colors.map((c) => {
    const oos = isColorAllOOS(c.id);
    return `<button type="button"
             class="variant-swatch ${modalState.color === c.id ? 'is-selected' : ''} ${oos ? 'is-oos' : ''}"
             ${oos ? 'disabled' : ''}
             data-color="${escHtml(c.id)}" style="background: ${escHtml(c.hex || '#ccc')};"
             aria-label="${escHtml(c.label || c.id)}${oos ? ' (หมด)' : ''}"
             title="${escHtml(c.label || c.id)}${oos ? ' — หมด' : ''}">
     </button>`;
  }).join('');
  if (label) {
    const found = colors.find((c) => c.id === modalState.color);
    label.textContent = found?.label || '';
  }
  host.onclick = (e) => {
    const btn = e.target.closest('[data-color]:not([disabled])');
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
  const variantOOS = isVariantOOS();
  const blocked = isBlockedForPurchase();
  if (box) box.classList.toggle('d-none', !variantOOS || blocked);
  if (addBtn) addBtn.disabled = blocked || variantOOS;
  renderStockLeftHint();
}

/** Render a "เหลือ N ชิ้น" badge for the currently selected variant
 *  on the product modal. Hidden when the admin hasn't filled in the
 *  matrix value for this cell (undefined → display nothing). Stays
 *  hidden too when the product is globally blocked (sold_out / closed)
 *  because the OOS pill already covers that case. */
function renderStockLeftHint() {
  const host = document.getElementById('shopProductModalStockLeft');
  if (!host) return;
  const p = modalState.product;
  if (!p || isBlockedForPurchase()) { host.classList.add('d-none'); host.textContent = ''; return; }
  const matrix = p.stock_matrix || {};
  const key = stockKey(modalState.size, modalState.color);
  const left = matrix[key];
  if (typeof left !== 'number') { host.classList.add('d-none'); host.textContent = ''; return; }
  host.classList.remove('d-none');
  if (left === 0) {
    host.textContent = 'หมดสต็อกแล้ว';
    host.className = 'small fw-semibold text-danger d-block mt-1';
  } else if (left <= 5) {
    host.textContent = `เหลือ ${left} ชิ้น`;
    host.className = 'small fw-semibold text-warning d-block mt-1';
  } else {
    host.textContent = `เหลือ ${left} ชิ้น`;
    host.className = 'small text-muted d-block mt-1';
  }
}
/** Has the admin set ANY value on this product's stock matrix?
 *  If yes, we treat undefined-key as "intentionally not stocked" → OOS.
 *  If no, the matrix is untracked and we fall back to "purchase allowed"
 *  (the global stock_status / production_status pills handle the broader
 *  block). */
function matrixIsConfigured(p) {
  const m = p?.stock_matrix || {};
  for (const v of Object.values(m)) {
    if (typeof v === 'number' && Number.isFinite(v)) return true;
  }
  return false;
}

function isVariantOOS() {
  const p = modalState.product;
  if (!p) return false;
  const matrix = p.stock_matrix || {};
  const key = stockKey(modalState.size, modalState.color);
  const v = matrix[key];
  if (typeof v === 'number') return v <= 0;
  // Key missing — OOS only when the matrix is configured. An empty
  // matrix means "not tracked" and we don't block.
  return matrixIsConfigured(p);
}
function isBlockedForPurchase() {
  const p = modalState.product;
  if (!p) return true;
  return p.stock_status === 'sold_out' || p.stock_status === 'production_closed';
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
