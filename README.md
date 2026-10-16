# E-Commerce Order Management & Search Service — Node.js / Express Backend

A line-by-line behavioral port of the Python/FastAPI backend to **Node.js +
Express**, implementing the same polyglot-persistence e-commerce system:

| Store | Owns | Screens |
|---|---|---|
| **PostgreSQL** | Orders, order items, users, fulfillment status (ACID source of truth) | Checkout, Order Details |
| **MongoDB** | Product catalog (flexible documents: variants, tags, attributes) | Storefront, Catalog Admin |
| **Elasticsearch** | Denormalized order documents + full-text search + KPI aggregations | Admin Search Dashboard |

The API contract is identical to the Python implementation, so the existing
Vue 3 frontend (`../ecommerce-polyglot-order-management/frontend`) works
unchanged against this backend. No real authentication — seeded demo users are
selected via a "Log In As" dropdown; the app is clearly labeled a POC.

## Quick start

### 1. Prerequisites

- Docker + Docker Compose (for PostgreSQL 16, MongoDB 8, Elasticsearch 8)
- Node 18+

### 2. Start the databases

```bash
docker compose up -d
docker compose ps
curl http://localhost:9200/_cluster/health
```

### 3. Configure

```bash
cp .env.example .env   # defaults work with docker-compose.yml out of the box
```

Key settings: `POSTGRES_DSN`, `MONGO_URI`, `MONGO_DB`, `ELASTICSEARCH_URL`,
`ES_INDEX`, `SYNC_STRATEGY` (`dual_write` | `outbox` | `polling`).

### 4. Install, seed, run

```bash
npm install
npm run seed:reset   # create schema, seed PG + Mongo, reindex ES (deterministic)
npm start            # API on http://localhost:8000
```

- API: http://localhost:8000
- Health: http://localhost:8000/api/health

### 5. Frontend (shared Vue 3 build)

```bash
cd ../ecommerce-polyglot-order-management/frontend
npm install
npm run dev   # http://localhost:5173, calls VITE_API_URL (default http://localhost:8000)
```

## The five screens (routes)

| Route | Screen | Reads from | Writes to |
|---|---|---|---|
| `/` | Customer Storefront — product grid, filters, cart drawer | MongoDB | — (cart is frontend state) |
| `/checkout` | Checkout — summary, place order, confirmation | MongoDB (validation) | PostgreSQL |
| `/admin` | Admin Search Dashboard — omni-search, filters, KPIs, table | Elasticsearch only | — |
| `/admin/orders/:id` | Admin Order Details — receipt, status dropdown, sync badge | PostgreSQL (+ ES sync badge) | PostgreSQL → ES |
| `/admin/catalog` | Catalog Administration — product table, create/edit forms | MongoDB | MongoDB only |

## Synchronization strategies

`SYNC_STRATEGY` selects how PostgreSQL orders reach Elasticsearch. All strategies
use the deterministic document id `order-<order_id>`, so retries are idempotent
upserts and reindexing is safe.

1. **`dual_write`** (default) — after the PG transaction commits, the order is
   indexed in Elasticsearch immediately. If ES is unreachable, the order still
   commits (checkout stays successful) and an `outbox` row is queued; a repair
   loop (every 10s) drains it.
2. **`outbox`** — an outbox row is inserted *inside the same PG transaction* as
   the order (atomic). A background worker polls the outbox every
   `OUTBOX_POLL_SECONDS`, indexes into ES, and retries with exponential backoff
   (10 attempts → `failed`, visible at `GET /api/admin/sync-status`).
3. **`polling`** — a worker polls `orders` by `updated_at` every
   `POLLING_INTERVAL_SECONDS` (15s) and upserts changed orders; the watermark is
   persisted in `sync_state`.

Demonstrating: place an order on `/checkout`, then watch it appear on `/admin`.
Switch strategies via `SYNC_STRATEGY` in `.env` and restart. To simulate an ES
outage, stop the elasticsearch container, place orders (they still succeed —
check `GET /api/admin/sync-status` for the backlog), restart it, and watch the
dashboard catch up. `POST /api/admin/reindex` (or `npm run reindex`) rebuilds
the whole index from PostgreSQL.

