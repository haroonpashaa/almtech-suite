import mongoose from 'mongoose';
import Deal from '../models/Deal.js';
import { transactionsSupported } from './ledger.js';

export async function validateDealId(res, id) {
  if (!id) return undefined;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid deal'); }
  const deal = await Deal.findById(id).select('identifier status');
  if (!deal) { res.status(404); throw new Error('Deal not found'); }
  if (deal.status !== 'open') { res.status(400); throw new Error('Closed deals cannot accept new records'); }
  return deal._id;
}

// Deal membership and deal deletion must use transactions. The shared Deal write
// below serializes every attach against deletion, while MongoDB aborts the whole
// operation (including that write) if a process dies mid-transaction. A standalone
// MongoDB cannot provide this guarantee, so these operations fail closed there.
export async function withDealTransaction(res, work) {
  await requireDealTransactionSupport(res, true);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function requireDealTransactionSupport(res, dealId) {
  if (dealId && !(await transactionsSupported())) {
    res.status(503);
    throw new Error('Deal linking and deletion require MongoDB replica-set transaction support.');
  }
}

// This update is intentionally in the same transaction as attaching the source
// record. Deletion performs a competing write to this Deal document before it
// checks for links, so MongoDB serializes the two operations or aborts one of them.
export async function claimDealForLink(session, id, { requireOpen = true } = {}) {
  const deal = await Deal.findOneAndUpdate(
    { _id: id, ...(requireOpen ? { status: 'open' } : {}) },
    { $inc: { linkRevision: 1 } },
    { new: true, session, timestamps: false }
  ).select('identifier status');
  if (deal) return deal;

  const existing = await Deal.findById(id).session(session).select('status');
  const error = new Error(existing ? 'Closed deals cannot accept new records' : 'Deal not found');
  error.statusCode = existing ? 409 : 404;
  throw error;
}
