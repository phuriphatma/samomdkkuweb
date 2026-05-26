// ==============================================
// SHOP STATE — Cart store, persisted to localStorage
//
// Each cart line: { productId, size, color, fit, qty, price }.
// Subscribers fire on every mutation so the FAB count, cart drawer, and
// checkout summary all stay in sync without a framework.
// ==============================================

const STORAGE_KEY = 'samoshop.cart.v1';

let cart = load();
const subscribers = new Set();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); }
  catch (e) { console.warn('[shop/state] persist failed:', e); }
}

function notify() {
  for (const cb of subscribers) {
    try { cb(cart); } catch (e) { console.error('[shop/state] subscriber error', e); }
  }
}

export function getCart() { return cart.slice(); }

export function cartCount() {
  return cart.reduce((s, it) => s + (Number(it.qty) || 0), 0);
}

export function cartSubtotal() {
  return cart.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
}

/**
 * Add an item; if the same product/size/color/fit is already in the cart,
 * bump qty instead of duplicating the line.
 */
export function addItem(item) {
  const i = cart.findIndex(
    (it) => it.productId === item.productId
        && it.size === item.size
        && it.color === item.color
        && it.fit === item.fit,
  );
  if (i >= 0) {
    cart[i] = { ...cart[i], qty: Math.min(99, cart[i].qty + (item.qty || 1)) };
  } else {
    cart.push({ ...item, qty: Math.max(1, Math.min(99, item.qty || 1)) });
  }
  persist();
  notify();
}

export function updateQty(index, qty) {
  if (index < 0 || index >= cart.length) return;
  const next = Math.max(1, Math.min(99, Number(qty) || 1));
  cart[index] = { ...cart[index], qty: next };
  persist();
  notify();
}

export function removeItem(index) {
  if (index < 0 || index >= cart.length) return;
  cart.splice(index, 1);
  persist();
  notify();
}

export function clearCart() {
  cart = [];
  persist();
  notify();
}

/**
 * Subscribe to cart changes. Callback fires once immediately with current
 * state, then on every mutation. Returns an unsubscribe fn.
 */
export function onCartChange(cb) {
  subscribers.add(cb);
  try { cb(cart); } catch (e) { console.error('[shop/state] subscriber error', e); }
  return () => subscribers.delete(cb);
}
