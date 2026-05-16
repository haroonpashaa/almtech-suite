import asyncHandler from 'express-async-handler';
import Invoice from '../models/Invoice.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Settings from '../models/Settings.js';
import StockMovement from '../models/StockMovement.js';
import { nextNumber } from '../utils/numbering.js';
import { computeItemTotals, applyTax } from '../utils/totals.js';
import { logActivity } from '../utils/activity.js';
import { streamInvoicePDF } from '../utils/pdf.js';

export const listInvoices = asyncHandler(async (req, res) => {
  const { customer, status, from, to, q } = req.query;
  const filter = {};
  if (customer) filter.customer = customer;
  if (status) filter.status = status;
  if (from || to) {
    filter.issuedAt = {};
    if (from) filter.issuedAt.$gte = new Date(from);
    if (to) filter.issuedAt.$lte = new Date(to);
  }
  if (q) filter.number = new RegExp(q, 'i');
  const items = await Invoice.find(filter).populate('customer', 'name company phone').sort('-issuedAt').limit(500);
  res.json(items);
});

export const getInvoice = asyncHandler(async (req, res) => {
  const inv = await Invoice.findById(req.params.id).populate('customer').populate('createdBy', 'name');
  if (!inv) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  res.json(inv);
});

async function buildLineFromProduct({ product, quantity, unitPrice, discount = 0, serials = [] }) {
  return {
    product: product._id,
    name: product.name,
    sku: product.sku,
    quantity,
    unitPrice,
    unitCost: product.purchasePrice,
    discount,
    serials,
    lineTotal: Math.max(0, quantity * unitPrice - discount),
  };
}

export const createInvoice = asyncHandler(async (req, res) => {
  const { customer: customerId, items, discount = 0, taxRate = 0, notes, initialPayment } = req.body;
  if (!items?.length) {
    res.status(400);
    throw new Error('At least one item is required');
  }
  const customer = await Customer.findById(customerId);
  if (!customer) {
    res.status(404);
    throw new Error('Customer not found');
  }

  const lines = [];
  for (const it of items) {
    const product = await Product.findById(it.product);
    if (!product) {
      res.status(400);
      throw new Error(`Product not found: ${it.product}`);
    }
    if (product.stock < it.quantity) {
      res.status(400);
      throw new Error(`Insufficient stock for ${product.name} (have ${product.stock}, need ${it.quantity})`);
    }
    lines.push(await buildLineFromProduct({ product, ...it }));
  }

  const { items: enriched, subtotal } = computeItemTotals(lines);
  const { taxAmount, total } = applyTax({ subtotal, discount, taxRate });

  if (customer.creditLimit > 0 && customer.balance + total - (initialPayment || 0) > customer.creditLimit) {
    res.status(400);
    throw new Error(`This sale would exceed the customer's credit limit of ${customer.creditLimit}`);
  }

  const number = await nextNumber('invoice');
  const payments = [];
  let paid = 0;
  if (initialPayment?.amount > 0) {
    payments.push({
      amount: initialPayment.amount,
      method: initialPayment.method || 'cash',
      reference: initialPayment.reference,
      recordedBy: req.user._id,
    });
    paid = initialPayment.amount;
  }
  const balance = Math.max(0, total - paid);
  const status = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'open';

  const invoice = await Invoice.create({
    number,
    customer: customer._id,
    items: enriched,
    subtotal,
    discount,
    taxRate,
    taxAmount,
    total,
    paid,
    balance,
    payments,
    status,
    notes,
    createdBy: req.user._id,
  });

  for (const it of enriched) {
    const product = await Product.findById(it.product);
    product.stock -= it.quantity;
    if (it.serials?.length && product.tracksSerials) {
      for (const s of it.serials) {
        const sn = product.serials.find((x) => x.serial === s);
        if (sn) {
          sn.status = 'sold';
          sn.soldInvoice = invoice._id;
        }
      }
    }
    await product.save();
    await StockMovement.create({
      product: product._id,
      type: 'sale',
      quantity: -it.quantity,
      balanceAfter: product.stock,
      refType: 'Invoice',
      refId: invoice._id,
      refNumber: invoice.number,
      createdBy: req.user._id,
    });
  }

  customer.balance += balance;
  await customer.save();

  await logActivity(req, 'invoice_created', {
    entity: 'Invoice',
    entityId: invoice._id,
    meta: { number, total, customer: customer.name },
  });
  res.status(201).json(invoice);
});

export const recordPayment = asyncHandler(async (req, res) => {
  const { amount, method = 'cash', reference } = req.body;
  if (!(amount > 0)) {
    res.status(400);
    throw new Error('Amount must be > 0');
  }
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  const cappedAmount = Math.min(amount, invoice.balance);
  invoice.payments.push({ amount: cappedAmount, method, reference, recordedBy: req.user._id });
  invoice.paid += cappedAmount;
  invoice.balance = Math.max(0, invoice.total - invoice.paid);
  invoice.status = invoice.balance === 0 ? 'paid' : 'partial';
  await invoice.save();

  const customer = await Customer.findById(invoice.customer);
  if (customer) {
    customer.balance = Math.max(0, customer.balance - cappedAmount);
    await customer.save();
  }

  await logActivity(req, 'payment_recorded', {
    entity: 'Invoice',
    entityId: invoice._id,
    meta: { amount: cappedAmount, method },
  });
  res.json(invoice);
});

export const returnInvoice = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  if (invoice.status === 'returned' || invoice.status === 'cancelled') {
    res.status(400);
    throw new Error(`Invoice already ${invoice.status}`);
  }
  for (const it of invoice.items) {
    const product = await Product.findById(it.product);
    if (!product) continue;
    product.stock += it.quantity;
    if (it.serials?.length && product.tracksSerials) {
      for (const s of it.serials) {
        const sn = product.serials.find((x) => x.serial === s);
        if (sn) {
          sn.status = 'returned';
          sn.soldInvoice = undefined;
        }
      }
    }
    await product.save();
    await StockMovement.create({
      product: product._id,
      type: 'return',
      quantity: it.quantity,
      balanceAfter: product.stock,
      refType: 'Invoice',
      refId: invoice._id,
      refNumber: invoice.number,
      createdBy: req.user._id,
    });
  }
  invoice.status = 'returned';
  await invoice.save();

  const customer = await Customer.findById(invoice.customer);
  if (customer) {
    customer.balance = Math.max(0, customer.balance - invoice.balance);
    await customer.save();
  }

  await logActivity(req, 'invoice_returned', { entity: 'Invoice', entityId: invoice._id });
  res.json(invoice);
});

export const invoicePDF = asyncHandler(async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate('customer');
  if (!invoice) {
    res.status(404);
    throw new Error('Invoice not found');
  }
  const settings = await Settings.getSingleton();
  streamInvoicePDF(res, { invoice: invoice.toObject(), customer: invoice.customer, settings });
});
