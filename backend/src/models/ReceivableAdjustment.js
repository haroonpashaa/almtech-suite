import mongoose from 'mongoose';

// Audited non-cash corrections to the customer's PKR receivable. Invoice and
// payment history remains immutable; this records only the correction delta.
const receivableAdjustmentSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    currency: { type: String, enum: ['PKR'], default: 'PKR', required: true },
    amount: { type: Number, required: true, min: 0 },
    direction: { type: String, enum: ['increase', 'decrease'], required: true },
    delta: { type: Number, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    idempotencyKey: { type: String, required: true, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

receivableAdjustmentSchema.index({ customer: 1, createdAt: -1 });
receivableAdjustmentSchema.index({ idempotencyKey: 1 }, { unique: true, name: 'receivable_adjustment_idempotency_unique' });

export default mongoose.model('ReceivableAdjustment', receivableAdjustmentSchema);
