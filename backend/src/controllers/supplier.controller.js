import asyncHandler from 'express-async-handler';
import Supplier from '../models/Supplier.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import { logActivity } from '../utils/activity.js';

export const listSuppliers = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const filter = {};
  if (q) {
    filter.$or = [
      { name: new RegExp(q, 'i') },
      { contactPerson: new RegExp(q, 'i') },
      { phone: new RegExp(q, 'i') },
      { email: new RegExp(q, 'i') },
    ];
  }
  const items = await Supplier.find(filter).sort('-createdAt');
  res.json(items);
});

export const getSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  res.json(supplier);
});

export const createSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.create(req.body);
  await logActivity(req, 'supplier_created', { entity: 'Supplier', entityId: supplier._id });
  res.status(201).json(supplier);
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  await logActivity(req, 'supplier_updated', { entity: 'Supplier', entityId: supplier._id });
  res.json(supplier);
});

export const supplierLedger = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  const pos = await PurchaseOrder.find({ supplier: supplier._id }).sort('-orderedAt');
  const entries = [];
  let running = 0;
  for (const po of pos.slice().reverse()) {
    running += po.total;
    entries.push({
      date: po.orderedAt,
      type: 'purchase',
      reference: po.number,
      credit: po.total,
      debit: 0,
      balance: running,
    });
    for (const p of po.payments) {
      running -= p.amount;
      entries.push({
        date: p.date,
        type: 'payment',
        reference: `${po.number} (${p.method})`,
        debit: p.amount,
        credit: 0,
        balance: running,
      });
    }
  }
  entries.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json({ supplier, payable: supplier.payable, entries });
});
