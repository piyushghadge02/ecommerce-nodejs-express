'use strict';

/**
 * Synchronization strategies: dual-write, transactional outbox, polling.
 *
 * All strategies upsert Elasticsearch documents with the deterministic id
 * `order-<order_id>`, so retries and replays are idempotent. MongoDB is never
 * part of the order synchronization path.
 *
 * - dual_write: index ES right after the PG commit. On failure, an outbox row
 *   is written in a *separate* PG transaction and a repair loop (every 10s)
 *   drains it.
 * - outbox: the outbox row is written *inside* the PG order transaction
 *   (atomic). A worker polls pending rows every OUTBOX_POLL_SECONDS, indexes
 *   to ES, and marks them done. Failures back off exponentially (2^attempts s)
 *   and become 'failed' after OUTBOX_MAX_ATTEMPTS attempts.
 * - polling: a worker every POLLING_INTERVAL_SECONDS selects orders with
 *   updated_at > watermark (stored in sync_state), upserts them, and advances
 *   the watermark. Survives ES outages (watermark simply doesn't advance).
 *
 * Mirrors services/sync_service.py from the Python reference implementation.
 */
const { getLogger } = require('../logger');
const ordersRepo = require('../repositories/ordersRepo');
const searchRepo = require('../repositories/searchRepo');

const log = getLogger('syncService');
const REPAIR_LOOP_SECONDS = 10;
const OUTBOX_BATCH_SIZE = 50;
const POLLING_BATCH_SIZE = 500;

/** Upsert one order document. Throws on ES failure (caller handles). */
async function pushOrderDoc(ctx, doc) {
  const es = ctx.getEsClient();
  if (!es) throw new Error('elasticsearch client unavailable');
  await searchRepo.upsertOrderDoc(es, ctx.config.ES_INDEX, doc);
}

/** Drain due outbox rows once. Returns {processed, failed} counts. */
async function processOutboxOnce(ctx) {
  const { config, pool } = ctx;
  const es = ctx.getEsClient();
  const batch = await ordersRepo.claimOutboxBatch(pool, OUTBOX_BATCH_SIZE);
  let processed = 0;
  let failed = 0;
  for (const row of batch) {
    try {
      await searchRepo.upsertOrderDoc(es, config.ES_INDEX, row.payload);
      await ordersRepo.markOutboxDone(pool, row.id);
      processed += 1;
    } catch (err) {
      const msg = String(err && err.message || err);
      log.warn('outbox event failed', { outbox_id: row.id, error: msg });
      await ordersRepo.markOutboxError(pool, row.id, msg, config.OUTBOX_MAX_ATTEMPTS);
      failed += 1;
    }
  }
  return { processed, failed };
}

function createLoop(fn, intervalSeconds, name) {
  let timer = null;
  let stopped = false;
  async function tick() {
    if (stopped) return;
    try {
      const result = await fn();
      if (result && (result.processed || result.failed || result.synced)) {
        log.info(`${name} cycle`, result);
      }
    } catch (err) {
      log.warn(`${name} cycle failed`, { error: String(err && err.message || err) });
    }
    if (!stopped) timer = setTimeout(tick, intervalSeconds * 1000);
  }
  // Defer the first tick slightly so boot isn't blocked.
  timer = setTimeout(tick, 1000);
  log.info(`${name} loop started`, { interval: intervalSeconds });
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

/** Background loop: keep draining the outbox (worker or repair loop). */
function runOutboxLoop(ctx, intervalSeconds) {
  return createLoop(() => processOutboxOnce(ctx), intervalSeconds, 'outbox');
}

/** One polling pass: upsert orders newer than the watermark, advance it. */
async function runPollingCycle(ctx) {
  const { pool } = ctx;
  const es = ctx.getEsClient();
  if (!es) throw new Error('elasticsearch client unavailable');
  const watermark = await ordersRepo.getPollingWatermark(pool);
  const epoch = new Date(0);
  const rows = await ordersRepo.fetchOrdersForSync(pool, {
    updatedAfter: watermark || epoch, limit: POLLING_BATCH_SIZE,
  });
  if (!rows.length) {
    return { synced: 0, watermark: watermark ? watermark.toISOString() : null };
  }
  let maxUpdated = watermark;
  let synced = 0;
  for (const entry of rows) {
    const doc = searchRepo.buildOrderDoc(entry.order, entry.user, entry.items);
    await pushOrderDoc(ctx, doc); // throws -> watermark not advanced
    synced += 1;
    if (!maxUpdated || entry.order.updatedAt > maxUpdated) maxUpdated = entry.order.updatedAt;
  }
  await ordersRepo.setPollingWatermark(pool, maxUpdated);
  log.info('polling cycle', { synced });
  return { synced, watermark: maxUpdated.toISOString() };
}

function runPollingLoop(ctx, intervalSeconds) {
  return createLoop(() => runPollingCycle(ctx), intervalSeconds, 'polling');
}

/** Full rebuild of the ES index from PostgreSQL (snapshots only, never Mongo). */
async function reindexAll(ctx) {
  const { pool } = ctx;
  const es = ctx.getEsClient();
  if (!es) throw new Error('elasticsearch client unavailable');
  await searchRepo.ensureIndex(es, ctx.config.ES_INDEX);
  const rows = await ordersRepo.fetchOrdersForSync(pool, { limit: 100000 });
  let count = 0;
  const batch = [];
  for (const entry of rows) {
    batch.push(searchRepo.buildOrderDoc(entry.order, entry.user, entry.items));
    if (batch.length >= 100) {
      await Promise.all(batch.splice(0).map((d) => searchRepo.upsertOrderDoc(es, ctx.config.ES_INDEX, d)));
      count += 100;
    }
  }
  if (batch.length) {
    await Promise.all(batch.map((d) => searchRepo.upsertOrderDoc(es, ctx.config.ES_INDEX, d)));
    count += batch.length;
  }
  try { await es.indices.refresh({ index: ctx.config.ES_INDEX }); } catch { /* ignore */ }
  log.info('reindex complete', { indexed: count });
  return count;
}

module.exports = {
  REPAIR_LOOP_SECONDS,
  OUTBOX_BATCH_SIZE,
  POLLING_BATCH_SIZE,
  pushOrderDoc,
  processOutboxOnce,
  runOutboxLoop,
  runPollingCycle,
  runPollingLoop,
  reindexAll,
};
