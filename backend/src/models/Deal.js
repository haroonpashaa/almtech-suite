import mongoose from 'mongoose';

const dealSchema = new mongoose.Schema({
  identifier: { type: String, required: true, trim: true },
  identifierKey: { type: String, required: true, unique: true, index: true },
  description: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  // Internal coordination fields: they prevent a deal deletion racing with a new
  // record link. `select: false` keeps them out of normal API responses.
  deleting: { type: Boolean, default: false, select: false },
  linkOperations: { type: Number, default: 0, min: 0, select: false },
}, { timestamps: true });

dealSchema.pre('validate', function () {
  if (this.identifier) this.identifierKey = this.identifier.trim().toLocaleLowerCase('en');
});

export default mongoose.model('Deal', dealSchema);
