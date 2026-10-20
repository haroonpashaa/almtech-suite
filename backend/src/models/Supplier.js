import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    taxNumber: { type: String, trim: true },
    payable: { type: Number, default: 0 },
    // `payable` remains the legacy PKR bucket; GBP is tracked separately so
    // supplier balances are never added across denominations.
    payableGBP: { type: Number, default: 0, min: 0 },
    notes: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

supplierSchema.index({ name: 'text', company: 'text', email: 'text' });

export default mongoose.model('Supplier', supplierSchema);
