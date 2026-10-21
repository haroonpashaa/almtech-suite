import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Product from '../models/Product.js';
import { listPosModels, listPosProducts } from './posProduct.controller.js';

describe('POS product selection API', () => {
  let memory;

  beforeAll(async () => {
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
  });
  afterEach(async () => { await Product.deleteMany({}); });
  afterAll(async () => {
    await mongoose.disconnect();
    await memory.stop();
  });

  function response() {
    const headers = {};
    return {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      set(key, value) { headers[String(key).toLowerCase()] = String(value); return this; },
      get(key) { return headers[String(key).toLowerCase()]; },
      json(body) { this.body = body; return this; },
    };
  }

  async function list(query = {}, role = 'sales') {
    const res = response();
    await listPosProducts({ query, user: { role } }, res);
    return res;
  }

  it('combines exact model and attribute filters and searches available serials', async () => {
    await Product.create([
      {
        name: 'ThinkPad X1', sku: 'POS-X1', brand: 'Lenovo', model: 'ThinkPad X1', ram: '16GB', processor: 'i7-1355U', storage: '512GB SSD', stock: 2,
        tracksSerials: true, serials: [{ serial: 'SN-X1-100', status: 'in_stock' }, { serial: 'SN-X1-SOLD', status: 'sold' }],
      },
      { name: 'ThinkPad X1 Carbon', sku: 'POS-X1C', brand: 'Lenovo', model: 'ThinkPad X1 Carbon', ram: '32GB', processor: 'i7-1365U', storage: '1TB SSD', stock: 1, tracksSerials: true, serials: [{ serial: 'SN-X1C-200', status: 'in_stock' }] },
      { name: 'EliteBook', sku: 'POS-ELITE', brand: 'HP', model: 'EliteBook 840', ram: '16GB', processor: 'i5', storage: '512GB SSD', stock: 1 },
    ]);

    const filtered = await list({
      models: JSON.stringify(['ThinkPad X1']),
      brand: 'leno',
      ram: '16',
      processor: 'i7',
      storage: '512',
      serial: '100',
    });
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items.map((product) => product.sku)).toEqual(['POS-X1']);
    expect(filtered.body.items[0]).toMatchObject({
      processor: 'i7-1355U',
      storage: '512GB SSD',
      serials: [{ serial: 'SN-X1-100', status: 'in_stock' }],
    });

    const similarName = await list({ models: JSON.stringify(['ThinkPad X1 Carbon']) });
    expect(similarName.body.items.map((product) => product.sku)).toEqual(['POS-X1C']);

    const soldSerial = await list({ serial: 'SN-X1-SOLD' });
    expect(soldSerial.body.total).toBe(0);
  });

  it('returns searchable model options and applies pagination with a matching total', async () => {
    await Product.create([
      { name: 'One', sku: 'POS-M1', model: 'ThinkPad X1' },
      { name: 'Two', sku: 'POS-M1-2', model: 'ThinkPad X1' },
      { name: 'Three', sku: 'POS-M2', model: 'ThinkPad X1 Carbon' },
    ]);
    const modelRes = response();
    await listPosModels({ query: { q: 'carbon' } }, modelRes);
    expect(modelRes.body).toEqual(['ThinkPad X1 Carbon']);

    const page = await list({ page: '2', limit: '1' });
    expect(page.body.total).toBe(3);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.page).toBe(2);
  });

  it('orders products with identical creation timestamps deterministically across pages', async () => {
    const createdAt = new Date('2026-01-15T12:00:00.000Z');
    await Product.create([
      { _id: new mongoose.Types.ObjectId('000000000000000000000003'), name: 'Third', sku: 'POS-TIE-3', createdAt, updatedAt: createdAt },
      { _id: new mongoose.Types.ObjectId('000000000000000000000001'), name: 'First', sku: 'POS-TIE-1', createdAt, updatedAt: createdAt },
      { _id: new mongoose.Types.ObjectId('000000000000000000000002'), name: 'Second', sku: 'POS-TIE-2', createdAt, updatedAt: createdAt },
    ]);

    const pages = await Promise.all([1, 2, 3].map((page) => list({ page: String(page), limit: '1' })));
    expect(pages.map((page) => page.body.items[0].sku)).toEqual(['POS-TIE-1', 'POS-TIE-2', 'POS-TIE-3']);
    expect(pages.map((page) => page.body.total)).toEqual([3, 3, 3]);
  });

  it('does not expose purchase cost and preserves the existing Sales comments restriction', async () => {
    await Product.create({ name: 'POS laptop', sku: 'POS-SAFE', purchasePrice: 500, comments: 'Internal note', condition: 'used', stock: 1 });
    const sales = await list();
    expect(sales.body.items[0]).not.toHaveProperty('purchasePrice');
    expect(sales.body.items[0]).not.toHaveProperty('comments');
    expect(sales.body.items[0].condition).toBe('used');

    const stock = await list({}, 'stock');
    expect(stock.body.items[0]).not.toHaveProperty('purchasePrice');
    expect(stock.body.items[0].comments).toBe('Internal note');
  });

  it('rejects malformed and over-limit model filters', async () => {
    const malformed = response();
    await expect(listPosProducts({ query: { models: '{bad' }, user: { role: 'sales' } }, malformed)).rejects.toThrow(/list of model names/i);
    expect(malformed.statusCode).toBe(400);

    const tooMany = response();
    const models = Array.from({ length: 101 }, (_, index) => `Model ${index + 1}`);
    await expect(listPosProducts({ query: { models: JSON.stringify(models) }, user: { role: 'sales' } }, tooMany)).rejects.toThrow(/up to 100 model names/i);
    expect(tooMany.statusCode).toBe(400);
  });
});
