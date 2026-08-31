// Cart-line serial-number slot management for POS.
//
// A `tracksSerials` line keeps exactly `quantity` slots (each '' until a serial is
// chosen), so growing or shrinking the quantity grows or shrinks the picker without
// losing selections already made in the slots that remain.

/** Resize a line's serial slots to match its current quantity, keeping existing
 *  selections in place (shrinking drops from the end, growing appends blanks). */
export function resizeSerials(serials, quantity) {
  const q = Math.max(0, Number(quantity) || 0);
  const arr = (serials || []).slice(0, q);
  while (arr.length < q) arr.push('');
  return arr;
}

/** The non-empty, submittable selections for a line — an unfilled slot never
 *  reaches the API as an empty string. */
export function compactSerials(serials) {
  return (serials || []).filter(Boolean);
}

/** A tracksSerials line is valid to submit only if nothing was picked (serial
 *  capture stays optional, as before this feature existed) or if every slot was
 *  filled with a distinct serial — a partial selection is never valid, since it
 *  could never correspond to a real, complete set of inventory units. */
export function serialsAreSubmittable(serials, quantity) {
  const chosen = compactSerials(serials);
  if (chosen.length === 0) return true;
  if (chosen.length !== Number(quantity)) return false;
  return new Set(chosen).size === chosen.length;
}
