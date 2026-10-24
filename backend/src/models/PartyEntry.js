import mongoose from 'mongoose';

// Standalone obligations, never stock movements or invented invoices/POs.
// All changes are transactionally paired with an immutable PartyEntryEvent.
const paymentSchema = new mongoose.Schema({
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialTransaction', required: true },
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  method: { type: String, enum: ['cash', 'bank', 'cheque', 'other'], required: true },
  reference: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reversed: { type: Boolean, default: false },
  reversalTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialTransaction' },
}, { _id: false });
const entrySchema = new mongoose.Schema({
  entityType: { type: String, enum: ['customer', 'supplier'], required: true },
  entity: { type: mongoose.Schema.Types.ObjectId, required: true },
  currency: { type: String, enum: ['PKR', 'GBP'], required: true },
  date: { type: Date, required: true },
  reference: { type: String, trim: true, maxlength: 200 },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  total: { type: Number, required: true, min: 0 },
  paid: { type: Number, default: 0, min: 0 },
  balance: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['active', 'void'], default: 'active' },
  version: { type: Number, default: 0 },
  payments: [paymentSchema],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
entrySchema.index({ entityType: 1, entity: 1, currency: 1, date: -1 });

const eventSchema = new mongoose.Schema({
  entry: { type: mongoose.Schema.Types.ObjectId, ref: 'PartyEntry', required: true },
  entityType: { type: String, enum: ['customer', 'supplier'], required: true },
  entity: { type: mongoose.Schema.Types.ObjectId, required: true },
  currency: { type: String, enum: ['PKR', 'GBP'], required: true },
  action: { type: String, enum: ['created', 'corrected', 'voided', 'payment', 'payment_reversed'], required: true },
  date: { type: Date, required: true },
  reason: { type: String, required: true },
  reference: String,
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  delta: { type: Number, required: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialTransaction' },
  idempotencyKey: { type: String, required: true, unique: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
eventSchema.index({ entityType: 1, entity: 1, currency: 1, date: 1 });
export const PartyEntryEvent = mongoose.model('PartyEntryEvent', eventSchema);
export default mongoose.model('PartyEntry', entrySchema);
