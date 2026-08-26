import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Product from '../models/Product.js';
import { IMPORTERS, ACTIONS } from './importers.js';

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

describe('products importer — comments', () => {
  it('sets comments on a newly created product', async () => {
    const prepared = await IMPORTERS.products.prepare([
      { sku: 'SN001', name: 'Intel Core i5-1135G7', comments: 'Screen scratch' },
    ]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'SN001' });
    expect(product.comments).toBe('Screen scratch');
  });

  it('updates comments on an existing product when the sheet supplies a new value', async () => {
    await Product.create({ sku: 'SN002', name: 'Old name', comments: 'Old comment' });
    const prepared = await IMPORTERS.products.prepare([
      { sku: 'SN002', name: 'Old name', comments: 'Battery health issue' },
    ]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'SN002' });
    expect(product.comments).toBe('Battery health issue');
  });

  it('leaves existing comments untouched when the sheet has no Comments column', async () => {
    await Product.create({ sku: 'SN003', name: 'Existing laptop', comments: 'Missing charger' });
    // No `comments` key at all — simulates a sheet with no Comments column, exactly
    // like the existing processor/ram/storage partial-update behaviour.
    const prepared = await IMPORTERS.products.prepare([{ sku: 'SN003', name: 'Existing laptop' }]);
    await IMPORTERS.products.commit(prepared);
    const product = await Product.findOne({ sku: 'SN003' });
    expect(product.comments).toBe('Missing charger');
  });

  it('does not require Comments for an otherwise-valid row', async () => {
    const prepared = await IMPORTERS.products.prepare([{ sku: 'SN004', name: 'No comments here' }]);
    expect(prepared[0].action).toBe(ACTIONS.CREATE);
    expect(prepared[0].errors).toHaveLength(0);
  });
});
