import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { protect, requireRole } from '../middleware/auth.js';
import mongoose from 'mongoose';
import SaleDraft from '../models/SaleDraft.js';
import { resolvePaging, runPaged } from '../utils/pagination.js';
import { operationError } from '../utils/inventoryOperation.js';
const router = Router();
router.use(protect, requireRole('admin', 'sales'));
router.get('/', asyncHandler(async (req, res) => {
  res.json(await runPaged(res, SaleDraft, { owner: req.user._id, status: 'active' }, { sort: '-updatedAt', paging: resolvePaging(req.query, 50) }));
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const draft = await SaleDraft.findOne({ _id: req.params.id, owner: req.user._id, status: { $ne: 'discarded' } });
  if (!draft) throw operationError('Draft not found', 404);
  res.json(draft);
}));
router.put('/:id', asyncHandler(async (req, res) => {
  const { state, revision } = req.body;
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(req.params.id) || !state || typeof state !== 'object' || Array.isArray(state) || !Array.isArray(state.cart) || state.cart.length > 2000 || JSON.stringify(state).length > 1000000 || !Number.isSafeInteger(revision) || revision < 0) throw operationError('Invalid draft or draft revision', 400);
  if (state.cart.some(line => !line || typeof line !== 'object' || !mongoose.isValidObjectId(line.product) || (line.serials !== undefined && (!Array.isArray(line.serials) || line.serials.some(sn => typeof sn !== 'string'))))) throw operationError('Draft contains an invalid product or serial selection', 400);
  const fields = ['cart', 'customer', 'dealId', 'bulkMode', 'bulkAmount', 'discount', 'taxRate', 'paymentAmount', 'paymentMethod', 'paymentAccount', 'notes', 'payKey', 'stockSelection', 'selectedSerials'];
  const clean = Object.fromEntries(fields.filter(key => Object.hasOwn(state, key)).map(key => [key, state[key]]));
  if (revision === 0) {
    try { return res.status(201).json(await SaleDraft.create({ _id: req.params.id, owner: req.user._id, state: clean })); }
    catch (error) { if (error.code === 11000) throw operationError('Draft changed in another window. Reopen it before editing.'); throw error; }
  }
  const draft = await SaleDraft.findOneAndUpdate({ _id: req.params.id, owner: req.user._id, revision, status: 'active' }, { $set: { state: clean }, $inc: { revision: 1 } }, { new: true });
  if (!draft) throw operationError('Draft changed or is no longer available. Reopen it before editing.');
  res.json(draft);
}));
router.delete('/:id', asyncHandler(async (req, res) => {
  if (!Number.isSafeInteger(req.body.revision)) throw operationError('A draft revision is required', 400);
  const draft = await SaleDraft.findOneAndUpdate({ _id: req.params.id, owner: req.user._id, revision: req.body.revision, status: 'active' }, { $set: { status: 'discarded' }, $inc: { revision: 1 } }, { new: true });
  if (!draft) throw operationError('Draft changed or is no longer available');
  res.json({ ok: true });
}));
export default router;
