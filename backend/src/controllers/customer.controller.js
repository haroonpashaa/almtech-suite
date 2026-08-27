import asyncHandler from 'express-async-handler';
import Customer from '../models/Customer.js';
import Invoice from '../models/Invoice.js';
import { logActivity } from '../utils/activity.js';
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

export const updateCustomer = asyncHandler(async (req, res) => {
  const updates = pickWritableCustomerFields(req.body);
  const customer = await Customer.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }
  await logActivity(req, 'customer_updated', { entity: 'Customer', entityId: customer._id });
  res.json(customer);
});

export const customerLedger = asyncHandler(async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }
  const invoices = await Invoice.find({ customer: customer._id }).sort('-issuedAt');
  const entries = [];
  let running = 0;
  for (const inv of invoices.slice().reverse()) {
    running += inv.total;
    entries.push({
      date: inv.issuedAt,
      type: 'invoice',
      reference: inv.number,
      debit: inv.total,
      credit: 0,
      balance: running,
    });
    for (const p of inv.payments) {
      running -= p.amount;
      entries.push({
        date: p.date,
        type: 'payment',
        reference: `${inv.number} (${p.method})`,
        debit: 0,
        credit: p.amount,
        balance: running,
      });
    }
  }
  entries.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json({ customer, balance: customer.balance, entries });
});
