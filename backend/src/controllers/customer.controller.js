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

export const createCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.create(req.body);
  await logActivity(req, 'customer_created', { entity: 'Customer', entityId: customer._id });
  res.status(201).json(customer);
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
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
