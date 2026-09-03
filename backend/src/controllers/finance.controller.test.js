import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Supplier from '../models/Supplier.js';
import OpeningBalance from '../models/OpeningBalance.js';
import { adjustSupplierPayable } from './finance.controller.js';

describe('adjustSupplierPayable (DB-backed)', () => {
  let mem;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await Supplier.deleteMany({});
    await OpeningBalance.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    return res;
  }

  async function makeSupplier(payable = 1000) {
    return Supplier.create({ name: 'Acme Parts', payable });
  }

  it('raises the stored payable to the corrected total and records an audited OpeningBalance delta', async () => {
    const supplier = await makeSupplier(1000);
    const req = { params: { id: supplier._id.toString() }, body: { amount: 1500, note: 'Reconciled against supplier statement dated 2026-08-30' }, user: { _id: userId } };
    const res = mockRes();

    await adjustSupplierPayable(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.supplier.payable).toBe(1500);

    const fresh = await Supplier.findById(supplier._id);
    expect(fresh.payable).toBe(1500);

    const ob = await OpeningBalance.findOne({ entityType: 'supplier', entity: supplier._id });
    expect(ob).toBeTruthy();
    expect(ob.amount).toBe(500);
    expect(ob.note).toContain('Reconciled');
  });

  it('lowers the stored payable and records a negative delta', async () => {
    const supplier = await makeSupplier(1000);
    const req = { params: { id: supplier._id.toString() }, body: { amount: 200, note: 'Supplier confirmed a lower balance' }, user: { _id: userId } };
    const res = mockRes();

    await adjustSupplierPayable(req, res);

    expect(res.body.supplier.payable).toBe(200);
    const ob = await OpeningBalance.findOne({ entityType: 'supplier', entity: supplier._id });
    expect(ob.amount).toBe(-800);
  });

  it('rejects an adjustment with no note', async () => {
    const supplier = await makeSupplier(1000);
    const req = { params: { id: supplier._id.toString() }, body: { amount: 1500 }, user: { _id: userId } };
    const res = mockRes();

    await expect(adjustSupplierPayable(req, res)).rejects.toThrow(/reason is required/i);
    expect(await Supplier.findById(supplier._id)).toMatchObject({ payable: 1000 });
  });

  it('rejects a negative corrected amount', async () => {
    const supplier = await makeSupplier(1000);
    const req = { params: { id: supplier._id.toString() }, body: { amount: -5, note: 'typo test' }, user: { _id: userId } };
    const res = mockRes();

    await expect(adjustSupplierPayable(req, res)).rejects.toThrow(/valid corrected payable amount/i);
  });

  it('rejects a no-op adjustment that matches the current payable exactly', async () => {
    const supplier = await makeSupplier(1000);
    const req = { params: { id: supplier._id.toString() }, body: { amount: 1000, note: 'no change' }, user: { _id: userId } };
    const res = mockRes();

    await expect(adjustSupplierPayable(req, res)).rejects.toThrow(/nothing to adjust/i);
    expect(await OpeningBalance.countDocuments({ entityType: 'supplier', entity: supplier._id })).toBe(0);
  });

  it('404s for a missing supplier without writing anything', async () => {
    const missingId = new mongoose.Types.ObjectId();
    const req = { params: { id: missingId.toString() }, body: { amount: 500, note: 'test' }, user: { _id: userId } };
    const res = mockRes();

    await expect(adjustSupplierPayable(req, res)).rejects.toThrow(/not found/i);
    expect(await OpeningBalance.countDocuments({})).toBe(0);
  });

  it('400s for an invalid supplier id', async () => {
    const req = { params: { id: 'not-an-id' }, body: { amount: 500, note: 'test' }, user: { _id: userId } };
    const res = mockRes();

    await expect(adjustSupplierPayable(req, res)).rejects.toThrow(/invalid supplier id/i);
  });
});
