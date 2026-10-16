'use strict';

/**
 * Checkout and order-status business logic.
 *
 * Write-path discipline:
 * - Checkout validates products against the CURRENT MongoDB catalog
 *   (server-side prices/titles win; client prices are ignored) and persists
 *   the order + items inside ONE PostgreSQL transaction. Snapshots (title,
 *   unit_price) are copied into order_items at checkout time.
 * - Elasticsearch is synchronized only AFTER the PG transaction commits. If ES
 *   is unavailable the PG order still succeeds; recovery is handled per
 *   strategy (see syncService).
 *
 * Mirrors services/order_service.py from the Python reference implementation.
 */
const { getLogger } = require('../logger');
const { toCents, formatCents, centsToFloat } = require('../money');
const ordersRepo = require('../repositories/ordersRepo');
const productsRepo = require('../repositories/productsRepo');
const searchRepo = require('../repositories/searchRepo');
const usersRepo = require('../repositories/usersRepo');
const syncService = require('./syncService');

const log = getLogger('orderService');
const STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED'];

class HttpError extends Error {
  constructor(status, detail) {
    super(detail);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
}

function truncateToSecond(date) {
  const d = new Date(date);
  d.setMilliseconds(0);
  return d;
}

/**
 * Build the denormalized ES document.
 * lines: [{productId, title, quantity, unitPriceCents}]
 */
function buildEsDoc(orderId, user, lines, { status, orderDate, updatedAt }) {
  const totalCents = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
  return {
    order_id: orderId,
    order_date: truncateToSecond(orderDate).toISOString(),
    status,
    total_amount: centsToFloat(totalCents),
    updated_at: truncateToSecond(updatedAt).toISOString(),
    customer: { id: user.id, name: user.name, email: user.email },
    items: lines.map((l) => ({
      product_id: l.productId,
      title: l.title,
      quantity: l.quantity,
      unit_price: centsToFloat(l.unitPriceCents),
    })),
  };
}

/** Validate each line against the live Mongo catalog. Throws HttpError. */
async function validateLines(mongoDb, items) {
  const lines = [];
  for (const item of items) {
    const product = await productsRepo.getProduct(mongoDb, item.product_id);
    if (!product) {
      throw new HttpError(422, `product not found: ${item.product_id}`);
    }
    if (!product.active) {
      throw new HttpError(422, `product is inactive: ${item.product_id}`);
    }
    lines.push({
      productId: item.product_id,
      title: product.title,
      quantity: item.quantity,
      unitPriceCents: toCents(product.price),
    });
  }
  return lines;
}

function orderItemOut(item) {
  const lineCents = item.quantity * item.unitPriceCents;
  return {
    product_id: item.productId,
    title: item.title,
    quantity: item.quantity,
    unit_price: formatCents(item.unitPriceCents),
    line_total: formatCents(lineCents),
  };
}

function orderCreateOut(order, user, items, esSync) {
  return {
    order_id: order.id,
    user_id: order.userId,
    status: order.status,
    total_amount: formatCents(order.totalAmountCents),
    order_date: order.orderDate.toISOString(),
    updated_at: order.updatedAt.toISOString(),
    items: items.map(orderItemOut),
    es_sync: esSync,
  };
}

/**
 * Synchronize a committed order to ES per SYNC_STRATEGY.
 * Never throws: ES failures become outbox rows / pending_retry, never fake rollbacks.
 */
async function syncAfterCommit(ctx, { orderId, eventType, doc }) {
  const { config, pool } = ctx;
  const strategy = config.SYNC_STRATEGY;
  if (strategy === 'outbox' || strategy === 'polling') {
    // outbox: row already inserted atomically inside the PG transaction.
    // polling: worker picks the order up via the updated_at watermark.
    return { strategy, status: 'queued' };
  }
  // dual_write: index immediately; on failure enqueue a repair outbox row
  // in a SEPARATE transaction (the order itself stays committed).
  try {
    await syncService.pushOrderDoc(ctx, doc);
    return { strategy, status: 'synced' };
  } catch (err) {
    log.warn('dual-write to ES failed; enqueueing outbox repair', {
      order_id: orderId, error: String(err && err.message || err),
    });
    await ordersRepo.insertOutboxEvent(pool, orderId, eventType, doc);
    return { strategy, status: 'pending_retry' };
  }
}

async function placeOrder(ctx, payload) {
  const { config, pool } = ctx;
  const mongoDb = ctx.getMongoDb();

  const user = await usersRepo.getUser(pool, payload.user_id);
  if (!user) throw new HttpError(400, `unknown user_id: ${payload.user_id}`);

  const lines = await validateLines(mongoDb, payload.items);
  const now = new Date();

  // Idempotency replay: return the existing order without inserting.
  if (payload.idempotency_key) {
    const existing = await ordersRepo.findOrderByIdempotencyKey(pool, payload.idempotency_key);
    if (existing) {
      const full = await ordersRepo.getOrderFull(pool, existing.id);
      let doc = null;
      try {
        doc = await searchRepo.getOrderDoc(ctx.getEsClient(), config.ES_INDEX, existing.id);
      } catch { /* ES unreachable -> treat as not synced */ }
      log.info('idempotent replay', { order_id: existing.id });
      return {
        out: orderCreateOut(full.order, full.user, full.items, {
          strategy: config.SYNC_STRATEGY,
          status: doc ? 'synced' : 'queued',
        }),
        statusCode: 200,
      };
    }
  }

  const makeDoc = (orderId) => buildEsDoc(orderId, user, lines, {
    status: 'PENDING', orderDate: now, updatedAt: now,
  });

  const { order, created } = await ordersRepo.createOrder(pool, {
    userId: payload.user_id,
    lines,
    idempotencyKey: payload.idempotency_key || null,
    orderDate: now,
    updatedAt: now,
    // Atomic outbox row for the outbox strategy (same PG transaction).
    outboxEventFactory: config.SYNC_STRATEGY === 'outbox'
      ? (orderId) => ({ eventType: 'order.created', payload: makeDoc(orderId) })
      : null,
  });
  if (!created) throw new HttpError(500, 'order creation conflict');

  const doc = makeDoc(order.id);
  const esSync = await syncAfterCommit(ctx, { orderId: order.id, eventType: 'order.created', doc });

  const full = await ordersRepo.getOrderFull(pool, order.id);
  return { out: orderCreateOut(full.order, full.user, full.items, esSync), statusCode: 201 };
}

async function getOrderDetail(ctx, orderId) {
  const { config, pool } = ctx;
  const full = await ordersRepo.getOrderFull(pool, orderId);
  if (!full) throw new HttpError(404, `order not found: ${orderId}`);
  const { order, user, items } = full;
  const pgUpdated = truncateToSecond(order.updatedAt);

  let esDoc = null;
  let esReachable = true;
  try {
    esDoc = await searchRepo.getOrderDoc(ctx.getEsClient(), config.ES_INDEX, orderId);
  } catch (err) {
    log.warn('es unreachable for sync check', { error: String(err && err.message || err) });
    esReachable = false;
  }

  let esUpdatedAt = null;
  let esInSync;
  if (!esReachable) {
    esInSync = null;
  } else if (!esDoc) {
    esInSync = false;
  } else {
    esUpdatedAt = searchRepo.coerceDt(esDoc.updated_at);
    esInSync =
      truncateToSecond(esUpdatedAt).getTime() === pgUpdated.getTime() &&
      esDoc.status === order.status &&
      Number(esDoc.total_amount) === centsToFloat(order.totalAmountCents);
  }

  return {
    order_id: order.id,
    user_id: order.userId,
    customer: { id: user.id, name: user.name, email: user.email },
    status: order.status,
    total_amount: formatCents(order.totalAmountCents),
    order_date: order.orderDate.toISOString(),
    updated_at: order.updatedAt.toISOString(),
    items: items.map(orderItemOut),
    sync: {
      es_in_sync: esInSync,
      pg_updated_at: order.updatedAt.toISOString(),
      es_updated_at: esUpdatedAt ? esUpdatedAt.toISOString() : null,
    },
  };
}

async function updateOrderStatus(ctx, orderId, status) {
  const { config, pool } = ctx;
  if (!STATUSES.includes(status)) throw new HttpError(422, `invalid status: ${status}`);

  const full = await ordersRepo.getOrderFull(pool, orderId);
  if (!full) throw new HttpError(404, `order not found: ${orderId}`);
  const { user, items, order } = full;
  const lines = items.map((i) => ({
    productId: i.productId, title: i.title, quantity: i.quantity, unitPriceCents: i.unitPriceCents,
  }));
  const factory = (oid, updatedAt) => ({
    eventType: 'order.status_updated',
    payload: buildEsDoc(oid, user, lines, {
      status, orderDate: order.orderDate, updatedAt,
    }),
  });

  const updated = await ordersRepo.updateOrderStatus(
    pool, orderId, status,
    config.SYNC_STRATEGY === 'outbox' ? factory : null
  );
  if (!updated) throw new HttpError(404, `order not found: ${orderId}`);

  const doc = factory(updated.id, updated.updatedAt).payload;
  const esSync = await syncAfterCommit(ctx, {
    orderId: updated.id, eventType: 'order.status_updated', doc,
  });
  return {
    order_id: updated.id,
    status: updated.status,
    updated_at: updated.updatedAt.toISOString(),
    es_sync: esSync,
  };
}

module.exports = {
  STATUSES,
  HttpError,
  truncateToSecond,
  buildEsDoc,
  validateLines,
  placeOrder,
  getOrderDetail,
  updateOrderStatus,
};
