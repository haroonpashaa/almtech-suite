import { requireSupportedCurrency } from '../utils/currencyPolicy.js';
import PartyEntry from '../models/PartyEntry.js';
import { partyEntryDetail, mergeOpenPartyEntries } from '../services/partyFinance.js';
import asyncHandler from 'express-async-handler';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Supplier from '../models/Supplier.js';
import OpeningBalance from '../models/OpeningBalance.js';
import ReceivableAdjustment from '../models/ReceivableAdjustment.js';
import { logActivity } from '../utils/activity.js';
import { requireReason } from '../services/paymentReversal.js';
import { roundCurrency } from '../services/exchangeRate.service.js';
import { runAtomically, transactionsSupported } from '../utils/ledger.js';

// ---------------------------------------------------------------------------
// Receivables & Payables
//
// Nothing here stores a balance. Customer.balance and Supplier.payable remain the
// source of truth. Document flows, audited corrections and standalone-entry
// operations update them through their validated posting paths. These endpoints are a *view*: they aggregate the open invoices and
// open purchase orders that already exist, and report the stored balance alongside the
// derived one so any divergence is visible rather than silently papered over.
//
// AGING BASIS — important: neither Invoice nor PurchaseOrder has a payment due date.
// Invoice carries only issuedAt; PurchaseOrder.expectedAt is an expected *delivery*
// date, not a payment term. Rather than invent due dates, aging is measured from the
// transaction date (invoice issuedAt / PO orderedAt). Every response carries
// `agingBasis: 'transaction_date'` so consumers cannot mistake it for contractual
// aging, and "overdue days" means "days since the document was raised".
// ---------------------------------------------------------------------------

const DAY = 86400000;

// Returned and cancelled invoices keep a non-zero `balance` field even though
// returnInvoice already removed the amount from Customer.balance. Including them would
// overstate receivables, so they are excluded here — as are drafts, which were never
// issued. The same reasoning applies to cancelled purchase orders.
const OPEN_INVOICE_MATCH = { status: { $nin: ['cancelled', 'returned', 'draft'] }, balance: { $gt: 0 } };
const OPEN_PO_MATCH = { status: { $nin: ['cancelled', 'draft'] }, balance: { $gt: 0 } };
const payableField = (currency) => currency === 'GBP' ? 'payableGBP' : 'payable';

export const exchangeRate = asyncHandler(async (req, res) => {
  res.status(410).json({ message: 'Currency conversion is temporarily unavailable. New financial entries support PKR only; historical snapshots are preserved.' });
});

const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];

function agingStages(dateField, now) {
  return [
    { $addFields: { ageDays: { $floor: { $divide: [{ $subtract: [now, `$${dateField}`] }, DAY] } } } },
    {
      $addFields: {
        bucket: {
          $switch: {
            branches: [
              { case: { $lte: ['$ageDays', 0] }, then: 'current' },
              { case: { $lte: ['$ageDays', 30] }, then: 'd1_30' },
              { case: { $lte: ['$ageDays', 60] }, then: 'd31_60' },
              { case: { $lte: ['$ageDays', 90] }, then: 'd61_90' },
            ],
            default: 'd90_plus',
          },
        },
      },
    },
  ];
}

const bucketSums = () =>
  Object.fromEntries(
    BUCKETS.map((b) => [b, { $sum: { $cond: [{ $eq: ['$bucket', b] }, '$balance', 0] } }])
  );

const emptyAging = () => Object.fromEntries(BUCKETS.map((b) => [b, 0]));

function sumAging(rows) {
  const out = emptyAging();
  for (const r of rows) for (const b of BUCKETS) out[b] += r.aging?.[b] || 0;
  return out;
}

function dateMatch(field, from, to) {
  if (!from && !to) return null;
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) range.$lte = new Date(to);
  return { [field]: range };
}

// Opening balances migrated from the owner's spreadsheets have no invoice or purchase
// order behind them, so they are merged into the rows, the aging buckets and the totals
// here. Without this they would show up only as an unexplained reconciliation gap.
// They are aged from their as-of date, which is a real recorded date.
async function openingBalanceRows(entityType, PartyModel, nameFields, now, currency) {
  const match = { entityType };
  if (currency) match.$expr = { $eq: [{ $ifNull: ['$currency', 'PKR'] }, currency] };
  const entries = await OpeningBalance.aggregate([
    { $match: match },
    { $group: { _id: '$entity', amount: { $sum: '$amount' }, oldest: { $min: '$asOf' } } },
  ]);
  if (!entries.length) return { byEntity: new Map(), total: 0 };
  const parties = await PartyModel.find({ _id: { $in: entries.map((e) => e._id) } }).select(nameFields);
  const partyById = new Map(parties.map((p) => [String(p._id), p]));
  const byEntity = new Map();
  let total = 0;
  for (const e of entries) {
    const ageDays = Math.floor((now - new Date(e.oldest)) / DAY);
    byEntity.set(String(e._id), { amount: e.amount, asOf: e.oldest, ageDays, party: partyById.get(String(e._id)) });
    total += e.amount;
  }
  return { byEntity, total };
}

