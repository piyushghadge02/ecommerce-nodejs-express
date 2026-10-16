'use strict';

/** Health checks for the app and each database dependency. */
const express = require('express');
const { asyncHandler } = require('./validate');

function healthRouter(ctx) {
  const router = express.Router();

  router.get('/api/health', asyncHandler(async (req, res) => {
    const [pg, mongo, esUp] = await Promise.all([
      ctx.pgPing(),
      ctx.mongoPing(),
      ctx.esPing(),
    ]);
    res.json({
      status: pg && mongo && esUp ? 'ok' : 'degraded',
      postgres: pg ? 'up' : 'down',
      mongodb: mongo ? 'up' : 'down',
      elasticsearch: esUp ? 'up' : 'down',
      sync_strategy: ctx.config.SYNC_STRATEGY,
    });
  }));

  return router;
}

module.exports = { healthRouter };
