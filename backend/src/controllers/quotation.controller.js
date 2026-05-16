import asyncHandler from 'express-async-handler';
import Quotation from '../models/Quotation.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Invoice from '../models/Invoice.js';
import StockMovement from '../models/StockMovement.js';
import { nextNumber } from '../utils/numbering.js';
import { computeItemTotals, applyTax } from '../utils/totals.js';
import { logActivity } from '../utils/activity.js';

export const listQuotations = asyncHandler(async (req, res) => {
  const items = await Quotation.find().populate('customer', 'name company').sort('-issuedAt').limit(500);
  res.json(items);
});

export const getQuotation = asyncHandler(async (req, res) => {
  const q = await Quotation.findById(req.params.id).populate('customer');
  if (!q) {
    res.status(404);
    throw new Error('Quotation not found');
  }
  res.json(q);
});

export const createQuotation = asyncHandler(async (req, res) => {
  const { customer: customerId, items, discount = 0, taxRate = 0, validUntil, notes } = req.body;
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
    lines.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      discount: it.discount || 0,
      lineTotal: Math.max(0, it.quantity * it.unitPrice - (it.discount || 0)),
    });
  }
  const { items: enriched, subtotal } = computeItemTotals(lines);
  const { taxAmount, total } = applyTax({ subtotal, discount, taxRate });
  const number = await nextNumber('quotation');
  const quote = await Quotation.create({
    number,
    customer: customer._id,
    items: enriched,
    subtotal,
    discount,
    taxRate,
    taxAmount,
    total,
    validUntil,
    notes,
    createdBy: req.user._id,
  });
  await logActivity(req, 'quotation_created', { entity: 'Quotation', entityId: quote._id, meta: { number, total } });
  res.status(201).json(quote);
});

export const convertToInvoice = asyncHandler(async (req, res) => {
  const quote = await Quotation.findById(req.params.id);
  if (!quote) {
    res.status(404);
    throw new Error('Quotation not found');
  }
  if (quote.status === 'converted') {
    res.status(400);
    throw new Error('Already converted');
  }
  for (const it of quote.items) {
    const product = await Product.findById(it.product);
    if (!product || product.stock < it.quantity) {
      res.status(400);
      throw new Error(`Insufficient stock for ${it.name}`);
    }
  }
  const invNumber = await nextNumber('invoice');
  const lines = [];
  for (const it of quote.items) {
    const product = await Product.findById(it.product);
    lines.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      unitCost: product.purchasePrice,
      discount: it.discount,
      lineTotal: it.lineTotal,
    });
  }
  const invoice = await Invoice.create({
    number: invNumber,
    customer: quote.customer,
    items: lines,
    subtotal: quote.subtotal,
    discount: quote.discount,
    taxRate: quote.taxRate,
    taxAmount: quote.taxAmount,
    total: quote.total,
    balance: quote.total,
    status: 'open',
    createdBy: req.user._id,
  });
  for (const it of lines) {
    const product = await Product.findById(it.product);
    product.stock -= it.quantity;
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
  const customer = await Customer.findById(quote.customer);
  if (customer) {
    customer.balance += quote.total;
    await customer.save();
  }
  quote.status = 'converted';
  quote.convertedInvoice = invoice._id;
  await quote.save();
  await logActivity(req, 'quotation_converted', {
    entity: 'Quotation',
    entityId: quote._id,
    meta: { invoice: invoice.number },
  });
  res.json({ quotation: quote, invoice });
});