const bucketFor = (ageDays) =>
  ageDays <= 0 ? 'current' : ageDays <= 30 ? 'd1_30' : ageDays <= 60 ? 'd31_60' : ageDays <= 90 ? 'd61_90' : 'd90_plus';

// The same search and date-range filters the invoice/PO pipeline applies must also
// apply to migrated opening balances, or they would leak past every filter.
function openingMatches(ob, { q, from, to, searchFields }) {
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const hit = searchFields.some((f) => rx.test(String(ob.party?.[f] || '')));
    if (!hit) return false;
  }
  if (from && new Date(ob.asOf) < new Date(from)) return false;
  if (to && new Date(ob.asOf) > new Date(to)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Receivables — money customers owe ALM
// ---------------------------------------------------------------------------
export const receivables = asyncHandler(async (req, res) => {
  const { q, from, to, bucket, status } = req.query;
  const now = new Date();

  const match = { ...OPEN_INVOICE_MATCH };
  if (status) match.status = status;
  const dm = dateMatch('issuedAt', from, to);
  if (dm) Object.assign(match, dm);

  const pipeline = [
    { $match: match },
    ...agingStages('issuedAt', now),
    {
      $group: {
        _id: '$customer',
        // Totals cover the customer's OPEN invoices only, which is what an accounts
        // receivable statement shows — settled invoices are not outstanding.
        total: { $sum: '$total' },
        paid: { $sum: '$paid' },
        outstanding: { $sum: '$balance' },
        invoiceCount: { $sum: 1 },
        oldestDate: { $min: '$issuedAt' },
        oldestAgeDays: { $max: '$ageDays' },
        ...bucketSums(),
      },
    },
    { $lookup: { from: 'customers', localField: '_id', foreignField: '_id', as: 'customer' } },
    { $unwind: '$customer' },
  ];

  // Server-side search so large datasets are never shipped to the client to filter.
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    pipeline.push({ $match: { $or: [{ 'customer.name': rx }, { 'customer.company': rx }, { 'customer.phone': rx }] } });
  }

  pipeline.push({
    $project: {
      _id: 0,
      customerId: '$_id',
      name: '$customer.name',
      company: '$customer.company',
      phone: '$customer.phone',
      storedBalance: '$customer.balance',
      total: 1,
      paid: 1,
      outstanding: 1,
      invoiceCount: 1,
      oldestDate: 1,
      oldestAgeDays: 1,
      aging: Object.fromEntries(BUCKETS.map((b) => [b, `$${b}`])),
    },
  });
  pipeline.push({ $sort: { outstanding: -1 } });

  let rows = await Invoice.aggregate(pipeline);

  const opening = await openingBalanceRows('customer', Customer, 'name company phone balance', now);
  const obFilter = { q, from, to, searchFields: ['name', 'company', 'phone'] };
  for (const row of rows) {
    const ob = opening.byEntity.get(String(row.customerId));
    if (!ob) continue;
    if (!openingMatches(ob, obFilter)) { opening.byEntity.delete(String(row.customerId)); continue; }
    row.outstanding += ob.amount;
    row.total += ob.amount;
    row.openingBalance = ob.amount;
    row.aging[bucketFor(ob.ageDays)] += ob.amount;
    row.oldestAgeDays = Math.max(row.oldestAgeDays, ob.ageDays);
    opening.byEntity.delete(String(row.customerId));
  }
  // Customers whose only receivable is a migrated opening balance still belong on the list.
  for (const [id, ob] of opening.byEntity) {
    if (!ob.party || !openingMatches(ob, obFilter)) continue;
    const aging = emptyAging();
    aging[bucketFor(ob.ageDays)] = ob.amount;
    rows.push({
      customerId: ob.party._id, name: ob.party.name, company: ob.party.company, phone: ob.party.phone,
      storedBalance: ob.party.balance, total: ob.amount, paid: 0, outstanding: ob.amount,
      invoiceCount: 0, oldestDate: ob.asOf, oldestAgeDays: ob.ageDays, openingBalance: ob.amount, aging,
    });
  }

  // Manual receivable corrections are reported separately from invoiced and paid
  // amounts. Their effective date is the recorded correction date, but they are not
  // invoices and therefore do not enter the invoice-aging buckets.
  const adjustmentMatch = {};
  const adjustmentDate = dateMatch('createdAt', from, to);
  if (adjustmentDate) Object.assign(adjustmentMatch, adjustmentDate);
  if (status && status !== 'open') adjustmentMatch._id = { $exists: false };
  const adjustmentGroups = await ReceivableAdjustment.aggregate([
    { $match: adjustmentMatch },
    { $group: { _id: '$customer', delta: { $sum: '$delta' }, count: { $sum: 1 } } },
  ]);
  const adjustmentParties = await Customer.find({ _id: { $in: adjustmentGroups.map((r) => r._id) } })
    .select('name company phone balance');
  const adjustmentPartyById = new Map(adjustmentParties.map((p) => [String(p._id), p]));
  const searchRx = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  for (const item of adjustmentGroups) {
    const party = adjustmentPartyById.get(String(item._id));
    if (!party || (searchRx && ![party.name, party.company, party.phone].some((v) => searchRx.test(String(v || ''))))) continue;
    let row = rows.find((r) => String(r.customerId) === String(item._id));
    if (!row) {
      row = {
        customerId: party._id, name: party.name, company: party.company, phone: party.phone,
        storedBalance: party.balance, total: 0, paid: 0, outstanding: 0, invoiceCount: 0,
        oldestDate: null, oldestAgeDays: 0, aging: emptyAging(),
      };
      rows.push(row);
    }
    row.adjustments = item.delta;
    row.adjustmentCount = item.count;
    row.outstanding += item.delta;
  }
  for (const row of rows) {
    row.adjustments ??= 0;
    if (req.user?.role !== 'admin') {
      delete row.adjustments;
      delete row.adjustmentCount;
    }
  }
  rows = await mergeOpenPartyEntries(rows, 'customer', Customer, req.query, now);
  // Admin must also be able to add an entry for a customer with no invoice.
  if (req.user?.role === 'admin' && !from && !to && !status) {
    const parties = await Customer.find({ active: true }).select('name company phone balance');
    const rx = q ? new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    for (const party of parties) {
      if (rows.some(row => String(row.customerId) === String(party._id))) continue;
      if (rx && ![party.name, party.company, party.phone].some(v => rx.test(String(v || '')))) continue;
      rows.push({ customerId: party._id, name: party.name, company: party.company, phone: party.phone, storedBalance: party.balance, total: 0, paid: 0, outstanding: 0, invoiceCount: 0, oldestDate: null, oldestAgeDays: 0, aging: emptyAging() });
    }
  }
  // Bucket filter runs last so it applies to opening-balance rows as well.
  if (bucket && BUCKETS.includes(bucket)) rows = rows.filter((r) => (r.aging?.[bucket] || 0) > 0);
  rows.sort((a, b) => b.outstanding - a.outstanding);

  const derivedTotal = rows.reduce((s, r) => s + r.outstanding, 0);
  const openingTotal = rows.reduce((s, r) => s + (r.openingBalance || 0), 0);
  const storedAgg = await Customer.aggregate([
    { $match: { balance: { $gt: 0 } } },
    { $group: { _id: null, total: { $sum: '$balance' } } },
  ]);
  const storedTotal = storedAgg[0]?.total || 0;
  const unfiltered = !q && !from && !to && !bucket && !status;

  res.json({
    agingBasis: 'transaction_date',
    rows,
    totalOutstanding: derivedTotal,
    openingBalances: openingTotal,
    totalInvoiced: rows.reduce((s, r) => s + r.total, 0),
    totalPaid: rows.reduce((s, r) => s + r.paid, 0),
    customerCount: rows.length,
    aging: sumAging(rows),
    ...(req.user?.role === 'admin' ? { adjustmentsTotal: rows.reduce((s, r) => s + (r.adjustments || 0), 0) } : {}),
    agingExcludesAdjustments: true,
    storedTotal,
    // Only meaningful on an unfiltered view — a filtered subset is expected to differ
    // from the stored company-wide balance.
    reconciled: unfiltered ? Math.abs(derivedTotal - storedTotal) < 0.005 : null,
  });
});

