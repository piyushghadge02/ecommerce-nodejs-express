'use strict';

/**
 * Shared test helpers: in-memory fakes (FakeMongo / FakeES), isolated test
 * contexts (PG `ecommerce_test`, Mongo `ecommerce_test`, ES `orders_test`),
 * and wipe/seed utilities.
 */
const { ObjectId } = require('mongodb');
const { loadConfig } = require('../src/config');
const { createContext } = require('../src/db');
const { ensureSchema } = require('../src/schema');
const searchRepo = require('../src/repositories/searchRepo');
const { createApp } = require('../src/app');

const TEST_ES_INDEX = 'orders_test';
const TEST_MONGO_DB = 'ecommerce_test';
const TEST_PG_DSN = 'postgresql://ecom:ecom@localhost:5432/ecommerce_test';

function testConfig(overrides = {}) {
  return loadConfig({
    POSTGRES_DSN: TEST_PG_DSN,
    MONGO_DB: TEST_MONGO_DB,
    ES_INDEX: TEST_ES_INDEX,
    SYNC_STRATEGY: 'dual_write',
    ...overrides,
  });
}

// ------------------------------------------------------------- FakeMongo ---
function matchDoc(doc, query) {
  for (const [key, cond] of Object.entries(query || {})) {
    if (key === '$or') {
      if (!cond.some((sub) => matchDoc(doc, sub))) return false;
    } else if (cond instanceof RegExp) {
      const value = doc[key];
      if (Array.isArray(value)) {
        if (!value.some((v) => cond.test(String(v)))) return false;
      } else if (!cond.test(String(value ?? ''))) {
        return false;
      }
    } else if (cond !== null && typeof cond === 'object') {
      if ('$regex' in cond) {
        const rx = new RegExp(cond.$regex, cond.$options || '');
        return matchDoc(doc, { [key]: rx });
      }
      if (JSON.stringify(doc[key]) !== JSON.stringify(cond)) return false;
    } else if (doc[key] !== cond) {
      return false;
    }
  }
  return true;
}

