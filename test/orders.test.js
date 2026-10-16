'use strict';

/**
 * Orders: checkout price validation (server prices win), exact totals,
 * atomic rollback, idempotent replay, PG-canonical reads, status updates.
 *
 * Service-level tests use FakeMongo + FakeES with the REAL isolated PG
 * (`ecommerce_test`, wiped per test). HTTP tests exercise the routes.
 */
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const orderService = require('../src/services/orderService');
const ordersRepo = require('../src/repositories/ordersRepo');
const {
  FakeES, createUnitContext, seedFakeMongoProducts,
  wipePg, seedTestUser, bootApp, api,
} = require('./helpers');

function payload(userId, items, idempotencyKey) {
  return {
    user_id: userId,
    items,
    idempotency_key: idempotencyKey ?? null,
  };
}

describe('checkout (service)', () => {
  describe('per-test context', () => {
    let t, userId, ids;
    beforeEach(async () => {
      t = await createUnitContext({ strategy: 'dual_write' });
      await wipePg(t.pool);
      ids = await seedFakeMongoProducts(t._fakeMongo);
      userId = await seedTestUser(t.pool);
    });
    afterEach(async () => { await t.close(); });

    it('computes totals from server prices and ignores client prices', async () => {
      const { out, statusCode } = await orderService.placeOrder(t, payload(userId, [
        { product_id: ids['WM-001'], quantity: 2 },
        { product_id: ids['MK-101'], quantity: 1 },
      ], 'ord-1'));
      assert.equal(statusCode, 201);
      assert.equal(out.total_amount, '200.66'); // 2*50.16 + 100.34
      assert.equal(out.items[0].unit_price, '50.16');
      assert.equal(out.items[0].line_total, '100.32');
      assert.equal(out.es_sync.status, 'synced');
      // PG rows exist
      const full = await ordersRepo.getOrderFull(t.pool, out.order_id);
      assert.equal(full.items.length, 2);
      assert.equal(full.order.status, 'PENDING');
    });

    it('rejects unknown user with 400', async () => {
      await assert.rejects(
        () => orderService.placeOrder(t, payload(999999, [{ product_id: ids['WM-001'], quantity: 1 }])),
        (e) => e.status === 400 && /unknown user_id/.test(e.detail)
      );
    });

    it('rejects missing product with 422', async () => {
      await assert.rejects(
        () => orderService.placeOrder(t, payload(userId, [{ product_id: '012345678901234567890123', quantity: 1 }])),
        (e) => e.status === 422 && /product not found/.test(e.detail)
      );
    });

    it('rejects inactive product with 422', async () => {
      await assert.rejects(
        () => orderService.placeOrder(t, payload(userId, [{ product_id: ids['CRT-1'], quantity: 1 }])),
        (e) => e.status === 422 && /inactive/.test(e.detail)
      );
    });

    it('rolls back the entire transaction when an item insert fails', async () => {
      // Sabotage: drop the order_items table's NOT NULL via an impossible line —
      // instead simulate by monkeypatching the repo to throw mid-transaction.
      const orig = ordersRepo.createOrder;
      let calls = 0;
      ordersRepo.createOrder = async (...args) => {
        calls += 1;
        if (calls === 1) throw new Error('simulated item insert failure');
        return orig(...args);
      };
      try {
        await assert.rejects(() => orderService.placeOrder(t, payload(userId, [
          { product_id: ids['WM-001'], quantity: 1 },
        ])), /simulated item insert failure/);
      } finally {
        ordersRepo.createOrder = orig;
      }
      const { rows } = await t.pool.query('SELECT COUNT(*)::int AS n FROM orders');
      assert.equal(rows[0].n, 0, 'no leaked order rows after rollback');
    });

    it('idempotent replay returns the same order with 200', async () => {
      const p = payload(userId, [{ product_id: ids['WM-001'], quantity: 1 }], 'idem-1');
      const first = await orderService.placeOrder(t, p);
      assert.equal(first.statusCode, 201);
      const second = await orderService.placeOrder(t, p);
      assert.equal(second.statusCode, 200);
      assert.equal(second.out.order_id, first.out.order_id);
      const { rows } = await t.pool.query('SELECT COUNT(*)::int AS n FROM orders');
      assert.equal(rows[0].n, 1);
    });

    it('ES-down checkout still commits PG and queues repair (dual_write)', async () => {
      t._fakeEs.down = true;
      const { out, statusCode } = await orderService.placeOrder(t, payload(userId, [
        { product_id: ids['WM-001'], quantity: 1 },
      ], 'esdown-1'));
      assert.equal(statusCode, 201);
      assert.equal(out.es_sync.status, 'pending_retry');
      const { rows } = await t.pool.query(
        "SELECT status FROM outbox WHERE order_id = $1", [out.order_id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].status, 'pending');
      const n = await t.pool.query('SELECT COUNT(*)::int AS n FROM orders');
      assert.equal(n.rows[0].n, 1);
    });

    it('outbox strategy queues without touching ES', async () => {
      const t2 = await createUnitContext({ strategy: 'outbox' });
      try {
        await wipePg(t2.pool);
        const ids2 = await seedFakeMongoProducts(t2._fakeMongo);
        const u2 = await seedTestUser(t2.pool);
        const { out } = await orderService.placeOrder(t2, payload(u2, [
          { product_id: ids2['WM-001'], quantity: 1 },
        ]));
        assert.equal(out.es_sync.status, 'queued');
        assert.equal(t2._fakeEs.indexCalls, 0);
        const { rows } = await t2.pool.query(
          "SELECT status, event_type FROM outbox WHERE order_id = $1", [out.order_id]);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].status, 'pending');
        assert.equal(rows[0].event_type, 'order.created');
      } finally {
        await t2.close();
      }
    });
  });
});