export const customerReceivable = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid customer id');
  }
  const customer = await Customer.findById(id);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }
  const now = new Date();

  // Read straight from Invoice — no copy of invoice data is kept for this screen.
  const invoices = await Invoice.find({ customer: customer._id, ...OPEN_INVOICE_MATCH }).sort('issuedAt');
  const rows = invoices.map((inv) => {
    const ageDays = Math.floor((now - inv.issuedAt) / DAY);
    return {
      _id: inv._id,
      number: inv.number,
      date: inv.issuedAt,
      total: inv.total,
      paid: inv.paid,
      balance: inv.balance,
      status: inv.status,
      ageDays,
      overdueDays: Math.max(0, ageDays),
      paymentCount: inv.payments.length,
    };
  });

  const aging = emptyAging();
  for (const r of rows) aging[bucketFor(r.ageDays)] += r.balance;

  // Any receivable migrated from a spreadsheet counts toward this customer's total too.
  const obAgg = await OpeningBalance.aggregate([
    { $match: { entityType: 'customer', entity: customer._id } },
    { $group: { _id: null, amount: { $sum: '$amount' }, oldest: { $min: '$asOf' } } },
  ]);
  const openingBalance = obAgg[0]?.amount || 0;
  let openingAgeDays = 0;
  if (openingBalance) {
    openingAgeDays = Math.floor((now - new Date(obAgg[0].oldest)) / DAY);
    aging[bucketFor(openingAgeDays)] += openingBalance;
  }
  const outstanding = rows.reduce((s, r) => s + r.balance, 0) + openingBalance;
  const adjustments = await ReceivableAdjustment.find({ customer: customer._id })
    .populate('createdBy', 'name').sort({ createdAt: -1 });
  const adjustmentTotal = adjustments.reduce((sum, row) => sum + row.delta, 0);
  const manual = await partyEntryDetail('customer', customer._id, 'PKR', req.user?.role === 'admin');
  const [documentTotals] = await Invoice.aggregate([
    { $match: { customer: customer._id, status: { $nin: ['cancelled', 'returned', 'draft'] } } },
    { $group: { _id: null, total: { $sum: '$total' }, paid: { $sum: '$paid' } } },
  ]);
  const totalOutstanding = outstanding + adjustmentTotal + manual.entryTotals.outstanding;
  const manualAging = await mergeOpenPartyEntries([], 'customer', Customer, {}, now, 'PKR', customer._id);
  const ownAging = manualAging.find(row => String(row.customerId) === String(customer._id));
  if (ownAging) for (const key of BUCKETS) aging[key] += ownAging.aging[key];

  res.json({
    agingBasis: 'transaction_date',
    customer,
    invoices: rows,
    openingBalance,
    ...(req.user?.role === 'admin' ? { adjustments, adjustmentTotal } : {}),
    ...manual,
    total: (documentTotals?.total || 0) + manual.entryTotals.total,
    paid: (documentTotals?.paid || 0) + manual.entryTotals.paid,
    documentOutstanding: outstanding - openingBalance,
    outstanding: totalOutstanding,
    storedBalance: customer.balance,
    reconciled: Math.abs(totalOutstanding - customer.balance) < 0.005,
    aging,
    agingExcludesAdjustments: true,
    oldestAgeDays: Math.max(openingAgeDays, ...rows.map((r) => r.ageDays), 0),
  });
});

