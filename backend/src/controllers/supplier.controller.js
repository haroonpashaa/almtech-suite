import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Supplier from '../models/Supplier.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import OpeningBalance from '../models/OpeningBalance.js';
import { logActivity } from '../utils/activity.js';
import { resolvePaging, runPaged } from '../utils/pagination.js';

// ---------------------------------------------------------------------------
// Supplier management.
//
// Restored deliberately, not copied back. The pre-Change-1 implementation had
// problems that the architecture has since outgrown, and all of them are fixed here:
//
//  1. It passed req.body straight into create/update, so a caller could set
//     `payable` — a financial field owned by the purchase-order and payment flows.
//     Only the explicitly listed descriptive fields are writable now, which makes
//     supplier maintenance financially inert.
//  2. It had no ObjectId validation, so a malformed id surfaced as a driver error.
//  3. Its ledger counted reversed payments (Change 8) as though the money had left,
//     understating the payable.
//  4. Its ledger ignored migrated opening balances (Change 7), so the closing figure
//     could not match Supplier.payable.
//
// Supplier.payable remains the single source of truth. Nothing here writes it.
// ---------------------------------------------------------------------------

// Everything a client may set. `payable` is deliberately absent.
const WRITABLE = ['name', 'contactPerson', 'phone', 'email', 'address', 'taxNumber', 'notes', 'active'];

function pickWritable(body = {}) {
  const out = {};
  for (const k of WRITABLE) {
    if (body[k] === undefined) continue;
    out[k] = typeof body[k] === 'string' ? body[k].trim() : body[k];
  }
  return out;
}

function requireObjectId(res, id, label = 'supplier id') {
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error(`Invalid ${label}`);
  }
  return id;
}

async function findSupplier(res, id) {
  requireObjectId(res, id);
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  return supplier;
}

// Purchase orders that actually contributed to the payable. Mirrors the exclusion
// the payables module already applies, so the two can never disagree.
const COUNTED_PO = { $nin: ['cancelled', 'draft'] };

export const listSuppliers = asyncHandler(async (req, res) => {
  const { q, active } = req.query;
  const filter = {};
  if (active === 'true') filter.active = true;
  if (active === 'false') filter.active = false;
  if (q) {
    const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { contactPerson: rx }, { phone: rx }, { email: rx }];
  }
  // Unbounded by default, as before — the purchase-order form depends on getting
  // every active supplier in one call. The count header is new.
  const paging = resolvePaging(req.query, 0);
  const items = await runPaged(res, Supplier, filter, { sort: 'name', paging });
  res.json(items);
});

