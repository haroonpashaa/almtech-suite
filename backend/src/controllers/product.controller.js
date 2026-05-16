import asyncHandler from 'express-async-handler';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import { logActivity } from '../utils/activity.js';

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
  const product = await Product.create(req.body);
  await logActivity(req, 'product_created', { entity: 'Product', entityId: product._id, meta: { sku: product.sku } });
  res.status(201).json(product);
});

export const updateProduct = asyncHandler(async (req, res) => {
  const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!product) {
    res.status(404);
    throw new Error('Product not found');
  }
  await logActivity(req, 'product_updated', { entity: 'Product', entityId: product._id });
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
