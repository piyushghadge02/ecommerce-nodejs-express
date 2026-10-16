'use strict';

/**
 * Deterministic demo seed (seed=42) for PG + MongoDB + Elasticsearch.
 *
 * Seeds:
 *   * 8 users (exact names/emails from the spec)
 *   * 26 products (25 active + 1 inactive) across peripherals/audio/cables/office
 *   * 44 orders / >=80 items meeting every fixture, band, date and status rule
 *   * deliberate snapshot mismatch: "Wireless Mouse" -> "Wireless Mouse Pro" (59.99)
 *     in Mongo AFTER orders are written; PG/ES history keeps the old snapshot
 *   * full Elasticsearch reindex from PostgreSQL
 *
 * Usage:
 *     node scripts/seed.js [--reset]
 *
 * --reset wipes PG transactional tables, the Mongo products collection and the
 * ES index first. Without --reset, existing users/products are skipped (orders
 * are only seeded when the orders table is empty).
 *
 * This is a line-by-line behavioral port of the Python reference seed
 * (backend/scripts/seed.py). The PRNG is a seeded mulberry32 (seed 42) rather
 * than CPython's Mersenne Twister, so the exact draw sequence differs across
 * languages — but `checkPlan` enforces every §9 rule deterministically.
 */
const path = require('path');

const { loadConfig } = require('../src/config');
const { createContext } = require('../src/db');
const { getLogger } = require('../src/logger');
const { ensureSchema } = require('../src/schema');
const { toCents } = require('../src/money');
const ordersRepo = require('../src/repositories/ordersRepo');
const productsRepo = require('../src/repositories/productsRepo');
const searchRepo = require('../src/repositories/searchRepo');
const syncService = require('../src/services/syncService');

const log = getLogger('seed');
const SEED = 42;
const NOW = new Date();

const USERS = [
  ['John Doe', 'john.doe@example.com'],
  ['Jane Smith', 'jane.smith@example.com'],
  ['Wendy Wireless', 'wendy.wireless@example.com'],
  ['Alex Rivera', 'alex.rivera@example.com'],
  ['Sam Patel', 'sam.patel@example.com'],
  ['Casey Nguyen', 'casey.nguyen@example.com'],
  ['Morgan Lee', 'morgan.lee@example.com'],
  ['Riley Brooks', 'riley.brooks@example.com'],
];
const WENDY_IDX = 2;

function product(sku, title, price, category, tags, attributes, variants, description = '', active = true) {
  return {
    sku,
    title,
    description: description || `${title} — quality ${category} product.`,
    price,
    category,
    tags,
    attributes,
    variants,
    active,
    updated_at: NOW,
  };
}
const v = (sku, color, stock) => ({ sku, color, stock });

