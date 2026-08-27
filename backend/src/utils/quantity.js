// Shared quantity validation for physical inventory units (laptops, accessories).
// Stock must always stay a whole number — these helpers exist so decimal, NaN,
// Infinity and non-numeric quantities are rejected at every entry point (New Sale,
// purchase order creation/receiving, manual stock adjustment) rather than silently
// producing fractional stock.
//
// `err.statusCode` lets these throw from outside a controller and still produce the
// same response the controller's own `res.status(400)` throws would (see errorHandler).

/** The raw value coerced to a number, but only if it's a finite whole number —
 *  otherwise null. Rejects decimals, NaN, Infinity and non-numeric input alike. */
function toWholeNumber(raw) {
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

/** For quantities that must be at least 1 — selling, ordering, or receiving units. */
export function requirePositiveWholeQuantity(raw, label) {
  const n = toWholeNumber(raw);
  if (n === null || n < 1) {
    const err = new Error(`Quantity for ${label} must be a whole number of at least 1 (got ${raw})`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

/** For a manual stock adjustment delta — any non-zero whole number, positive to add
 *  stock or negative to remove it. Zero is rejected as a no-op, not a valid delta. */
export function requireNonZeroWholeQuantity(raw, label) {
  const n = toWholeNumber(raw);
  if (n === null || n === 0) {
    const err = new Error(`Adjustment quantity for ${label} must be a non-zero whole number (got ${raw})`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}
