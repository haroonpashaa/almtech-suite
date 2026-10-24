import mongoose from 'mongoose';
import { inventoryOperation, operationError } from '../utils/inventoryOperation.js';
import asyncHandler from 'express-async-handler';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { logActivity, diffFields } from '../utils/activity.js';
import { requireNonZeroWholeQuantity } from '../utils/quantity.js';
import { resolvePaging, runPaged } from '../utils/pagination.js';
import { safeFilterValue } from '../utils/safeFilterValue.js';
import Invoice from '../models/Invoice.js';

// Barcodes are optional. Treat blank/whitespace-only input as "no barcode" so the
// partial unique index never sees an empty string, and so clearing the field in the
// admin form actually removes it rather than storing ''.
const cleanBarcode = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

async function assertBarcodeFree(res, barcode, excludeId) {
  const filter = { barcode };
  if (excludeId) filter._id = { $ne: excludeId };
  const owner = await Product.findOne(filter).select('name sku');
  if (owner) {
    res.status(409);
    throw new Error(`Barcode "${barcode}" is already assigned to ${owner.name} (SKU ${owner.sku})`);
  }
}

// The pre-check above closes the common case with a helpful message; this catches the
// race where two requests pass the check concurrently and the unique index rejects one.
function rethrowDuplicateBarcode(err, res, barcode) {
  if (err?.code === 11000 && err?.keyPattern?.barcode) {
    res.status(409);
    throw new Error(`Barcode "${barcode}" is already assigned to another product`);
  }
  throw err;
}

// ---------------------------------------------------------------------------
// Cost price is administrator information: it is what the business pays, and from it
// anyone can derive the margin on every sale. Sales maintains the catalogue but must
// not see or set it, so it is stripped on the way out and ignored on the way in.
// Stripping happens here rather than in the interface, so hiding a column cannot be
// undone by calling the API directly.
const COST_FIELDS = ['purchasePrice'];
const seesCost = (req) => req.user?.role === 'admin' || req.user?.role === 'stock';

function withoutCost(req, doc) {
  if (!doc || seesCost(req)) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  for (const f of COST_FIELDS) delete plain[f];
  return plain;
}

/** Drop any cost field a caller is not allowed to set, so an omitted field keeps its
 *  stored value rather than being zeroed by someone who cannot see it. */
export function stripCostInput(req, payload) {
  if (seesCost(req)) return payload;
  const clean = { ...payload };
  for (const f of COST_FIELDS) delete clean[f];
  return clean;
}

// Comments are free-text condition notes about a specific unit (screen scratch,
// missing charger, etc.) that Sales must not see in the product catalogue. Unlike
// cost, this is one-directional and sales-specific only — admin and stock keep
// seeing it exactly as before. Stripped here (not just hidden in the interface) so
// calling the API directly cannot recover it, same reasoning as withoutCost.
const COMMENT_FIELDS = ['comments'];
const seesComments = (req) => req.user?.role !== 'sales';

function withoutComments(req, doc) {
  if (!doc || seesComments(req)) return doc;
  const plain = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  for (const f of COMMENT_FIELDS) delete plain[f];
  return plain;
}

/** Drop comments from a sales user's input, so an edit that can't see the field
 *  can't blank it out either. */
export function stripCommentsInput(req, payload) {
  if (seesComments(req)) return payload;
  const clean = { ...payload };
  for (const f of COMMENT_FIELDS) delete clean[f];
  return clean;
}

function sanitizeProduct(req, doc) {
  return withoutComments(req, withoutCost(req, doc));
}

// ALM-SEC-007: every legitimate business field the product create form and
// import path actually set, and nothing else — in particular never `_id`,
// `createdAt`, `updatedAt`, `__v`, or `serials` (which has its own
// dedicated sell/return flow via invoices, not a generic create payload).
// Mirrors the allowlist pattern `pickWritableCustomerFields` already uses
// for customers, replacing the `{ ...req.body }` spread that previously let
// a caller set server-owned metadata directly on `.create()`.
const PRODUCT_WRITABLE_FIELDS = [
  'name', 'sku', 'brand', 'model', 'category', 'description',
  'processor', 'ram', 'storage', 'graphics', 'screen', 'condition', 'warranty', 'comments',
  'image', 'purchasePrice', 'sellingPrice', 'stock', 'lowStockThreshold',
  'tracksSerials', 'barcode', 'active',
];

function pickWritableProductFields(body) {
  const clean = {};
  for (const f of PRODUCT_WRITABLE_FIELDS) {
    if (body[f] !== undefined) clean[f] = body[f];
  }
  return clean;
}

