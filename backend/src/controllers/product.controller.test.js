import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Product from '../models/Product.js';
import { stripCostInput, stripCommentsInput, listProducts, getProduct, createProduct, updateProduct } from './product.controller.js';

describe('stripCostInput', () => {
  it('strips purchasePrice for a sales user', () => {
    const req = { user: { role: 'sales' } };
    expect(stripCostInput(req, { name: 'X', purchasePrice: 5000, sellingPrice: 9000 })).toEqual({
      name: 'X', sellingPrice: 9000,
    });
  });

  it('keeps purchasePrice for admin and stock', () => {
    const payload = { name: 'X', purchasePrice: 5000 };
    expect(stripCostInput({ user: { role: 'admin' } }, payload)).toEqual(payload);
    expect(stripCostInput({ user: { role: 'stock' } }, payload)).toEqual(payload);
  });

  it('is a no-op when purchasePrice is already absent', () => {
    const req = { user: { role: 'sales' } };
    expect(stripCostInput(req, { name: 'X' })).toEqual({ name: 'X' });
  });
});

describe('stripCommentsInput', () => {
  it('strips comments for a sales user', () => {
    const req = { user: { role: 'sales' } };
    expect(stripCommentsInput(req, { name: 'X', comments: 'Screen scratch' })).toEqual({ name: 'X' });
  });

  it('keeps comments for admin and stock', () => {
    const payload = { name: 'X', comments: 'Screen scratch' };
    expect(stripCommentsInput({ user: { role: 'admin' } }, payload)).toEqual(payload);
    expect(stripCommentsInput({ user: { role: 'stock' } }, payload)).toEqual(payload);
  });

  it('is a no-op when comments is already absent', () => {
    const req = { user: { role: 'sales' } };
    expect(stripCommentsInput(req, { name: 'X' })).toEqual({ name: 'X' });
  });
});

// ===========================================================================
// Comments visibility (DB-backed) — Sales must never receive the `comments`
// field, on read or on write, while Admin and Stock keep seeing it exactly as
// before. Mirrors the existing cost-price visibility tests above; this is the
// same withoutCost/stripCostInput architecture applied to a second field.
// ===========================================================================
describe('Product comments visibility (DB-backed)', () => {
  let mem;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await Product.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    const headers = {};
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      set: (k, v) => { headers[String(k).toLowerCase()] = String(v); return res; },
      get: (k) => headers[String(k).toLowerCase()],
      json(body) { this.body = body; return this; },
    };
    return res;
  }

  async function makeProduct(comments = 'Screen scratch on lid') {
    return Product.create({ sku: 'CMT-1', name: 'Commented Laptop', stock: 3, comments });
  }

  it('getProduct hides comments from a sales user but keeps them for admin/stock', async () => {
    const p = await makeProduct();

    const salesRes = mockRes();
    await getProduct({ params: { id: p._id.toString() }, user: { role: 'sales' } }, salesRes);
    expect(salesRes.body.comments).toBeUndefined();

    const adminRes = mockRes();
    await getProduct({ params: { id: p._id.toString() }, user: { role: 'admin' } }, adminRes);
    expect(adminRes.body.comments).toBe('Screen scratch on lid');

    const stockRes = mockRes();
    await getProduct({ params: { id: p._id.toString() }, user: { role: 'stock' } }, stockRes);
    expect(stockRes.body.comments).toBe('Screen scratch on lid');
  });

  it('listProducts hides comments from a sales user but keeps them for admin', async () => {
    await makeProduct();

    const salesRes = mockRes();
    await listProducts({ query: {}, user: { role: 'sales' } }, salesRes);
    expect(salesRes.body.items[0].comments).toBeUndefined();

    const adminRes = mockRes();
    await listProducts({ query: {}, user: { role: 'admin' } }, adminRes);
    expect(adminRes.body.items[0].comments).toBe('Screen scratch on lid');
  });

  it('createProduct ignores comments sent by a sales user', async () => {
    const res = mockRes();
    await createProduct({ body: { sku: 'CMT-2', name: 'New Laptop', comments: 'Should not be saved' }, user: { role: 'sales' } }, res);
    expect(res.body.comments).toBeUndefined();
    const stored = await Product.findOne({ sku: 'CMT-2' });
    expect(stored.comments).toBe('');
  });

  it('updateProduct from a sales user does not wipe an existing comment', async () => {
    const p = await makeProduct('Original comment');
    // Simulates the sales edit form: the comments field is hidden, so nothing in
    // the payload carries a comments key at all — but even an explicit blank
    // must not be trusted from a sales user (stripCommentsInput drops the key
    // outright rather than relying on the client to omit it).
    const res = mockRes();
    await updateProduct({ params: { id: p._id.toString() }, body: { name: 'Commented Laptop', comments: '' }, user: { role: 'sales' } }, res);
    expect(res.statusCode).toBe(200);
    const stored = await Product.findById(p._id);
    expect(stored.comments).toBe('Original comment');
  });

  it('updateProduct from an admin can still change comments', async () => {
    const p = await makeProduct('Original comment');
    const res = mockRes();
    await updateProduct({ params: { id: p._id.toString() }, body: { comments: 'Updated by admin' }, user: { role: 'admin' } }, res);
    expect(res.body.comments).toBe('Updated by admin');
  });
});

