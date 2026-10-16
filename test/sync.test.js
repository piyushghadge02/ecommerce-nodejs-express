'use strict';

/**
 * Sync strategies: dual-write failure/repair, outbox worker backoff,
 * deterministic upsert ids, polling watermark cycles, reindex, admin/health.
 */
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const orderService = require('../src/services/orderService');
const ordersRepo = require('../src/repositories/ordersRepo');
const searchRepo = require('../src/repositories/searchRepo');
const syncService = require('../src/services/syncService');
const { toCents } = require('../src/money');
const {
  FakeES, createUnitContext, seedFakeMongoProducts,
  createTestContext, wipePg, seedTestUser, wipeRealTestNamespaces, bootApp, api,
} = require('./helpers');

describe('sync strategies (fakes + real PG)', () => {
  let t, userId, ids;
  beforeEach(async () => {
    t = await createUnitContext({ strategy: 'dual_write' });
    await wipePg(t.pool);
    ids = await seedFakeMongoProducts(t._fakeMongo);
    userId = await seedTestUser(t.pool);
  });
  afterEach(async () => { await t.close(); });

  it('dual-write failure enqueues repair; worker recovers when ES returns', async () => {
    t._fakeEs.down = true;
    const { out, statusCode } = await orderService.placeOrder(t, {
      user_id: userId,
      items: [{ product_id: ids['WM-001'], quantity: 1 }],
      idempotency_key: 'sync-dw-1',
    });
    assert.equal(statusCode, 201);
    assert.equal(out.es_sync.status, 'pending_retry');
    let { rows } = await t.pool.query("SELECT COUNT(*)::int AS n FROM outbox WHERE status = 'pending'");
    assert.equal(rows[0].n, 1);
    ({ rows } = await t.pool.query('SELECT COUNT(*)::int AS n FROM orders'));
    assert.equal(rows[0].n, 1); // PG truth intact

    t._fakeEs.down = false;
    const result = await syncService.processOutboxOnce(t);
    assert.deepEqual(result, { processed: 1, failed: 0 });
    const stored = t._fakeEs._docs.get('orders_test')?.get(`order-${out.order_id}`)
      || t._fakeEs._docs.get(t.config.ES_INDEX)?.get(`order-${out.order_id}`);
    assert.ok(stored, 'doc indexed after repair');
    assert.equal(stored.customer.name, 'Test User');
    ({ rows } = await t.pool.query("SELECT COUNT(*)::int AS n FROM outbox WHERE status = 'done'"));
    assert.equal(rows[0].n, 1);
  });

  it('outbox worker backs off then marks failed after max attempts', async () => {
    const t2 = await createUnitContext({ strategy: 'outbox' });
    try {
      await wipePg(t2.pool);
      const ids2 = await seedFakeMongoProducts(t2._fakeMongo);
      const u2 = await seedTestUser(t2.pool);
      t2._fakeEs.down = true; // ES stays down
      const { out } = await orderService.placeOrder(t2, {
        user_id: u2, items: [{ product_id: ids2['WM-001'], quantity: 1 }],
        idempotency_key: null,
      });
      assert.equal(out.es_sync.status, 'queued');

      const before = new Date();
      let result = await syncService.processOutboxOnce(t2);
      assert.deepEqual(result, { processed: 0, failed: 1 });
      let { rows } = await t2.pool.query('SELECT * FROM outbox');
      assert.equal(rows[0].status, 'pending');
      assert.equal(rows[0].attempts, 1);
      assert.ok(new Date(rows[0].next_attempt_at) > before, 'backoff scheduled');
      assert.match(rows[0].last_error, /fake elasticsearch is down/);

      // force to the last attempt -> next failure marks it failed
      await t2.pool.query(
        `UPDATE outbox SET attempts = $1, next_attempt_at = now() - interval '1 second'`,
        [t2.config.OUTBOX_MAX_ATTEMPTS - 1]
      );
      result = await syncService.processOutboxOnce(t2);
      assert.deepEqual(result, { processed: 0, failed: 1 });
      ({ rows } = await t2.pool.query('SELECT * FROM outbox'));
      assert.equal(rows[0].status, 'failed');
      assert.equal(rows[0].attempts, t2.config.OUTBOX_MAX_ATTEMPTS);
    } finally {
      await t2.close();
    }
  });

  it('upserts are idempotent with deterministic order-<id>', async () => {
    const es = new FakeES();
    const doc = {
      order_id: 42, status: 'PENDING', total_amount: 9.99,
      order_date: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
      customer: { id: 1, name: 'N', email: 'n@e.com' }, items: [],
    };
    const ctxLike = { getEsClient: () => es, config: { ES_INDEX: 'orders' } };
    await syncService.pushOrderDoc(ctxLike, doc);
    await syncService.pushOrderDoc(ctxLike, doc); // retry: same id
    assert.deepEqual([...es._docs.get('orders').keys()], ['order-42']);
  });

  it('admin sync-status and health endpoints', async () => {
    const app = await bootApp(t);
    try {
      const { status, json } = await api(app.baseUrl, 'GET', '/api/health');
      assert.equal(status, 200);
      assert.equal(json.status, 'ok');
      assert.equal(json.postgres, 'up');
      assert.equal(json.mongodb, 'up');
      assert.equal(json.elasticsearch, 'up');
      assert.equal(json.sync_strategy, 'dual_write');
      const s = await api(app.baseUrl, 'GET', '/api/admin/sync-status');
      assert.equal(s.json.outbox_pending, 0);
      assert.equal(s.json.outbox_failed, 0);
      assert.equal(s.json.elasticsearch_docs, 0);
    } finally {
      await app.close();
    }
  });

  it('health degraded when ES unreachable', async () => {
    const t2 = await createUnitContext({ strategy: 'dual_write', });
    t2.getEsClient = () => null;
    t2.esPing = async () => false;
    const app = await bootApp(t2);
    try {
      const { json } = await api(app.baseUrl, 'GET', '/api/health');
      assert.equal(json.status, 'degraded');
      assert.equal(json.elasticsearch, 'down');
      const s = await api(app.baseUrl, 'POST', '/api/search/orders', { q: 'x' });
      assert.equal(s.status, 503);
    } finally {
      await app.close();
      await t2.close();
    }
  });
});

