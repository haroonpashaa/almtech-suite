import mongoose from 'mongoose';

const settingsSchema = new mongoose.Schema(
  {
    businessName: { type: String, default: 'ALMTech' },
    address: String,
    phone: String,
    email: String,
    taxNumber: String,
    logoUrl: String,
    currency: { type: String, default: 'PKR' },
    defaultTaxRate: { type: Number, default: 0 },
    showTaxOnInvoices: { type: Boolean, default: true },
    invoicePrefix: { type: String, default: 'INV-' },
    invoiceNextNumber: { type: Number, default: 1 },
    quotationPrefix: { type: String, default: 'QT-' },
    quotationNextNumber: { type: Number, default: 1 },
    poPrefix: { type: String, default: 'PO-' },
    poNextNumber: { type: Number, default: 1 },
  },
  { timestamps: true }
);

settingsSchema.statics.getSingleton = async function () {
  let doc = await this.findOne();
  if (!doc) doc = await this.create({});
  return doc;
};

export default mongoose.model('Settings', settingsSchema);