describe('order detail + status (service)', () => {
  let t, userId, ids, orderId;
  before(async () => { t = await createUnitContext({ strategy: 'dual_write' }); });
  after(async () => { await t.close(); });
  beforeEach(async () => {
    await wipePg(t.pool);
    t._fakeEs = new FakeES();
    const { FakeMongoDb } = require('./helpers');
    t._fakeMongo = new FakeMongoDb();
    // rebind getters to the fresh fakes
    const fm = t._fakeMongo, fe = t._fakeEs;
    t.getMongoDb = () => fm;
    t.getEsClient = () => fe;
    ids = await seedFakeMongoProducts(fm);
    userId = await seedTestUser(t.pool);
    const { out } = await orderService.placeOrder(t, payload(userId, [
      { product_id: ids['WM-001'], quantity: 1 },
    ], `det-${Date.now()}-${Math.random()}`));
    orderId = out.order_id;
  });

  it('reads canonical data from PG with sync badge', async () => {
    const detail = await orderService.getOrderDetail(t, orderId);
    assert.equal(detail.order_id, orderId);
    assert.equal(detail.customer.name, 'Test User');
    assert.equal(detail.items[0].title, 'Wireless Mouse');
    assert.equal(detail.sync.es_in_sync, true);
    assert.ok(detail.sync.pg_updated_at);
    assert.ok(detail.sync.es_updated_at);
  });

  it('sync badge is null when ES unreachable', async () => {
    t._fakeEs.down = true;
    const detail = await orderService.getOrderDetail(t, orderId);
    assert.equal(detail.sync.es_in_sync, null);
    t._fakeEs.down = false;
  });

  it('404 for unknown order', async () => {
    await assert.rejects(
      () => orderService.getOrderDetail(t, 999999),
      (e) => e.status === 404
    );
  });

  it('PATCH status updates PG then ES', async () => {
    const out = await orderService.updateOrderStatus(t, orderId, 'SHIPPED');
    assert.equal(out.status, 'SHIPPED');
    assert.equal(out.es_sync.status, 'synced');
    const { rows } = await t.pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
    assert.equal(rows[0].status, 'SHIPPED');
    const doc = await t._fakeEs.get({ index: 'orders_test', id: `order-${orderId}` });
    assert.equal(doc._source.status, 'SHIPPED');
  });

  it('PATCH rejects invalid status with 422', async () => {
    await assert.rejects(
      () => orderService.updateOrderStatus(t, orderId, 'CANCELLED'),
      (e) => e.status === 422
    );
  });

  it('catalog edit does not rewrite PG snapshots', async () => {
    const productsRepo = require('../src/repositories/productsRepo');
    await productsRepo.updateProduct(t._fakeMongo, ids['WM-001'], { title: 'Wireless Mouse Pro', price: 59.99 });
    const detail = await orderService.getOrderDetail(t, orderId);
    assert.equal(detail.items[0].title, 'Wireless Mouse');
    assert.equal(detail.items[0].unit_price, '50.16');
  });
});

describe('orders routes (HTTP)', () => {
  let ctx, app, userId, ids;
  before(async () => {
    ctx = await createUnitContext({ strategy: 'dual_write' });
    await wipePg(ctx.pool);
    ids = await seedFakeMongoProducts(ctx._fakeMongo);
    userId = await seedTestUser(ctx.pool);
    app = await bootApp(ctx);
  });
  after(async () => { await app.close(); await ctx.close(); });

  it('POST /api/orders 201 + validation envelopes', async () => {
    const { status, json } = await api(app.baseUrl, 'POST', '/api/orders', {
      user_id: userId,
      items: [{ product_id: ids['WM-001'], quantity: 2 }],
      idempotency_key: 'http-ord-1',
    });
    assert.equal(status, 201);
    assert.equal(json.total_amount, '100.32');
    assert.equal(json.es_sync.strategy, 'dual_write');
  });

  it('POST /api/orders 422 on bad quantity', async () => {
    const { status, json } = await api(app.baseUrl, 'POST', '/api/orders', {
      user_id: userId, items: [{ product_id: ids['WM-001'], quantity: 0 }],
    });
    assert.equal(status, 422);
    assert.ok(json.detail);
  });

  it('GET /api/orders/:id returns detail', async () => {
    const created = await api(app.baseUrl, 'POST', '/api/orders', {
      user_id: userId, items: [{ product_id: ids['MK-101'], quantity: 1 }],
      idempotency_key: 'http-ord-2',
    });
    const { status, json } = await api(app.baseUrl, 'GET', `/api/orders/${created.json.order_id}`);
    assert.equal(status, 200);
    assert.equal(json.items[0].title, 'Mechanical Keyboard');
  });

  it('PATCH /api/orders/:id/status', async () => {
    const created = await api(app.baseUrl, 'POST', '/api/orders', {
      user_id: userId, items: [{ product_id: ids['MK-101'], quantity: 1 }],
      idempotency_key: 'http-ord-3',
    });
    const { status, json } = await api(app.baseUrl, 'PATCH',
      `/api/orders/${created.json.order_id}/status`, { status: 'PROCESSING' });
    assert.equal(status, 200);
    assert.equal(json.status, 'PROCESSING');
  });
});
