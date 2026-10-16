'use strict';

/**
 * Request validation helpers. All failures produce the API error envelope
 * `{detail: "..."}` with the same status codes the Python/FastAPI reference
 * produces (422 for schema validation, 400/404/409/503 for business errors).
 */
const { HttpError } = require('../services/orderService');

const STATUSES = ['PENDING', 'PROCESSING', 'SHIPPED'];

function fail(status, detail) {
  throw new HttpError(status, detail);
}

function isInt(v) {
  return typeof v === 'number' && Number.isInteger(v);
}

function asDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) fail(422, `invalid ${field}: ${value}`);
  return d;
}

/** Wrap async route handlers so rejections reach the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function validateOrderCreate(body) {
  if (!body || typeof body !== 'object') fail(422, 'request body must be a JSON object');
  if (!isInt(body.user_id)) fail(422, 'user_id must be an integer');
  if (!Array.isArray(body.items) || body.items.length < 1) {
    fail(422, 'items must be a non-empty array');
  }
  const items = body.items.map((it, i) => {
    if (!it || typeof it !== 'object') fail(422, `items[${i}] must be an object`);
    if (typeof it.product_id !== 'string' || !it.product_id) {
      fail(422, `items[${i}].product_id must be a non-empty string`);
    }
    if (!isInt(it.quantity) || it.quantity < 1) {
      fail(422, `items[${i}].quantity must be an integer >= 1`);
    }
    return { product_id: it.product_id, quantity: it.quantity };
  });
  let idempotencyKey = null;
  if (body.idempotency_key !== undefined && body.idempotency_key !== null) {
    if (typeof body.idempotency_key !== 'string' || !body.idempotency_key) {
      fail(422, 'idempotency_key must be a non-empty string');
    }
    idempotencyKey = body.idempotency_key;
  }
  return { user_id: body.user_id, items, idempotency_key: idempotencyKey };
}

function validateProductCreate(body) {
  if (!body || typeof body !== 'object') fail(422, 'request body must be a JSON object');
  const { sku, title, description = null, price, category,
    tags = [], attributes = {}, variants, active = true } = body;
  if (typeof sku !== 'string' || !sku.trim()) fail(422, 'sku must be a non-empty string');
  if (typeof title !== 'string' || !title.trim()) fail(422, 'title must be a non-empty string');
  if (typeof category !== 'string' || !category.trim()) fail(422, 'category must be a non-empty string');
  if (typeof price !== 'number' || !(price > 0)) fail(422, 'price must be a number > 0');
  if (!Array.isArray(variants) || variants.length < 1) fail(422, 'variants must be a non-empty array');
  for (const [i, v] of variants.entries()) {
    if (!v || typeof v !== 'object' || typeof v.sku !== 'string' || !v.sku) {
      fail(422, `variants[${i}].sku must be a non-empty string`);
    }
  }
  if (!Array.isArray(tags)) fail(422, 'tags must be an array');
  if (attributes === null || typeof attributes !== 'object' || Array.isArray(attributes)) {
    fail(422, 'attributes must be an object');
  }
  return { sku, title, description, price, category, tags, attributes, variants, active: Boolean(active) };
}

function validateProductUpdate(body) {
  if (!body || typeof body !== 'object') fail(422, 'request body must be a JSON object');
  const allowed = ['sku', 'title', 'description', 'price', 'category', 'tags', 'attributes', 'variants', 'active'];
  const patch = {};
  for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
  if (Object.keys(patch).length === 0) fail(422, 'empty update');
  if (patch.sku !== undefined && (typeof patch.sku !== 'string' || !patch.sku.trim())) {
    fail(422, 'sku must not be blank');
  }
  if (patch.title !== undefined && (typeof patch.title !== 'string' || !patch.title.trim())) {
    fail(422, 'title must not be blank');
  }
  if (patch.price !== undefined && (typeof patch.price !== 'number' || !(patch.price > 0))) {
    fail(422, 'price must be > 0');
  }
  if (patch.variants !== undefined && (!Array.isArray(patch.variants) || patch.variants.length < 1)) {
    fail(422, 'variants must be a non-empty array');
  }
  return patch;
}

const SORT_FIELDS = ['order_date', 'total_amount', 'order_id'];

function validateSearch(body) {
  if (!body || typeof body !== 'object') fail(422, 'request body must be a JSON object');
  const params = {
    q: null, statuses: null, date_from: null, date_to: null,
    min_total: null, max_total: null,
    sort_by: 'order_date', sort_dir: 'desc', page: 1, page_size: 20,
  };
  if (body.q !== undefined && body.q !== null) {
    if (typeof body.q !== 'string') fail(422, 'q must be a string');
    params.q = body.q;
  }
  if (body.statuses !== undefined && body.statuses !== null) {
    if (!Array.isArray(body.statuses)) fail(422, 'statuses must be an array');
    for (const s of body.statuses) {
      if (!STATUSES.includes(s)) fail(422, `invalid status: ${s}`);
    }
    params.statuses = [...body.statuses];
  }
  if (body.date_from !== undefined && body.date_from !== null && body.date_from !== '') {
    const d = asDate(body.date_from, 'date_from');
    params.date_from = d.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  if (body.date_to !== undefined && body.date_to !== null && body.date_to !== '') {
    const d = asDate(body.date_to, 'date_to');
    params.date_to = d.toISOString().slice(0, 10);
  }
  if (body.min_total !== undefined && body.min_total !== null) {
    if (typeof body.min_total !== 'number') fail(422, 'min_total must be a number');
    params.min_total = body.min_total;
  }
  if (body.max_total !== undefined && body.max_total !== null) {
    if (typeof body.max_total !== 'number') fail(422, 'max_total must be a number');
    params.max_total = body.max_total;
  }
  if (body.sort_by !== undefined && body.sort_by !== null) {
    if (!SORT_FIELDS.includes(body.sort_by)) fail(422, `invalid sort_by: ${body.sort_by}`);
    params.sort_by = body.sort_by;
  }
  if (body.sort_dir !== undefined && body.sort_dir !== null) {
    if (!['asc', 'desc'].includes(body.sort_dir)) fail(422, `invalid sort_dir: ${body.sort_dir}`);
    params.sort_dir = body.sort_dir;
  }
  if (body.page !== undefined && body.page !== null) {
    if (!isInt(body.page) || body.page < 1) fail(422, 'page must be an integer >= 1');
    params.page = body.page;
  }
  if (body.page_size !== undefined && body.page_size !== null) {
    if (!isInt(body.page_size) || body.page_size < 1 || body.page_size > 100) {
      fail(422, 'page_size must be an integer between 1 and 100');
    }
    params.page_size = body.page_size;
  }
  return params;
}

module.exports = {
  STATUSES,
  fail,
  asyncHandler,
  validateOrderCreate,
  validateProductCreate,
  validateProductUpdate,
  validateSearch,
};
