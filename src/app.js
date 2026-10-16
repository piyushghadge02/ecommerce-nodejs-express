'use strict';

/**
 * Express application factory.
 *
 * Mirrors app/main.py from the Python reference implementation: CORS for the
 * Vite dev origin, JSON body parsing, the six routers, and a final error
 * middleware that always returns the `{detail: ...}` envelope (never stack
 * traces or secrets to clients).
 */
const express = require('express');
const cors = require('cors');
const { getLogger } = require('./logger');
const { HttpError } = require('./services/orderService');
const { usersRouter } = require('./routes/users');
const { productsRouter } = require('./routes/products');
const { ordersRouter } = require('./routes/orders');
const { searchRouter } = require('./routes/search');
const { healthRouter } = require('./routes/health');
const { adminRouter } = require('./routes/admin');

const log = getLogger('app');

function createApp(ctx) {
  const app = express();

  // Demo POC: allow all origins (Cloudflare Pages frontends call from public URLs).
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.use(usersRouter(ctx));
  app.use(productsRouter(ctx));
  app.use(ordersRouter(ctx));
  app.use(searchRouter(ctx));
  app.use(healthRouter(ctx));
  app.use(adminRouter(ctx));

  // 404 for unknown API routes (keeps the envelope consistent).
  app.use('/api', (req, res) => {
    res.status(404).json({ detail: `not found: ${req.method} ${req.path}` });
  });

  // Final error handler: `{detail}` envelope, no stack traces to clients.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ detail: err.detail });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ detail: 'invalid JSON body' });
    }
    log.error('unhandled error', { error: String(err && err.stack || err) });
    return res.status(500).json({ detail: 'internal server error' });
  });

  return app;
}

module.exports = { createApp };
