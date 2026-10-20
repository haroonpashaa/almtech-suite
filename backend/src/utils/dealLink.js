import mongoose from 'mongoose';
import asyncHandler from 'express-async-handler';
import Deal from '../models/Deal.js';

export async function validateDealId(res, id) {
  if (!id) return undefined;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid deal'); }
  const deal = await Deal.findById(id).select('identifier status');
  if (!deal) { res.status(404); throw new Error('Deal not found'); }
  if (deal.status !== 'open') { res.status(400); throw new Error('Closed deals cannot accept new records'); }
  return deal._id;
}

// Keep a deal locked against deletion until a newly created invoice, purchase
// order, or expense has finished writing. Existing-record linking uses the same
// counter in dealAccounts.controller.js.
export const reserveDealForRecordCreation = asyncHandler(async (req, res, next) => {
  const id = req.body?.dealId;
  if (!id) return next();
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid deal'); }

  const deal = await Deal.findOneAndUpdate(
    { _id: id, status: 'open', deleting: { $ne: true } },
    { $inc: { linkOperations: 1 } },
    { new: true }
  );
  if (!deal) {
    const existing = await Deal.findById(id).select('status');
    if (!existing) { res.status(404); throw new Error('Deal not found'); }
    res.status(existing.status === 'open' ? 409 : 400);
    throw new Error(existing.status === 'open' ? 'This deal is being deleted; try again shortly' : 'Closed deals cannot accept new records');
  }

  let released = false;
  res.once('finish', () => {
    if (released) return;
    released = true;
    Deal.updateOne({ _id: deal._id, linkOperations: { $gt: 0 } }, { $inc: { linkOperations: -1 } }).catch((error) => {
      console.error('Failed to release deal record-creation lock:', error.message);
    });
  });
  next();
});
