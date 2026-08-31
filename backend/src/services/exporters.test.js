import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Product from '../models/Product.js';
import { EXPORTERS } from './exporters.js';

// ===========================================================================
// Product export — Comments and Purchase Price are both Product master data
// withheld from Sales everywhere else (product.controller.js's
// withoutComments/withoutCost); this closes the one remaining path either
// could reach Sales through: the spreadsheet export.
// ===========================================================================
describe('EXPORTERS.products (DB-backed)', () => {
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

  async function seed() {
    await Product.create({
      sku: 'CMT-1', name: 'Commented Laptop', stock: 3,
      comments: 'Screen scratch on lid', purchasePrice: 500, sellingPrice: 900,
    });
  }

  it('includes Comments and Purchase Price, with their real data, for admin', async () => {
    await seed();
    const built = await EXPORTERS.products.build({}, { user: { role: 'admin' } });
    expect(built.columns.some((c) => c.header === 'Comments')).toBe(true);
    expect(built.columns.some((c) => c.header === 'Purchase Price')).toBe(true);
    expect(built.rows[0].comments).toBe('Screen scratch on lid');
    expect(built.rows[0].purchasePrice).toBe(500);
  });

  it('includes Comments and Purchase Price for stock (unaffected by this change)', async () => {
    await seed();
    const built = await EXPORTERS.products.build({}, { user: { role: 'stock' } });
    expect(built.columns.some((c) => c.header === 'Comments')).toBe(true);
    expect(built.columns.some((c) => c.header === 'Purchase Price')).toBe(true);
  });

  it('omits the Comments column entirely for sales', async () => {
    await seed();
    const built = await EXPORTERS.products.build({}, { user: { role: 'sales' } });
    expect(built.columns.some((c) => c.header === 'Comments')).toBe(false);
  });

  it('omits the Purchase Price column entirely for sales', async () => {
    await seed();
    const built = await EXPORTERS.products.build({}, { user: { role: 'sales' } });
    expect(built.columns.some((c) => c.header === 'Purchase Price')).toBe(false);
  });

  it('still exports every other permitted product column for sales', async () => {
    await seed();
    const built = await EXPORTERS.products.build({}, { user: { role: 'sales' } });
    const headers = built.columns.map((c) => c.header);
    expect(headers).toEqual(expect.arrayContaining(['SKU', 'Name', 'Selling Price', 'Stock', 'Processor', 'RAM']));
  });

  it('behaves exactly as before when no ctx/user is supplied', async () => {
    await seed();
    const built = await EXPORTERS.products.build({}, undefined);
    expect(built.columns.some((c) => c.header === 'Comments')).toBe(true);
    expect(built.columns.some((c) => c.header === 'Purchase Price')).toBe(true);
  });
});
