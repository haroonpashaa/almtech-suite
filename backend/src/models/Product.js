import mongoose from 'mongoose';

const serialSchema = new mongoose.Schema(
  {
    serial: { type: String, required: true, trim: true },
    status: { type: String, enum: ['in_stock', 'sold', 'returned'], default: 'in_stock' },
    soldInvoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true },
    brand: { type: String, trim: true },
    model: { type: String, trim: true },
    category: { type: String, trim: true, index: true },
    description: String,
    image: String,
    purchasePrice: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5, min: 0 },
    tracksSerials: { type: Boolean, default: false },
    serials: [serialSchema],
    barcode: { type: String, trim: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', sku: 'text', brand: 'text', model: 'text' });

productSchema.virtual('isLowStock').get(function () {
  return this.stock <= this.lowStockThreshold;
});

productSchema.set('toJSON', { virtuals: true });

export default mongoose.model('Product', productSchema);
