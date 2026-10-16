'use strict';

/** Admin API: sync backlog visibility and full ES rebuild from PostgreSQL. */
const express = require('express');
const ordersRepo = require('../repositories/ordersRepo');
const searchRepo = require('../repositories/searchRepo');
const syncService = require('../services/syncService');
const { asyncHandler, fail } = require('./validate');

function adminRouter(ctx) {
  const router = express.Router();

  router.get('/api/admin/sync-status', asyncHandler(async (req, res) => {
    const counts = await ordersRepo.countOutboxByStatus(ctx.pool);
    const watermark = await ordersRepo.getSyncState(ctx.pool, ordersRepo.POLLING_WATERMARK_KEY);
    let docs = null;
    try {
      docs = await searchRepo.countDocs(ctx.getEsClient(), ctx.config.ES_INDEX);
    } catch { /* ES down -> null */ }
    res.json({
      outbox_pending: (counts.pending || 0) + (counts.processing || 0),
      outbox_failed: counts.failed || 0,
      polling_watermark: watermark,
      elasticsearch_docs: docs,
    });
  }));

  router.post('/api/admin/reindex', asyncHandler(async (req, res) => {
    let reachable = true;
    try {
      reachable = await ctx.getEsClient().ping();
    } catch {
      reachable = false;
    }
    if (!reachable) {
      fail(503, 'reindex unavailable: elasticsearch unreachable');
    }
    const indexed = await syncService.reindexAll(ctx);
    res.json({ indexed });
  }));

  return router;
}

module.exports = { adminRouter };
