import mongoose from 'mongoose';

// A financial account is any place money is held — the till, a bank account, a
// wallet. Nothing here is specific to a particular bank: "Bank of Punjab" and
// "Soneri Bank" are just two rows of type 'bank'. Adding another account is a
// data operation (POST /api/accounts), never a schema change.
const accountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    type: { type: String, enum: ['cash', 'bank', 'wallet', 'other'], required: true },

    // Optional descriptive metadata — meaningful for bank/wallet accounts,
    // simply left blank for cash. No behaviour branches on these.
    bankName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    accountTitle: { type: String, trim: true },

    // Balance model: currentBalance is maintained incrementally with an atomic
    // $inc on every posting, and must always equal
    //   openingBalance + sum(in) - sum(out)
    // over this account's FinancialTransaction rows. GET /accounts/:id/ledger
    // recomputes that sum and reports any drift rather than hiding it.
    openingBalance: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },

    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    notes: String,
  },
  { timestamps: true }
);

accountSchema.index({ active: 1, sortOrder: 1 });

export default mongoose.model('Account', accountSchema);
