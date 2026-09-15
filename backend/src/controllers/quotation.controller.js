import asyncHandler from 'express-async-handler';
import Quotation from '../models/Quotation.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import { nextNumber } from '../utils/numbering.js';
import { computeItemTotals, applyTax } from '../utils/totals.js';
import { logActivity } from '../utils/activity.js';
import { resolvePaging, runPaged } from '../utils/pagination.js';
import { runAtomically } from '../utils/ledger.js';
import { commitInvoiceEffects, resolveLinePricing } from './invoice.controller.js';

export const listQuotations = asyncHandler(async (req, res) => {
  const paging = resolvePaging(req.query, 500);
  const items = await runPaged(res, Quotation, {}, {
    sort: '-issuedAt',
    populate: [['customer', 'name company']],
    paging,
  });
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
    // ALM-SEC-008 fix — same rule as createInvoice's: admin's pricing is
    // trusted as submitted (unchanged); for any other role, unitPrice is the
    // product's own sellingPrice and discount is capped at the product's own
    // cost. A quotation converted to an invoice later carries these already-
    // resolved values through unchanged, so nothing further is needed at
    // conversion time.
    const { unitPrice, discount: lineDiscount } = resolveLinePricing({
      role: req.user.role,
      product,
      quantity: it.quantity,
      requestedUnitPrice: it.unitPrice,
      requestedDiscount: it.discount,
    });
    lines.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      quantity: it.quantity,
      unitPrice,
      discount: lineDiscount,
      lineTotal: Math.max(0, it.quantity * unitPrice - lineDiscount),
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

// ---------------------------------------------------------------------------
// ALM-SEC-015 fix (blast-radius expansion): this used to be a second, separate
// implementation of "commit an invoice's stock/balance effects" — the exact
// same read-modify-write-shaped bug already fixed in invoice.controller.js's
// createInvoice (product.stock -= quantity / product.save(),
// customer.balance += total / customer.save(), with no transaction), just
// reached via quotation conversion instead of direct invoice creation. Ten
// concurrent conversions against a stock of 20 used to leave stock at 13 and
// the customer's receivable at 450, not 500 — identical shape to the
// original evidence.
//
// Fixed by reusing commitInvoiceEffects() from invoice.controller.js — the
// same atomic-claim/compensating-rollback primitive createInvoice itself now
// uses — rather than maintaining a second copy that could drift out of sync
// again. The only conversion-specific addition is atomically claiming the
// quotation itself first (`status: { $ne: 'converted' }`), which closes a
// second race this same rewrite makes straightforward to also close: two
// concurrent conversion attempts of the SAME quotation could previously both
// pass the `quote.status === 'converted'` pre-check and both create an
// invoice from one quote.
// ---------------------------------------------------------------------------
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
  // Pre-flight only (fast, friendly error on the common non-concurrent case) —
  // the atomic claim inside commitInvoiceEffects() is the real enforcement
  // point, exactly as in createInvoice.
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
      serials: it.serials || [],
      lineTotal: it.lineTotal,
    });
  }
  const originalStatus = quote.status;

  const invoice = await runAtomically(async (session) => {
    const opts = session ? { session } : {};

    // Claimed first: only one concurrent conversion attempt of this
    // quotation can ever proceed past this point.
    const claimedQuote = await Quotation.findOneAndUpdate(
      { _id: quote._id, status: { $ne: 'converted' } },
      { $set: { status: 'converted' } },
      { ...opts, new: true }
    );
    if (!claimedQuote) {
      const err = new Error('Already converted');
      err.statusCode = 400;
      throw err;
    }

    let created;
    try {
      created = await commitInvoiceEffects({
        session,
        invoiceFields: {
          number: invNumber,
          customer: quote.customer,
          items: lines,
          subtotal: quote.subtotal,
          discount: quote.discount,
          taxRate: quote.taxRate,
          taxAmount: quote.taxAmount,
          total: quote.total,
          paid: 0,
          balance: quote.total,
          payments: [],
          status: 'open',
          createdBy: req.user._id,
        },
        customerId: quote.customer,
        balanceIncrease: quote.total,
        userId: req.user._id,
      });
    } catch (e) {
      if (!session) {
        // Give the quotation back so a failed attempt doesn't permanently
        // strand it as "converted" with no actual invoice behind it.
        await Quotation.updateOne({ _id: quote._id }, { $set: { status: originalStatus } });
      }
      throw e;
    }

    await Quotation.updateOne({ _id: quote._id }, { $set: { convertedInvoice: created._id } }, opts);
    return created;
  });

  await logActivity(req, 'quotation_converted', {
    entity: 'Quotation',
    entityId: quote._id,
    meta: { invoice: invoice.number },
  });
  res.json({ quotation: await Quotation.findById(quote._id), invoice });
});
