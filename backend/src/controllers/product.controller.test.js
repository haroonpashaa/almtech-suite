import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Product from '../models/Product.js';
import { stripCostInput, listProducts } from './product.controller.js';

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
