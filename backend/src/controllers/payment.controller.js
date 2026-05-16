import asyncHandler from 'express-async-handler';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';

export const recentPayments = asyncHandler(async (req, res) => {
  const { from, to } = req.query;
  const dateFilter = {};
  if (from) dateFilter.$gte = new Date(from);
  if (to) dateFilter.$lte = new Date(to);

  const invoices = await Invoice.find(Object.keys(dateFilter).length ? { 'payments.date': dateFilter } : {})
    .populate('customer', 'name')
    .sort('-issuedAt')
    .limit(200);

  const customerPayments = invoices.flatMap((inv) =>
    inv.payments.map((p) => ({
      date: p.date,
      direction: 'in',
      method: p.method,
      amount: p.amount,
      reference: p.reference,
      invoice: inv.number,
      customer: inv.customer?.name,
    }))
  );

  const pos = await PurchaseOrder.find(Object.keys(dateFilter).length ? { 'payments.date': dateFilter } : {})
    .populate('supplier', 'name')
    .sort('-orderedAt')
    .limit(200);
  const supplierPayments = pos.flatMap((po) =>
    po.payments.map((p) => ({
      date: p.date,
      direction: 'out',
      method: p.method,
      amount: p.amount,
      reference: p.reference,
      po: po.number,
      supplier: po.supplier?.name,
    }))
  );

  res.json(
    [...customerPayments, ...supplierPayments].sort((a, b) => new Date(b.date) - new Date(a.date))
  );
});