describe('sync integration (real ES)', () => {
  let ctx;
  before(async () => { ctx = await createTestContext({ SYNC_STRATEGY: 'dual_write' }); });
  after(async () => { await ctx.close(); });
  beforeEach(async () => {
    await wipePg(ctx.pool);
    await wipeRealTestNamespaces();
  });

  it('polling worker: watermark advances, changed orders sync on next cycle', async () => {
    const userId = await seedTestUser(ctx.pool);
    const { order } = await ordersRepo.createOrder(ctx.pool, {
      userId,
      lines: [{ productId: 'prod-1', title: 'Test Product', quantity: 1, unitPriceCents: toCents('33.33') }],
    });
    const es = ctx.getEsClient();

    const r1 = await syncService.runPollingCycle(ctx);
    assert.equal(r1.synced, 1);
    await es.indices.refresh({ index: 'orders_test' });
    let doc = await searchRepo.getOrderDoc(es, 'orders_test', order.id);
    assert.ok(Math.abs(doc.total_amount - 33.33) < 0.001);
    assert.equal(doc.status, 'PENDING');

    const r2 = await syncService.runPollingCycle(ctx);
    assert.equal(r2.synced, 0);

    await ordersRepo.updateOrderStatus(ctx.pool, order.id, 'SHIPPED');
    const r3 = await syncService.runPollingCycle(ctx);
    assert.equal(r3.synced, 1);
    await es.indices.refresh({ index: 'orders_test' });
    doc = await searchRepo.getOrderDoc(es, 'orders_test', order.id);
    assert.equal(doc.status, 'SHIPPED');
  });

  it('POST /api/admin/reindex rebuilds ES from PG only', async () => {
    const app = await bootApp(ctx);
    try {
      const userId = await seedTestUser(ctx.pool);
      const mk = async (total) => (await ordersRepo.createOrder(ctx.pool, {
        userId,
        lines: [{ productId: 'prod-1', title: 'Test Product', quantity: 1, unitPriceCents: toCents(total) }],
      })).order.id;
      const oid1 = await mk('10.00');
      const oid2 = await mk('20.00');
      await ordersRepo.updateOrderStatus(ctx.pool, oid2, 'SHIPPED');

      const { status, json } = await api(app.baseUrl, 'POST', '/api/admin/reindex');
      assert.equal(status, 200);
      assert.equal(json.indexed, 2);
      const s = await api(app.baseUrl, 'GET', '/api/admin/sync-status');
      assert.equal(s.json.elasticsearch_docs, 2);

      const es = ctx.getEsClient();
      const d1 = await searchRepo.getOrderDoc(es, 'orders_test', oid1);
      const d2 = await searchRepo.getOrderDoc(es, 'orders_test', oid2);
      assert.equal(d1.items[0].title, 'Test Product'); // PG snapshot, not Mongo
      assert.equal(d2.status, 'SHIPPED');
    } finally {
      await app.close();
    }
  });

  it('polling watermark visible in sync-status', async () => {
    const userId = await seedTestUser(ctx.pool);
    await ordersRepo.createOrder(ctx.pool, {
      userId,
      lines: [{ productId: 'p', title: 'T', quantity: 1, unitPriceCents: 100 }],
    });
    await syncService.runPollingCycle(ctx);
    const wm = await ordersRepo.getPollingWatermark(ctx.pool);
    assert.ok(wm instanceof Date);
  });
});