const PRODUCTS = [
  // ---- peripherals (7 active) ----
  product('WM-001', 'Wireless Mouse', 50.16, 'peripherals',
    ['wireless', 'usb', 'office'], { color: 'black', dpi: 1600, battery: 'AA' },
    [v('WM-001-BLK', 'black', 40), v('WM-001-WHT', 'white', 12)]),
  product('MK-101', 'Mechanical Keyboard', 100.34, 'peripherals',
    ['wired', 'rgb', 'gaming'], { switch: 'brown', layout: 'TKL', backlight: true },
    [v('MK-101-BRN', 'black', 25)]),
  product('WK-102', 'Wireless Keyboard', 65.00, 'peripherals',
    ['wireless', 'bluetooth'], { layout: 'full', battery: 'rechargeable' },
    [v('WK-102-BLK', 'black', 30)]),
  product('HUB-201', 'USB-C Hub 7-in-1', 45.00, 'peripherals',
    ['usb-c', 'hub', 'laptop'], { ports: 7, hdmi: '4K' },
    [v('HUB-201-GRY', 'gray', 50)]),
  product('MP-202', 'Ergonomic Mouse Pad', 18.99, 'peripherals',
    ['office', 'desk'], { size: 'XL', material: 'rubber' },
    [v('MP-202-BLK', 'black', 100)]),
  product('CAM-203', 'Webcam HD 1080p', 55.50, 'peripherals',
    ['video', 'usb'], { resolution: '1080p', microphone: true },
    [v('CAM-203-BLK', 'black', 35)]),
  product('MON-204', '4K Monitor 27-inch', 249.99, 'peripherals',
    ['display', '4k', 'usb-c'], { size: '27in', panel: 'IPS' },
    [v('MON-204-BLK', 'black', 15)]),
  // ---- audio (6 active) ----
  product('EB-301', 'Wireless Earbuds', 79.99, 'audio',
    ['wireless', 'bluetooth', 'audio'], { battery_hours: 24, anc: false },
    [v('EB-301-WHT', 'white', 60), v('EB-301-BLK', 'black', 45)]),
  product('NCH-302', 'Noise Cancelling Headphones', 199.00, 'audio',
    ['wireless', 'anc', 'premium'], { battery_hours: 40, anc: true },
    [v('NCH-302-BLK', 'black', 20)]),
  product('SPK-303', 'Bluetooth Speaker Mini', 35.75, 'audio',
    ['wireless', 'bluetooth', 'speaker'], { battery_hours: 12, waterproof: 'IPX5' },
    [v('SPK-303-BLU', 'blue', 40)]),
  product('MIC-304', 'USB Microphone Pro', 89.00, 'audio',
    ['usb', 'streaming'], { pattern: 'cardioid', mount: 'desk' },
    [v('MIC-304-BLK', 'black', 28)]),
  product('EP-305', 'Wired Earphones', 12.99, 'audio',
    ['wired', 'budget'], { connector: '3.5mm' },
    [v('EP-305-WHT', 'white', 120)]),
  product('SB-306', 'Soundbar Slim', 129.99, 'audio',
    ['tv', 'hdmi', 'audio'], { channels: '2.1', hdmi_arc: true },
    [v('SB-306-BLK', 'black', 18)]),
  // ---- cables (6 active) ----
  product('CBL-401', 'USB-C to USB-C Cable 2m', 14.99, 'cables',
    ['usb-c', 'charging'], { length: '2m', wattage: 100 },
    [v('CBL-401-BLK', 'black', 200)]),
  product('HDMI-402', 'HDMI 2.1 Cable', 19.99, 'cables',
    ['hdmi', '4k'], { length: '2m', version: '2.1' },
    [v('HDMI-402-BLK', 'black', 150)]),
  product('WCP-403', 'Wireless Charging Pad', 29.99, 'cables',
    ['wireless', 'charging', 'qi'], { wattage: 15 },
    [v('WCP-403-WHT', 'white', 70)]),
  product('LGT-404', 'Lightning Cable 1m', 11.50, 'cables',
    ['apple', 'charging'], { length: '1m', mfi: true },
    [v('LGT-404-WHT', 'white', 180)]),
  product('DP-405', 'DisplayPort Cable', 22.00, 'cables',
    ['display', 'pc'], { length: '1.8m', version: '1.4' },
    [v('DP-405-BLK', 'black', 90)]),
  product('ETH-406', 'Ethernet Cable Cat6 5m', 16.75, 'cables',
    ['network', 'wired'], { length: '5m', category: 'Cat6' },
    [v('ETH-406-BLU', 'blue', 110)]),
  // ---- office (6 active + 1 inactive) ----
  product('LAMP-501', 'Desk Lamp LED', 32.50, 'office',
    ['desk', 'lighting'], { dimmable: true, color_temp: '3000-6000K' },
    [v('LAMP-501-WHT', 'white', 55)]),
  product('MST-502', 'Monitor Stand Bamboo', 49.99, 'office',
    ['desk', 'ergonomic'], { material: 'bamboo', max_load_kg: 15 },
    [v('MST-502-NAT', 'natural', 32)]),
  product('PRS-503', 'Wireless Presenter Remote', 39.95, 'office',
    ['wireless', 'presentation'], { range_m: 30, laser: 'red' },
    [v('PRS-503-BLK', 'black', 48)]),
  product('LST-504', 'Laptop Stand Aluminum', 42.00, 'office',
    ['desk', 'laptop'], { material: 'aluminum', adjustable: true },
    [v('LST-504-SLV', 'silver', 42)]),
  product('ORG-505', 'Desk Organizer Set', 24.99, 'office',
    ['desk', 'storage'], { pieces: 5 },
    [v('ORG-505-GRY', 'gray', 65)]),
  product('CUSH-506', 'Office Chair Cushion', 27.50, 'office',
    ['comfort', 'chair'], { material: 'memory foam' },
    [v('CUSH-506-BLK', 'black', 80)]),
  product('CRT-507', 'Old CRT Monitor', 99.99, 'office',
    ['vintage'], { size: '17in' }, [v('CRT-507-BGE', 'beige', 2)],
    '', false),
];

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — deterministic, seed 42
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function choice(rng, seq) { return seq[Math.floor(rng() * seq.length)]; }
function randint(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
function randrange(rng, n) { return Math.floor(rng() * n); }
function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Order plan (pure function — unit-testable without any database)
// ---------------------------------------------------------------------------
function idxBySku(products) {
  const m = {};
  products.forEach((p, i) => { m[p.sku] = i; });
  return m;
}

function buildOrderPlan(products) {
  const rng = makeRng(SEED);
  const sku = idxBySku(products);
  const active = products.map((p, i) => i).filter((i) => products[i].active !== false);
  const wireless = active.filter((i) => {
    const p = products[i];
    return p.title.toLowerCase().includes('wireless') ||
      (p.tags || []).some((t) => String(t).toLowerCase() === 'wireless');
  });
  const cheap = active.filter((i) => products[i].price < 25);
  const mid = active.filter((i) => products[i].price >= 25 && products[i].price <= 99);

  const WM = sku['WM-001'], MK = sku['MK-101'];
  const NCH = sku['NCH-302'], SB = sku['SB-306'], MON = sku['MON-204'];
  const EP = sku['EP-305'];

  const plan = [];
  const addOrder = (userIdx, lines) => { plan.push({ user_idx: userIdx, lines, status: null, days_ago: null }); return plan.length - 1; };
  const randomLines = (n) => Array.from({ length: n }, () => [choice(rng, active), randint(rng, 1, 3)]);

  // 1) base: every user gets 2 orders
  for (let u = 0; u < 8; u++) {
    for (let k = 0; k < 2; k++) addOrder(u, randomLines(choice(rng, [2, 2, 3])));
  }
  // 2) Wendy's 3 extra wireless orders — each gets Wireless Mouse
  for (let k = 0; k < 3; k++) {
    addOrder(WENDY_IDX, [[WM, randint(rng, 1, 2)], ...randomLines(randint(rng, 0, 1))]);
  }
  // 3) price bands
  for (let i = 0; i < 5; i++) addOrder(randrange(rng, 8), [[cheap[i % cheap.length], 1]]); // under $30
  for (let i = 0; i < 5; i++) { // $30..$150
    const p = mid[i % mid.length];
    const qty = products[p].price * 2 > 150 ? 1 : 2;
    addOrder(randrange(rng, 8), [[p, qty]]);
  }
  for (const lines of [[[NCH, 2]], [[SB, 2]], [[MON, 1]], [[MK, 3]], [[NCH, 1], [EP, 1]]]) {
    addOrder(randrange(rng, 8), lines); // over $200
  }
  // 4) random fill
  for (let k = 0; k < 10; k++) addOrder(randrange(rng, 8), randomLines(choice(rng, [2, 2, 3])));

  if (plan.length !== 44) throw new Error(`expected 44 orders, got ${plan.length}`);

  // 5) fixtures: 8 orders contain Wireless Mouse, 3 contain Mechanical
  //    Keyboard, 2 contain both. Slots 16..18 already have WM (Wendy).
  const fixturePool = shuffle(rng, Array.from({ length: 10 }, (_, i) => 34 + i));
  const wmSlots = [16, 17, 18, ...fixturePool.slice(0, 5)];
  const mkSlots = fixturePool.slice(5, 8);
  const bothSlots = fixturePool.slice(0, 2);
  for (const s of wmSlots) {
    if (!plan[s].lines.some(([pi]) => pi === WM)) plan[s].lines.push([WM, 1]);
  }
  for (const s of mkSlots) plan[s].lines.push([MK, 1]);
  for (const s of bothSlots) {
    if (!plan[s].lines.some(([pi]) => pi === MK)) plan[s].lines.push([MK, 1]);
  }

  // 6) statuses 15/15/14
  plan.forEach((o, i) => { o.status = i < 15 ? 'PENDING' : (i < 30 ? 'PROCESSING' : 'SHIPPED'); });

  // 7) dates: 5 within last 7 days, >=5 older than 60 days, spread over 90
  const daysAgo = shuffle(rng, [1, 2, 4, 5, 6, ...Array.from({ length: 39 }, (_, i) => 8 + Math.floor((i * 82) / 38))]);
  plan.forEach((o, i) => { o.days_ago = daysAgo[i]; });

  return plan;
}

function checkPlan(plan, products) {
  const problems = [];
  const sku = idxBySku(products);
  const WM = sku['WM-001'], MK = sku['MK-101'];
  const total = (o) => o.lines.reduce((s, [pi, qty]) => s + toCents(products[pi].price) * qty, 0);

  if (plan.length !== 44) problems.push(`expected 44 orders, got ${plan.length}`);
  const nItems = plan.reduce((s, o) => s + o.lines.length, 0);
  if (nItems < 80) problems.push(`expected >=80 items, got ${nItems}`);
  const statuses = plan.map((o) => o.status);
  for (const [st, need] of [['PENDING', 10], ['PROCESSING', 10], ['SHIPPED', 10]]) {
    const n = statuses.filter((s) => s === st).length;
    if (n < need) problems.push(`status ${st}: ${n} < ${need}`);
  }
  const old = plan.filter((o) => o.days_ago > 60).length;
  if (old < 5) problems.push(`orders older than 60 days: ${old} < 5`);
  const recent = plan.filter((o) => o.days_ago <= 7).length;
  if (recent < 5) problems.push(`orders within last 7 days: ${recent} < 5`);
  if (Math.max(...plan.map((o) => o.days_ago)) < 85) problems.push('dates do not spread over ~90 days');
  const totals = plan.map(total);
  if (totals.filter((t) => t < 3000).length < 5) problems.push('need >=5 orders under $30');
  if (totals.filter((t) => t >= 3000 && t <= 15000).length < 5) problems.push('need >=5 orders $30-$150');
  if (totals.filter((t) => t > 20000).length < 5) problems.push('need >=5 orders over $200');
  const perUser = Array.from({ length: 8 }, (_, u) => plan.filter((o) => o.user_idx === u).length);
  if (Math.min(...perUser) < 2) problems.push(`every user needs >=2 orders: ${perUser}`);
  const wendyWireless = plan.filter((o) => o.user_idx === WENDY_IDX && o.lines.some(([pi]) => {
    const p = products[pi];
    return p.title.toLowerCase().includes('wireless') ||
      (p.tags || []).some((t) => String(t).toLowerCase() === 'wireless');
  })).length;
  if (wendyWireless < 3) problems.push(`Wendy wireless orders: ${wendyWireless} < 3`);
  const wmOrders = plan.filter((o) => o.lines.some(([pi]) => pi === WM)).length;
  if (wmOrders < 8) problems.push(`Wireless Mouse orders: ${wmOrders} < 8`);
  const mkOrders = plan.filter((o) => o.lines.some(([pi]) => pi === MK)).length;
  if (mkOrders < 3) problems.push(`Mechanical Keyboard orders: ${mkOrders} < 3`);
  const both = plan.filter((o) =>
    o.lines.some(([pi]) => pi === WM) && o.lines.some(([pi]) => pi === MK)).length;
  if (both < 2) problems.push(`orders with both products: ${both} < 2`);
  return problems;
}

// ---------------------------------------------------------------------------
// Database execution
// ---------------------------------------------------------------------------
async function seedUsers(pool) {
  const mapping = {};
  for (let idx = 0; idx < USERS.length; idx++) {
    const [name, email] = USERS[idx];
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    let id;
    if (rows.length) {
      id = rows[0].id;
    } else {
      const ins = await pool.query('INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id', [name, email]);
      id = ins.rows[0].id;
    }
    mapping[idx] = id;
  }
  return mapping;
}

async function seedProducts(db, reset) {
  const coll = db.collection(productsRepo.PRODUCTS_COLLECTION);
  if (reset) await coll.deleteMany({});
  await productsRepo.ensureIndexes(db);
  const docs = [];
  for (const p of PRODUCTS) {
    let existing = await coll.findOne({ sku: p.sku });
    if (!existing) {
      const r = await coll.insertOne({ ...p });
      existing = await coll.findOne({ _id: r.insertedId });
    }
    docs.push(existing);
  }
  return docs;
}

async function seedOrders(pool, userMap, products) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM orders');
  if (rows[0].n > 0) {
    log.info('orders already seeded; skipping', { count: rows[0].n });
    return [];
  }
  const plan = buildOrderPlan(products);
  const problems = checkPlan(plan, products);
  if (problems.length) throw new Error(`seed plan violates rules: ${problems.join('; ')}`);

  const prodRefs = products.map((p) => ({
    mongoId: String(p._id), title: p.title, priceCents: toCents(p.price),
  }));

  for (const o of plan) {
    const lines = o.lines.map(([pi, qty]) => ({
      productId: prodRefs[pi].mongoId,
      title: prodRefs[pi].title,
      quantity: qty,
      unitPriceCents: prodRefs[pi].priceCents,
    }));
    const orderDate = new Date(NOW.getTime() - o.days_ago * 86400000 - ((o.days_ago * 37) % 1440) * 60000);
    const { order } = await ordersRepo.createOrder(pool, {
      userId: userMap[o.user_idx],
      lines,
      orderDate,
      updatedAt: orderDate,
    });
    if (o.status !== 'PENDING') {
      await ordersRepo.updateOrderStatus(pool, order.id, o.status);
    }
  }
  log.info('orders seeded', { count: plan.length });
  return plan;
}

