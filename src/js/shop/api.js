// ==============================================
// SHOP API — Supabase CRUD via dbRest()
//
// We bypass supabase-js for the same reason PR / VS modules do: the
// client occasionally enters a state where the next call hangs, and
// silent-success on RLS-blocked writes is documented elsewhere (see
// .claude/rules/mistakes.md). Every write here uses
// `prefer: 'return=representation'` and checks `data.length > 0` so an
// RLS denial surfaces as an error instead of looking like success.
// ==============================================

import { dbRest } from '../db.js';
import { genOrderId } from './data.js';
import { deleteShopFile } from './uploads.js';

// ---- Products ----------------------------------------------------------

export async function listProducts({ activeOnly = true } = {}) {
  const filter = activeOnly ? '&is_active=eq.true' : '';
  const { data, error } = await dbRest(
    `/shop_products?select=*${filter}&order=added_at.desc`,
  );
  if (error) throw new Error(error.message || 'โหลดสินค้าไม่สำเร็จ');
  return data || [];
}

/** Reserved-stock map across ALL products at once — one RPC call instead
 *  of one per product. Shape:
 *    { "p-shirt-id": { "S-red": 3, "M-blue": 1 }, ... }
 *  Powers the buyer-side "available = max(0, stock - reserved)" view.
 *  Falls back to {} on any error (e.g. migration 0030 not applied) so
 *  the UI gracefully degrades to the legacy raw-stock display. */
export async function fetchReservedMatrixAll() {
  const { data, error } = await dbRest('/rpc/shop_reserved_matrix_all', {
    method: 'POST',
    body: {},
  });
  if (error) {
    if (error.status === 404 || /shop_reserved_matrix_all/i.test(error.message || '')) {
      if (!window.__samoWarnedReservedRpc) {
        window.__samoWarnedReservedRpc = true;
        console.warn('[shop] shop_reserved_matrix_all RPC missing — apply migration 0030 for reservation-aware stock display.');
      }
      return {};
    }
    console.warn('[shop] reserved matrix fetch failed:', error.message);
    return {};
  }
  return data && typeof data === 'object' ? data : {};
}

/** Atomic order creation — locks product rows, validates available stock
 *  under the lock, then inserts header + items in one transaction. The
 *  legacy 2-step createOrder() below is kept as a fallback for envs
 *  that haven't applied migration 0030. Returns the new order row
 *  (re-read after insert so callers get the same shape as before). */
export async function placeShopOrder(payload) {
  const items = (payload.items || []).map((it) => ({
    product_id:  it.productId,
    size:        it.size || 'F',
    color:       it.color || 'default',
    fit:         it.fit || 'unisex',
    qty:         Number(it.qty) || 1,
    unit_price:  Number(it.price) || 0,
  }));
  const { data, error } = await dbRest('/rpc/place_shop_order', {
    method: 'POST',
    body: {
      p_buyer_id:         payload.buyerId,
      p_buyer_label:      payload.buyerLabel || null,
      p_buyer_name:       payload.buyerName || null,
      p_buyer_email:      payload.buyerEmail || null,
      p_buyer_note:       payload.buyerNote || null,
      p_pickup_location:  payload.pickupLocation || null,
      p_slip_url:         payload.slipUrl || null,
      p_slip_uploaded_at: payload.slipUploadedAt || null,
      p_items:            items,
      p_fee:              Number(payload.fee) || 0,
    },
  });
  if (error) {
    const msg = error.message || '';
    // Pre-0030 / migration not applied → fall back to the legacy
    // direct-insert path so buyers can still check out (no atomic
    // stock check, but the old behaviour they had yesterday).
    if (error.status === 404 || /place_shop_order/i.test(msg)) {
      if (!window.__samoWarnedPlaceOrderRpc) {
        window.__samoWarnedPlaceOrderRpc = true;
        console.warn('[shop] place_shop_order RPC missing — apply migration 0030 for atomic stock checks. Using legacy direct-insert.');
      }
      return createOrder(payload);
    }
    if (/OUT_OF_STOCK/.test(msg)) {
      throw new Error('สินค้าหมดสต็อกแล้ว กรุณารีเฟรชหน้าและลองอีกครั้ง');
    }
    throw new Error(msg || 'สั่งซื้อไม่สำเร็จ');
  }
  // RPC returns just the new id (text). Re-read the full row so callers
  // get the same shape as createOrder.
  const orderId = typeof data === 'string' ? data : (Array.isArray(data) ? data[0] : data);
  if (!orderId) throw new Error('สั่งซื้อไม่สำเร็จ (ไม่ได้รับรหัสคำสั่งซื้อ)');
  const idEsc = encodeURIComponent(orderId);
  const { data: rows } = await dbRest(`/shop_orders?id=eq.${idEsc}&select=*`);
  return (rows && rows[0]) || { id: orderId };
}

