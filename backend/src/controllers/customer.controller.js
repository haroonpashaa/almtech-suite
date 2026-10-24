import { partyEntryLedgerEvents } from '../services/partyFinance.js';
import OpeningBalance from '../models/OpeningBalance.js';
import ReceivableAdjustment from '../models/ReceivableAdjustment.js';
import asyncHandler from 'express-async-handler';
import Customer from '../models/Customer.js';
import Invoice from '../models/Invoice.js';
import { logActivity, diffFields } from '../utils/activity.js';
import { resolvePaging, runPaged } from '../utils/pagination.js';

export const listCustomers = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const filter = {};
  if (q) {
    filter.$or = [
      { name: new RegExp(q, 'i') },
      { company: new RegExp(q, 'i') },
      { phone: new RegExp(q, 'i') },
      { email: new RegExp(q, 'i') },
    ];
  }
  // This list was previously unbounded. The default stays unbounded so that every
  // existing caller — including the POS customer picker — is unaffected; callers
  // that want a window now have one, and everyone gets the true count.
  const paging = resolvePaging(req.query, 0);
  const items = await runPaged(res, Customer, filter, { sort: '-createdAt', paging });
  res.json(items);
});

export const getCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }
  res.json(customer);
});

// Profile fields only. `balance` is system-maintained — it moves exclusively through
// invoice creation, payments and returns (see invoice.controller.js) and must never be
// settable directly from either endpoint below, so it (and _id/timestamps) are left off
// this list rather than trusted from the request body.
const CUSTOMER_WRITABLE_FIELDS = ['name', 'company', 'phone', 'email', 'cnicNtn', 'address', 'creditLimit', 'notes', 'active'];

export function pickWritableCustomerFields(body) {
  const clean = {};
  for (const f of CUSTOMER_WRITABLE_FIELDS) {
    if (body[f] !== undefined) clean[f] = body[f];
  }
  return clean;
}

export const createCustomer = asyncHandler(async (req, res) => {
  // `active` is left out entirely when the caller doesn't supply it (rather than
  // defaulted here), so the schema's own default (`true`) still applies exactly as
  // before — this only filters what's on the request, it doesn't add anything new.
  const fields = pickWritableCustomerFields(req.body);
  const customer = await Customer.create(fields);
  await logActivity(req, 'customer_created', { entity: 'Customer', entityId: customer._id });
  res.status(201).json(customer);
});

// ALM-SEC-022: the significant fields worth a before/after diff on update.
const CUSTOMER_AUDIT_FIELDS = ['creditLimit', 'active'];

export const updateCustomer = asyncHandler(async (req, res) => {
  const updates = pickWritableCustomerFields(req.body);
  const before = await Customer.findById(req.params.id).select(CUSTOMER_AUDIT_FIELDS.join(' ')).lean();
  const customer = await Customer.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }
  const changes = before ? diffFields(before, customer, CUSTOMER_AUDIT_FIELDS) : {};
  await logActivity(req, 'customer_updated', {
    entity: 'Customer',
    entityId: customer._id,
    meta: Object.keys(changes).length ? { changes } : undefined,
  });
  res.json(customer);
});

export const customerLedger = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }
  const invoices = await Invoice.find({ customer: customer._id, status: { $nin: ['cancelled', 'draft'] } }).sort('issuedAt');
  const entries = [];
  for (const invoice of invoices) {
    entries.push({ date: invoice.issuedAt, type: 'invoice', reference: invoice.number, debit: invoice.total, credit: 0 });
    for (const payment of invoice.payments) {
      entries.push({ date: payment.date, type: 'payment', reference: payment.reference || invoice.number, debit: 0, credit: payment.amount });
      if (payment.reversed) entries.push({ date: payment.reversedAt || payment.date, type: 'payment_reversal', reference: invoice.number, debit: payment.amount, credit: 0 });
    }
    if (invoice.status === 'returned') entries.push({ date: invoice.updatedAt, type: 'return', reference: invoice.number, debit: 0, credit: invoice.total });
  }
  const openings = await OpeningBalance.find({ entityType: 'customer', entity: customer._id });
  for (const entry of openings) entries.push({ date: entry.asOf, type: 'opening_balance', reference: entry.reference, debit: Math.max(0, entry.amount), credit: Math.max(0, -entry.amount) });
  const corrections = await ReceivableAdjustment.find({ customer: customer._id });
  for (const entry of corrections) entries.push({ date: entry.createdAt, type: 'correction', debit: Math.max(0, entry.delta), credit: Math.max(0, -entry.delta) });
  const standalone = await partyEntryLedgerEvents('customer', customer._id, 'PKR', req.user?.role === 'admin');
  // Customer JSON ledger uses debit for amounts owed; PDF statements use credit.
  for (const entry of standalone) entries.push({ ...entry, debit: entry.credit, credit: entry.debit });
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  for (const entry of entries) { running = Math.round((running + entry.debit - entry.credit) * 100) / 100; entry.balance = running; }
  res.json({ customer, balance: customer.balance, closingBalance: running, reconciled: Math.abs(customer.balance - running) < 0.005, entries: entries.reverse() });
});
