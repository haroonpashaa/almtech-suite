import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    cnicNtn: { type: String, trim: true },
    address: { type: String, trim: true },
    creditLimit: { type: Number, default: 0, min: 0 },
    balance: { type: Number, default: 0 },
    notes: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

customerSchema.index({ name: 'text', company: 'text', phone: 'text', email: 'text' });
// The customer list sorts newest-first and had no index for it.
customerSchema.index({ createdAt: -1 });

export default mongoose.model('Customer', customerSchema);