export const listProducts = asyncHandler(async (req, res) => {
  const { q, category, lowStock } = req.query;
  const filter = {};
  if (category) filter.category = safeFilterValue(category);
  if (req.query.models !== undefined && req.query.models !== '') {
    let models;
    try {
      models = typeof req.query.models === 'string' ? JSON.parse(req.query.models) : req.query.models;
    } catch {
      res.status(400);
      throw new Error('Model filter must be a list of model names');
    }
    if (!Array.isArray(models) || models.length > 100 || models.some((model) => typeof model !== 'string')) {
      res.status(400);
      throw new Error('Model filter must contain up to 100 model names');
    }
    const selectedModels = [...new Set(models.map((model) => model.trim()).filter(Boolean))];
    if (selectedModels.length) filter.model = { $in: selectedModels };
  }
  if (q) {
    const search = String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Specifications are part of the search because "16GB" or "i7" is how staff
    // actually look for a machine at the counter.
    filter.$or = [
      { name: new RegExp(search, 'i') },
      { sku: new RegExp(search, 'i') },
      { brand: new RegExp(search, 'i') },
      { model: new RegExp(search, 'i') },
      { processor: new RegExp(search, 'i') },
      { ram: new RegExp(search, 'i') },
      { storage: new RegExp(search, 'i') },
      { 'serials.serial': new RegExp(search, 'i') },
    ];
  }
  // Expressed as a query condition (not a post-fetch filter) so it composes correctly
  // with pagination — a post-fetch filter on just the current page would silently
  // under-count and mis-paginate the low-stock view once the list is paged rather
  // than fully loaded.
  if (lowStock === 'true') filter.$expr = { $lte: ['$stock', '$lowStockThreshold'] };

  // Same pagination utility as Invoices/Customers/Suppliers (resolvePaging/runPaged) —
  // the response body keeps its existing {items, total, page, limit} shape, since POS,
  // QuotationForm and PurchaseOrderForm all read `data.items` from this same endpoint.
  const paging = resolvePaging(req.query, 50);
  // Stable secondary ordering keeps offset-based pages disjoint when products
  // share a creation timestamp (including while a large PO catalogue is loaded).
  const items = await runPaged(res, Product, filter, { sort: { createdAt: -1, _id: 1 }, paging });
  const total = Number(res.get('X-Total-Count'));
  res.json({ items: items.map((p) => sanitizeProduct(req, p)), total, page: paging.page, limit: paging.limit });
});

// Inventory's model picker uses distinct values from the existing catalogue;
// this endpoint does not create or persist a second copy of product data.
export const listProductModels = asyncHandler(async (_req, res) => {
  const values = await Product.distinct('model', { model: { $type: 'string', $ne: '' } });
  const models = [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  res.json(models);
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  res.json(sanitizeProduct(req, product));
});

// Read-only summary composed from the catalogue, stock ledger and invoice snapshots.
// Historical line snapshots keep this useful even after a product is deactivated.
export const productSummary = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) { res.status(404); throw new Error('Product not found'); }
  const [sales, movements] = await Promise.all([
    Invoice.aggregate([
      { $match: { status: { $nin: ['cancelled', 'returned', 'draft'] }, 'items.product': product._id } },
      { $unwind: '$items' },
      { $match: { 'items.product': product._id } },
      { $group: { _id: null, quantitySold: { $sum: '$items.quantity' }, revenue: { $sum: '$items.lineTotal' }, invoiceCount: { $sum: 1 }, lastSold: { $max: '$issuedAt' } } },
    ]),
    StockMovement.find({ product: product._id }).sort({ createdAt: -1, _id: -1 }).limit(20).populate('createdBy', 'name'),
  ]);
  res.json({ product: sanitizeProduct(req, product), sales: sales[0] || { quantitySold: 0, revenue: 0, invoiceCount: 0, lastSold: null }, movements });
});

export const createProduct = asyncHandler(async (req, res) => {
  const payload = stripCommentsInput(req, stripCostInput(req, pickWritableProductFields(req.body)));
  const barcode = cleanBarcode(payload.barcode);
  if (barcode) {
    await assertBarcodeFree(res, barcode);
    payload.barcode = barcode;
  } else {
    delete payload.barcode;
  }

  let product;
  try {
    product = await Product.create(payload);
  } catch (e) {
    rethrowDuplicateBarcode(e, res, barcode);
  }
  await logActivity(req, 'product_created', { entity: 'Product', entityId: product._id, meta: { sku: product.sku } });
  res.status(201).json(sanitizeProduct(req, product));
});

// ALM-SEC-022: the financially/operationally significant fields worth a
// before/after diff on update — mirrors the level of detail
// `stock_adjusted`/`payment_reversed` already record. `purchasePrice` is
// safe to include here even though sales can't see it elsewhere: the
// activity log itself is admin-only (`activity.routes.js`).
const PRODUCT_AUDIT_FIELDS = ['sellingPrice', 'purchasePrice', 'active'];

