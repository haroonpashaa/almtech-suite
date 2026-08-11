import mongoose from 'mongoose';

// Audit record of an import run. Metadata and per-row outcomes only — the uploaded
// workbook itself is never stored: it is parsed in memory and discarded, so the
// database never becomes a file store and Excel never becomes a second source of truth.
const importBatchSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    filename: { type: String, required: true },
    fileSize: Number,
    status: { type: String, enum: ['completed', 'completed_with_errors', 'failed'], default: 'completed' },
    totalRows: { type: Number, default: 0 },
    created: { type: Number, default: 0 },
    updated: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    // Bounded sample of failures so the history view is useful without unbounded growth.
    rowErrors: [{ row: Number, field: String, value: String, message: String }],
    durationMs: Number,
    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

importBatchSchema.index({ createdAt: -1 });
importBatchSchema.index({ type: 1, createdAt: -1 });

export default mongoose.model('ImportBatch', importBatchSchema);
