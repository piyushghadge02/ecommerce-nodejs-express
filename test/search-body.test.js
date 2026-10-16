'use strict';

/** Unit tests: ES query-body construction (bool + multi_match + nested + aggs). */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const searchRepo = require('../src/repositories/searchRepo');

function params(overrides = {}) {
  return {
    q: null, statuses: null, date_from: null, date_to: null,
    min_total: null, max_total: null,
    sort_by: 'order_date', sort_dir: 'desc', page: 1, page_size: 20,
    ...overrides,
  };
}

describe('buildSearchBody', () => {
  it('match_all when no q and no filters', () => {
    const body = searchRepo.buildSearchBody(params());
    assert.deepEqual(body.query, { match_all: {} });
    assert.equal(body.size, 20);
    assert.equal(body.from, 0);
  });

  it('q produces multi_match + nested query with minimum_should_match', () => {
    const body = searchRepo.buildSearchBody(params({ q: 'wireless' }));
    const should = body.query.bool.must[0].bool.should;
    assert.equal(should.length, 2);
    assert.deepEqual(should[0].multi_match.fields, ['customer.name', 'customer.email', 'items.title']);
    assert.equal(should[0].multi_match.query, 'wireless');
    assert.equal(should[1].nested.path, 'items');
    assert.deepEqual(should[1].nested.query, { match: { 'items.title': 'wireless' } });
    assert.equal(body.query.bool.must[0].bool.minimum_should_match, 1);
  });

  it('applies status/date/total filters', () => {
    const body = searchRepo.buildSearchBody(params({
      statuses: ['PENDING', 'SHIPPED'],
      date_from: '2026-07-01', date_to: '2026-10-16',
      min_total: 30, max_total: 150,
    }));
    const filters = body.query.bool.filter;
    assert.deepEqual(filters[0], { terms: { status: ['PENDING', 'SHIPPED'] } });
    assert.deepEqual(filters[1], { range: { order_date: { gte: '2026-07-01', lte: '2026-10-16T23:59:59' } } });
    assert.deepEqual(filters[2], { range: { total_amount: { gte: 30, lte: 150 } } });
  });

  it('sorting and pagination', () => {
    const body = searchRepo.buildSearchBody(params({ sort_by: 'total_amount', sort_dir: 'asc', page: 3, page_size: 10 }));
    assert.deepEqual(body.sort, [{ total_amount: { order: 'asc' } }]);
    assert.equal(body.from, 20);
    assert.equal(body.size, 10);
  });

  it('aggregations run in the same query scope', () => {
    const body = searchRepo.buildSearchBody(params({ q: 'x' }));
    assert.ok(body.aggs.revenue.sum);
    assert.ok(body.aggs.by_status.terms);
    assert.ok(body.aggs.total_orders.value_count);
    assert.equal(body.track_total_hits, true);
  });
});

describe('parseSearchResponse', () => {
  it('parses hits and aggregations', () => {
    const body = {
      hits: {
        total: { value: 2, relation: 'eq' },
        hits: [
          { _source: { order_id: 7, order_date: '2026-10-01T00:00:00+00:00', status: 'PENDING', total_amount: 50.16, customer: { id: 3, name: 'Wendy Wireless', email: 'w@e.com' } } },
        ],
      },
      aggregations: {
        revenue: { value: 150.5 },
        by_status: { buckets: [{ key: 'PENDING', doc_count: 2 }] },
        total_orders: { value: 2 },
      },
    };
    const out = searchRepo.parseSearchResponse(body, params({ page_size: 20 }));
    assert.equal(out.total, 2);
    assert.equal(out.orders[0].customer.name, 'Wendy Wireless');
    assert.equal(out.aggs.revenue, 150.5);
    assert.deepEqual(out.aggs.by_status, { PENDING: 2 });
    assert.equal(out.aggs.total_orders, 2);
    assert.equal(out.total_pages, 1);
  });

  it('deterministic document ids', () => {
    assert.equal(searchRepo.docId(42), 'order-42');
  });
});