// Admin-only, non-cash correction. It never rewrites invoice or payment history.
// Multi-document transactions are required so the customer balance and immutable
// audit row cannot be left apart by a failed or interrupted request.
export const adjustCustomerReceivable = asyncHandler(async (req, res) => {
  requireSupportedCurrency(req.body.currency ?? 'PKR');
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) { res.status(400); throw new Error('Invalid customer id'); }
  if (!(await transactionsSupported())) {
    res.status(503);
    throw new Error('Receivable corrections require MongoDB transaction support; no changes were made.');
  }
  const rawAmount = Number(req.body?.amount);
  const amount = Number.isFinite(rawAmount) ? roundCurrency(rawAmount) : NaN;
  const direction = req.body?.direction;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
  const expectedBalance = Number(req.body?.expectedBalance);
  if (!Number.isFinite(amount) || amount <= 0) { res.status(400); throw new Error('Amount must be greater than zero'); }
  if (!['increase', 'decrease'].includes(direction)) { res.status(400); throw new Error('Direction must be increase or decrease'); }
  if (!reason) { res.status(400); throw new Error('A correction reason is required'); }
  if (reason.length > 500) { res.status(400); throw new Error('Reason must be 500 characters or fewer'); }
  if (!idempotencyKey || idempotencyKey.length > 200) { res.status(400); throw new Error('A valid idempotency key is required'); }
  if (!Number.isFinite(expectedBalance) || expectedBalance < 0) { res.status(400); throw new Error('A valid expected customer balance is required'); }
  if (await ReceivableAdjustment.exists({ idempotencyKey })) { res.status(409); throw new Error('This correction has already been recorded'); }

  let result;
  try {
    result = await runAtomically(async (session) => {
      const customer = await Customer.findById(id).session(session);
      if (!customer) { res.status(404); throw new Error('Customer not found'); }
      if (customer.balance !== expectedBalance) { res.status(409); throw new Error('Customer balance changed since it was loaded. Refresh and retry.'); }

      const [invoiceAgg, openingAgg, adjustmentAgg, entryAgg] = await Promise.all([
        Invoice.aggregate([{ $match: { customer: customer._id, ...OPEN_INVOICE_MATCH } }, { $group: { _id: null, total: { $sum: '$balance' } } }]).session(session),
        OpeningBalance.aggregate([{ $match: { entityType: 'customer', entity: customer._id } }, { $group: { _id: null, total: { $sum: '$amount' } } }]).session(session),
        ReceivableAdjustment.aggregate([{ $match: { customer: customer._id } }, { $group: { _id: null, total: { $sum: '$delta' } } }]).session(session),
        PartyEntry.aggregate([{ $match: { entityType: 'customer', entity: customer._id, status: 'active' } }, { $group: { _id: null, total: { $sum: '$balance' } } }]).session(session),
      ]);
      const currentDerived = (invoiceAgg[0]?.total || 0) + (openingAgg[0]?.total || 0) + (adjustmentAgg[0]?.total || 0) + (entryAgg[0]?.total || 0);
      const delta = direction === 'increase' ? amount : -amount;
      if (currentDerived + delta < -0.005 || customer.balance + delta < -0.005) { res.status(400); throw new Error('A correction cannot reduce receivables below zero'); }
      const balanceAfter = Math.round((customer.balance + delta) * 100) / 100;
      const [adjustment] = await ReceivableAdjustment.create([{
        customer: customer._id, currency: 'PKR', amount, direction, delta, balanceBefore: customer.balance,
        balanceAfter, reason, idempotencyKey, createdBy: req.user._id,
      }], { session });
      const updated = await Customer.findOneAndUpdate(
        { _id: customer._id, balance: expectedBalance },
        { $inc: { balance: delta } },
        { new: true, session }
      );
      if (!updated) { res.status(409); throw new Error('Customer balance changed during this correction. Refresh and retry.'); }
      return { customer: updated, adjustment };
    });
  } catch (error) {
    if (error?.code === 11000) { res.status(409); throw new Error('This correction has already been recorded'); }
    throw error;
  }
  await logActivity(req, 'receivable_adjusted', {
    entity: 'Customer', entityId: result.customer._id,
    meta: { adjustmentId: result.adjustment._id, amount, direction, delta: result.adjustment.delta, reason },
  });
  res.status(201).json(result);
});