export async function upsertProduct(row) {
  if (!row || !row.id) throw new Error('product.id required');
  // Upsert with on_conflict so the same call works for create and update.
  const send = async (body) => dbRest(
    `/shop_products?on_conflict=id`,
    { method: 'POST', body, prefer: 'return=representation,resolution=merge-duplicates' },
  );
  let { data, error } = await send(row);
  // Pre-0029 fallback: preorder_price column not deployed yet. Strip
  // and retry so admin can still save the rest of the form. One-time
  // console warning so the missing migration is visible without
  // spamming on every save.
  if (error && error.status === 400 && /preorder_price/i.test(error.message || '')) {
    if (!window.__samoWarnedPreorderPriceCol) {
      window.__samoWarnedPreorderPriceCol = true;
      console.warn('[shop] preorder_price column missing — apply migration 0029_shop_preorder_price.sql to enable separate preorder pricing.');
    }
    const { preorder_price: _omit, ...rest } = row;
    ({ data, error } = await send(rest));
  }
  if (error) throw new Error(error.message || 'บันทึกสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกสินค้าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

/** Set a product's production status (pending / produced / announced)
 *  and cascade to every eligible happy-path order. Returns the RPC's
 *  summary row { updated_product, moved_to_produce, moved_to_ready }. */
export async function applyProductProductionStatus(productId, status) {
  const { data, error } = await dbRest('/rpc/apply_product_production_status', {
    method: 'POST',
    body: { p_product_id: productId, p_status: status },
  });
  if (error) {
    // Pre-0024 fallback: column / RPC missing → flip the field only,
    // skip the cascade (so admin can at least record intent until they
    // apply the migration).
    if (error.status === 404 || /apply_product_production_status/i.test(error.message || '')) {
      if (!window.__samoWarnedProdStatusRpc) {
        window.__samoWarnedProdStatusRpc = true;
        console.warn('[shop] apply_product_production_status RPC missing — apply migration 0024.');
      }
      throw new Error('ยังไม่ได้ติดตั้ง migration 0024 — กรุณาเรียก admin');
    }
    throw new Error(error.message || 'อัปเดตสถานะผลิตไม่สำเร็จ');
  }
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return row || { updated_product: true, moved_to_produce: 0, moved_to_ready: 0 };
}

export async function deleteProduct(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_products?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบสินค้าไม่สำเร็จ (RLS หรือไม่มีแถวที่ตรง id)');
  }
  return true;
}

// ---- Orders ------------------------------------------------------------

const ORDER_FIELDS = '*,items:shop_order_items(*)';

export async function listMyOrders(buyerId) {
  if (!buyerId) return [];
  const idEsc = encodeURIComponent(buyerId);
  const { data, error } = await dbRest(
    `/shop_orders?select=${ORDER_FIELDS}&buyer_id=eq.${idEsc}&order=placed_at.desc`,
  );
  if (error) throw new Error(error.message || 'โหลดคำสั่งซื้อไม่สำเร็จ');
  return data || [];
}

export async function listAllOrders() {
  const { data, error } = await dbRest(
    `/shop_orders?select=${ORDER_FIELDS}&order=placed_at.desc`,
  );
  if (error) throw new Error(error.message || 'โหลดคำสั่งซื้อไม่สำเร็จ');
  return data || [];
}

export async function getOrder(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_orders?select=${ORDER_FIELDS}&id=eq.${idEsc}`,
  );
  if (error) throw new Error(error.message || 'โหลดคำสั่งซื้อไม่สำเร็จ');
  return (data && data[0]) || null;
}

/**
 * Create a new order header + items in two REST calls. On insert collision
 * (id already exists, ~1/100k) we retry with a fresh id once.
 *
 * @param {{
 *   buyerId: string, buyerLabel: string,
 *   items: Array<{productId,size,color,fit,qty,price}>,
 *   subtotal: number, fee?: number,
 *   slipUrl: string, slipUploadedAt: string,
 *   pickupLocation: string, buyerNote: string,
 * }} payload
 */
export async function createOrder(payload) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Order id prefix = first cart item's product.code (set by admin
    // in the product editor). Falls back to "SH" inside genOrderId
    // when nothing usable is supplied.
    const id = genOrderId(payload.code);
    const now = new Date().toISOString();
    const subtotal = Number(payload.subtotal) || 0;
    const fee = Number(payload.fee) || 0;
    const orderRow = {
      id,
      buyer_id: payload.buyerId,
      buyer_label: payload.buyerLabel || null,
      // buyer_name / buyer_email arrived in migration 0026. If the
      // migration isn't applied yet PostgREST errors PGRST204; the
      // retry below strips these and re-sends.
      ...(payload.buyerName  ? { buyer_name:  payload.buyerName  } : {}),
      ...(payload.buyerEmail ? { buyer_email: payload.buyerEmail } : {}),
      status: payload.slipUrl ? 'review' : 'pending',
      subtotal,
      fee,
      total: subtotal + fee,
      slip_url: payload.slipUrl || null,
      slip_uploaded_at: payload.slipUploadedAt || null,
      pickup_location: payload.pickupLocation || null,
      buyer_note: payload.buyerNote || null,
      timeline: [
        { stage: 'pending', at: now, label: 'รอชำระเงิน' },
        ...(payload.slipUrl ? [{ stage: 'review', at: now, label: 'ส่งสลิปแล้ว — รอตรวจ' }] : []),
      ],
      placed_at: now,
    };
    let { data: orderData, error: orderErr } = await dbRest(
      '/shop_orders',
      { method: 'POST', body: orderRow, prefer: 'return=representation' },
    );
    if (orderErr) {
      const msg = (orderErr.message || '').toLowerCase();
      // Migration 0026 not applied → buyer_name / buyer_email missing.
      // Drop them and retry once so the order can still be placed.
      if (/buyer_(name|email)/.test(msg) || /pgrst204/.test(msg)) {
        if (!window.__samoWarnedBuyerContact) {
          window.__samoWarnedBuyerContact = true;
          console.warn('[shop] buyer_name/buyer_email missing — apply migration 0026 to persist checkout contact fields.');
        }
        const { buyer_name, buyer_email, ...slim } = orderRow;
        ({ data: orderData, error: orderErr } = await dbRest(
          '/shop_orders',
          { method: 'POST', body: slim, prefer: 'return=representation' },
        ));
      }
    }
    if (orderErr) {
      // Unique violation? retry with a new id.
      const msg = (orderErr.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('unique')) { lastErr = orderErr; continue; }
      throw new Error(orderErr.message || 'สร้างคำสั่งซื้อไม่สำเร็จ');
    }
    if (!Array.isArray(orderData) || orderData.length === 0) {
      throw new Error('สร้างคำสั่งซื้อไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
    }

    // Items
    const itemRows = (payload.items || []).map((it) => ({
      order_id: id,
      product_id: it.productId,
      size: it.size || 'F',
      color: it.color || null,
      fit: it.fit || 'unisex',
      qty: Number(it.qty) || 1,
      unit_price: Number(it.price) || 0,
    }));
    if (itemRows.length) {
      const { data: itemData, error: itemErr } = await dbRest(
        '/shop_order_items',
        { method: 'POST', body: itemRows, prefer: 'return=representation' },
      );
      if (itemErr) {
        // Roll back the order header so we don't leave an orphan.
        await dbRest(`/shop_orders?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
        throw new Error(itemErr.message || 'บันทึกรายการสินค้าไม่สำเร็จ');
      }
      if (!Array.isArray(itemData) || itemData.length !== itemRows.length) {
        await dbRest(`/shop_orders?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
        throw new Error('บันทึกรายการสินค้าไม่สำเร็จ');
      }
    }
    return orderData[0];
  }
  throw new Error(lastErr?.message || 'สร้างคำสั่งซื้อไม่สำเร็จ (เลขซ้ำ)');
}

/**
 * Update an order's status (and append a timeline entry). Admin-only by RLS.
 */
export async function updateOrderStatus(id, nextStatus, extra = {}) {
  const current = await getOrder(id);
  if (!current) throw new Error('ไม่พบคำสั่งซื้อ');
  const now = new Date().toISOString();
  const timeline = Array.isArray(current.timeline) ? current.timeline.slice() : [];
  timeline.push({
    stage: nextStatus,
    at: now,
    label: extra.label || nextStatus,
    by: extra.by || 'admin',
  });
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_orders?id=eq.${idEsc}`,
    {
      method: 'PATCH',
      body: {
        status: nextStatus,
        timeline,
        ...(extra.pickupBatchId !== undefined ? { pickup_batch_id: extra.pickupBatchId } : {}),
        ...(extra.adminNote !== undefined ? { admin_note: extra.adminNote } : {}),
        ...(extra.cancelReason !== undefined ? { cancel_reason: extra.cancelReason } : {}),
      },
      prefer: 'return=representation',
    },
  );
  if (error) throw new Error(error.message || 'อัปเดตสถานะไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('อัปเดตสถานะไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

/** Admin-only: hard-delete an order, and trash the attached slip image
 *  from Drive in the same flow. RLS policy `shop_orders_delete_admin`
 *  from 0003 gates the row delete to shop admins.
 *
 *  Order of operations:
 *    1. Fetch the order to capture slip_url (we lose it after delete).
 *    2. DELETE the row (the authoritative state change).
 *    3. Trash the Drive file via the GAS proxy. Best-effort — a Drive
 *       blip here MUST NOT roll back the order delete, because the row
 *       is already gone and re-creating it is hard. The slip file would
 *       just orphan until manual cleanup.
 *  Drive uses "trash" (30-day undo) instead of purge — easier to recover
 *  if an admin deletes the wrong order. */
export async function deleteOrder(id) {
  const idEsc = encodeURIComponent(id);
  const existing = await getOrder(id);
  const slipUrl = existing?.slip_url || null;
  const { data, error } = await dbRest(
    `/shop_orders?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบคำสั่งซื้อไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบไม่สำเร็จ — ไม่พบคำสั่งซื้อหรือคุณไม่มีสิทธิ์ลบ');
  }
  // Fire-and-forget slip trash. Caller doesn't await it; we still log
  // a warning if it fails so admin can spot orphans in Drive later.
  if (slipUrl) {
    deleteShopFile(slipUrl).then((ok) => {
      if (!ok) console.warn('[shop/api] order', id, 'deleted but slip not trashed:', slipUrl);
    });
  }
  return true;
}

/** Buyer-facing: upload or replace the slip on a pending/review/
 *  slip_mismatch order. Sends the order back to 'review' so it
 *  reappears in the admin verify queue. If there was an old slip,
 *  trash it from Drive afterwards (best-effort — order update is the
 *  source of truth). */
export async function setOrderSlip(id, slipUrl) {
  const idEsc = encodeURIComponent(id);
  const now = new Date().toISOString();
  const current = await getOrder(id);
  if (!current) throw new Error('ไม่พบคำสั่งซื้อ');
  const oldSlipUrl = current.slip_url || null;
  const timeline = Array.isArray(current.timeline) ? current.timeline.slice() : [];
  timeline.push({ stage: 'review', at: now, label: 'ส่งสลิปแล้ว — รอตรวจ' });
  const { data, error } = await dbRest(
    `/shop_orders?id=eq.${idEsc}`,
    {
      method: 'PATCH',
      body: { slip_url: slipUrl, slip_uploaded_at: now, status: 'review', timeline },
      prefer: 'return=representation',
    },
  );
  if (error) throw new Error(error.message || 'ส่งสลิปไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ส่งสลิปไม่สำเร็จ (RLS หรือสถานะไม่ใช่ pending/review/slip_mismatch)');
  }
  // Trash the prior slip from Drive so replaced files don't pile up.
  // Fire-and-forget — the new slip is already persisted; orphaning the
  // old one is a cleanup nuisance at worst, never a correctness issue.
  if (oldSlipUrl && oldSlipUrl !== slipUrl) {
    deleteShopFile(oldSlipUrl).then((ok) => {
      if (!ok) console.warn('[shop/api] order', id, 'slip replaced but old not trashed:', oldSlipUrl);
    });
  }
  return data[0];
}

// ---- Pickup batches ----------------------------------------------------

export async function listActiveBatches() {
  const { data, error } = await dbRest(
    '/shop_pickup_batches?select=*&is_active=eq.true&order=created_at.desc',
  );
  if (error) throw new Error(error.message || 'โหลดประกาศไม่สำเร็จ');
  return data || [];
}

export async function listAllBatches() {
  const { data, error } = await dbRest(
    '/shop_pickup_batches?select=*&order=created_at.desc',
  );
  if (error) throw new Error(error.message || 'โหลดประกาศไม่สำเร็จ');
  return data || [];
}

export async function upsertBatch(row) {
  const isUpdate = row.id != null;
  const body = { ...row };
  const path = isUpdate
    ? `/shop_pickup_batches?id=eq.${encodeURIComponent(row.id)}`
    : '/shop_pickup_batches';
  const method = isUpdate ? 'PATCH' : 'POST';
  if (!isUpdate) delete body.id;
  const { data, error } = await dbRest(path, {
    method,
    body,
    prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'บันทึกประกาศไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกประกาศไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function closeBatch(id) {
  return upsertBatch({ id, is_active: false });
}

// ---- Shop banners (admin-curated landing carousel) ---------------------

/** Public-readable list of banners. activeOnly defaults to true — the
 *  customer-facing carousel hides retired banners; the admin tab passes
 *  false to manage everything. */
export async function listShopBanners({ activeOnly = true } = {}) {
  const params = ['select=*', 'order=display_order.asc,created_at.desc'];
  if (activeOnly) params.push('is_active=eq.true');
  const { data, error } = await dbRest(`/shop_banners?${params.join('&')}`);
  if (error) {
    // Pre-0019: table doesn't exist. Treat as "no banners" so the
    // carousel just falls back to its product fallback.
    if (error.status === 404 || /shop_banners/i.test(error.message || '')) {
      if (!window.__samoWarnedBanners) {
        window.__samoWarnedBanners = true;
        console.warn('[shop] shop_banners missing — apply migration 0019_shop_banners.sql.');
      }
      return [];
    }
    throw new Error(error.message || 'โหลดแบนเนอร์ไม่สำเร็จ');
  }
  return data || [];
}

export async function createShopBanner(row) {
  const { data, error } = await dbRest('/shop_banners', {
    method: 'POST', body: row, prefer: 'return=representation',
  });
  if (error) throw new Error(error.message || 'เพิ่มแบนเนอร์ไม่สำเร็จ');
  return Array.isArray(data) ? data[0] : data;
}

export async function updateShopBanner(id, patch) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_banners?id=eq.${idEsc}`,
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'อัปเดตแบนเนอร์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ไม่พบแบนเนอร์หรือคุณไม่มีสิทธิ์แก้ไข');
  }
  return data[0];
}

export async function deleteShopBanner(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_banners?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบแบนเนอร์ไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ไม่พบแบนเนอร์หรือคุณไม่มีสิทธิ์ลบ');
  }
  return true;
}

/** Persist a new ordering. orderedIds[0] is the topmost (display_order=0).
 *  PATCH-per-row; for ~10 banners this is fast enough. */
export async function reorderShopBanners(orderedIds) {
  for (let i = 0; i < orderedIds.length; i += 1) {
    await updateShopBanner(orderedIds[i], { display_order: i });
  }
}

// ---- Pickup records (delivery checklist) -------------------------------

export async function listPickupRecordsForOrder(orderId) {
  const idEsc = encodeURIComponent(orderId);
  const { data, error } = await dbRest(
    `/shop_pickup_records?select=*&order_id=eq.${idEsc}&order=created_at.asc`,
  );
  if (error) throw new Error(error.message || 'โหลดบันทึกการรับสินค้าไม่สำเร็จ');
  return data || [];
}

export async function listPickupRecords({ orderIds } = {}) {
  let q = '/shop_pickup_records?select=*&order=created_at.desc';
  if (Array.isArray(orderIds) && orderIds.length) {
    const inList = orderIds.map((id) => `"${id}"`).join(',');
    q += `&order_id=in.(${encodeURIComponent(inList)})`;
  }
  const { data, error } = await dbRest(q);
  if (error) throw new Error(error.message || 'โหลดบันทึกการรับสินค้าไม่สำเร็จ');
  return data || [];
}

/**
 * Insert (or upsert by order_item_id) a pickup record. If the item was
 * already marked picked-up we merge the new fields (e.g. an issue logged
 * later). Caller passes `recipient_name`, optional `issue_type`/`issue_note`,
 * and admin uid.
 */
export async function upsertPickupRecord(row) {
  if (!row || !row.order_id || !row.order_item_id) {
    throw new Error('order_id + order_item_id required');
  }
  const { data, error } = await dbRest(
    `/shop_pickup_records?on_conflict=order_item_id`,
    {
      method: 'POST',
      body: row,
      prefer: 'return=representation,resolution=merge-duplicates',
    },
  );
  if (error) throw new Error(error.message || 'บันทึกการรับสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกการรับสินค้าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}

export async function resolvePickupIssue(id, resolution) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_pickup_records?id=eq.${idEsc}`,
    {
      method: 'PATCH',
      body: { resolution, resolved_at: new Date().toISOString() },
      prefer: 'return=representation',
    },
  );
  if (error) throw new Error(error.message || 'บันทึกการแก้ไขไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกการแก้ไขไม่สำเร็จ');
  }
  return data[0];
}

export async function deletePickupRecord(id) {
  const idEsc = encodeURIComponent(id);
  const { data, error } = await dbRest(
    `/shop_pickup_records?id=eq.${idEsc}`,
    { method: 'DELETE', prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'ลบบันทึกไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('ลบบันทึกไม่สำเร็จ');
  }
  return true;
}

// ---- Settings ----------------------------------------------------------

export async function getSettings() {
  const { data, error } = await dbRest('/shop_settings?id=eq.1&select=*');
  if (error) throw new Error(error.message || 'โหลดการตั้งค่าไม่สำเร็จ');
  return (data && data[0]) || null;
}

export async function saveSettings(patch) {
  const { data, error } = await dbRest(
    '/shop_settings?id=eq.1',
    { method: 'PATCH', body: patch, prefer: 'return=representation' },
  );
  if (error) throw new Error(error.message || 'บันทึกการตั้งค่าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกการตั้งค่าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
}
