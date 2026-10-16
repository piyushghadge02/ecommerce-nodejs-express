'use strict';

/**
 * PostgreSQL repository: orders, order items, outbox, sync_state.
 *
 * All write paths use explicit transaction boundaries (BEGIN/COMMIT/ROLLBACK
 * via a dedicated pg client). `createOrder` inserts the order, its items, and
 * (optionally) an outbox event inside ONE transaction: any failure rolls
 * everything back.
 *
 * Money is handled as integer cents; PG NUMERIC(12,2) values are read as
 * strings and converted with the money helpers (lossless).
 *
 * Mirrors repositories/orders_repo.py from the Python reference implementation.
 */
const { getLogger } = require('../logger');
const { toCents, formatCents } = require('../money');

const log = getLogger('ordersRepo');
const POLLING_WATERMARK_KEY = 'polling_watermark';

function mapOrder(row) {
  return {
    id: row.id,
    userId: row.user_id,
    orderDate: row.order_date,
    status: row.status,
    totalAmountCents: toCents(row.total_amount),
    updatedAt: row.updated_at,
    idempotencyKey: row.idempotency_key,
  };
}

function mapOrderItem(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    title: row.title,
    quantity: row.quantity,
    unitPriceCents: toCents(row.unit_price),
  };
}

function mapUser(row) {
  return { id: row.id, name: row.name, email: row.email };
}

function mapOutbox(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

/** Run `fn(client)` inside a transaction; roll back on any error. */
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function findOrderByIdempotencyKey(client, idempotencyKey) {
  const { rows } = await client.query('SELECT * FROM orders WHERE idempotency_key = $1', [idempotencyKey]);
  return rows[0] ? mapOrder(rows[0]) : null;
}

/**
 * Insert order + items (+ optional outbox row) atomically.
 *
 * lines: [{productId, title, quantity, unitPriceCents}]
 * outboxEventFactory(orderId) -> {eventType, payload} (called after the order
 * id is known, still inside the same transaction).
 *
 * Returns {order, created}. If `idempotencyKey` matches an existing order,
 * no insert happens and the existing order is returned with created=false.
 */
async function createOrder(pool, {
  userId, lines, idempotencyKey = null, outboxEventFactory = null,
  orderDate = null, updatedAt = null,
}) {
  return withTransaction(pool, async (client) => {
    if (idempotencyKey) {
      const existing = await findOrderByIdempotencyKey(client, idempotencyKey);
      if (existing) return { order: existing, created: false };
    }
    const totalCents = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
    const { rows } = await client.query(
      `INSERT INTO orders (user_id, order_date, status, total_amount, updated_at, idempotency_key)
       VALUES ($1, $2, 'PENDING', $3, $4, $5) RETURNING *`,
      [userId, orderDate || new Date(), formatCents(totalCents), updatedAt || new Date(), idempotencyKey]
    );
    const order = mapOrder(rows[0]);
    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items (order_id, product_id, title, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, line.productId, line.title, line.quantity, formatCents(line.unitPriceCents)]
      );
    }
    if (outboxEventFactory) {
      const event = outboxEventFactory(order.id);
      await client.query(
        `INSERT INTO outbox (order_id, event_type, payload) VALUES ($1, $2, $3)`,
        [order.id, event.eventType, JSON.stringify(event.payload)]
      );
    }
    log.info('order created', { order_id: order.id, total: formatCents(totalCents) });
    return { order, created: true };
  });
}

/** Canonical order with user + items. */
async function getOrderFull(poolOrClient, orderId) {
  const q = (text, params) => poolOrClient.query(text, params);
  const or_ = await q('SELECT * FROM orders WHERE id = $1', [orderId]);
  if (or_.rows.length === 0) return null;
  const order = mapOrder(or_.rows[0]);
  const ur = await q('SELECT id, name, email FROM users WHERE id = $1', [order.userId]);
  const ir = await q('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [orderId]);
  return { order, user: mapUser(ur.rows[0]), items: ir.rows.map(mapOrderItem) };
}

/**
 * Update status + updated_at, optionally inserting an outbox row atomically.
 * outboxEventFactory(orderId, updatedAt) -> {eventType, payload}.
 */
async function updateOrderStatus(pool, orderId, status, outboxEventFactory = null) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    if (rows.length === 0) return null;
    const updatedAt = new Date();
    const upd = await client.query(
      'UPDATE orders SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *',
      [status, updatedAt, orderId]
    );
    const order = mapOrder(upd.rows[0]);
    if (outboxEventFactory) {
      const event = outboxEventFactory(order.id, order.updatedAt);
      await client.query(
        `INSERT INTO outbox (order_id, event_type, payload) VALUES ($1, $2, $3)`,
        [order.id, event.eventType, JSON.stringify(event.payload)]
      );
    }
    log.info('order status updated', { order_id: order.id, status });
    return order;
  });
}

