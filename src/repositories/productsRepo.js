'use strict';

/**
 * MongoDB repository: product catalog.
 *
 * The storefront reads products ONLY from MongoDB. Catalog admin writes go to
 * MongoDB only — historical PostgreSQL order items and Elasticsearch documents
 * are never rewritten on catalog edits.
 *
 * Mirrors repositories/products_repo.py from the Python reference implementation.
 */
const { ObjectId } = require('mongodb');
const { getLogger } = require('../logger');

const log = getLogger('productsRepo');
const PRODUCTS_COLLECTION = 'products';

class DuplicateSkuError extends Error {
  constructor(sku) {
    super(`duplicate sku: ${sku}`);
    this.name = 'DuplicateSkuError';
  }
}

function isDuplicateKeyError(err) {
  return err && (err.code === 11000 || err.codeName === 'DuplicateKey');
}

/** Convert a raw Mongo document into the API shape (ObjectId -> string id). */
function serializeProduct(doc) {
  const out = { ...doc };
  out.id = String(out._id);
  delete out._id;
  return out;
}

async function ensureIndexes(db) {
  const coll = db.collection(PRODUCTS_COLLECTION);
  await coll.createIndex({ sku: 1 }, { unique: true });
  await coll.createIndex({ category: 1 });
  await coll.createIndex({ active: 1 });
}

/**
 * List products. `active: null` means all; default `true` hides inactive.
 * `q` is a case-insensitive substring match across title/description/tags.
 */
async function listProducts(db, { category = null, q = null, active = true } = {}) {
  const query = {};
  if (active !== null && active !== undefined) query.active = Boolean(active);
  if (category) query.category = category;
  if (q) {
    // Escape regex metacharacters so the query stays a literal substring match.
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [{ title: rx }, { description: rx }, { tags: rx }];
  }
  const docs = await db.collection(PRODUCTS_COLLECTION).find(query).sort({ title: 1 }).toArray();
  return docs.map(serializeProduct);
}

async function getProduct(db, productId) {
  if (!ObjectId.isValid(productId)) return null;
  const doc = await db.collection(PRODUCTS_COLLECTION).findOne({ _id: new ObjectId(productId) });
  return doc ? serializeProduct(doc) : null;
}

async function createProduct(db, payload) {
  const doc = { ...payload, updated_at: new Date() };
  try {
    const result = await db.collection(PRODUCTS_COLLECTION).insertOne(doc);
    const created = await db.collection(PRODUCTS_COLLECTION).findOne({ _id: result.insertedId });
    log.info('product created', { sku: payload.sku });
    return serializeProduct(created);
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new DuplicateSkuError(payload.sku);
    throw err;
  }
}

async function updateProduct(db, productId, patch) {
  if (!ObjectId.isValid(productId)) return null;
  const update = { ...patch, updated_at: new Date() };
  try {
    const result = await db.collection(PRODUCTS_COLLECTION)
      .updateOne({ _id: new ObjectId(productId) }, { $set: update });
    if (result.matchedCount === 0) return null;
    const doc = await db.collection(PRODUCTS_COLLECTION).findOne({ _id: new ObjectId(productId) });
    log.info('product updated', { product_id: productId });
    return serializeProduct(doc);
  } catch (err) {
    if (isDuplicateKeyError(err)) throw new DuplicateSkuError(patch.sku);
    throw err;
  }
}

module.exports = {
  PRODUCTS_COLLECTION,
  DuplicateSkuError,
  serializeProduct,
  ensureIndexes,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
};
