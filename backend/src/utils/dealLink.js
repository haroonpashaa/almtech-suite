import mongoose from 'mongoose';
import Deal from '../models/Deal.js';

export async function validateDealId(res, id) {
  if (!id) return undefined;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid deal'); }
  const deal = await Deal.findById(id).select('identifier status');
  if (!deal) { res.status(404); throw new Error('Deal not found'); }
  if (deal.status !== 'open') { res.status(400); throw new Error('Closed deals cannot accept new records'); }
  return deal._id;
}
