import mongoose from 'mongoose';

// Money-IN and money-OUT types. Transfers are deliberately their own pair so a
// movement between two owned accounts is never counted as income or expense.
// expense_reversal is money returning to an account because a posted expense was
// voided. It is deliberately not 'other_income' — reversing an expense is not revenue,
// and keeping it distinct stops it inflating income in any report.
// payment_reversal appears in BOTH lists on purpose: reversing a customer payment
// takes money back OUT of an account, while reversing a supplier payment puts money
// back IN. The direction is decided by the original transaction being undone.
//
// Like expense_reversal, it is deliberately not other_income/expense — a reversing
// entry is neither revenue nor a cost, and keeping it typed separately stops any
// report mistaking it for one.
export const IN_TYPES = ['customer_payment', 'sale_payment', 'other_income', 'transfer_in', 'expense_reversal', 'payment_reversal'];
export const OUT_TYPES = ['expense', 'supplier_payment', 'purchase_payment', 'other_payment', 'transfer_out', 'payment_reversal'];

// The single ledger of money movement.
//
// Relationship to the pre-existing payment records: invoice payments and purchase
// order payments are stored as embedded subdocuments on Invoice.payments[] and
// PurchaseOrder.payments[]. Those remain the document-level record of "this invoice
// was paid" and still drive invoice.paid / invoice.balance / customer.balance /
// supplier.payable exactly as before — none of that logic was replaced.
//
// This collection records the *other half* of the same event: which account the
// money physically moved into or out of. One payment therefore produces exactly one
// embedded payment line AND exactly one FinancialTransaction, linked in both
// directions (payment line -> transaction, transaction -> invoice/purchaseOrder).
// It is not a second payment system; it is the account-side view of the same event,
// and it is the only place expenses and transfers — which have no invoice to hang
// off — can be recorded.
const financialTransactionSchema = new mongoose.Schema(
  {
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
    amount: { type: Number, required: true, min: 0 },
    direction: { type: String, enum: ['in', 'out'], required: true },
    type: { type: String, enum: [...IN_TYPES, ...OUT_TYPES], required: true },
    date: { type: Date, default: Date.now },

    description: String,
    reference: String,
    method: { type: String, enum: ['cash', 'bank', 'cheque', 'other'] },

    // Source document links — at most one of these is set for a given transaction.
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
    purchaseOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
    expense: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense' },

    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier' },

    // Transfer support (architecture only — no transfer UI in this change).
    // The two legs of one transfer share a transferGroup and point at each other's
    // account via counterpartyAccount.
    transferGroup: { type: String },
    counterpartyAccount: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },

    // Set on a reversing entry, pointing at the transaction it undoes. The original is
    // never deleted or edited — the pair stands as the audit trail.
    reversalOf: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialTransaction' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Optional client-supplied key. The unique+sparse index makes a retried request
    // fail loudly instead of silently posting the money twice.
    idempotencyKey: { type: String },
  },
  { timestamps: true }
);

// Account ledger view, newest-first history, and the running-balance recompute.
financialTransactionSchema.index({ account: 1, date: -1 });
// Global payment history and date-range filtering.
financialTransactionSchema.index({ date: -1 });
// Tracing a transaction back to its source document.
financialTransactionSchema.index({ invoice: 1 });
financialTransactionSchema.index({ purchaseOrder: 1 });
financialTransactionSchema.index({ customer: 1, date: -1 });
financialTransactionSchema.index({ supplier: 1, date: -1 });
financialTransactionSchema.index({ type: 1, date: -1 });
financialTransactionSchema.index({ transferGroup: 1 });
financialTransactionSchema.index({ expense: 1 });
financialTransactionSchema.index({ reversalOf: 1 });
financialTransactionSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $gt: '' } }, name: 'idempotency_unique_when_present' }
);

export default mongoose.model('FinancialTransaction', financialTransactionSchema);
