import mongoose from 'mongoose';
import FinancialTransaction from '../models/FinancialTransaction.js';
import { postPaymentAtomically, rethrowDuplicatePosting } from '../utils/ledger.js';

// ---------------------------------------------------------------------------
// Payment reversal — one implementation, shared by invoice and purchase-order
// payments, because the accounting is identical apart from which document and which
// party balance moves.
//
// Nothing is ever deleted or edited. The original payment line keeps its amount,
// account and date exactly as recorded and is simply marked reversed; the original
// FinancialTransaction stays untouched; and a NEW transaction is posted in the
// opposite direction. The two together are the audit trail.
// ---------------------------------------------------------------------------

// Embedded payment subdocuments are declared with `_id: false`, so they have no id of
// their own. A payment is therefore addressed either by its position in the array
// (stable — payments are only ever appended, never removed) or by the id of the ledger
// transaction it produced, which is the natural handle for an attributed payment.
export function resolvePayment(res, payments, paymentId) {
  const raw = String(paymentId ?? '');
  let index = -1;

  if (/^[0-9a-f]{24}$/i.test(raw)) {
    index = payments.findIndex((p) => String(p.transaction || '') === raw);
    if (index === -1) {
      res.status(404);
      throw new Error('No payment on this document is linked to that transaction');
    }
  } else if (/^\d+$/.test(raw)) {
    index = Number(raw);
    if (index < 0 || index >= payments.length) {
      res.status(404);
      throw new Error(`Payment ${index} not found — this document has ${payments.length} payment(s)`);
    }
  } else {
    res.status(400);
    throw new Error('Payment reference must be a payment index or a financial transaction id');
  }

  return { payment: payments[index], index };
}

export function requireReason(res, reason) {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (!r) {
    res.status(400);
    throw new Error('A reason is required to reverse a payment');
  }
  if (r.length > 500) {
    res.status(400);
    throw new Error('Reason must be 500 characters or fewer');
  }
  return r;
}

// Guards that must pass before anything is written. Each throws with a clear message
// and leaves the payment and every balance untouched.
export async function assertReversible(res, payment) {
  if (payment.reversed) {
    res.status(409);
    throw new Error('This payment has already been reversed');
  }
  // Historical payments imported without account attribution (Change 7) have no
  // ledger entry to reverse. Inventing an account to undo them would fabricate
  // accounting data, so they are refused rather than guessed at.
  if (!payment.transaction || !payment.account) {
    res.status(409);
    throw new Error(
      'This payment has no financial account or ledger entry attached (it was recorded before account tracking, ' +
        'or imported as a historical payment). It cannot be reversed automatically — correct it manually and record the adjustment.'
    );
  }
  const original = await FinancialTransaction.findById(payment.transaction);
  if (!original) {
    res.status(409);
    throw new Error('The ledger entry for this payment could not be found, so it cannot be reversed safely');
  }
  if (await FinancialTransaction.exists({ reversalOf: original._id })) {
    res.status(409);
    throw new Error('A reversing entry already exists for this payment');
  }
  return original;
}

/**
 * Posts the reversing entry and applies the document-level updates as one unit, using
 * the same atomic/compensating mechanism invoice payments, supplier payments and
 * expenses already use — no new transaction machinery is introduced here.
 *
 * `applyDocumentUpdates(session, reversalTxn)` performs the document and party-balance
 * writes and must pass `session` through to every one of them.
 */
export async function postReversal(res, {
  original,
  payment,
  index,
  reason,
  user,
  description,
  links,
  applyDocumentUpdates,
}) {
  // The reversal always moves the opposite way to the entry it undoes.
  const direction = original.direction === 'in' ? 'out' : 'in';

  let reversal;
  try {
    reversal = await postPaymentAtomically(
      {
        account: original.account,
        amount: original.amount,
        direction,
        type: 'payment_reversal',
        method: original.method,
        reference: original.reference,
        description,
        reversalOf: original._id,
        ...links,
        createdBy: user._id,
        // One reversal per original transaction, enforced by the existing unique index
        // even if two requests race past the pre-check above.
        idempotencyKey: `reversal:${original._id}`,
      },
      async (session, posted) => {
        payment.reversed = true;
        payment.reversedAt = new Date();
        payment.reversedBy = user._id;
        payment.reversalReason = reason;
        payment.reversalTransaction = posted._id;
        await applyDocumentUpdates(session, posted);
      }
    );
  } catch (e) {
    if (e?.code === 11000 && e?.keyPattern?.idempotencyKey) {
      res.status(409);
      throw new Error('This payment has already been reversed');
    }
    rethrowDuplicatePosting(e, res);
    throw e;
  }
  return reversal;
}

export const isObjectId = (v) => mongoose.isValidObjectId(v);
