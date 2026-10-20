import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Deal from '../models/Deal.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Expense from '../models/Expense.js';
import { logActivity } from '../utils/activity.js';

const MODELS = { invoice: Invoice, purchase: PurchaseOrder, expense: Expense };

async function getDealSummary(deal, loaded) {
  const [invoices, purchases, expenses] = loaded || await Promise.all([
    Invoice.find({ deal: deal._id }).select('number issuedAt status items total paid balance currency').sort('issuedAt'),
    PurchaseOrder.find({ deal: deal._id }).select('number orderedAt status items total paid balance currency').sort('orderedAt'),
    Expense.find({ deal: deal._id }).select('amount category description date status reference currency').sort('date'),
  ]);
  const activeInvoices = invoices.filter((x) => !['draft', 'cancelled', 'returned'].includes(x.status));
  const activePurchases = purchases.filter((x) => !['draft', 'cancelled'].includes(x.status));
  const postedExpenses = expenses.filter((x) => x.status === 'posted');
  const totalsByCurrency = {};
  const bucket = (currency = 'PKR') => totalsByCurrency[currency] ||= { currency, revenue: 0, costOfGoods: 0, purchaseCosts: 0, otherExpenses: 0, grossProfit: 0, netProfit: 0 };
  for (const invoice of activeInvoices) {
    const totals = bucket(invoice.currency || 'PKR');
    totals.revenue += invoice.items.reduce((s, line) => s + (Number(line.lineTotal) || 0), 0);
    totals.costOfGoods += invoice.items.reduce((s, line) => s + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0);
  }
  // Match the existing P&L: sales line snapshots define cost of goods sold. Linked
  // purchase orders are reported separately and are not deducted a second time.
  for (const po of activePurchases) bucket(po.currency || 'PKR').purchaseCosts += po.total;
  for (const expense of postedExpenses) bucket(expense.currency || 'PKR').otherExpenses += expense.amount;
  for (const totals of Object.values(totalsByCurrency)) {
    totals.grossProfit = totals.revenue - totals.costOfGoods;
    totals.netProfit = totals.grossProfit - totals.otherExpenses;
  }
  // Legacy single-currency consumers remain PKR-only; GBP is surfaced in the
  // explicit currency buckets below and is never added to PKR figures.
  const totals = totalsByCurrency.PKR || { revenue: 0, costOfGoods: 0, purchaseCosts: 0, otherExpenses: 0, grossProfit: 0, netProfit: 0 };
  return {
    deal,
    records: { invoices: activeInvoices, purchases: activePurchases, expenses },
    totals: { ...totals, totalsByCurrency },
  };
}

export const listDealAccounts = asyncHandler(async (_req, res) => {
  const deals = await Deal.find().sort({ status: 1, identifierKey: 1 });
  const ids = deals.map((deal) => deal._id);
  const [invoices, purchases, expenses] = ids.length ? await Promise.all([
    Invoice.find({ deal: { $in: ids } }).select('number issuedAt status items total paid balance currency deal').sort('issuedAt'),
    PurchaseOrder.find({ deal: { $in: ids } }).select('number orderedAt status items total paid balance currency deal').sort('orderedAt'),
    Expense.find({ deal: { $in: ids } }).select('amount category description date status reference currency deal').sort('date'),
  ]) : [[], [], []];
  const byDeal = (rows) => rows.reduce((map, row) => {
    const key = String(row.deal);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
    return map;
  }, new Map());
  const invoiceMap = byDeal(invoices), purchaseMap = byDeal(purchases), expenseMap = byDeal(expenses);
  res.json(await Promise.all(deals.map((deal) => getDealSummary(deal, [invoiceMap.get(String(deal._id)) || [], purchaseMap.get(String(deal._id)) || [], expenseMap.get(String(deal._id)) || []]))));
});

export const dealOptions = asyncHandler(async (_req, res) => {
  res.json(await Deal.find({ status: 'open' }).select('identifier description').sort('identifierKey'));
});

export const getDealAccount = asyncHandler(async (req, res) => {
  const deal = await Deal.findById(req.params.id).populate('createdBy', 'name');
  if (!deal) { res.status(404); throw new Error('Deal not found'); }
  res.json(await getDealSummary(deal));
});

export const createDealAccount = asyncHandler(async (req, res) => {
  const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
  if (!identifier || identifier.length > 80) { res.status(400); throw new Error('Enter a deal identifier of 1 to 80 characters'); }
  try {
    const deal = await Deal.create({ identifier, description: String(req.body.description || '').trim(), createdBy: req.user._id });
    await logActivity(req, 'deal_created', { entity: 'Deal', entityId: deal._id, meta: { identifier } });
    res.status(201).json(deal);
  } catch (error) {
    if (error?.code === 11000) { res.status(409); throw new Error(`Deal "${identifier}" already exists`); }
    throw error;
  }
});

export const linkDealRecord = asyncHandler(async (req, res) => {
  const { type, recordId } = req.body || {};
  const Model = MODELS[type];
  if (!Model || !mongoose.isValidObjectId(recordId)) { res.status(400); throw new Error('Select a valid invoice, purchase order, or expense'); }
  const deal = await Deal.findById(req.params.id);
  if (!deal) { res.status(404); throw new Error('Deal not found'); }
  const document = await Model.findById(recordId);
  if (!document) { res.status(404); throw new Error(`${type} record not found`); }
  if (type === 'expense' && document.status !== 'posted') { res.status(400); throw new Error('Only posted expenses can be linked to a deal'); }
  if (['invoice', 'purchase'].includes(type) && ['draft', 'cancelled', 'returned'].includes(document.status)) { res.status(400); throw new Error('Draft, cancelled, or returned documents cannot be linked to a deal'); }
  if (document.deal && String(document.deal) !== String(deal._id)) { res.status(409); throw new Error('This record already belongs to another deal'); }
  const updated = await Model.findOneAndUpdate(
    { _id: document._id, $or: [{ deal: { $exists: false } }, { deal: null }, { deal: deal._id }] },
    { $set: { deal: deal._id } }, { new: true }
  );
  if (!updated) { res.status(409); throw new Error('This record was linked to another deal while you were editing'); }
  await logActivity(req, 'deal_record_linked', { entity: type, entityId: updated._id, meta: { deal: deal.identifier } });
  res.json({ ok: true, type, recordId: updated._id, deal: deal.identifier });
});

export const unlinkDealRecord = asyncHandler(async (req, res) => {
  const Model = MODELS[req.params.type];
  if (!Model || !mongoose.isValidObjectId(req.params.recordId)) { res.status(400); throw new Error('Invalid deal record'); }
  const deal = await Deal.findById(req.params.id);
  if (!deal) { res.status(404); throw new Error('Deal not found'); }
  const updated = await Model.findOneAndUpdate({ _id: req.params.recordId, deal: deal._id }, { $unset: { deal: 1 } }, { new: true });
  if (!updated) { res.status(404); throw new Error('Linked record not found'); }
  await logActivity(req, 'deal_record_unlinked', { entity: req.params.type, entityId: updated._id, meta: { deal: deal.identifier } });
  res.json({ ok: true });
});