class FakeCursor {
  constructor(docs) { this._docs = docs; }
  sort(spec) {
    const [[key, dir]] = Object.entries(spec);
    this._docs = [...this._docs].sort((a, b) => {
      const av = a[key] ?? '', bv = b[key] ?? '';
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
    return this;
  }
  async toArray() { return this._docs.map((d) => ({ ...d })); }
}

class FakeMongoCollection {
  constructor() { this.docs = new Map(); }
  find(query) {
    const docs = [...this.docs.values()].filter((d) => matchDoc(d, query));
    return new FakeCursor(docs);
  }
  async findOne(filter) {
    for (const d of this.docs.values()) if (matchDoc(d, filter)) return { ...d };
    return null;
  }
  async insertOne(doc) {
    for (const d of this.docs.values()) {
      if (d.sku === doc.sku) {
        const err = new Error(`duplicate sku: ${doc.sku}`);
        err.code = 11000;
        throw err;
      }
    }
    const copy = { ...doc, _id: doc._id || new ObjectId() };
    this.docs.set(String(copy._id), copy);
    return { insertedId: copy._id };
  }
  async updateOne(filter, update) {
    let matched = 0;
    for (const [id, d] of this.docs) {
      if (matchDoc(d, filter)) {
        const newSku = update.$set && update.$set.sku;
        if (newSku && [...this.docs.entries()].some(([oid, v]) => oid !== id && v.sku === newSku)) {
          const err = new Error(`duplicate sku: ${newSku}`);
          err.code = 11000;
          throw err;
        }
        Object.assign(d, { ...update.$set });
        matched = 1;
        break;
      }
    }
    return { matchedCount: matched };
  }
  async deleteMany(filter) {
    let n = 0;
    for (const [id, d] of [...this.docs]) {
      if (matchDoc(d, filter || {})) { this.docs.delete(id); n++; }
    }
    return { deletedCount: n };
  }
  async countDocuments(filter) {
    return [...this.docs.values()].filter((d) => matchDoc(d, filter || {})).length;
  }
  async createIndex() { return 'idx'; }
}

class FakeMongoDb {
  constructor() { this._colls = new Map(); }
  collection(name) {
    if (!this._colls.has(name)) this._colls.set(name, new FakeMongoCollection());
    return this._colls.get(name);
  }
}

// ---------------------------------------------------------------- FakeES ---
function notFoundError(id) {
  const err = new Error(`document ${id} not found`);
  err.meta = { statusCode: 404 };
  return err;
}

class FakeES {
  constructor() {
    this._indices = new Set();
    this._docs = new Map(); // index -> Map(id -> doc)
    this.down = false;
    this.lastSearchBody = null;
    this.indexCalls = 0;
    this.indices = {
      exists: async ({ index }) => this._indices.has(index),
      create: async ({ index }) => { this._indices.add(index); },
      delete: async ({ index }) => { this._indices.delete(index); this._docs.delete(index); },
      refresh: async () => {},
    };
  }
  async ping() { return !this.down; }
  _guard() { if (this.down) throw new Error('fake elasticsearch is down'); }
  _store(index) {
    if (!this._docs.has(index)) this._docs.set(index, new Map());
    return this._docs.get(index);
  }
  async index({ index, id, document }) {
    this._guard();
    this.indexCalls += 1;
    this._store(index).set(id, JSON.parse(JSON.stringify(document)));
    return { result: 'updated' };
  }
  async get({ index, id }) {
    this._guard();
    const doc = this._store(index).get(id);
    if (!doc) throw notFoundError(id);
    return { _source: JSON.parse(JSON.stringify(doc)) };
  }
  async search({ index, ...body }) {
    this._guard();
    this.lastSearchBody = JSON.parse(JSON.stringify(body));
    return {
      hits: { total: { value: 0, relation: 'eq' }, hits: [] },
      aggregations: {
        revenue: { value: 0 },
        by_status: { buckets: [] },
        total_orders: { value: 0 },
      },
    };
  }
  async count({ index }) {
    this._guard();
    return { count: this._store(index).size };
  }
}

// --------------------------------------------------------------- contexts ---
async function createTestContext(overrides = {}) {
  const config = testConfig(overrides);
  const ctx = createContext(config);
  await ensureSchema(ctx.pool);
  return ctx;
}

/** Context whose Mongo/ES clients are fakes (real PG). Creates the PG schema. */
async function createUnitContext({ mongoDb = null, esClient = undefined, strategy = 'dual_write' } = {}) {
  const config = testConfig({ SYNC_STRATEGY: strategy });
  const ctx = createContext(config);
  await ensureSchema(ctx.pool);
  const fakeMongo = mongoDb || new FakeMongoDb();
  const fakeEs = esClient === undefined ? new FakeES() : esClient;
  ctx.getMongoDb = () => fakeMongo;
  ctx.getEsClient = () => fakeEs;
  ctx.esPing = async () => (fakeEs ? fakeEs.ping() : false);
  ctx._fakeMongo = fakeMongo;
  ctx._fakeEs = fakeEs;
  return ctx;
}

async function wipePg(pool) {
  await pool.query('DELETE FROM outbox');
  await pool.query('DELETE FROM order_items');
  await pool.query('DELETE FROM orders');
  await pool.query('DELETE FROM sync_state');
  await pool.query('DELETE FROM users');
}

async function seedTestUser(pool, name = 'Test User', email = 'test.user@example.com') {
  const { rows } = await pool.query(
    'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id', [name, email]
  );
  return rows[0].id;
}

function sampleProducts() {
  const now = new Date();
  return [
    {
      sku: 'WM-001', title: 'Wireless Mouse', description: 'A mouse', price: 50.16,
      category: 'peripherals', tags: ['wireless', 'usb'], attributes: { color: 'black' },
      variants: [{ sku: 'WM-001-BLK', color: 'black', stock: 10 }],
      active: true, updated_at: now,
    },
    {
      sku: 'MK-101', title: 'Mechanical Keyboard', description: 'A keyboard', price: 100.34,
      category: 'peripherals', tags: ['wired'], attributes: { switch: 'brown' },
      variants: [{ sku: 'MK-101-BRN', color: 'black', stock: 5 }],
      active: true, updated_at: now,
    },
    {
      sku: 'CRT-1', title: 'Old CRT', description: 'inactive', price: 10.0,
      category: 'office', tags: [], attributes: {},
      variants: [{ sku: 'CRT-1', stock: 1 }],
      active: false, updated_at: now,
    },
  ];
}

async function seedFakeMongoProducts(fakeMongo) {
  const coll = fakeMongo.collection('products');
  const ids = {};
  for (const p of sampleProducts()) {
    const r = await coll.insertOne(p);
    ids[p.sku] = String(r.insertedId);
  }
  return ids;
}

async function wipeRealTestNamespaces() {
  // Mongo ecommerce_test + ES orders_test (PG is wiped per-test instead).
  const { MongoClient } = require('mongodb');
  const { Client } = require('@elastic/elasticsearch');
  const mongo = new MongoClient('mongodb://localhost:27017', { serverSelectionTimeoutMS: 5000 });
  try {
    await mongo.db(TEST_MONGO_DB).collection('products').deleteMany({});
  } finally {
    await mongo.close();
  }
  const es = new Client({ node: 'http://localhost:9200', requestTimeout: 5000 });
  try {
    await es.indices.delete({ index: TEST_ES_INDEX, ignore_unavailable: true });
    await searchRepo.ensureIndex(es, TEST_ES_INDEX);
  } finally {
    await es.close();
  }
}

/** Boot the Express app on an ephemeral port; returns {baseUrl, close}. */
async function bootApp(ctx) {
  const app = createApp(ctx);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function api(baseUrl, method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}

module.exports = {
  TEST_ES_INDEX,
  TEST_MONGO_DB,
  TEST_PG_DSN,
  testConfig,
  FakeMongoDb,
  FakeMongoCollection,
  FakeES,
  createTestContext,
  createUnitContext,
  wipePg,
  seedTestUser,
  sampleProducts,
  seedFakeMongoProducts,
  wipeRealTestNamespaces,
  bootApp,
  api,
};
