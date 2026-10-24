import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Supplier from '../models/Supplier.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import OpeningBalance from '../models/OpeningBalance.js';
import { adjustSupplierPayable, payables } from './finance.controller.js';
import { clearRateCacheForTests } from '../services/exchangeRate.service.js';

describe('adjustSupplierPayable (DB-backed)', () => {
  let mem;
  let requestNumber = 0;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  beforeEach(() => {
    process.env.EXCHANGE_RATE_API_KEY = 'test-only-key';
    vi.stubGlobal('fetch', async (url) => {
      const base = String(url).split('/').at(-1);
      const time = Math.floor(Date.now() / 1000);
      return { ok: true, json: async () => ({ result: 'success', base_code: base, conversion_rates: base === 'GBP' ? { GBP: 1, PKR: 360 } : { GBP: 1 / 360, PKR: 1 }, time_last_update_unix: time - 60, time_next_update_unix: time + 86400 }) };
    });
  });

  afterEach(async () => {
    clearRateCacheForTests();
    await Supplier.deleteMany({});
    await OpeningBalance.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
    vi.unstubAllGlobals();
    delete process.env.EXCHANGE_RATE_API_KEY;
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

  function adjustmentBody(supplier, body) {
    return { currency: 'PKR', expectedUpdatedAt: supplier.updatedAt.toISOString(), idempotencyKey: `finance-test-${++requestNumber}`, ...body };
  }

  it('raises the stored payable to the corrected total and records an audited OpeningBalance delta', async () => {
    const supplier = await makeSupplier(1000);
    const req = { params: { id: supplier._id.toString() }, body: adjustmentBody(supplier, { amount: 1500, note: 'Reconciled against supplier statement dated 2026-08-30' }), user: { _id: userId } };
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
    const req = { params: { id: supplier._id.toString() }, body: adjustmentBody(supplier, { amount: 200, note: 'Supplier confirmed a lower balance' }), user: { _id: userId } };
    const res = mockRes();

    await adjustSupplierPayable(req, res);

    expect(res.body.supplier.payable).toBe(200);
    const ob = await OpeningBalance.findOne({ entityType: 'supplier', entity: supplier._id });
    expect(ob.amount).toBe(-800);
  });

  it('rejects new GBP corrections without changing historical balances or snapshots', async () => {
    const supplier = await Supplier.create({ name: 'GBP Supplier', payable: 1000, payableGBP: 10 });
    const saved = await OpeningBalance.create({ entityType: 'supplier', entity: supplier._id, entityName: supplier.name, currency: 'GBP', amount: 10, fxSnapshot: { fromCurrency: 'GBP', toCurrency: 'PKR', rate: 360, originalAmount: 10, equivalentAmount: 3600, source: 'Historical', effectiveAt: new Date(), fetchedAt: new Date() } });
    await expect(adjustSupplierPayable({ params: { id: String(supplier._id) }, body: adjustmentBody(supplier, { currency: 'GBP', amount: 12.5, note: 'Correction' }), user: { _id: userId } }, mockRes())).rejects.toMatchObject({ statusCode: 400 });
    expect((await Supplier.findById(supplier._id)).toObject()).toMatchObject({ payable: 1000, payableGBP: 10 });
    expect((await OpeningBalance.findById(saved._id)).fxSnapshot.equivalentAmount).toBe(3600);
    expect(await OpeningBalance.countDocuments()).toBe(1);
  });

  it('corrects PKR balances without creating a foreign-currency snapshot', async () => {
    const supplier = await makeSupplier(1000); const res = mockRes();
    await adjustSupplierPayable({ params: { id: String(supplier._id) }, body: adjustmentBody(supplier, { amount: 1000.01, note: 'PKR correction' }), user: { _id: userId } }, res);
    expect(res.body.supplier.payable).toBe(1000.01);
    expect(res.body.supplier.payableGBP).toBe(0);
    expect(res.body.adjustment.fxSnapshot).toBeUndefined();
  });

  it('rejects a repeated or stale payable correction without duplicating its audit row', async () => {
    const supplier = await makeSupplier(1000);
    const body = adjustmentBody(supplier, { amount: 1250, note: 'Concurrent correction' });
    const call = () => adjustSupplierPayable({ params: { id: supplier._id.toString() }, body, user: { _id: userId } }, mockRes());
    await call();
    await expect(call()).rejects.toThrow(/changed since it was loaded/i);
    expect(await OpeningBalance.countDocuments({ entity: supplier._id })).toBe(1);
    expect((await Supplier.findById(supplier._id)).payable).toBe(1250);
  });

  it('allows a PKR correction when the rate provider is unavailable without calling it', async () => {
    const supplier = await makeSupplier(1000); const fetchSpy = vi.fn().mockRejectedValue(new Error('Offline'));
    vi.stubGlobal('fetch', fetchSpy);
    await adjustSupplierPayable({ params: { id: String(supplier._id) }, body: adjustmentBody(supplier, { amount: 1200, note: 'PKR correction' }), user: { _id: userId } }, mockRes());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await Supplier.findById(supplier._id)).payable).toBe(1200);
    expect(await OpeningBalance.countDocuments({ entity: supplier._id })).toBe(1);
  });

  it('allows PKR corrections without exchange-rate configuration', async () => {
    const supplier = await makeSupplier(1000); const originalKey = process.env.EXCHANGE_RATE_API_KEY;
    delete process.env.EXCHANGE_RATE_API_KEY;
    const fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy);
    try {
      await adjustSupplierPayable({ params: { id: String(supplier._id) }, body: adjustmentBody(supplier, { amount: 1200, note: 'PKR correction' }), user: { _id: userId } }, mockRes());
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((await Supplier.findById(supplier._id)).payable).toBe(1200);
    } finally { process.env.EXCHANGE_RATE_API_KEY = originalKey; }
  });

  it('rejects an adjustment with no note', async () => {
    const supplier = await makeSupplier(1000);
    const req = { params: { id: supplier._id.toString() }, body: adjustmentBody(supplier, { amount: 1500 }), user: { _id: userId } };
    const res = mockRes();

    await expect(adjustSupplierPayable(req, res)).rejects.toThrow(/reason is required/i);
    expect(await Supplier.findById(supplier._id)).toMatchObject({ payable: 1000 });
  });

  it('rejects a negative corrected amount', async () => {
    const supplier = await makeSupplier(1000);
    const req = { params: { id: supplier._id.toString() }, body: adjustmentBody(supplier, { amount: -5, note: 'typo test' }), user: { _id: userId } };
    const res = mockRes();

    await expect(adjustSupplierPayable(req, res)).rejects.toThrow(/valid PKR corrected payable amount/i);
  });

  it('rejects a no-op adjustment that matches the current payable exactly', async () => {
    const supplier = await makeSupplier(1000);
    const req = { params: { id: supplier._id.toString() }, body: adjustmentBody(supplier, { amount: 1000, note: 'no change' }), user: { _id: userId } };
    const res = mockRes();

    await expect(adjustSupplierPayable(req, res)).rejects.toThrow(/nothing to adjust/i);
    expect(await OpeningBalance.countDocuments({ entityType: 'supplier', entity: supplier._id })).toBe(0);
  });

  it('404s for a missing supplier without writing anything', async () => {
    const missingId = new mongoose.Types.ObjectId();
    const req = { params: { id: missingId.toString() }, body: { currency: 'PKR', expectedUpdatedAt: new Date().toISOString(), idempotencyKey: 'missing-test', amount: 500, note: 'test' }, user: { _id: userId } };
    const res = mockRes();

    await expect(adjustSupplierPayable(req, res)).rejects.toThrow(/not found/i);
    expect(await OpeningBalance.countDocuments({})).toBe(0);
  });

  it('400s for an invalid supplier id', async () => {
    const req = { params: { id: 'not-an-id' }, body: { currency: 'PKR', expectedUpdatedAt: new Date().toISOString(), idempotencyKey: 'invalid-id-test', amount: 500, note: 'test' }, user: { _id: userId } };
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
