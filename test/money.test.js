'use strict';

/** Unit tests: decimal-safe money helpers. */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { toCents, formatCents, centsToFloat } = require('../src/money');

describe('money', () => {
  it('parses floats with half-up rounding', () => {
    assert.equal(toCents(50.16), 5016);
    assert.equal(toCents('100.34'), 10034);
    assert.equal(toCents(0.005), 1); // half-up
    assert.equal(toCents(0.004), 0);
    assert.equal(toCents('10'), 1000);
  });

  it('formats cents as decimal strings', () => {
    assert.equal(formatCents(5016), '50.16');
    assert.equal(formatCents(100), '1.00');
    assert.equal(formatCents(5), '0.05');
    assert.equal(formatCents(0), '0.00');
  });

  it('round-trips PG NUMERIC strings losslessly', () => {
    for (const s of ['50.16', '100.34', '199.00', '0.99', '1234567.89', '10.00']) {
      assert.equal(formatCents(toCents(s)), s);
    }
  });

  it('sums line totals in integer cents (no float drift)', () => {
    const total = 3 * toCents(100.34) + 2 * toCents(50.16);
    assert.equal(total, 40134);
    assert.equal(formatCents(total), '401.34');
  });

  it('rejects invalid money values', () => {
    assert.throws(() => toCents('abc'), /invalid money/);
    assert.throws(() => toCents(''), /invalid money/);
  });

  it('centsToFloat for ES doubles', () => {
    assert.equal(centsToFloat(5016), 50.16);
  });
});