async function applySnapshotMismatch(db) {
  const coll = db.collection(productsRepo.PRODUCTS_COLLECTION);
  const result = await coll.updateOne(
    { sku: 'WM-001' },
    { $set: { title: 'Wireless Mouse Pro', price: 59.99, updated_at: new Date() } }
  );
  log.info('snapshot mismatch applied', { matched: result.matchedCount });
}

async function verify(ctx) {
  const { pool } = ctx;
  const db = ctx.getMongoDb();
  const es = ctx.getEsClient();
  const n = async (sql) => (await pool.query(sql)).rows[0].n;
  const nUsers = await n('SELECT COUNT(*)::int AS n FROM users');
  const nOrders = await n('SELECT COUNT(*)::int AS n FROM orders');
  const nItems = await n('SELECT COUNT(*)::int AS n FROM order_items');
  const coll = db.collection(productsRepo.PRODUCTS_COLLECTION);
  const nProducts = await coll.countDocuments({ active: true });
  const nInactive = await coll.countDocuments({ active: false });
  const wm = await coll.findOne({ sku: 'WM-001' });
  const esDocs = await searchRepo.countDocs(es, ctx.config.ES_INDEX);

  const old = (await pool.query(
    `SELECT title, unit_price FROM order_items WHERE title = 'Wireless Mouse' LIMIT 1`
  )).rows[0];

  console.log(`users=${nUsers} products(active)=${nProducts} inactive=${nInactive} orders=${nOrders} items=${nItems} es_docs=${esDocs}`);
  console.log(`mongo WM-001 title=${JSON.stringify(wm.title)} price=${wm.price}`);
  console.log(`historical PG snapshot intact: ${!!old}${old ? ` (${old.title}, ${old.unit_price})` : ''}`);

  const assert = require('assert');
  assert.strictEqual(nUsers, 8, 'expected 8 users');
  assert.ok(nProducts >= 24, 'expected >=24 active products');
  assert.ok(nInactive >= 1, 'expected >=1 inactive product');
  assert.strictEqual(nOrders, 44, 'expected 44 orders');
  assert.ok(nItems >= 80, 'expected >=80 items');
  assert.strictEqual(wm.title, 'Wireless Mouse Pro');
  assert.strictEqual(Number(wm.price), 59.99);
  assert.ok(old && old.title === 'Wireless Mouse' && Number(old.unit_price) === 50.16,
    'historical snapshot was rewritten!');
  if (esDocs !== null) assert.strictEqual(esDocs, nOrders, `ES docs ${esDocs} != PG orders ${nOrders}`);
  console.log('seed verification passed');
}

