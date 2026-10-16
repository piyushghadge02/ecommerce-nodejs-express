'use strict';

/**
 * Elasticsearch repository: the `orders` index.
 *
 * The admin search dashboard reads ONLY from Elasticsearch. Documents are
 * denormalized snapshots (titles/prices copied at checkout) with deterministic
 * document IDs `order-<order_id>` so every upsert is idempotent.
 *
 * `items` uses a **nested** mapping: a plain object mapping would flatten the
 * items arrays and produce false cross-item matches. The search query therefore
 * uses a nested query for `items.title` alongside a top-level multi_match.
 *
 * Mirrors repositories/search_repo.py from the Python reference implementation.
 */
const { getLogger } = require('../logger');
const { centsToFloat, toCents } = require('../money');

const log = getLogger('searchRepo');

const ORDERS_MAPPING = {
  mappings: {
    properties: {
      order_id: { type: 'long' },
      order_date: { type: 'date' },
      status: { type: 'keyword' },
      total_amount: { type: 'double' },
      updated_at: { type: 'date' },
      customer: {
        type: 'object',
        properties: {
          id: { type: 'long' },
          name: {
            type: 'text',
            fields: { keyword: { type: 'keyword', ignore_above: 256 } },
          },
          email: { type: 'keyword' },
        },
      },
      items: {
        type: 'nested',
        properties: {
          product_id: { type: 'keyword' },
          title: {
            type: 'text',
            fields: { keyword: { type: 'keyword', ignore_above: 256 } },
          },
          quantity: { type: 'integer' },
          unit_price: { type: 'double' },
        },
      },
    },
  },
};

const SORT_FIELDS = {
  order_date: 'order_date',
  total_amount: 'total_amount',
  order_id: 'order_id',
};

function docId(orderId) {
  return `order-${orderId}`;
}

function iso(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString();
}

/** Build the denormalized ES document from PG rows (snapshots only). */
function buildOrderDoc(order, user, items) {
  return {
    order_id: order.id,
    order_date: iso(order.orderDate),
    status: order.status,
    total_amount: centsToFloat(order.totalAmountCents),
    updated_at: iso(order.updatedAt),
    customer: { id: user.id, name: user.name, email: user.email },
    items: items.map((item) => ({
      product_id: item.productId,
      title: item.title,
      quantity: item.quantity,
      unit_price: centsToFloat(item.unitPriceCents),
    })),
  };
}

// ------------------------------------------------------------ index ops ---
function isNotFound(err) {
  return err && (err.meta?.statusCode === 404 || err.statusCode === 404);
}

/** Create the index with the explicit mapping if missing. Never throws. */
async function ensureIndex(es, index) {
  try {
    const exists = await es.indices.exists({ index });
    if (!exists) {
      await es.indices.create({ index, ...ORDERS_MAPPING });
      log.info('elasticsearch index created', { index });
    }
    return true;
  } catch (err) {
    log.warn('elasticsearch ensure_index failed', { error: String(err && err.message || err) });
    return false;
  }
}

async function upsertOrderDoc(es, index, doc) {
  await es.index({ index, id: docId(doc.order_id), document: doc });
}

