import mongoose from 'mongoose';

const dealSchema = new mongoose.Schema({
  identifier: { type: String, required: true, trim: true },
  identifierKey: { type: String, required: true, unique: true, index: true },
  description: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

dealSchema.pre('validate', function () {
  if (this.identifier) this.identifierKey = this.identifier.trim().toLocaleLowerCase('en');
});

export default mongoose.model('Deal', dealSchema);