// ---------------------------------------------------------------------------
// Payables — money ALM owes suppliers.
//
// This reads the Supplier records and purchase orders preserved in Change 1. The
// aggregate/list views below remain read-only computed data — nothing here stores a
// balance of its own. The one write this file exposes is adjustSupplierPayable
// further down: an audited correction to Supplier.payable, never a direct overwrite.
// ---------------------------------------------------------------------------
export const payables = asyncHandler(async (req, res) => {
  const { q, from, to, bucket, status } = req.query;
  const currency = req.query.currency || 'PKR';
  if (!['GBP', 'PKR'].includes(currency)) { res.status(400); throw new Error('Payable currency must be GBP or PKR'); }
  const field = payableField(currency);
  const now = new Date();

  const match = { ...OPEN_PO_MATCH };
  match.$expr = { $eq: [{ $ifNull: ['$currency', 'PKR'] }, currency] };
  if (status) match.status = status;
  const dm = dateMatch('orderedAt', from, to);
  if (dm) Object.assign(match, dm);

  const pipeline = [
    { $match: match },
    ...agingStages('orderedAt', now),
    {
      $group: {
        _id: '$supplier',
        total: { $sum: '$total' },
        paid: { $sum: '$paid' },
        outstanding: { $sum: '$balance' },
        poCount: { $sum: 1 },
        oldestDate: { $min: '$orderedAt' },
        oldestAgeDays: { $max: '$ageDays' },
        ...bucketSums(),
      },
    },
    { $lookup: { from: 'suppliers', localField: '_id', foreignField: '_id', as: 'supplier' } },
    { $unwind: '$supplier' },
  ];

  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    pipeline.push({ $match: { $or: [{ 'supplier.name': rx }, { 'supplier.contactPerson': rx }, { 'supplier.phone': rx }] } });
  }

  pipeline.push({
    $project: {
      _id: 0,
      supplierId: '$_id',
      name: '$supplier.name',
      contactPerson: '$supplier.contactPerson',
      phone: '$supplier.phone',
      storedPayable: `$supplier.${field}`,
      total: 1,
      paid: 1,
      outstanding: 1,
      poCount: 1,
      oldestDate: 1,
      oldestAgeDays: 1,
      aging: Object.fromEntries(BUCKETS.map((b) => [b, `$${b}`])),
    },
  });
  pipeline.push({ $sort: { outstanding: -1 } });

  let rows = await PurchaseOrder.aggregate(pipeline);

  const opening = await openingBalanceRows('supplier', Supplier, 'name contactPerson phone payable payableGBP', now, currency);
  const obFilter = { q, from, to, searchFields: ['name', 'contactPerson', 'phone'] };
  for (const row of rows) {
    const ob = opening.byEntity.get(String(row.supplierId));
    if (!ob) continue;
    if (!openingMatches(ob, obFilter)) { opening.byEntity.delete(String(row.supplierId)); continue; }
    row.outstanding += ob.amount;
    row.total += ob.amount;
    row.openingBalance = ob.amount;
    row.aging[bucketFor(ob.ageDays)] += ob.amount;
    row.oldestAgeDays = Math.max(row.oldestAgeDays, ob.ageDays);
    opening.byEntity.delete(String(row.supplierId));
  }
  for (const [id, ob] of opening.byEntity) {
    if (!ob.party || !openingMatches(ob, obFilter)) continue;
    const aging = emptyAging();
    aging[bucketFor(ob.ageDays)] = ob.amount;
    rows.push({
      supplierId: ob.party._id, name: ob.party.name, contactPerson: ob.party.contactPerson, phone: ob.party.phone,
      storedPayable: ob.party[field] || 0, total: ob.amount, paid: 0, outstanding: ob.amount,
      poCount: 0, oldestDate: ob.asOf, oldestAgeDays: ob.ageDays, openingBalance: ob.amount, aging,
    });
  }

  // Every active supplier belongs in this list, not only ones currently owing
  // money — an Admin must be able to reach and correct any supplier's payable
  // from this section, and a supplier with nothing outstanding was otherwise
  // never reachable here at all (only via Suppliers → Payables card). These are
  // plain zero rows, still fully linked to the same adjustable detail page.
  const covered = new Set(rows.map((r) => String(r.supplierId)));
  const supplierMatch = { active: true };
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    supplierMatch.$or = [{ name: rx }, { contactPerson: rx }, { phone: rx }];
  }
  const remaining = await Supplier.find(supplierMatch).select('name contactPerson phone payable payableGBP').sort('name');
  for (const s of remaining) {
    if (covered.has(String(s._id))) continue;
    rows.push({
      supplierId: s._id, name: s.name, contactPerson: s.contactPerson, phone: s.phone,
      storedPayable: s[field] || 0, total: 0, paid: 0, outstanding: 0,
      poCount: 0, oldestDate: null, oldestAgeDays: 0, aging: emptyAging(),
    });
  }

  rows = await mergeOpenPartyEntries(rows, 'supplier', Supplier, req.query, now, currency);
  if (bucket && BUCKETS.includes(bucket)) rows = rows.filter((r) => (r.aging?.[bucket] || 0) > 0);
  rows.sort((a, b) => b.outstanding - a.outstanding);

  const derivedTotal = rows.reduce((s, r) => s + r.outstanding, 0);
  const openingTotal = rows.reduce((s, r) => s + (r.openingBalance || 0), 0);
  const storedAgg = await Supplier.aggregate([{ $group: { _id: null, total: { $sum: { $ifNull: [`$${field}`, 0] } } } }]);
  const storedTotal = storedAgg[0]?.total || 0;
  const unfiltered = !q && !from && !to && !bucket && !status;

  res.json({
    agingBasis: 'transaction_date',
    currency,
    rows,
    totalOutstanding: derivedTotal,
    openingBalances: openingTotal,
    totalOrdered: rows.reduce((s, r) => s + r.total, 0),
    totalPaid: rows.reduce((s, r) => s + r.paid, 0),
    supplierCount: rows.length,
    aging: sumAging(rows),
    storedTotal,
    reconciled: unfiltered ? Math.abs(derivedTotal - storedTotal) < 0.005 : null,
  });
});

