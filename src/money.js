'use strict';

/**
 * Decimal-safe money arithmetic.
 *
 * All money math runs on integer cents; values serialize to JSON as decimal
 * strings ("123.45") exactly like the Python reference (Pydantic Decimal
 * fields serialize to strings), so clients/tests can parse them losslessly.
 */

/**
 * Parse a money value (number or numeric string, e.g. PG NUMERIC or a Mongo
 * double) into integer cents, rounding half-up to 2 decimals — mirroring
 * `Decimal(str(value)).quantize(0.01, ROUND_HALF_UP)`.
 */
function toCents(value) {
  const s = String(value).trim();
  if (!/^[+-]?\d+(\.\d+)?$/.test(s)) {
    throw new Error(`invalid money value: ${s}`);
  }
  const negative = s.startsWith('-');
  const digits = (negative ? s.slice(1) : s).split('.');
  const intPart = digits[0];
  let frac = (digits[1] || '');
  // Round half-up at the 3rd decimal place.
  const third = frac.length > 2 ? parseInt(frac[2], 10) : 0;
  frac = (frac + '00').slice(0, 2);
  let cents = parseInt(intPart, 10) * 100 + parseInt(frac, 10);
  if (third >= 5) cents += 1;
  return negative ? -cents : cents;
}

/** Format integer cents as a decimal string, e.g. 5016 -> "50.16". */
function formatCents(cents) {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const str = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${str}` : str;
}

/** Integer cents -> JS number (for Elasticsearch `double` fields). */
function centsToFloat(cents) {
  return Number(formatCents(cents));
}

module.exports = { toCents, formatCents, centsToFloat };