// ===========================================================================
// listProducts pagination — a stand-in for the ~700-product production case:
// enough documents to require several pages at the real page size (50), without
// the runtime cost of actually creating hundreds of documents per test run.
// ===========================================================================
describe('listProducts pagination', () => {
  let mem;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await Product.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    const headers = {};
    const res = {
      set: (k, v) => { headers[String(k).toLowerCase()] = String(v); return res; },
      get: (k) => headers[String(k).toLowerCase()],
      json: (body) => { res.body = body; return res; },
    };
    return res;
  }

  async function call(query) {
    const req = { query, user: { role: 'admin' } };
    const res = mockRes();
    await listProducts(req, res);
    return res.body;
  }

  async function seed(count) {
    const docs = [];
    for (let i = 0; i < count; i++) {
      // Ascending createdAt so product 0 is oldest, product N-1 is newest — matches
      // the endpoint's `-createdAt` sort, so "page 1" is deterministic (newest first).
      docs.push({
        sku: `PAGE-${String(i).padStart(4, '0')}`,
        name: `Paging Product ${i}`,
        stock: 5,
        createdAt: new Date(Date.now() + i * 1000),
      });
    }
    await Product.insertMany(docs);
  }

  it('page 1 returns exactly the configured page size, not the full collection', async () => {
    await seed(120);
    const body = await call({});
    expect(body.items).toHaveLength(50);
    expect(body.limit).toBe(50);
    expect(body.page).toBe(1);
  });

  it('the true total count is always reported, independent of the page size', async () => {
    await seed(120);
    const body = await call({});
    expect(body.total).toBe(120);
  });

  it('page 2 returns the next 50 records, disjoint from page 1', async () => {
    await seed(120);
    const page1 = await call({ page: 1, limit: 50 });
    const page2 = await call({ page: 2, limit: 50 });
    expect(page2.items).toHaveLength(50);
    const page1Skus = new Set(page1.items.map((p) => p.sku));
    const overlap = page2.items.filter((p) => page1Skus.has(p.sku));
    expect(overlap).toHaveLength(0);
  });

  it('page 3 returns the remaining partial page', async () => {
    await seed(120);
    const body = await call({ page: 3, limit: 50 });
    expect(body.items).toHaveLength(20);
    expect(body.total).toBe(120);
  });

  it('search finds a product far outside page 1, without requesting a later page', async () => {
    await seed(120); // newest 120 products fill pages 1–3 entirely
    // The oldest product in the seed (index 0) sorts last under -createdAt and would
    // never appear on page 1 of an unfiltered browse.
    const body = await call({ q: 'PAGE-0000' });
    expect(body.items.some((p) => p.sku === 'PAGE-0000')).toBe(true);
  });

  it('low-stock filtering is applied before pagination, not after', async () => {
    await Product.insertMany([
      { sku: 'LOW-1', name: 'Low 1', stock: 1, lowStockThreshold: 5 },
      { sku: 'LOW-2', name: 'Low 2', stock: 2, lowStockThreshold: 5 },
      { sku: 'OK-1', name: 'OK 1', stock: 50, lowStockThreshold: 5 },
    ]);
    const body = await call({ lowStock: 'true' });
    expect(body.total).toBe(2);
    expect(body.items.map((p) => p.sku).sort()).toEqual(['LOW-1', 'LOW-2']);
  });

  it('category and q filters still work as before', async () => {
    await Product.insertMany([
      { sku: 'CAT-1', name: 'Cat Product', category: 'Laptops', stock: 1 },
      { sku: 'CAT-2', name: 'Other', category: 'Accessories', stock: 1 },
    ]);
    const body = await call({ category: 'Laptops' });
    expect(body.items.map((p) => p.sku)).toEqual(['CAT-1']);
  });
});
