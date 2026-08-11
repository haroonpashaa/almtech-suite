import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import FinancialTransaction from '../models/FinancialTransaction.js';

// Unified payment / financial history.
//
// From Change 3 onwards every payment writes a FinancialTransaction, so the ledger is
// the complete record. Payments recorded *before* Change 3 exist only as embedded
// subdocuments on Invoice.payments[] / PurchaseOrder.payments[] with no ledger row —
// this endpoint therefore returns the union of both, flagging the pre-ledger ones as
// `legacy` (they have no account attribution) so no existing history is lost.
export const recentPayments = asyncHandler(async (req, res) => {
  const { from, to, account, type, direction, customer, supplier, invoice, purchaseOrder, limit = 300 } = req.query;

  const filter = {};
  if (from || to) {
    filter.date = {};
    if (from) filter.date.$gte = new Date(from);
    if (to) filter.date.$lte = new Date(to);
  }
  if (account && mongoose.isValidObjectId(account)) filter.account = account;
  if (type) filter.type = type;
  if (direction) filter.direction = direction;
  if (customer && mongoose.isValidObjectId(customer)) filter.customer = customer;
  if (supplier && mongoose.isValidObjectId(supplier)) filter.supplier = supplier;
  if (invoice && mongoose.isValidObjectId(invoice)) filter.invoice = invoice;
  if (purchaseOrder && mongoose.isValidObjectId(purchaseOrder)) filter.purchaseOrder = purchaseOrder;

  const txns = await FinancialTransaction.find(filter)
    .populate('account', 'name type')
    .populate('customer', 'name')
    .populate('supplier', 'name')
    .populate('invoice', 'number status balance')
    .populate('purchaseOrder', 'number status balance')
    .populate('createdBy', 'name')
    .sort('-date')
    .limit(Number(limit));

  const rows = txns.map((t) => ({
    _id: t._id,
    date: t.date,
    direction: t.direction,
    type: t.type,
    amount: t.amount,
    account: t.account?.name,
    accountId: t.account?._id,
    accountType: t.account?.type,
    method: t.method,
    reference: t.reference,
    description: t.description,
    customer: t.customer?.name,
    supplier: t.supplier?.name,
    invoice: t.invoice?.number,
    invoiceId: t.invoice?._id,
    status: t.invoice?.status ?? t.purchaseOrder?.status,
    po: t.purchaseOrder?.number,
    purchaseOrderId: t.purchaseOrder?._id,
    user: t.createdBy?.name,
    legacy: false,
  }));

  // Pre-Change-3 payments. Skipped entirely when filtering by something they cannot
  // carry (account, ledger type, direction) — they would never match anyway.
  const wantsLegacy = !account && !type && !direction && !customer && !supplier;
  if (wantsLegacy) {
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    const hasDate = Object.keys(dateFilter).length > 0;

    // When the caller is asking about one purchase order, invoice-side legacy payments
    // can never match — scanning them anyway would leak unrelated rows into the result.
    const invFilter = hasDate ? { 'payments.date': dateFilter } : {};
    if (invoice && mongoose.isValidObjectId(invoice)) invFilter._id = invoice;
    const invoices = purchaseOrder ? [] : await Invoice.find(invFilter).populate('customer', 'name').sort('-issuedAt').limit(300);
    for (const inv of invoices) {
      for (const p of inv.payments) {
        if (p.transaction) continue; // already represented by a ledger row
        rows.push({
          date: p.date,
          direction: 'in',
          type: 'customer_payment',
          amount: p.amount,
          account: null,
          method: p.method,
          reference: p.reference,
          description: `Payment on invoice ${inv.number}`,
          customer: inv.customer?.name,
          invoice: inv.number,
          invoiceId: inv._id,
          status: inv.status,
          legacy: true,
        });
      }
    }

    const poFilter = hasDate ? { 'payments.date': dateFilter } : {};
    if (purchaseOrder && mongoose.isValidObjectId(purchaseOrder)) poFilter._id = purchaseOrder;
    const pos = invoice ? [] : await PurchaseOrder.find(poFilter).populate('supplier', 'name').sort('-orderedAt').limit(300);
    for (const po of pos) {
      for (const p of po.payments) {
        if (p.transaction) continue;
        rows.push({
          date: p.date,
          direction: 'out',
          type: 'supplier_payment',
          amount: p.amount,
          account: null,
          method: p.method,
          reference: p.reference,
          description: `Payment on purchase order ${po.number}`,
          supplier: po.supplier?.name,
          po: po.number,
          purchaseOrderId: po._id,
          status: po.status,
          legacy: true,
        });
      }
    }
  }

  rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(rows);
});
