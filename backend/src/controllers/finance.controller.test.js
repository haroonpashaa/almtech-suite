import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Supplier from '../models/Supplier.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import OpeningBalance from '../models/OpeningBalance.js';
import { adjustSupplierPayable, payables } from './finance.controller.js';

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

// ===========================================================================
// payables() list — every active supplier must be reachable/editable from this
// section, not only ones with an open purchase order or opening balance.
// ===========================================================================
describe('payables list includes every active supplier (DB-backed)', () => {
  let mem;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await Supplier.deleteMany({});
    await PurchaseOrder.deleteMany({});
    await OpeningBalance.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  }

  it('lists a supplier with no open purchase orders and no opening balance as a zero row, not omitted', async () => {
    const supplier = await Supplier.create({ name: 'Zero Balance Supplier', payable: 0 });
    const res = mockRes();
    await payables({ query: {} }, res);

    const row = res.body.rows.find((r) => String(r.supplierId) === String(supplier._id));
    expect(row).toBeTruthy();
    expect(row.outstanding).toBe(0);
    expect(row.total).toBe(0);
    expect(row.poCount).toBe(0);
    // Zero rows must not inflate the real totals.
    expect(res.body.totalOutstanding).toBe(0);
  });

  it('still lists a supplier with a real open purchase order at its correct outstanding amount', async () => {
    const supplier = await Supplier.create({ name: 'Owed Supplier', payable: 500 });
    await PurchaseOrder.create({
      number: 'PO-TEST-1', supplier: supplier._id,
      items: [{ product: new mongoose.Types.ObjectId(), name: 'Part', sku: 'P1', quantity: 1, unitCost: 500, lineTotal: 500 }],
      subtotal: 500, total: 500, paid: 0, balance: 500, status: 'ordered',
    });
    const res = mockRes();
    await payables({ query: {} }, res);

    const row = res.body.rows.find((r) => String(r.supplierId) === String(supplier._id));
    expect(row.outstanding).toBe(500);
    expect(res.body.totalOutstanding).toBe(500);
  });

  it('an inactive supplier is not added as a zero row', async () => {
    const supplier = await Supplier.create({ name: 'Inactive Supplier', payable: 0, active: false });
    const res = mockRes();
    await payables({ query: {} }, res);

    expect(res.body.rows.find((r) => String(r.supplierId) === String(supplier._id))).toBeUndefined();
  });

  it('a search query still narrows zero-balance suppliers by name', async () => {
    await Supplier.create({ name: 'Findable Zero Co', payable: 0 });
    await Supplier.create({ name: 'Other Zero Co', payable: 0 });
    const res = mockRes();
    await payables({ query: { q: 'Findable' } }, res);

    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].name).toBe('Findable Zero Co');
  });
});
