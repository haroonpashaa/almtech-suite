import { useCallback, useRef, useState } from 'react';

/* ---------------------------------------------------------------------------
   Guarded submission.

   On a phone a "tap" is easy to deliver twice — a fat-finger double tap, a
   300 ms click after a touchend, or an impatient second press while the request
   is in flight. Verified against the running API: two concurrent POSTs to
   /invoices/:id/payments both succeeded and moved 4,000 out of a 2,000 payment.

   This hook makes the UI incapable of issuing the second request:
     - `pending` disables the control and shows progress
     - a ref latch rejects re-entry even before React re-renders, which is the
       case a `disabled` prop alone does not cover on a fast double tap
     - the latch always clears, on success and on failure, so a failed action can
       be retried rather than being dead

   It deliberately does NOT retry, dedupe by key, or invent an idempotency
   mechanism — the accounting layer owns that decision.
   --------------------------------------------------------------------------- */
export function useSubmit(fn, { onError } = {}) {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback(async (...args) => {
    // Synchronous latch: set before any await, so a second tap in the same tick
    // is rejected even though `pending` has not re-rendered yet.
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPending(true);
    try {
      return await fn(...args);
    } catch (err) {
      if (onError) onError(err);
      else throw err;
      return undefined;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [fn, onError]);

  return { run, pending };
}
