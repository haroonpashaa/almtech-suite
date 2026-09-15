// ALM-SEC-009 fix: the backend has always supported an `idempotencyKey` on a
// payment POST (server-side, a unique index rejects a second write with the
// same key — see backend/src/utils/ledger.js), but no screen ever sent one,
// so the protection never actually engaged for a real user. A double-click, a
// dropped-response retry, or a slow-network resubmit could post the same
// payment twice — verified live: two concurrent POSTs both succeeded and
// moved twice the intended amount.
//
// One key per "logical payment attempt": generate it once when a payment
// form/dialog is opened (or on first mount, for an always-visible inline
// form), reuse it across repeated submit attempts of that same attempt
// (covering a genuine retry), and only generate a new one once that attempt
// actually succeeds or the user starts a distinctly new one (a fresh dialog
// open). This is what lets a retry of the same payment dedupe while a
// genuinely separate, later payment still goes through normally.
export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback for an environment without crypto.randomUUID — still unique
  // enough for this purpose (deduping a handful of near-simultaneous
  // requests from the same browser tab, not a cryptographic requirement).
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
