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
    notes: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

supplierSchema.index({ name: 'text', company: 'text', email: 'text' });

export default mongoose.model('Supplier', supplierSchema);