## API summary

| Method & path | Source | Description |
|---|---|---|
| `GET /api/users` | PG | Seeded users for "Log In As" |
| `GET /api/products[?category=&q=&active=]` | Mongo | Catalog (active-only by default) |
| `GET /api/products/{id}` | Mongo | Single product |
| `POST /api/products` | Mongo | Create product (201; 409 on duplicate SKU) |
| `PUT /api/products/{id}` | Mongo | Edit product (never touches order history) |
| `POST /api/orders` | PG (+Mongo validation) | Transactional checkout; `idempotency_key` supported |
| `GET /api/orders/{id}` | PG | Canonical order + ES sync badge |
| `PATCH /api/orders/{id}/status` | PG → ES | Update fulfillment status |
| `POST /api/search/orders` | ES only | Omni-search, filters, sorting, pagination, aggregations |
| `GET /api/health` | all | Dependency health |
| `GET /api/admin/sync-status` | PG + ES | Outbox backlog, watermark, doc count |
| `POST /api/admin/reindex` | PG → ES | Rebuild search index |

Money serializes as JSON strings (`"total_amount": "100.32"`) exactly like the
Python API; datetimes serialize as ISO-8601. Errors use the `{detail: "..."}`
envelope.

## Running tests

```bash
npm test
```

69 tests (Node's built-in `node:test` runner, no test dependencies):

- **Unit** (no DB): money helpers, deterministic seed-plan rules, ES query-body
  construction and response parsing.
- **Service/integration with fakes**: FakeMongo + FakeES with the real isolated
  PostgreSQL database `ecommerce_test` — product filtering/inactive hiding,
  checkout price validation (server prices win), exact totals, transactional
  rollback, idempotent replay, ES-down checkout (PG still commits), status
  updates, snapshot preservation, dual-write repair, outbox backoff → failed,
  admin/health endpoints, HTTP route validation envelopes.
- **Integration with live DBs** (isolated `ecommerce_test` / `orders_test` —
  demo data is never touched): search across customer names + item titles,
  status/date/price filters, aggregation correctness, sorting, pagination,
  polling watermark cycles, reindex from PG.

## Project layout

```
docker-compose.yml  .env.example  README.md
package.json
src/
  index.js            # bootstrap: schema, ES index, workers, listen
  app.js              # Express app factory (routers + error envelope)
  config.js           # env config (dotenv)
  db.js               # pg Pool, MongoClient, ES client (per-context)
  schema.js           # PostgreSQL DDL
  logger.js           # structured JSON logging
  money.js            # integer-cents money helpers
  repositories/       # usersRepo, productsRepo, ordersRepo (explicit txns), searchRepo
  services/           # orderService (checkout), syncService (3 strategies + workers)
  routes/             # users, products, orders, search, health, admin + validate.js
scripts/
  seed.js             # deterministic seed (seed=42) + verification
  reindex.js          # rebuild ES index from PG
  schema.sql          # DDL for reviewers
test/
  helpers.js          # FakeMongo/FakeES, isolated contexts, HTTP boot helper
  *.test.js           # unit + integration suites
```

## Troubleshooting

- **ES won't start / `vm.max_map_count`**: `sudo sysctl -w vm.max_map_count=262144`.
- **Port conflicts**: change `ports` in `docker-compose.yml` and `.env`.
- **Search returns nothing after seeding**: `npm run reindex` and check
  `GET /api/admin/sync-status`.
- **Frontend can't reach the API**: ensure the API runs on `:8000` and
  `VITE_API_URL` matches; CORS allows `http://localhost:5173`.
- **Proxy env issues in sandboxes**: run with
  `no_proxy=localhost,127.0.0.1 NO_PROXY=localhost,127.0.0.1` if localhost
  HTTP calls fail with proxy parsing errors.
