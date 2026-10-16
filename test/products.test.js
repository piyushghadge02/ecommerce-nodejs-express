'use strict';

/**
 * Products: filtering, inactive hiding, CRUD validation (Mongo only).
 * Uses FakeMongo for repo tests and HTTP-level route tests with real PG.
 */
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const productsRepo = require('../src/repositories/productsRepo');
const {
  FakeMongoDb, createUnitContext, seedFakeMongoProducts,
  createTestContext, wipePg, bootApp, api,
} = require('./helpers');

describe('products repo (fake mongo)', () => {
  let fake;
  before(() => { fake = new FakeMongoDb(); });
  beforeEach(async () => {
    fake = new FakeMongoDb();
    await seedFakeMongoProducts(fake);
  });

  it('lists active products by default, hiding inactive', async () => {
    const all = await productsRepo.listProducts(fake, {});
    assert.equal(all.length, 2);
    assert.ok(all.every((p) => p.active));
    assert.ok(!all.some((p) => p.title === 'Old CRT'));
  });

  it('active=all includes the inactive product', async () => {
    const all = await productsRepo.listProducts(fake, { active: null });
    assert.equal(all.length, 3);
  });

  it('active=false returns only inactive', async () => {
    const docs = await productsRepo.listProducts(fake, { active: false });
    assert.equal(docs.length, 1);
    assert.equal(docs[0].title, 'Old CRT');
  });

  it('category filter', async () => {
    const docs = await productsRepo.listProducts(fake, { category: 'office' });
    assert.equal(docs.length, 0); // CRT is inactive and hidden
    const all = await productsRepo.listProducts(fake, { category: 'office', active: null });
    assert.equal(all.length, 1);
  });

  it('q matches title/description/tags case-insensitively', async () => {
    const byTitle = await productsRepo.listProducts(fake, { q: 'wireless' });
    assert.equal(byTitle.length, 1);
    const byTag = await productsRepo.listProducts(fake, { q: 'WIRELESS' });
    assert.equal(byTag.length, 1);
    const none = await productsRepo.listProducts(fake, { q: 'zzz-no-match' });
    assert.equal(none.length, 0);
  });

  it('serializes ObjectId to string id', async () => {
    const docs = await productsRepo.listProducts(fake, {});
    assert.equal(typeof docs[0].id, 'string');
    assert.ok(!('_id' in docs[0]));
  });

  it('getProduct returns null for invalid ids', async () => {
    assert.equal(await productsRepo.getProduct(fake, 'not-an-objectid'), null);
  });

  it('create + update round-trip', async () => {
    const created = await productsRepo.createProduct(fake, {
      sku: 'NEW-1', title: 'New Thing', price: 9.99, category: 'office',
      tags: [], attributes: {}, variants: [{ sku: 'NEW-1-A', stock: 3 }], active: true,
    });
    assert.equal(created.title, 'New Thing');
    const updated = await productsRepo.updateProduct(fake, created.id, { price: 12.5 });
    assert.equal(Number(updated.price), 12.5);
  });

  it('duplicate sku raises DuplicateSkuError', async () => {
    await assert.rejects(
      () => productsRepo.createProduct(fake, {
        sku: 'WM-001', title: 'Dup', price: 1, category: 'office',
        tags: [], attributes: {}, variants: [{ sku: 'X', stock: 1 }], active: true,
      }),
      (err) => err instanceof productsRepo.DuplicateSkuError
    );
  });

  it('update of missing product returns null', async () => {
    const { ObjectId } = require('mongodb');
    assert.equal(await productsRepo.updateProduct(fake, String(new ObjectId()), { price: 2 }), null);
  });
});

describe('products routes (HTTP)', () => {
  let ctx, app;
  before(async () => {
    ctx = await createUnitContext({});
    await wipePg(ctx.pool);
    await seedFakeMongoProducts(ctx._fakeMongo);
    app = await bootApp(ctx);
  });
  after(async () => { await app.close(); await ctx.close(); });

  it('GET /api/products hides inactive by default', async () => {
    const { status, json } = await api(app.baseUrl, 'GET', '/api/products');
    assert.equal(status, 200);
    assert.equal(json.length, 2);
    assert.ok(json.every((p) => p.active));
  });

  it('GET /api/products?active=all shows inactive', async () => {
    const { status, json } = await api(app.baseUrl, 'GET', '/api/products?active=all');
    assert.equal(status, 200);
    assert.equal(json.length, 3);
  });

  it('GET /api/products?category=&q= filters', async () => {
    const { json } = await api(app.baseUrl, 'GET', '/api/products?category=peripherals&q=keyboard');
    assert.equal(json.length, 1);
    assert.equal(json[0].title, 'Mechanical Keyboard');
  });

  it('GET /api/products/:id 404 for unknown', async () => {
    const { status, json } = await api(app.baseUrl, 'GET', '/api/products/012345678901234567890123');
    assert.equal(status, 404);
    assert.match(json.detail, /product not found/);
  });

  it('POST /api/products validates and 201s', async () => {
    const { status, json } = await api(app.baseUrl, 'POST', '/api/products', {
      sku: 'HTTP-1', title: 'HTTP Thing', price: 19.99, category: 'cables',
      variants: [{ sku: 'HTTP-1-A', stock: 2 }],
    });
    assert.equal(status, 201);
    assert.equal(json.sku, 'HTTP-1');
    assert.equal(json.price, 19.99);
  });

  it('POST /api/products 422 on bad payload, 409 on duplicate sku', async () => {
    const bad = await api(app.baseUrl, 'POST', '/api/products', { sku: 'X', title: 'T' });
    assert.equal(bad.status, 422);
    const dup = await api(app.baseUrl, 'POST', '/api/products', {
      sku: 'HTTP-1', title: 'Dup', price: 1, category: 'cables',
      variants: [{ sku: 'D', stock: 1 }],
    });
    assert.equal(dup.status, 409);
    assert.match(dup.json.detail, /duplicate sku/);
  });

  it('PUT /api/products/:id edits mongo only', async () => {
    const list = await api(app.baseUrl, 'GET', '/api/products?q=HTTP+Thing');
    const id = list.json[0].id;
    const { status, json } = await api(app.baseUrl, 'PUT', `/api/products/${id}`, { title: 'Renamed Thing' });
    assert.equal(status, 200);
    assert.equal(json.title, 'Renamed Thing');
    const empty = await api(app.baseUrl, 'PUT', `/api/products/${id}`, {});
    assert.equal(empty.status, 422);
  });
});
