'use strict';

/**
 * Rebuild the Elasticsearch `orders` index from PostgreSQL.
 *
 * Reads orders + users + order_items from PostgreSQL and upserts denormalized
 * documents (historical title/price snapshots) into Elasticsearch with
 * deterministic ids `order-<order_id>`. The MongoDB catalog is NEVER consulted:
 * historical snapshots must survive catalog edits.
 *
 * Usage:
 *     node scripts/reindex.js [--reset]
 */
const { loadConfig } = require('../src/config');
const { createContext } = require('../src/db');
const { getLogger } = require('../src/logger');
const searchRepo = require('../src/repositories/searchRepo');
const syncService = require('../src/services/syncService');

const log = getLogger('reindex');

async function main(reset = false) {
  const config = loadConfig();
  const ctx = createContext(config);
  try {
    const es = ctx.getEsClient();
    if (!(await searchRepo.ensureIndex(es, config.ES_INDEX))) {
      log.error('elasticsearch unreachable; aborting');
      return 1;
    }
    if (reset) {
      await searchRepo.deleteIndex(es, config.ES_INDEX);
      await searchRepo.ensureIndex(es, config.ES_INDEX);
    }
    const indexed = await syncService.reindexAll(ctx);
    console.log(`reindexed ${indexed} orders into '${config.ES_INDEX}'`);
    return 0;
  } finally {
    await ctx.close();
  }
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  main(reset).then(
    (code) => process.exit(code),
    (err) => { console.error('reindex failed:', err); process.exit(1); }
  );
}

module.exports = { main };