export const supplierPayable = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid supplier id');
  }
  const currency = req.query.currency || 'PKR';
  if (!['GBP', 'PKR'].includes(currency)) { res.status(400); throw new Error('Payable currency must be GBP or PKR'); }
  const field = payableField(currency);
  const supplier = await Supplier.findById(id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  const now = new Date();

  const pos = await PurchaseOrder.find({ supplier: supplier._id, ...OPEN_PO_MATCH, $expr: { $eq: [{ $ifNull: ['$currency', 'PKR'] }, currency] } }).sort('orderedAt');
  const rows = pos.map((po) => {
    const ageDays = Math.floor((now - po.orderedAt) / DAY);
    return {
      _id: po._id,
      currency,
      fxSnapshot: po.fxSnapshots?.at(-1) || null,
      number: po.number,
      date: po.orderedAt,
      // Expected delivery date, surfaced for context only — it is not a payment due date.
      expectedAt: po.expectedAt,
      total: po.total,
      paid: po.paid,
      balance: po.balance,
      status: po.status,
      ageDays,
      overdueDays: Math.max(0, ageDays),
      paymentCount: po.payments.length,
    };
  });

  const aging = emptyAging();
  for (const r of rows) aging[bucketFor(r.ageDays)] += r.balance;

  const obAgg = await OpeningBalance.aggregate([
    { $match: { entityType: 'supplier', entity: supplier._id, $expr: { $eq: [{ $ifNull: ['$currency', 'PKR'] }, currency] } } },
    { $group: { _id: null, amount: { $sum: '$amount' }, oldest: { $min: '$asOf' } } },
  ]);
  const openingBalance = obAgg[0]?.amount || 0;
  let openingAgeDays = 0;
  if (openingBalance) {
    openingAgeDays = Math.floor((now - new Date(obAgg[0].oldest)) / DAY);
    aging[bucketFor(openingAgeDays)] += openingBalance;
  }
  const outstanding = rows.reduce((s, r) => s + r.balance, 0) + openingBalance;

  const manual = await partyEntryDetail('supplier', supplier._id, currency, true);
  const [documentTotals] = await PurchaseOrder.aggregate([
    { $match: { supplier: supplier._id, status: { $nin: ['cancelled', 'draft'] }, $expr: { $eq: [{ $ifNull: ['$currency', 'PKR'] }, currency] } } },
    { $group: { _id: null, total: { $sum: '$total' }, paid: { $sum: '$paid' } } },
  ]);
  const manualAging = await mergeOpenPartyEntries([], 'supplier', Supplier, {}, now, currency, supplier._id);
  const ownAging = manualAging.find(row => String(row.supplierId) === String(supplier._id));
  if (ownAging) for (const key of BUCKETS) aging[key] += ownAging.aging[key];
  res.json({
    agingBasis: 'transaction_date',
    currency,
    supplier,
    purchaseOrders: rows,
    openingBalance,
    ...manual,
    total: (documentTotals?.total || 0) + manual.entryTotals.total,
    paid: (documentTotals?.paid || 0) + manual.entryTotals.paid,
    documentOutstanding: outstanding - openingBalance,
    outstanding: outstanding + manual.entryTotals.outstanding,
    storedPayable: supplier[field] || 0,
    reconciled: Math.abs(outstanding + manual.entryTotals.outstanding - (supplier[field] || 0)) < 0.005,
    aging,
    oldestAgeDays: Math.max(openingAgeDays, ...rows.map((r) => r.ageDays), 0),
  });
});

