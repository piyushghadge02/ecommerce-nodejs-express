'use strict';

/** Users API — seeded demo users for the storefront 'Log In As' dropdown. */
const express = require('express');
const usersRepo = require('../repositories/usersRepo');
const { asyncHandler } = require('./validate');

function usersRouter(ctx) {
  const router = express.Router();

  router.get('/api/users', asyncHandler(async (req, res) => {
    const users = await usersRepo.listUsers(ctx.pool);
    res.json(users.map((u) => ({ id: u.id, name: u.name, email: u.email })));
  }));

  return router;
}

module.exports = { usersRouter };
