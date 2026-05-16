import mongoose from 'mongoose';

const movementSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    type: { type: String, enum: ['sale', 'purchase', 'return', 'adjustment'], required: true },
    quantity: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    refType: { type: String, enum: ['Invoice', 'PurchaseOrder', 'Adjustment'] },
    refId: mongoose.Schema.Types.ObjectId,
    refNumber: String,
    note: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

movementSchema.index({ product: 1, createdAt: -1 });

export default mongoose.model('StockMovement', movementSchema);