// ---------------------------------------------------------------------------
// Manual payable balance correction (admin only).
//
// Supplier.payable is never simply overwritten. Instead this posts an audited
// OpeningBalance entry — the same mechanism the Opening Balances import already
// uses to apply a migrated balance — and applies the identical delta to
// Supplier.payable, so a correction always leaves a traceable record instead of
// a silent edit. `amount` is the CORRECTED total the admin wants the payable to
// read; the delta actually applied is computed here from the supplier's stored
// value at write time, not from whatever the client last saw.
// ---------------------------------------------------------------------------
export const adjustSupplierPayable = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    res.status(400);
    throw new Error('Invalid supplier id');
  }
  const note = requireReason(res, req.body?.note);
  const currency = req.body?.currency || 'PKR';
  requireSupportedCurrency(currency);
  const newTotal = Number(req.body?.amount);
  if (!Number.isFinite(newTotal) || newTotal < 0 || Math.abs(newTotal - roundCurrency(newTotal)) > 1e-8) {
    res.status(400);
    throw new Error(`Enter a valid ${currency} corrected payable amount (0 or more, up to 2 decimal places)`);
  }
  const expectedUpdatedAt = new Date(req.body?.expectedUpdatedAt);
  if (!req.body?.expectedUpdatedAt || Number.isNaN(expectedUpdatedAt.getTime())) { res.status(400); throw new Error('Reload the supplier payable before editing it'); }
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
  if (!idempotencyKey || idempotencyKey.length > 200) { res.status(400); throw new Error('A valid idempotency key is required'); }

  const supplier = await Supplier.findById(id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  if (supplier.updatedAt.getTime() !== expectedUpdatedAt.getTime()) { res.status(409); throw new Error('Supplier payable changed since it was loaded. Reload and try again.'); }
  const field = payableField(currency);
  const delta = roundCurrency(newTotal - (supplier[field] || 0));
  if (delta === 0) {
    res.status(400);
    throw new Error('The corrected amount matches the current payable — nothing to adjust');
  }

  let adjustment;
  try {
    adjustment = await OpeningBalance.create({
      entityType: 'supplier', entity: supplier._id, entityName: supplier.name,
      amount: delta, currency, idempotencyKey,
      reference: `manual-adjust:${idempotencyKey}`, note, createdBy: req.user._id,
    });
  } catch (error) {
    if (error?.code === 11000) { res.status(409); throw new Error('This payable adjustment has already been submitted'); }
    throw error;
  }

  const updated = await Supplier.findOneAndUpdate(
    { _id: supplier._id, updatedAt: expectedUpdatedAt },
    { $inc: { [field]: delta } },
    { new: true }
  );
  if (!updated) {
    // Supplier vanished between the read above and this write — undo the audit
    // row rather than leave a recorded adjustment with nothing applied.
    await OpeningBalance.deleteOne({ _id: adjustment._id });
    res.status(409);
    throw new Error('Supplier payable changed during the edit. Reload and try again.');
  }

  await logActivity(req, 'payable_adjusted', {
    entity: 'Supplier',
    entityId: supplier._id,
    meta: { delta, newTotal, currency, note, adjustmentId: adjustment._id },
  });

  res.status(201).json({ supplier: updated, adjustment });
});

