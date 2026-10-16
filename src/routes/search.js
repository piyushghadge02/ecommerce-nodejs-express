'use strict';

/** Search API — Elasticsearch ONLY. Never PostgreSQL or MongoDB. */
const express = require('express');
const searchRepo = require('../repositories/searchRepo');
const { asyncHandler, validateSearch, fail } = require('./validate');

function searchRouter(ctx) {
  const router = express.Router();

  router.post('/api/search/orders', asyncHandler(async (req, res) => {
    const params = validateSearch(req.body);
    const es = ctx.getEsClient();
    let reachable = true;
    try {
      reachable = await es.ping();
    } catch {
      reachable = false;
    }
    if (!reachable) {
      fail(503, 'search unavailable: elasticsearch unreachable');
    }
    res.json(await searchRepo.searchOrders(es, ctx.config.ES_INDEX, params));
  }));

  return router;
}

module.exports = { searchRouter };