// Existing inventory is changed by receiving, sales/returns and stock adjustments,
// never by saving a catalogue form (which may contain an old inventory snapshot).
const PRODUCT_EDIT_FIELDS = [
  'name', 'sku', 'brand', 'model', 'category', 'description',
  'processor', 'ram', 'storage', 'graphics', 'screen', 'condition', 'warranty', 'comments',
  'image', 'purchasePrice', 'sellingPrice', 'lowStockThreshold', 'barcode', 'active',
];

export const updateProduct = asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400);
    throw new Error('Product edits must contain an object of editable fields');
  }
  const rejected = Object.keys(body).filter((field) => !PRODUCT_EDIT_FIELDS.includes(field));
  if (rejected.length) {
    res.status(400);
    throw new Error(`Fields cannot be changed through product edits: ${rejected.join(', ')}. Use stock adjustments or purchase receiving for inventory changes.`);
  }
  const editable = {};
  for (const field of PRODUCT_EDIT_FIELDS) {
    if (Object.hasOwn(body, field)) editable[field] = body[field];
  }
  const { barcode: rawBarcode, ...rest } = editable;
  const update = { $set: stripCommentsInput(req, stripCostInput(req, rest)) };
  let barcode = '';
  const before = await Product.findById(req.params.id).select(PRODUCT_AUDIT_FIELDS.join(' ')).lean();

  // Only touch the barcode when the client actually sent the key, so partial updates
  // that omit it leave any existing barcode alone.
  if ('barcode' in req.body) {
    barcode = cleanBarcode(rawBarcode);
    if (barcode) {
      await assertBarcodeFree(res, barcode, req.params.id);
      update.$set.barcode = barcode;
    } else {
      update.$unset = { barcode: '' };
    }
  }

  let product;
  try {
    product = await Product.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  } catch (e) {
    rethrowDuplicateBarcode(e, res, barcode);
  }
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  const changes = before ? diffFields(before, product, PRODUCT_AUDIT_FIELDS) : {};
  await logActivity(req, 'product_updated', {
    entity: 'Product',
    entityId: product._id,
    meta: Object.keys(changes).length ? { changes } : undefined,
  });
  res.json(sanitizeProduct(req, product));
});

// POS barcode lookup. Read-only: this never touches stock — inventory continues to
// move solely through the existing invoice/checkout and stock-adjustment paths.
export const lookupByBarcode = asyncHandler(async (req, res) => {
  const code = cleanBarcode(req.query.code);
  if (!code) {
    res.status(400);
    throw new Error('Barcode is required');
  }
  const product = await Product.findOne({ barcode: code });
  if (!product) {
    res.status(404);
    throw new Error(`Product not found for barcode: ${code}`);
  }
  res.json(sanitizeProduct(req, product));
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  await logActivity(req, 'product_deactivated', { entity: 'Product', entityId: product._id });
  res.json({ ok: true });
});

export const adjustStock = asyncHandler(async (req, res) => {
  const { quantity, note } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  const delta = requireNonZeroWholeQuantity(quantity, product.name);

  // ALM-SEC-016 fix: a single atomic pipeline update, not a JavaScript
  // read-modify-write. `$max: [0, $add: ['$stock', delta]]` is computed by
  // MongoDB from its own current value at write time, in the same operation
  // that writes it back — so two concurrent adjustments can never clobber each
  // other's change the way "product.stock = Math.max(0, product.stock + delta);
  // await product.save();" did (ten concurrent +1 adjustments on stock=0 used
  // to land on 4, not 10). Same idiom `applyInvoicePayment` already uses
  // elsewhere in this codebase for the identical "clamp atomically" need on
  // Customer.balance.
  const updated = await Product.findOneAndUpdate(
    { _id: product._id },
    [{ $set: { stock: { $max: [0, { $add: ['$stock', delta] }] } } }],
    { new: true }
  );

  // ALM-SEC-010 fix: record what actually happened to stock, not the raw
  // requested delta. When the zero floor clamps the change (e.g. -9999
  // against a stock of 4), the movement previously still claimed quantity:
  // -9999 even though the real change was only -4 — internally
  // inconsistent with its own balanceAfter and unreconcilable in any
  // forensic review. `product.stock` here is this request's own pre-update
  // read, so the applied delta is exactly what this specific adjustment
  // contributed.
  const appliedDelta = updated.stock - product.stock;
  await StockMovement.create({
    product: updated._id,
    type: 'adjustment',
    quantity: appliedDelta,
    balanceAfter: updated.stock,
    refType: 'Adjustment',
    note,
    createdBy: req.user._id,
  });
  await logActivity(req, 'stock_adjusted', { entity: 'Product', entityId: updated._id, meta: { quantity, note } });
  res.json(sanitizeProduct(req, updated));
});