// ---------------------------------------------------------------------------
// Net outstanding position — what is owed to the business minus what it owes.
// This is a money-owed position, not profit.
// ---------------------------------------------------------------------------
export const position = asyncHandler(async (_req, res) => {
  const now = new Date();
  const [recAgg, adjustmentAgg, payAgg, storedRec, storedPay] = await Promise.all([
    Invoice.aggregate([{ $match: OPEN_INVOICE_MATCH }, { $group: { _id: null, total: { $sum: '$balance' } } }]),
    ReceivableAdjustment.aggregate([{ $group: { _id: null, total: { $sum: '$delta' } } }]),
    PurchaseOrder.aggregate([{ $match: OPEN_PO_MATCH }, { $group: { _id: { $ifNull: ['$currency', 'PKR'] }, total: { $sum: '$balance' } } }]),
    Customer.aggregate([{ $match: { balance: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: '$balance' } } }]),
    Supplier.aggregate([{ $group: { _id: null, PKR: { $sum: { $ifNull: ['$payable', 0] } }, GBP: { $sum: { $ifNull: ['$payableGBP', 0] } } } }]),
  ]);

  const [openRec, openPay] = await Promise.all([
    OpeningBalance.aggregate([{ $match: { entityType: 'customer' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    OpeningBalance.aggregate([{ $match: { entityType: 'supplier' } }, { $group: { _id: { $ifNull: ['$currency', 'PKR'] }, total: { $sum: '$amount' } } }]),
  ]);
  const entries = await PartyEntry.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: { entityType: '$entityType', currency: '$currency' }, total: { $sum: '$balance' } } },
  ]);
  const receivablesTotal = (recAgg[0]?.total || 0) + (openRec[0]?.total || 0) + (adjustmentAgg[0]?.total || 0) + (entries.find(row => row._id.entityType === 'customer')?.total || 0);
  const payablesByCurrency = { PKR: 0, GBP: 0 };
  for (const row of payAgg) payablesByCurrency[row._id] += row.total;
  for (const row of openPay) if (payablesByCurrency[row._id] !== undefined) payablesByCurrency[row._id] += row.total;
  for (const row of entries) if (row._id.entityType === 'supplier') payablesByCurrency[row._id.currency] += row.total;
  const storedPayablesByCurrency = { PKR: storedPay[0]?.PKR || 0, GBP: storedPay[0]?.GBP || 0 };
  const payablesTotal = payablesByCurrency.PKR;

  res.json({
    asOf: now,
    receivables: receivablesTotal,
    payables: payablesTotal,
    payablesByCurrency,
    netPosition: receivablesTotal - payablesTotal,
    storedReceivables: storedRec[0]?.total || 0,
    storedPayables: storedPayablesByCurrency.PKR,
    storedPayablesByCurrency,
    reconciled:
      Math.abs(receivablesTotal - (storedRec[0]?.total || 0)) < 0.005 &&
      Math.abs(payablesByCurrency.PKR - storedPayablesByCurrency.PKR) < 0.005 &&
      Math.abs(payablesByCurrency.GBP - storedPayablesByCurrency.GBP) < 0.005,
  });
});
