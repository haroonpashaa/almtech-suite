import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Supplier from '../models/Supplier.js';

const CURRENCIES = ['PKR', 'GBP'];
const STATUSES = ['draft', 'ordered', 'partial', 'received', 'cancelled'];
const COUNTED_PO = { $nin: ['draft', 'cancelled'] };
const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function dayBoundary(value, label, inclusiveEnd = false) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const error = new Error(`Invalid ${label} date`);
    error.statusCode = 400;
    throw error;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    const error = new Error(`Invalid ${label} date`);
    error.statusCode = 400;
    throw error;
  }
  if (inclusiveEnd) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

function currencyBuckets(rows, fields) {
  const byCurrency = new Map(rows.map((row) => [row._id, row]));
  return CURRENCIES.map((currency) => {
    const source = byCurrency.get(currency) || {};
    return Object.fromEntries([
      ['currency', currency],
      ...fields.map((field) => [field, roundMoney(source[field] || 0)]),
    ]);
  });
}

// Read-only purchase summary. Purchase totals follow the same inclusion rule as
// supplier payables and the existing purchase time series: draft and cancelled
// orders are not counted. Supplier.payable/payableGBP remain the authoritative
// current balances and are intentionally reported separately from date-filtered
// PO balances because they also include opening balances and earlier orders.
export const purchaseSummary = asyncHandler(async (req, res) => {
  const { from, to, supplier: supplierId } = req.query;
  const start = dayBoundary(from, 'start');
  const end = dayBoundary(to, 'end', true);
  if (start && end && start >= end) {
    res.status(400);
    throw new Error('Start date must be on or before end date');
  }
  if (supplierId && !mongoose.isValidObjectId(supplierId)) {
    res.status(400);
    throw new Error('Invalid supplier');
  }

  const filters = {};
  if (supplierId) filters.supplier = new mongoose.Types.ObjectId(supplierId);
  if (start || end) {
    filters.orderedAt = {};
    if (start) filters.orderedAt.$gte = start;
    if (end) filters.orderedAt.$lt = end;
  }
  const countedFilters = { ...filters, status: COUNTED_PO };
  // Older purchase records without currency are legacy PKR, matching the supplier
  // ledger and the existing currency-compatible reports.
  const currencyExpr = { $ifNull: ['$currency', 'PKR'] };

  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const askedLimit = Math.floor(Number(req.query.limit) || 50);
  const limit = Math.min(100, Math.max(1, askedLimit));

  const [purchaseRows, statusRows, supplierRows, balanceRows, historyTotal, history] = await Promise.all([
    PurchaseOrder.aggregate([
      { $match: countedFilters },
      { $group: { _id: currencyExpr, purchaseCount: { $sum: 1 }, purchaseValue: { $sum: '$total' }, paid: { $sum: '$paid' }, outstanding: { $sum: '$balance' } } },
    ]),
    PurchaseOrder.aggregate([
      { $match: filters },
      { $group: { _id: { status: '$status', currency: currencyExpr }, count: { $sum: 1 }, value: { $sum: '$total' } } },
      { $sort: { '_id.status': 1, '_id.currency': 1 } },
    ]),
    PurchaseOrder.aggregate([
      { $match: countedFilters },
      { $group: { _id: { supplier: '$supplier', currency: currencyExpr }, purchaseCount: { $sum: 1 }, purchaseValue: { $sum: '$total' }, paid: { $sum: '$paid' }, outstanding: { $sum: '$balance' } } },
      { $lookup: { from: Supplier.collection.name, localField: '_id.supplier', foreignField: '_id', as: 'supplier' } },
      { $unwind: { path: '$supplier', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 0, supplierId: '$_id.supplier', supplierName: '$supplier.name', currency: '$_id.currency', purchaseCount: 1, purchaseValue: 1, paid: 1, outstanding: 1 } },
      { $sort: { supplierName: 1, currency: 1 } },
    ]),
    Supplier.aggregate([
      ...(supplierId ? [{ $match: { _id: new mongoose.Types.ObjectId(supplierId) } }] : []),
      { $group: { _id: null, PKR: { $sum: { $ifNull: ['$payable', 0] } }, GBP: { $sum: { $ifNull: ['$payableGBP', 0] } } } },
    ]),
    PurchaseOrder.countDocuments(filters),
    PurchaseOrder.find(filters)
      .select('number orderedAt supplier currency total paid balance status')
      .populate('supplier', 'name')
      .sort('-orderedAt -_id')
      .skip((page - 1) * limit)
      .limit(limit),
  ]);

  const balances = balanceRows[0] || {};
  const statusBreakdown = STATUSES.map((status) => ({
    status,
    currencies: CURRENCIES.map((currency) => {
      const row = statusRows.find((item) => item._id.status === status && item._id.currency === currency);
      return { currency, count: row?.count || 0, value: roundMoney(row?.value || 0) };
    }),
  }));

  res.json({
    totalsByCurrency: currencyBuckets(purchaseRows, ['purchaseCount', 'purchaseValue', 'paid', 'outstanding']),
    currentSupplierBalancesByCurrency: CURRENCIES.map((currency) => ({ currency, outstanding: roundMoney(balances[currency] || 0) })),
    statusBreakdown,
    suppliers: supplierRows.map((row) => ({
      ...row,
      purchaseValue: roundMoney(row.purchaseValue),
      paid: roundMoney(row.paid),
      outstanding: roundMoney(row.outstanding),
    })),
    purchases: history,
    pagination: { page, limit, total: historyTotal },
    filters: { from: from || null, to: to || null, supplier: supplierId || null },
  });
});
