import mongoose from 'mongoose';

const activitySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    action: { type: String, required: true },
    entity: String,
    entityId: String,
    meta: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

activitySchema.index({ createdAt: -1 });

export default mongoose.model('Activity', activitySchema);
