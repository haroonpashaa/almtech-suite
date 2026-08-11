import mongoose from 'mongoose';

const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,
    sku: String,
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    serials: [String],
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const paymentLineSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    method: { type: String, enum: ['cash', 'bank', 'cheque', 'other'], default: 'cash' },
    amount: { type: Number, required: true, min: 0 },
    reference: String,
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Which financial account the money landed in, and the ledger row recording it.
    // Optional on the schema so payments taken before Change 3 still load; required
    // by the API for every new payment.
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialTransaction' },
    // Reversal audit trail. The original amount, account and date are never edited —
    // a reversed payment stays exactly as recorded and is simply marked.
    reversed: { type: Boolean, default: false },
    reversedAt: Date,
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reversalReason: String,
    reversalTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialTransaction' },
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    items: [lineSchema],
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paid: { type: Number, default: 0, min: 0 },
    balance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'open', 'partial', 'paid', 'returned', 'cancelled'],
      default: 'open',
    },
    payments: [paymentLineSchema],
    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    issuedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

invoiceSchema.index({ customer: 1, issuedAt: -1 });
invoiceSchema.index({ status: 1 });

export default mongoose.model('Invoice', invoiceSchema);
