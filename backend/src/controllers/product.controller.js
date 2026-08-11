import asyncHandler from 'express-async-handler';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { logActivity } from '../utils/activity.js';

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

export const listProducts = asyncHandler(async (req, res) => {
  const { q, category, lowStock, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (category) filter.category = category;
  if (q) {
    filter.$or = [
      { name: new RegExp(q, 'i') },
      { sku: new RegExp(q, 'i') },
      { brand: new RegExp(q, 'i') },
      { model: new RegExp(q, 'i') },
    ];
  }
  let query = Product.find(filter).sort('-createdAt');
  const total = await Product.countDocuments(filter);
  query = query.skip((page - 1) * limit).limit(Number(limit));
  let items = await query;
  if (lowStock === 'true') items = items.filter((p) => p.stock <= p.lowStockThreshold);
  res.json({ items, total, page: Number(page), limit: Number(limit) });
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  res.json(product);
});

export const createProduct = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
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
  res.status(201).json(product);
});

export const updateProduct = asyncHandler(async (req, res) => {
  const { barcode: rawBarcode, ...rest } = req.body;
  const update = { $set: rest };
  let barcode = '';

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
  await logActivity(req, 'product_updated', { entity: 'Product', entityId: product._id });
  res.json(product);
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
  res.json(product);
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
  product.stock = Math.max(0, product.stock + Number(quantity));
  await product.save();
  await StockMovement.create({
    product: product._id,
    type: 'adjustment',
    quantity: Number(quantity),
    balanceAfter: product.stock,
    refType: 'Adjustment',
    note,
    createdBy: req.user._id,
  });
  await logActivity(req, 'stock_adjusted', { entity: 'Product', entityId: product._id, meta: { quantity, note } });
  res.json(product);
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
      const existing = await Product.findOne({ sku: row.sku?.toUpperCase() });
      if (existing) {
        Object.assign(existing, row);
        await existing.save();
        results.updated++;
      } else {
        await Product.create(row);
        results.created++;
      }
    } catch (e) {
      results.errors.push({ sku: row.sku, error: e.message });
    }
  }
  await logActivity(req, 'products_imported', { meta: results });
  res.json(results);
});