// Removing physical stock is separate from deleting/deactivating a product.
async function removeStockLine(req, res, session) {
  const { quantity, reason, serials = [] } = req.body;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    res.status(400); throw new Error('Removal quantity must be a positive whole number');
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    res.status(400); throw new Error('A removal reason is required');
  }
  if (!Array.isArray(serials) || serials.some(s => typeof s !== 'string') || new Set(serials).size !== serials.length) {
    res.status(400); throw new Error('Serial selections must be unique serial numbers');
  }
  const product = await Product.findById(req.params.id).session(session);
  if (!product) { res.status(404); throw new Error('Product not found'); }
  if (product.tracksSerials) {
    if (serials.length !== quantity || serials.some(sn => !product.serials.some(s => s.serial === sn && s.status === 'in_stock' && !s.soldInvoice))) {
      res.status(400); throw new Error('Select exactly one available in-stock serial per unit to remove');
    }
  } else if (serials.length) {
    res.status(400); throw new Error('This product does not track serial numbers');
  }
  const mutation = { $inc: { stock: -quantity } };
  if (product.tracksSerials) mutation.$pull = { serials: { serial: { $in: serials }, status: 'in_stock', soldInvoice: null } };
  const changed = await Product.findOneAndUpdate(
    { _id: product._id, stock: { $gte: quantity } }, mutation, { new: true, session }
  );
  if (!changed) { res.status(409); throw new Error('Insufficient available stock; refresh inventory before retrying'); }
  await StockMovement.create([{
    product: changed._id, type: 'adjustment', quantity: -quantity,
    balanceAfter: changed.stock, refType: 'Adjustment', createdBy: req.user._id,
    note: `Delete Stock: ${reason.trim()}${serials.length ? ` | Serials: ${JSON.stringify(serials)}` : ''}`,
  }], { session });
  return changed;
}

export const removeStock = asyncHandler(async (req, res) => {
  const result = await inventoryOperation({ owner: req.user._id, kind: 'stock-removal', key: req.body.idempotencyKey, input: { product: req.params.id, quantity: req.body.quantity, reason: req.body.reason, serials: req.body.serials || [] } }, async session => {
    const product = await removeStockLine(req, res, session);
    return { productId: String(product._id) };
  });
  const updated = await Product.findById(result.productId);
  await logActivity(req, 'stock_adjusted', { entity: 'Product', entityId: updated._id, meta: { quantity: -req.body.quantity, reason: req.body.reason, serials: req.body.serials || [] } });
  res.json(sanitizeProduct(req, updated));
});

export const removeStockBulk = asyncHandler(async (req, res) => {
  const { items, reason, idempotencyKey } = req.body;
  if (!Array.isArray(items) || !items.length || items.length > 1000 || items.some(item => !item || !mongoose.isValidObjectId(item.product))) throw operationError('Select between 1 and 1000 valid products', 400);
  if (new Set(items.map(item => String(item.product).toLowerCase())).size !== items.length) throw operationError('Each product may only appear once', 400);
  const result = await inventoryOperation({ owner: req.user._id, kind: 'stock-removal', key: idempotencyKey, input: { items, reason } }, async session => {
    const removed = [];
    for (const item of items) {
      const product = await removeStockLine({ ...req, params: { id: item.product }, body: { quantity: item.quantity, serials: item.serials || [], reason } }, res, session);
      removed.push({ product: String(product._id), quantity: item.quantity, balanceAfter: product.stock });
    }
    return { removed };
  });
  res.json(result);
});

export const stockLedger = asyncHandler(async (req, res) => {
  const movements = await StockMovement.find({ product: req.params.id }).sort('-createdAt').limit(500);
  res.json(movements);
});

export const importProducts = asyncHandler(async (req, res) => {
  const { rows } = req.body;
  if (!Array.isArray(rows)) {
    res.status(400);
    throw new Error('rows must be an array');
  }
  const results = { created: 0, updated: 0, errors: [] };
  for (const row of rows) {
    try {
      // createProduct/updateProduct both strip cost from a sales user's input; this
      // route bypassed that and let a sales user set purchasePrice directly.
      const cleanRow = stripCostInput(req, row);
      const existing = await Product.findOne({ sku: cleanRow.sku?.toUpperCase() });
      if (existing) {
        Object.assign(existing, cleanRow);
        await existing.save();
        results.updated++;
      } else {
        await Product.create(cleanRow);
        results.created++;
      }
    } catch (e) {
      results.errors.push({ sku: row.sku, error: e.message });
    }
  }
  await logActivity(req, 'products_imported', { meta: results });
  res.json(results);
});
