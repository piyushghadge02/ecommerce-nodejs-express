'use strict';

/**
 * Application configuration. Every secret / connection string comes from the
 * environment (or a local `.env` file during development). Nothing is hard-coded.
 *
 * Mirrors app/core/config.py from the Python reference implementation.
 */
require('dotenv').config();

const STRATEGIES = ['dual_write', 'outbox', 'polling'];

function intEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`invalid integer for ${name}: ${raw}`);
  return n;
}

function loadConfig(overrides = {}) {
  const strategy = String(
    overrides.SYNC_STRATEGY ?? process.env.SYNC_STRATEGY ?? 'dual_write'
  ).trim().toLowerCase();
  if (!STRATEGIES.includes(strategy)) {
    throw new Error(`invalid SYNC_STRATEGY: ${strategy} (expected one of ${STRATEGIES.join('|')})`);
  }
  // node-postgres wants a plain `postgresql://` URL; accept the SQLAlchemy-style
  // `postgresql+asyncpg://` form as well for .env compatibility.
  const dsn = overrides.POSTGRES_DSN ?? process.env.POSTGRES_DSN ?? 'postgresql://ecom:ecom@localhost:5432/ecommerce';
  return {
    POSTGRES_DSN: dsn.replace(/^postgresql\+asyncpg:\/\//, 'postgresql://'),
    MONGO_URI: overrides.MONGO_URI ?? process.env.MONGO_URI ?? 'mongodb://localhost:27017',
    MONGO_DB: overrides.MONGO_DB ?? process.env.MONGO_DB ?? 'ecommerce',
    ELASTICSEARCH_URL: overrides.ELASTICSEARCH_URL ?? process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',
    ES_INDEX: overrides.ES_INDEX ?? process.env.ES_INDEX ?? 'orders',
    SYNC_STRATEGY: strategy,
    OUTBOX_POLL_SECONDS: intEnv('OUTBOX_POLL_SECONDS', 2),
    POLLING_INTERVAL_SECONDS: intEnv('POLLING_INTERVAL_SECONDS', 15),
    OUTBOX_MAX_ATTEMPTS: intEnv('OUTBOX_MAX_ATTEMPTS', 10),
    API_HOST: process.env.API_HOST ?? '0.0.0.0',
    API_PORT: intEnv('API_PORT', 8000),
  };
}

module.exports = { loadConfig, STRATEGIES };
