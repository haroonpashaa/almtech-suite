import mongoose from 'mongoose';

// Records the starting financial position carried over from the owner's spreadsheets.
//
// An opening balance is NOT a transaction: it is the position the business already had
// before ALM Suite started tracking it. So importing one never creates revenue, an
// expense, or a FinancialTransaction. It only moves the figure the relevant module
// already treats as authoritative:
//   account  -> Account.openingBalance (which shifts currentBalance by the same delta)
//   customer -> Customer.balance   (the existing receivable)
//   supplier -> Supplier.payable   (the existing payable)
//
// This collection exists so those adjustments are auditable and repeatable-safe, not to
// hold a second copy of any balance.
const openingBalanceSchema = new mongoose.Schema(
  {
    entityType: { type: String, enum: ['account', 'customer', 'supplier'], required: true },
    entity: { type: mongoose.Schema.Types.ObjectId, required: true },
    entityName: String,
    amount: { type: Number, required: true },
    asOf: { type: Date, default: Date.now },
    reference: { type: String, trim: true },
    note: String,
    importBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'ImportBatch' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Re-importing the same sheet must not stack opening balances. One entry per
// entity+reference; rows without a reference fall back to one entry per entity.
openingBalanceSchema.index(
  { entityType: 1, entity: 1, reference: 1 },
  { unique: true, name: 'opening_balance_identity' }
);
openingBalanceSchema.index({ entityType: 1, createdAt: -1 });

export default mongoose.model('OpeningBalance', openingBalanceSchema);
