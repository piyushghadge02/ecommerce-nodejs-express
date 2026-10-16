'use strict';

/** Products API — MongoDB ONLY (catalog reads/writes never touch PG/ES). */
const express = require('express');
const productsRepo = require('../repositories/productsRepo');
const { asyncHandler, validateProductCreate, validateProductUpdate, fail } = require('./validate');

function productOut(doc) {
  return {
    id: doc.id,
    sku: doc.sku,
    title: doc.title,
    description: doc.description ?? null,
    price: Number(doc.price),
    category: doc.category,
    tags: doc.tags ?? [],
    attributes: doc.attributes ?? {},
    variants: doc.variants ?? [],
    active: doc.active ?? true,
    updated_at: doc.updated_at ? new Date(doc.updated_at).toISOString() : null,
  };
}

function productsRouter(ctx) {
  const router = express.Router();

  router.get('/api/products', asyncHandler(async (req, res) => {
    const activeParam = req.query.active ?? 'true';
    if (!['true', 'false', 'all'].includes(activeParam)) {
      fail(422, `invalid active filter: ${activeParam}`);
    }
    const active = { true: true, false: false, all: null }[activeParam];
    const docs = await productsRepo.listProducts(ctx.getMongoDb(), {
      category: req.query.category || null,
      q: req.query.q || null,
      active,
    });
    res.json(docs.map(productOut));
  }));

  router.get('/api/products/:productId', asyncHandler(async (req, res) => {
    const doc = await productsRepo.getProduct(ctx.getMongoDb(), req.params.productId);
    if (!doc) fail(404, `product not found: ${req.params.productId}`);
    res.json(productOut(doc));
  }));

  router.post('/api/products', asyncHandler(async (req, res) => {
    const payload = validateProductCreate(req.body);
    try {
      const doc = await productsRepo.createProduct(ctx.getMongoDb(), payload);
      res.status(201).json(productOut(doc));
    } catch (err) {
      if (err instanceof productsRepo.DuplicateSkuError) fail(409, err.message);
      throw err;
    }
  }));

  router.put('/api/products/:productId', asyncHandler(async (req, res) => {
    const patch = validateProductUpdate(req.body);
    try {
      const doc = await productsRepo.updateProduct(ctx.getMongoDb(), req.params.productId, patch);
      if (!doc) fail(404, `product not found: ${req.params.productId}`);
      // Catalog edits touch Mongo only — PG snapshots and ES docs are untouched.
      res.json(productOut(doc));
    } catch (err) {
      if (err instanceof productsRepo.DuplicateSkuError) fail(409, err.message);
      throw err;
    }
  }));

  return router;
}

module.exports = { productsRouter, productOut };
