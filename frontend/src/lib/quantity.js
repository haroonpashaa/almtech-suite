// Shared quantity handling for cart-style line items (POS, etc).
//
// The bug this fixes: a plain `Number(e.target.value)` (or `Math.max(1, Number(v))`)
// on a controlled <input type="number"> turns an emptied field into 1 immediately, so
// the field never actually goes blank while retyping — clearing a "3" to type "7"
// becomes "17" instead, because the forced "1" is still there when the next digit
// lands. clampQuantity() lets '' pass through so the input can go blank, while still
// clamping any real number into the valid [1, max] range.

export function clampQuantity(raw, max = Infinity) {
  if (raw === '' || raw === null || raw === undefined) return '';
  const n = Number(raw);
  if (!Number.isFinite(n)) return '';
  return Math.max(1, Math.min(Math.floor(n), max));
}

export function isValidQuantity(value, max = Infinity) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= max;
}
