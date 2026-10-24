import mongoose from 'mongoose';
// A durable receipt for keyed sale/removal requests, committed with their effects.
const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: ['sale', 'stock-removal'], required: true },
  key: { type: String, required: true },
  hash: { type: String, required: true },
  result: mongoose.Schema.Types.Mixed,
}, { timestamps: true });
schema.index({ owner: 1, kind: 1, key: 1 }, { unique: true });
export default mongoose.model('InventoryOperation', schema);
