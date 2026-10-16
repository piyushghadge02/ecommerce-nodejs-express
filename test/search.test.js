'use strict';

/**
 * Search: real Elasticsearch (`orders_test` index) + real PG (`ecommerce_test`).
 * Covers q across customer names + item titles, status/date/price filters,
 * aggregation correctness vs filters, sorting, pagination, and HTTP routes.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const searchRepo = require('../src/repositories/searchRepo');
const ordersRepo = require('../src/repositories/ordersRepo');
const { toCents } = require('../src/money');
const {
  createTestContext, wipePg, seedTestUser, wipeRealTestNamespaces, bootApp, api,
} = require('./helpers');

async function makeOrder(ctx, userId, lines, { status = 'PENDING', daysAgo = 0 } = {}) {
  const orderDate = new Date(Date.now() - daysAgo * 86400000);
  const { order } = await ordersRepo.createOrder(ctx.pool, {
    userId,
    lines: lines.map(([title, qty, cents]) => ({
      productId: `prod-${title}`, title, quantity: qty, unitPriceCents: cents,
    })),
    orderDate,
    updatedAt: orderDate,
  });
  if (status !== 'PENDING') await ordersRepo.updateOrderStatus(ctx.pool, order.id, status);
  return order.id;
}

describe('search integration (real ES)', () => {
  let ctx;
  before(async () => {
    ctx = await createTestContext({ SYNC_STRATEGY: 'dual_write' });
  });
  after(async () => { await ctx.close(); });
  beforeEach(async () => {
    await wipePg(ctx.pool);
    await wipeRealTestNamespaces();
  });

  async function fixture() {
    const wendy = await seedTestUser(ctx.pool, 'Wendy Wireless', 'wendy.wireless@example.com');
    const john = await seedTestUser(ctx.pool, 'John Doe', 'john.doe@example.com');
    const ids = [];
    ids.push(await makeOrder(ctx, wendy, [['Wireless Mouse', 1, toCents(50.16)]], { status: 'PENDING', daysAgo: 1 }));
    ids.push(await makeOrder(ctx, john, [['Wireless Mouse', 2, toCents(50.16)]], { status: 'SHIPPED', daysAgo: 70 }));
    ids.push(await makeOrder(ctx, john, [['Mechanical Keyboard', 1, toCents(100.34)]], { status: 'PROCESSING', daysAgo: 3 }));
    ids.push(await makeOrder(ctx, wendy, [['USB Cable', 1, toCents(9.99)]], { status: 'PENDING', daysAgo: 2 }));
    await ctx.getEsClient().indices.refresh({ index: 'orders_test' });
    // index via reindexAll (PG -> ES, snapshots only)
    const syncService = require('../src/services/syncService');
    const n = await syncService.reindexAll(ctx);
    assert.equal(n, 4);
    await ctx.getEsClient().indices.refresh({ index: 'orders_test' });
    return { wendy, john, ids };
  }

  function baseParams(overrides = {}) {
    return {
      q: null, statuses: null, date_from: null, date_to: null,
      min_total: null, max_total: null,
      sort_by: 'order_date', sort_dir: 'desc', page: 1, page_size: 20,
      ...overrides,
    };
  }

  it('q=wireless matches item titles AND customer name', async () => {
    await fixture();
    const es = ctx.getEsClient();
    const out = await searchRepo.searchOrders(es, 'orders_test', baseParams({ q: 'wireless' }));
    assert.equal(out.total, 3); // 2x Wireless Mouse items + Wendy's USB Cable order (name)
    const names = out.orders.map((o) => o.customer.name);
    assert.ok(names.includes('Wendy Wireless'));
  });

  it('status filter narrows results', async () => {
    await fixture();
    const es = ctx.getEsClient();
    const pending = await searchRepo.searchOrders(es, 'orders_test', baseParams({ statuses: ['PENDING'] }));
    assert.equal(pending.total, 2);
    assert.ok(pending.orders.every((o) => o.status === 'PENDING'));
  });

  it('date range filter', async () => {
    await fixture();
    const es = ctx.getEsClient();
    const recent = await searchRepo.searchOrders(es, 'orders_test', baseParams({
      date_from: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    }));
    assert.equal(recent.total, 3); // excludes the 70-day-old order
  });

  it('price range filter', async () => {
    await fixture();
    const es = ctx.getEsClient();
    const cheap = await searchRepo.searchOrders(es, 'orders_test', baseParams({ max_total: 30 }));
    assert.equal(cheap.total, 1);
    assert.equal(cheap.orders[0].total_amount, 9.99);
  });

  it('aggregations reflect the active filters', async () => {
    await fixture();
    const es = ctx.getEsClient();
    const out = await searchRepo.searchOrders(es, 'orders_test', baseParams({ statuses: ['PENDING'] }));
    // PENDING: 50.16 + 9.99 = 60.15
    assert.ok(Math.abs(out.aggs.revenue - 60.15) < 0.01, `revenue=${out.aggs.revenue}`);
    assert.deepEqual(out.aggs.by_status, { PENDING: 2 });
    assert.equal(out.aggs.total_orders, 2);
  });

  it('sorting and pagination', async () => {
    await fixture();
    const es = ctx.getEsClient();
    const p1 = await searchRepo.searchOrders(es, 'orders_test', baseParams({
      sort_by: 'total_amount', sort_dir: 'asc', page: 1, page_size: 2,
    }));
    assert.equal(p1.total, 4);
    assert.equal(p1.total_pages, 2);
    assert.ok(p1.orders[0].total_amount <= p1.orders[1].total_amount);
    const p2 = await searchRepo.searchOrders(es, 'orders_test', baseParams({
      sort_by: 'total_amount', sort_dir: 'asc', page: 2, page_size: 2,
    }));
    assert.equal(p2.orders.length, 2);
    assert.ok(!p1.orders.some((a) => p2.orders.some((b) => b.order_id === a.order_id)));
  });

  it('POST /api/search/orders via HTTP', async () => {
    await fixture();
    const app = await bootApp(ctx);
    try {
      const { status, json } = await api(app.baseUrl, 'POST', '/api/search/orders', {
        q: 'keyboard', page: 1, page_size: 20,
      });
      assert.equal(status, 200);
      assert.equal(json.total, 1);
      assert.equal(json.orders[0].customer.name, 'John Doe');
      assert.ok(json.aggs);
    } finally {
      await app.close();
    }
  });

  it('search validation 422s', async () => {
    const app = await bootApp(ctx);
    try {
      const bad = await api(app.baseUrl, 'POST', '/api/search/orders', { page_size: 500 });
      assert.equal(bad.status, 422);
      const badSort = await api(app.baseUrl, 'POST', '/api/search/orders', { sort_by: 'nope' });
      assert.equal(badSort.status, 422);
    } finally {
      await app.close();
    }
  });
});