/** Fetch orders joined with user + items for ES document building. */
async function fetchOrdersForSync(pool, { orderIds = null, updatedAfter = null, limit = 500 } = {}) {
  const client = await pool.connect();
  try {
    let text = `SELECT o.*, u.name AS user_name, u.email AS user_email
                FROM orders o JOIN users u ON u.id = o.user_id`;
    const params = [];
    const conds = [];
    if (orderIds && orderIds.length) {
      params.push(orderIds);
      conds.push(`o.id = ANY($${params.length})`);
    }
    if (updatedAfter) {
      params.push(updatedAfter);
      conds.push(`o.updated_at > $${params.length}`);
    }
    if (conds.length) text += ' WHERE ' + conds.join(' AND ');
    params.push(limit);
    text += ` ORDER BY o.updated_at ASC, o.id ASC LIMIT $${params.length}`;
    const { rows } = await client.query(text, params);
    const out = [];
    for (const row of rows) {
      const ir = await client.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [row.id]);
      out.push({
        order: mapOrder(row),
        user: { id: row.user_id, name: row.user_name, email: row.user_email },
        items: ir.rows.map(mapOrderItem),
      });
    }
    return out;
  } finally {
    client.release();
  }
}

// ------------------------------------------------------------- outbox ---
/** Insert an outbox row in its own transaction (dual-write fallback path). */
async function insertOutboxEvent(pool, orderId, eventType, payload) {
  const { rows } = await pool.query(
    `INSERT INTO outbox (order_id, event_type, payload) VALUES ($1, $2, $3) RETURNING *`,
    [orderId, eventType, JSON.stringify(payload)]
  );
  return mapOutbox(rows[0]);
}

/** Fetch due pending rows with SKIP LOCKED so multiple workers are safe. */
async function claimOutboxBatch(pool, limit = 50) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM outbox
       WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY id ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    for (const row of rows) {
      await client.query(`UPDATE outbox SET status = 'processing' WHERE id = $1`, [row.id]);
    }
    return rows.map(mapOutbox);
  });
}

async function markOutboxDone(pool, outboxId) {
  await pool.query(`UPDATE outbox SET status = 'done', last_error = NULL WHERE id = $1`, [outboxId]);
}

/** Exponential backoff (2^attempts seconds); 'failed' after maxAttempts. */
async function markOutboxError(pool, outboxId, error, maxAttempts) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM outbox WHERE id = $1', [outboxId]);
    if (rows.length === 0) return;
    const row = rows[0];
    const attempts = row.attempts + 1;
    if (attempts >= maxAttempts) {
      await client.query(
        `UPDATE outbox SET attempts = $1, last_error = $2, status = 'failed' WHERE id = $3`,
        [attempts, String(error).slice(0, 2000), outboxId]
      );
    } else {
      const delaySeconds = Math.pow(2, attempts);
      await client.query(
        `UPDATE outbox SET attempts = $1, last_error = $2, status = 'pending',
                next_attempt_at = now() + ($3 || ' seconds')::interval
         WHERE id = $4`,
        [attempts, String(error).slice(0, 2000), String(delaySeconds), outboxId]
      );
    }
  } finally {
    client.release();
  }
}

async function countOutboxByStatus(pool) {
  const { rows } = await pool.query('SELECT status, COUNT(*)::int AS count FROM outbox GROUP BY status');
  const out = {};
  for (const r of rows) out[r.status] = r.count;
  return out;
}

// --------------------------------------------------------- sync_state ---
async function getSyncState(pool, key) {
  const { rows } = await pool.query('SELECT value FROM sync_state WHERE key = $1', [key]);
  return rows.length ? rows[0].value : null;
}

async function setSyncState(pool, key, value) {
  await pool.query(
    `INSERT INTO sync_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

async function getPollingWatermark(pool) {
  const raw = await getSyncState(pool, POLLING_WATERMARK_KEY);
  return raw ? new Date(raw) : null;
}

async function setPollingWatermark(pool, value) {
  await setSyncState(pool, POLLING_WATERMARK_KEY, value.toISOString());
}

// -------------------------------------------------------------- admin ---
/** Truncate all transactional tables (used by --reset seed). FK order matters. */
async function deleteAllDemoData(pool) {
  await pool.query('TRUNCATE outbox, order_items, orders, sync_state, users RESTART IDENTITY CASCADE');
}

module.exports = {
  POLLING_WATERMARK_KEY,
  withTransaction,
  mapOrder,
  mapOrderItem,
  findOrderByIdempotencyKey,
  createOrder,
  getOrderFull,
  updateOrderStatus,
  fetchOrdersForSync,
  insertOutboxEvent,
  claimOutboxBatch,
  markOutboxDone,
  markOutboxError,
  countOutboxByStatus,
  getSyncState,
  setSyncState,
  getPollingWatermark,
  setPollingWatermark,
  deleteAllDemoData,
};
