'use strict';

/**
 * Application bootstrap.
 *
 * Startup:
 * 1. Create PostgreSQL tables if missing.
 * 2. Create the Elasticsearch `orders` index if missing (graceful if ES down).
 * 3. Ensure MongoDB product indexes.
 * 4. Start background sync workers per SYNC_STRATEGY:
 *    - dual_write -> repair loop draining the outbox every 10s
 *    - outbox     -> outbox worker every OUTBOX_POLL_SECONDS
 *    - polling    -> polling worker every POLLING_INTERVAL_SECONDS
 */
const { loadConfig } = require('./config');
const { createContext } = require('./db');
const { getLogger } = require('./logger');
const { ensureSchema } = require('./schema');
const { createApp } = require('./app');
const productsRepo = require('./repositories/productsRepo');
const searchRepo = require('./repositories/searchRepo');
const syncService = require('./services/syncService');

const log = getLogger('bootstrap');

async function initPostgres(ctx) {
  try {
    await ensureSchema(ctx.pool);
    log.info('postgres tables ensured');
    return true;
  } catch (err) {
    log.warn('postgres init failed', { error: String(err && err.message || err) });
    return false;
  }
}

async function initElasticsearch(ctx) {
  return searchRepo.ensureIndex(ctx.getEsClient(), ctx.config.ES_INDEX);
}

async function initMongo(ctx) {
  try {
    await productsRepo.ensureIndexes(ctx.getMongoDb());
    log.info('mongo indexes ensured');
    return true;
  } catch (err) {
    log.warn('mongo init failed', { error: String(err && err.message || err) });
    return false;
  }
}

function startWorkers(ctx) {
  const { config } = ctx;
  const stops = [];
  if (config.SYNC_STRATEGY === 'dual_write') {
    stops.push(syncService.runOutboxLoop(ctx, syncService.REPAIR_LOOP_SECONDS));
  } else if (config.SYNC_STRATEGY === 'outbox') {
    stops.push(syncService.runOutboxLoop(ctx, config.OUTBOX_POLL_SECONDS));
  } else if (config.SYNC_STRATEGY === 'polling') {
    stops.push(syncService.runPollingLoop(ctx, config.POLLING_INTERVAL_SECONDS));
  }
  return () => stops.forEach((stop) => stop());
}

async function main() {
  const config = loadConfig();
  const ctx = createContext(config);

  const pgOk = await initPostgres(ctx);
  const esOk = await initElasticsearch(ctx);
  const mongoOk = await initMongo(ctx);
  log.info('startup complete', {
    postgres: pgOk, elasticsearch: esOk, mongodb: mongoOk,
    sync_strategy: config.SYNC_STRATEGY,
  });

  const stopWorkers = startWorkers(ctx);
  const app = createApp(ctx);
  const server = app.listen(config.API_PORT, config.API_HOST, () => {
    log.info(`listening on http://${config.API_HOST}:${config.API_PORT}`);
  });

  async function shutdown(signal) {
    log.info(`received ${signal}; shutting down`);
    stopWorkers();
    await new Promise((resolve) => server.close(resolve));
    await ctx.close();
    log.info('shutdown complete');
    process.exit(0);
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = { createApp, createContext: require('./db').createContext, loadConfig, startWorkers, initPostgres, initElasticsearch, initMongo };
