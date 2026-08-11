import asyncHandler from 'express-async-handler';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Product from '../models/Product.js';
import Supplier from '../models/Supplier.js';
import StockMovement from '../models/StockMovement.js';
import { nextNumber } from '../utils/numbering.js';
import { logActivity } from '../utils/activity.js';
import { postPaymentAtomically, resolveAccount, rethrowDuplicatePosting } from '../utils/ledger.js';
import { resolvePayment, requireReason, assertReversible, postReversal } from '../services/paymentReversal.js';

export const listPOs = asyncHandler(async (req, res) => {
  const { supplier, status } = req.query;
  const filter = {};
  if (supplier) filter.supplier = supplier;
  if (status) filter.status = status;
  const items = await PurchaseOrder.find(filter).populate('supplier', 'name').sort('-orderedAt').limit(500);
  res.json(items);
});

export const getPO = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id).populate('supplier').populate('createdBy', 'name');
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  res.json(po);
});

export const createPO = asyncHandler(async (req, res) => {
  const { supplier: supplierId, items, taxRate = 0, expectedAt, notes } = req.body;
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const product = await Product.findById(it.product);
    if (!product) {
      res.status(400);
      throw new Error(`Product not found: ${it.product}`);
    }
    const lineTotal = it.quantity * it.unitCost;
    lines.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      quantity: it.quantity,
      received: 0,
      unitCost: it.unitCost,
      serials: it.serials || [],
      lineTotal,
    });
    subtotal += lineTotal;
  }
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  const number = await nextNumber('po');
  const po = await PurchaseOrder.create({
    number,
    supplier: supplier._id,
    items: lines,
    subtotal,
    taxRate,
    taxAmount,
    total,
    balance: total,
    expectedAt,
    notes,
    createdBy: req.user._id,
  });
  supplier.payable += total;
  await supplier.save();
  await logActivity(req, 'po_created', { entity: 'PurchaseOrder', entityId: po._id, meta: { number, total } });
  res.status(201).json(po);
});

export const receiveItems = asyncHandler(async (req, res) => {
  const { receipts } = req.body;
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  for (const r of receipts) {
    const line = po.items.find((l) => l.product.toString() === r.product);
    if (!line) continue;
    const incoming = Math.max(0, Math.min(r.quantity, line.quantity - line.received));
    if (!incoming) continue;
    line.received += incoming;
    const product = await Product.findById(line.product);
    if (product) {
      product.stock += incoming;
      product.purchasePrice = line.unitCost;
      if (product.tracksSerials && r.serials?.length) {
        for (const s of r.serials) {
          if (!product.serials.find((x) => x.serial === s)) {
            product.serials.push({ serial: s, status: 'in_stock' });
          }
        }
      }
      await product.save();
      await StockMovement.create({
        product: product._id,
        type: 'purchase',
        quantity: incoming,
        balanceAfter: product.stock,
        refType: 'PurchaseOrder',
        refId: po._id,
        refNumber: po.number,
        createdBy: req.user._id,
      });
    }
  }
  const allReceived = po.items.every((l) => l.received >= l.quantity);
  const anyReceived = po.items.some((l) => l.received > 0);
  po.status = allReceived ? 'received' : anyReceived ? 'partial' : po.status;
  await po.save();
  await logActivity(req, 'po_received', { entity: 'PurchaseOrder', entityId: po._id });
  res.json(po);
});

export const recordSupplierPayment = asyncHandler(async (req, res) => {
  const { amount, method = 'bank', reference, account: accountId, idempotencyKey } = req.body;
  if (!(amount > 0)) {
    res.status(400);
    throw new Error('Amount must be > 0');
  }
  const account = await resolveAccount(res, accountId);
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  if (po.balance <= 0) {
    res.status(400);
    throw new Error('This purchase order is already settled');
  }
  const cappedAmount = Math.min(amount, po.balance);

  // PO paid/balance and Supplier.payable behave exactly as before — the supplier
  // payable data preserved in Change 1 remains the payables source of truth. The
  // addition is the money-out ledger row against the paying account.
  try {
    await postPaymentAtomically(
      {
        account: account._id,
        amount: cappedAmount,
        direction: 'out',
        type: 'supplier_payment',
        method,
        reference,
        description: `Payment on purchase order ${po.number}`,
        purchaseOrder: po._id,
        supplier: po.supplier,
        createdBy: req.user._id,
        idempotencyKey,
      },
      async (session, posted) => {
        po.payments.push({
          amount: cappedAmount,
          method,
          reference,
          recordedBy: req.user._id,
          account: account._id,
          transaction: posted._id,
        });
        po.paid += cappedAmount;
        po.balance = Math.max(0, po.total - po.paid);
        await po.save({ session });

        await Supplier.updateOne(
          { _id: po.supplier },
          [{ $set: { payable: { $max: [0, { $subtract: ['$payable', cappedAmount] }] } } }],
          session ? { session } : {}
        );
      }
    );
  } catch (e) {
    rethrowDuplicatePosting(e, res);
  }

  await logActivity(req, 'supplier_payment', {
    entity: 'PurchaseOrder',
    entityId: po._id,
    meta: { amount: cappedAmount, account: account.name },
  });
  res.json(po);
});

// ---------------------------------------------------------------------------
// Reverse a previously recorded supplier payment (admin only).
//
// Mirror image of the invoice reversal: the money goes back INTO the paying account,
// the purchase order's paid amount drops, and Supplier.payable is restored.
// ---------------------------------------------------------------------------
export const reverseSupplierPayment = asyncHandler(async (req, res) => {
  const reason = requireReason(res, req.body?.reason);

  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  if (po.status === 'cancelled') {
    res.status(409);
    throw new Error('This purchase order is cancelled, so its payments can no longer be reversed');
  }

  const { payment, index } = resolvePayment(res, po.payments, req.params.paymentId);
  const original = await assertReversible(res, payment);
  const amount = original.amount;

  const reversal = await postReversal(res, {
    original,
    payment,
    index,
    reason,
    user: req.user,
    description: `Reversal of payment on purchase order ${po.number} — ${reason}`,
    links: { purchaseOrder: po._id, supplier: po.supplier },
    applyDocumentUpdates: async (session) => {
      po.paid = Math.max(0, po.paid - amount);
      po.balance = Math.max(0, po.total - po.paid);
      // PO status tracks goods receipt, not payment — recordSupplierPayment never
      // touches it, so neither does the reversal.
      await po.save({ session });

      await Supplier.updateOne(
        { _id: po.supplier },
        { $inc: { payable: amount } },
        session ? { session } : {}
      );
    },
  });

  await logActivity(req, 'supplier_payment_reversed', {
    entity: 'PurchaseOrder',
    entityId: po._id,
    meta: { amount, reason, payment: index, reversalTransaction: reversal._id.toString() },
  });
  res.json(po);
});
