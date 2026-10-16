'use strict';

/** Orders API — PostgreSQL is the source of truth; Mongo only validates prices. */
const express = require('express');
const orderService = require('../services/orderService');
const { asyncHandler, validateOrderCreate, fail } = require('./validate');

function ordersRouter(ctx) {
  const router = express.Router();

  router.post('/api/orders', asyncHandler(async (req, res) => {
    const payload = validateOrderCreate(req.body);
    // Duplicate protection: the same idempotency_key returns the existing order.
    const { out, statusCode } = await orderService.placeOrder(ctx, payload);
    res.status(statusCode).json(out);
  }));

  router.get('/api/orders/:orderId', asyncHandler(async (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (!Number.isInteger(orderId)) fail(404, `order not found: ${req.params.orderId}`);
    res.json(await orderService.getOrderDetail(ctx, orderId));
  }));

  router.patch('/api/orders/:orderId/status', asyncHandler(async (req, res) => {
    const orderId = parseInt(req.params.orderId, 10);
    if (!Number.isInteger(orderId)) fail(404, `order not found: ${req.params.orderId}`);
    if (!req.body || typeof req.body.status !== 'string') {
      fail(422, 'status must be one of PENDING, PROCESSING, SHIPPED');
    }
    res.json(await orderService.updateOrderStatus(ctx, orderId, req.body.status));
  }));

  return router;
}

module.exports = { ordersRouter };