async function main(reset = false) {
  const config = loadConfig();
  const ctx = createContext(config);
  try {
    await ensureSchema(ctx.pool);
    if (reset) {
      await ordersRepo.deleteAllDemoData(ctx.pool);
      log.info('postgres demo data wiped');
    }
    const db = ctx.getMongoDb();
    const userMap = await seedUsers(ctx.pool);
    const products = await seedProducts(db, reset);
    await seedOrders(ctx.pool, userMap, products);
    await applySnapshotMismatch(db);

    const es = ctx.getEsClient();
    if (reset) await searchRepo.deleteIndex(es, ctx.config.ES_INDEX);
    if (!(await searchRepo.ensureIndex(es, ctx.config.ES_INDEX))) {
      console.log('ERROR: elasticsearch unreachable — PG/Mongo seeded, ES reindex skipped');
      return 1;
    }
    const indexed = await syncService.reindexAll(ctx);
    console.log(`reindexed ${indexed} orders`);

    await verify(ctx);
    return 0;
  } finally {
    await ctx.close();
  }
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  main(reset).then(
    (code) => process.exit(code),
    (err) => { console.error('seed failed:', err); process.exit(1); }
  );
}

module.exports = { USERS, PRODUCTS, SEED, buildOrderPlan, checkPlan, makeRng };
