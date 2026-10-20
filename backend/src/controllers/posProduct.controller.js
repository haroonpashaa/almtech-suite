import asyncHandler from 'express-async-handler';
import Product from '../models/Product.js';
import { resolvePaging, runPaged } from '../utils/pagination.js';

const MAX_MODELS = 100;
const FILTER_FIELDS = ['brand', 'ram', 'processor', 'storage'];

function literalRegex(value) {
  return new RegExp(String(value).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function parseModels(value, res) {
  if (value === undefined || value === '') return [];
  let models;
  try {
    models = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    res.status(400);
    throw new Error('Model filter must be a list of model names');
  }
  if (!Array.isArray(models) || models.length > MAX_MODELS || models.some((model) => typeof model !== 'string')) {
    res.status(400);
    throw new Error(`Model filter must contain up to ${MAX_MODELS} model names`);
  }
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}

function addLiteralFilter(filter, field, value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text) filter[field] = literalRegex(text);
}

export const listPosProducts = asyncHandler(async (req, res) => {
  const filter = {};
  const selectedModels = parseModels(req.query.models, res);
  if (selectedModels.length) filter.model = { $in: selectedModels };
  for (const field of FILTER_FIELDS) addLiteralFilter(filter, field, req.query[field]);

  const serial = typeof req.query.serial === 'string' ? req.query.serial.trim() : '';
  if (serial) filter.serials = { $elemMatch: { serial: literalRegex(serial), status: 'in_stock' } };

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query) {
    const search = literalRegex(query);
    filter.$or = [
      { name: search }, { sku: search }, { brand: search }, { model: search },
      { ram: search }, { processor: search }, { storage: search },
      { serials: { $elemMatch: { serial: search, status: 'in_stock' } } },
    ];
  }

  const paging = resolvePaging(req.query, 30);
  const projection = '_id name sku brand model ram processor storage condition comments stock sellingPrice tracksSerials serials active';
  const items = await runPaged(res, Product, filter, {
    sort: '-createdAt _id',
    select: projection,
    paging,
  });

  // POS needs serials to distinguish sellable units, but only in-stock serials are
  // useful there. Keep purchase cost outside this endpoint's response entirely.
  const canSeeComments = req.user?.role !== 'sales';
  res.json({
    items: items.map((product) => {
      const item = product.toObject();
      item.serials = (item.serials || []).filter((unit) => unit.status === 'in_stock').map(({ serial }) => ({ serial, status: 'in_stock' }));
      if (!canSeeComments) delete item.comments;
      return item;
    }),
    total: Number(res.get('X-Total-Count')),
    page: paging.page,
    limit: paging.limit,
  });
});

export const listPosModels = asyncHandler(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const filter = { model: { $type: 'string', $ne: '' } };
  if (q) filter.model = { $type: 'string', $regex: literalRegex(q), $ne: '' };
  const models = await Product.distinct('model', filter);
  res.json([...new Set(models.map((model) => model.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)));
});
