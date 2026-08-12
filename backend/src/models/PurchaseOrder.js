import mongoose from 'mongoose';

const lineSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    name: String,
    sku: String,
    quantity: { type: Number, required: true, min: 1 },
    received: { type: Number, default: 0, min: 0 },
    unitCost: { type: Number, required: true, min: 0 },
    serials: [String],
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const paymentLineSchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    method: { type: String, enum: ['cash', 'bank', 'cheque', 'other'], default: 'bank' },
    amount: { type: Number, required: true, min: 0 },
    reference: String,
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Which financial account the money left, and the ledger row recording it.
    // Optional on the schema so payments made before Change 3 still load; required
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

const poSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    items: [lineSchema],
    subtotal: { type: Number, required: true, min: 0 },
    taxRate: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paid: { type: Number, default: 0, min: 0 },
    balance: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['draft', 'ordered', 'partial', 'received', 'cancelled'],
      default: 'ordered',
    },
    payments: [paymentLineSchema],
    notes: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    orderedAt: { type: Date, default: Date.now },
    expectedAt: Date,
  },
  { timestamps: true }
);

poSchema.index({ supplier: 1, orderedAt: -1 });
poSchema.index({ status: 1 });
// Same reasoning as Invoice: the unfiltered list sorts on orderedAt alone.
poSchema.index({ orderedAt: -1 });

export default mongoose.model('PurchaseOrder', poSchema);