// One supplier with the purchase-order rollup the profile screen needs. The figures
// are derived here for display only — Supplier.payable stays authoritative and is
// returned alongside so any divergence is visible rather than hidden.
export const getSupplier = asyncHandler(async (req, res) => {
  const supplier = await findSupplier(res, req.params.id);

  // The purchase-order history is windowed. It previously took .limit(100) with no
  // total, so a supplier with more than 100 orders silently lost the rest — the
  // same defect as the invoice list, at a smaller threshold. The count is now
  // returned so the screen can say what it is not showing.
  const poLimit = Math.min(Math.max(Number(req.query.poLimit) || 100, 1), 500);
  const poPage = Math.max(Number(req.query.poPage) || 1, 1);

  const [rollup, openingAgg, recent, purchaseOrderTotal] = await Promise.all([
    PurchaseOrder.aggregate([
      { $match: { supplier: supplier._id, status: COUNTED_PO } },
      {
        $group: {
          _id: null,
          orderCount: { $sum: 1 },
          totalPurchases: { $sum: '$total' },
          totalPaid: { $sum: '$paid' },
          outstanding: { $sum: '$balance' },
          lastOrderedAt: { $max: '$orderedAt' },
        },
      },
    ]),
    OpeningBalance.aggregate([
      { $match: { entityType: 'supplier', entity: supplier._id } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    PurchaseOrder.find({ supplier: supplier._id })
      .select('number orderedAt total paid balance status expectedAt')
      .sort('-orderedAt')
      .skip((poPage - 1) * poLimit)
      .limit(poLimit),
    PurchaseOrder.countDocuments({ supplier: supplier._id }),
  ]);

  const r = rollup[0] || {};
  const openingBalance = openingAgg[0]?.total || 0;
  const derivedOutstanding = (r.outstanding || 0) + openingBalance;

  res.json({
    supplier,
    summary: {
      orderCount: r.orderCount || 0,
      totalPurchases: r.totalPurchases || 0,
      totalPaid: r.totalPaid || 0,
      openingBalance,
      outstanding: derivedOutstanding,
      // The authoritative figure, plus whether the derivation agrees with it.
      storedPayable: supplier.payable,
      reconciled: Math.abs(derivedOutstanding - supplier.payable) < 0.005,
      lastOrderedAt: r.lastOrderedAt || null,
    },
    purchaseOrders: recent,
    purchaseOrderPaging: { page: poPage, limit: poLimit, total: purchaseOrderTotal },
  });
});

export const createSupplier = asyncHandler(async (req, res) => {
  const data = pickWritable(req.body);
  if (!data.name) {
    res.status(400);
    throw new Error('Supplier name is required');
  }
  if (await Supplier.findOne({ name: data.name })) {
    res.status(409);
    throw new Error(`A supplier named "${data.name}" already exists`);
  }
  // payable is never set from input — a new supplier starts owing nothing, and only
  // purchase orders, payments and opening balances can move it.
  const supplier = await Supplier.create(data);
  await logActivity(req, 'supplier_created', { entity: 'Supplier', entityId: supplier._id, meta: { name: supplier.name } });
  res.status(201).json(supplier);
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await findSupplier(res, req.params.id);
  const data = pickWritable(req.body);

  if (data.name !== undefined && !data.name) {
    res.status(400);
    throw new Error('Supplier name cannot be empty');
  }
  if (data.name && data.name !== supplier.name) {
    if (await Supplier.findOne({ name: data.name, _id: { $ne: supplier._id } })) {
      res.status(409);
      throw new Error(`A supplier named "${data.name}" already exists`);
    }
  }

  Object.assign(supplier, data);
  await supplier.save();
  await logActivity(req, 'supplier_updated', { entity: 'Supplier', entityId: supplier._id });
  res.json(supplier);
});

// ---------------------------------------------------------------------------
// Supplier ledger.
//
// Rebuilt from exactly the events that move Supplier.payable, so the closing balance
// equals the stored figure:
//
//   opening balance   credit   (migrated from spreadsheets — Change 7)
//   purchase order    credit   (createPO adds the total)
//   payment           debit    (recordSupplierPayment subtracts)
//   payment reversal  credit   (Change 8 puts it back)
//
// A reversed payment keeps its original line — nothing is hidden — and gains a
// matching reversal line, which is what the account ledger does too.
// ---------------------------------------------------------------------------
export const supplierLedger = asyncHandler(async (req, res) => {
  const supplier = await findSupplier(res, req.params.id);

  const [pos, openings] = await Promise.all([
    PurchaseOrder.find({ supplier: supplier._id, status: COUNTED_PO }).sort('orderedAt'),
    OpeningBalance.find({ entityType: 'supplier', entity: supplier._id }).sort('asOf'),
  ]);

  const events = [];

  for (const ob of openings) {
    events.push({
      date: ob.asOf,
      type: 'opening_balance',
      description: 'Opening balance carried forward',
      reference: ob.reference || null,
      credit: ob.amount,
      debit: 0,
    });
  }

  for (const po of pos) {
    events.push({
      date: po.orderedAt,
      type: 'purchase',
      description: `Purchase order ${po.number}`,
      reference: po.number,
      purchaseOrder: po._id,
      credit: po.total,
      debit: 0,
    });
    for (const p of po.payments) {
      events.push({
        date: p.date,
        type: 'payment',
        description: `Payment on ${po.number}${p.method ? ` (${p.method})` : ''}`,
        reference: p.reference || po.number,
        purchaseOrder: po._id,
        credit: 0,
        debit: p.amount,
        reversed: !!p.reversed,
      });
      // The reversal is its own dated event, so the running balance moves on the day
      // the money actually came back rather than retroactively.
      if (p.reversed) {
        events.push({
          date: p.reversedAt || p.date,
          type: 'payment_reversal',
          description: `Payment reversed${p.reversalReason ? ` — ${p.reversalReason}` : ''}`,
          reference: p.reference || po.number,
          purchaseOrder: po._id,
          credit: p.amount,
          debit: 0,
        });
      }
    }
  }

  events.sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = 0;
  const entries = events.map((e) => {
    running += e.credit - e.debit;
    return { ...e, balance: Math.round(running * 100) / 100 };
  });

  const totalCredit = Math.round(entries.reduce((t, e) => t + e.credit, 0) * 100) / 100;
  const totalDebit = Math.round(entries.reduce((t, e) => t + e.debit, 0) * 100) / 100;
  const closing = Math.round(running * 100) / 100;

  res.json({
    supplier,
    payable: supplier.payable,
    closingBalance: closing,
    totalCredit,
    totalDebit,
    reconciled: Math.abs(closing - supplier.payable) < 0.005,
    entries: entries.reverse(), // newest first for display
  });
});