async function getOrderDoc(es, index, orderId) {
  try {
    const resp = await es.get({ index, id: docId(orderId) });
    return resp._source || null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function countDocs(es, index) {
  try {
    const resp = await es.count({ index });
    return Number(resp.count);
  } catch (err) {
    log.warn('elasticsearch count failed', { error: String(err && err.message || err) });
    return null;
  }
}

async function deleteIndex(es, index) {
  try {
    await es.indices.delete({ index, ignore_unavailable: true });
  } catch (err) {
    log.warn('elasticsearch delete_index failed', { error: String(err && err.message || err) });
  }
}

// --------------------------------------------------------------- search ---
/**
 * Build the ES query body: bool + multi_match (+ nested) + filters + aggs.
 *
 * Aggregations run in the SAME filter context as the hits, so revenue and
 * status counts always describe exactly the currently filtered result set.
 */
function buildSearchBody(params) {
  const must = [];
  if (params.q) {
    must.push({
      bool: {
        should: [
          {
            multi_match: {
              query: params.q,
              fields: ['customer.name', 'customer.email', 'items.title'],
              type: 'best_fields',
            },
          },
          { nested: { path: 'items', query: { match: { 'items.title': params.q } } } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  const filters = [];
  if (params.statuses && params.statuses.length) {
    filters.push({ terms: { status: [...params.statuses] } });
  }
  if (params.date_from || params.date_to) {
    const range = {};
    if (params.date_from) range.gte = params.date_from;
    if (params.date_to) range.lte = `${params.date_to}T23:59:59`; // inclusive end of day
    filters.push({ range: { order_date: range } });
  }
  if (params.min_total != null || params.max_total != null) {
    const range = {};
    if (params.min_total != null) range.gte = params.min_total;
    if (params.max_total != null) range.lte = params.max_total;
    filters.push({ range: { total_amount: range } });
  }

  let query;
  if (must.length || filters.length) {
    query = { bool: {} };
    if (must.length) query.bool.must = must;
    if (filters.length) query.bool.filter = filters;
  } else {
    query = { match_all: {} };
  }

  return {
    query,
    sort: [{ [SORT_FIELDS[params.sort_by]]: { order: params.sort_dir } }],
    from: (params.page - 1) * params.page_size,
    size: params.page_size,
    aggs: {
      revenue: { sum: { field: 'total_amount' } },
      by_status: { terms: { field: 'status', size: 10 } },
      total_orders: { value_count: { field: 'order_id' } },
    },
    track_total_hits: true,
  };
}

function coerceDt(value) {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

function parseHit(source) {
  const customer = source.customer || {};
  return {
    order_id: Number(source.order_id),
    order_date: iso(source.order_date),
    customer: {
      id: Number(customer.id || 0),
      name: String(customer.name || ''),
      email: String(customer.email || ''),
    },
    total_amount: Number(source.total_amount || 0),
    status: source.status || 'PENDING',
  };
}

function parseSearchResponse(body, params) {
  const hits = body.hits || {};
  const totalInfo = hits.total || 0;
  const total = typeof totalInfo === 'object' ? (totalInfo.value || 0) : Number(totalInfo);
  const orders = (hits.hits || []).map((h) => parseHit(h._source || {}));

  const aggs = body.aggregations || {};
  const revenue = (aggs.revenue || {}).value || 0;
  const byStatus = {};
  for (const b of (aggs.by_status || {}).buckets || []) byStatus[b.key] = Number(b.doc_count);
  const totalOrders = Number((aggs.total_orders || {}).value || 0);

  return {
    total,
    page: params.page,
    page_size: params.page_size,
    total_pages: total ? Math.max(1, Math.ceil(total / params.page_size)) : 1,
    orders,
    aggs: { revenue: Number(revenue), by_status: byStatus, total_orders: totalOrders },
  };
}

function emptySearchResponse(params) {
  return {
    total: 0, page: params.page, page_size: params.page_size, total_pages: 1, orders: [],
    aggs: { revenue: 0, by_status: {}, total_orders: 0 },
  };
}

async function searchOrders(es, index, params) {
  const body = buildSearchBody(params);
  try {
    const resp = await es.search({ index, ...body });
    return parseSearchResponse(resp, params);
  } catch (err) {
    if (isNotFound(err)) return emptySearchResponse(params); // index missing: empty set
    throw err;
  }
}

module.exports = {
  ORDERS_MAPPING,
  SORT_FIELDS,
  docId,
  iso,
  coerceDt,
  buildOrderDoc,
  ensureIndex,
  upsertOrderDoc,
  getOrderDoc,
  countDocs,
  deleteIndex,
  buildSearchBody,
  parseSearchResponse,
  searchOrders,
  // re-export for tests
  toCents,
};
