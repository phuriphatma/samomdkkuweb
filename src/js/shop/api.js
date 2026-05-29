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

// ---- Products ----------------------------------------------------------

export async function listProducts({ activeOnly = true } = {}) {
  const filter = activeOnly ? '&is_active=eq.true' : '';
  const { data, error } = await dbRest(
    `/shop_products?select=*${filter}&order=added_at.desc`,
  );
  if (error) throw new Error(error.message || 'โหลดสินค้าไม่สำเร็จ');
  return data || [];
}

export async function upsertProduct(row) {
  if (!row || !row.id) throw new Error('product.id required');
  // Upsert with on_conflict so the same call works for create and update.
  const { data, error } = await dbRest(
    `/shop_products?on_conflict=id`,
    {
      method: 'POST',
      body: row,
      prefer: 'return=representation,resolution=merge-duplicates',
    },
  );
  if (error) throw new Error(error.message || 'บันทึกสินค้าไม่สำเร็จ');
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('บันทึกสินค้าไม่สำเร็จ (RLS หรือสิทธิ์ไม่พอ)');
  }
  return data[0];
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
    const id = genOrderId();
    const now = new Date().toISOString();
    const subtotal = Number(payload.subtotal) || 0;
    const fee = Number(payload.fee) || 0;
    const orderRow = {
      id,
      buyer_id: payload.buyerId,
      buyer_label: payload.buyerLabel || null,
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
    const { data: orderData, error: orderErr } = await dbRest(
      '/shop_orders',
      { method: 'POST', body: orderRow, prefer: 'return=representation' },
    );
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

/** Buyer-facing: re-upload a slip on a pending/review order. */
export async function setOrderSlip(id, slipUrl) {
  const idEsc = encodeURIComponent(id);
  const now = new Date().toISOString();
  const current = await getOrder(id);
  if (!current) throw new Error('ไม่พบคำสั่งซื้อ');
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
    throw new Error('ส่งสลิปไม่สำเร็จ (RLS หรือสถานะไม่ใช่ pending/review)');
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
