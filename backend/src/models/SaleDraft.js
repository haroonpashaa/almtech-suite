import mongoose from 'mongoose';
const schema = new mongoose.Schema({
  _id: String,
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  state: { type: mongoose.Schema.Types.Mixed, required: true },
  revision: { type: Number, default: 1 },
  status: { type: String, enum: ['active', 'finalized', 'discarded'], default: 'active' },
  invoice: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
}, { timestamps: true });
schema.index({ owner: 1, status: 1, updatedAt: -1 });
export default mongoose.model('SaleDraft', schema);
