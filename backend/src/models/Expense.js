import mongoose from 'mongoose';

// Categories live here as configuration rather than being repeated across the
// frontend. GET /api/expenses/categories serves this list, so the dropdown and the
// server validation can never drift apart, and adding a category is a one-line edit.
export const EXPENSE_CATEGORIES = [
  'Rent',
  'Salaries',
  'Electricity',
  'Gas',
  'Internet',
  'Telephone',
  'Fuel',
  'Transport',
  'Repairs & Maintenance',
  'Office Supplies',
  'Marketing',
  'Taxes',
  'Customs',
  'Duty',
  'Shipping',
  'Bank Charges',
  'Miscellaneous',
];

// An Expense is the *categorised business record*; the money movement it causes lives
// in FinancialTransaction, exactly as an invoice payment does. The two are created
// together and reference each other for account-funded expenses. An explicit
// `other` payment source records external spending without moving an ERP account.
//
// Nothing here knows about any particular bank: `account` is a ref into the Accounts
// system created in Change 3, so a newly created account is immediately usable.
const expenseSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['GBP', 'PKR'], default: 'PKR', required: true },
    category: { type: String, required: true, enum: EXPENSE_CATEGORIES },
    paymentSource: { type: String, enum: ['account', 'other'], default: 'account' },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required() { return this.paymentSource !== 'other'; } },
    deal: { type: mongoose.Schema.Types.ObjectId, ref: 'Deal', index: true },
    date: { type: Date, required: true, default: Date.now },
    description: { type: String, trim: true },
    notes: { type: String, trim: true },
    reference: { type: String, trim: true, required() { return this.paymentSource === 'other'; } },

    // Posted expenses are never deleted. Voiding sets status and posts a reversing
    // ledger entry, so the audit trail keeps both movements.
    status: { type: String, enum: ['posted', 'voided'], default: 'posted' },

    financialTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialTransaction', required() { return this.paymentSource !== 'other'; } },
    idempotencyKey: { type: String },
    reversalTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialTransaction' },
    voidedAt: Date,
    voidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    voidReason: String,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Daily/monthly reports and the list view are all date-ordered; the compound indexes
// cover the category and account filters layered on top.
expenseSchema.index({ date: -1 });
expenseSchema.index({ status: 1, date: -1 });
expenseSchema.index({ category: 1, date: -1 });
expenseSchema.index({ account: 1, date: -1 });
expenseSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $gt: '' } } });

export default mongoose.model('Expense', expenseSchema);
