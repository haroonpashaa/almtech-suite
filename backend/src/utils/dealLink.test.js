import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Deal from '../models/Deal.js';
import Invoice from '../models/Invoice.js';
import { claimDealForLink, withDealTransaction } from './dealLink.js';

describe('deal transaction safety', () => {
  let memory;
  beforeAll(async () => { memory = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(memory.getUri()); });
  afterEach(async () => { await Promise.all([Deal.deleteMany({}), Invoice.deleteMany({})]); });
  afterAll(async () => { await mongoose.disconnect(); await memory.stop(); });

  it('rolls back a deal claim and linked record when a transaction is interrupted', async () => {
    const deal = await Deal.create({ identifier: 'INTERRUPTED-LINK' });
    const customer = new mongoose.Types.ObjectId();
    const product = new mongoose.Types.ObjectId();

    await expect(withDealTransaction({}, async (session) => {
      await claimDealForLink(session, deal._id);
      await Invoice.create([{
        number: 'INV-INTERRUPTED', customer, deal: deal._id,
        items: [{ product, name: 'Test', quantity: 1, unitPrice: 10, unitCost: 5, lineTotal: 10 }],
        subtotal: 10, total: 10, balance: 10,
      }], { session });
      throw new Error('simulated process interruption before commit');
    })).rejects.toThrow(/simulated process interruption/i);

    expect(await Invoice.countDocuments({ deal: deal._id })).toBe(0);
    expect((await Deal.findById(deal._id).select('+linkRevision')).linkRevision).toBe(0);
  });

  it('commits the deal revision and linked record together', async () => {
    const deal = await Deal.create({ identifier: 'COMMITTED-LINK' });
    const customer = new mongoose.Types.ObjectId();
    const product = new mongoose.Types.ObjectId();

    await withDealTransaction({}, async (session) => {
      const claimed = await claimDealForLink(session, deal._id);
      await Invoice.create([{
        number: 'INV-COMMITTED', customer, deal: claimed._id,
        items: [{ product, name: 'Test', quantity: 1, unitPrice: 10, unitCost: 5, lineTotal: 10 }],
        subtotal: 10, total: 10, balance: 10,
      }], { session });
    });

    expect((await Deal.findById(deal._id).select('+linkRevision')).linkRevision).toBe(1);
    expect(await Invoice.countDocuments({ deal: deal._id })).toBe(1);
  });
});
