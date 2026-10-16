'use strict';

/** Unit tests: the deterministic seed plan satisfies every §9 rule (pure function). */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { PRODUCTS, buildOrderPlan, checkPlan } = require('../scripts/seed.js');

describe('seed plan', () => {
  it('satisfies every §9 rule', () => {
    const plan = buildOrderPlan(PRODUCTS);
    assert.deepEqual(checkPlan(plan, PRODUCTS), []);
  });

  it('is deterministic across runs', () => {
    const a = buildOrderPlan(PRODUCTS);
    const b = buildOrderPlan(PRODUCTS);
    assert.deepEqual(a, b);
  });

  it('has 44 orders, >=80 items, 15/15/14 statuses', () => {
    const plan = buildOrderPlan(PRODUCTS);
    assert.equal(plan.length, 44);
    assert.ok(plan.reduce((s, o) => s + o.lines.length, 0) >= 80);
    const counts = {};
    for (const o of plan) counts[o.status] = (counts[o.status] || 0) + 1;
    assert.deepEqual(counts, { PENDING: 15, PROCESSING: 15, SHIPPED: 14 });
  });

  it('every order total equals its line items', () => {
    const { toCents } = require('../src/money');
    const plan = buildOrderPlan(PRODUCTS);
    for (const o of plan) {
      const total = o.lines.reduce((s, [pi, qty]) => s + toCents(PRODUCTS[pi].price) * qty, 0);
      assert.ok(total > 0, 'positive total');
    }
  });

  it('catalog has 25 active + 1 inactive products, >=6 wireless', () => {
    const active = PRODUCTS.filter((p) => p.active !== false);
    const inactive = PRODUCTS.filter((p) => p.active === false);
    assert.equal(active.length, 25);
    assert.equal(inactive.length, 1);
    const wireless = active.filter((p) =>
      p.title.toLowerCase().includes('wireless') || p.tags.includes('wireless'));
    assert.ok(wireless.length >= 6, `wireless: ${wireless.length}`);
    const cats = {};
    for (const p of active) cats[p.category] = (cats[p.category] || 0) + 1;
    for (const c of ['peripherals', 'audio', 'cables', 'office']) {
      assert.ok(cats[c] >= 5, `category ${c}: ${cats[c]}`);
    }
  });
});
