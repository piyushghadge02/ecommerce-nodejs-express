'use strict';

/**
 * Database client management: PostgreSQL (pg Pool), MongoDB (official driver),
 * Elasticsearch (official client).
 *
 * `createContext(config)` builds an isolated set of clients; the Express app
 * factory and the test suite each get their own context. Clients use short
 * timeouts and the app degrades gracefully when a dependency is unreachable.
 *
 * Mirrors app/core/database.py from the Python reference implementation.
 */
const { Pool } = require('pg');
const { MongoClient } = require('mongodb');
const { Client: ESClient } = require('@elastic/elasticsearch');
const { getLogger } = require('./logger');

const log = getLogger('db');

function createContext(config) {
  const pool = new Pool({
    connectionString: config.POSTGRES_DSN,
    max: 5,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  pool.on('error', (err) => log.warn('pg pool error', { error: String(err) }));

  let mongoClient = null;
  let esClient = null;

  function getMongoClient() {
    if (!mongoClient) {
      mongoClient = new MongoClient(config.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
    }
    return mongoClient;
  }

  function getMongoDb() {
    return getMongoClient().db(config.MONGO_DB);
  }

  function getEsClient() {
    if (!esClient) {
      esClient = new ESClient({
        node: config.ELASTICSEARCH_URL,
        requestTimeout: 5000,
        maxRetries: 0,
      });
    }
    return esClient;
  }

  async function esPing() {
    try {
      return await getEsClient().ping();
    } catch (err) {
      log.warn('elasticsearch ping failed', { error: String(err && err.message || err) });
      return false;
    }
  }

  async function pgPing() {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } catch {
      return false;
    } finally {
      client.release();
    }
  }

  async function mongoPing() {
    try {
      await getMongoClient().db('admin').command({ ping: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async function close() {
    try { await esClient?.close(); } catch { /* ignore */ }
    try { await mongoClient?.close(); } catch { /* ignore */ }
    try { await pool.end(); } catch { /* ignore */ }
  }

  return { config, pool, getMongoClient, getMongoDb, getEsClient, esPing, pgPing, mongoPing, close };
}

module.exports = { createContext };
