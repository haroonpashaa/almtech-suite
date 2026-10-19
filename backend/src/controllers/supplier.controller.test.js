import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Supplier from '../models/Supplier.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import OpeningBalance from '../models/OpeningBalance.js';
import { getSupplier, supplierLedger } from './supplier.controller.js';

describe('supplier financial views by original currency', () => {
  let mem;
  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });
  afterEach(async () => {
    await Promise.all([Supplier.deleteMany({}), PurchaseOrder.deleteMany({}), OpeningBalance.deleteMany({})]);
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  const mockRes = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

  it('keeps GBP and legacy PKR supplier summaries and ledgers separate', async () => {
    const supplier = await Supplier.create({ name: 'Mixed Currency Supplier', payable: 25, payableGBP: 37 });
    await PurchaseOrder.create({ number: 'PO-PKR', supplier: supplier._id, subtotal: 20, total: 20, paid: 0, balance: 20, status: 'ordered', items: [] });
    await PurchaseOrder.create({ number: 'PO-GBP', supplier: supplier._id, currency: 'GBP', subtotal: 30, total: 30, paid: 0, balance: 30, status: 'ordered', items: [] });
    await OpeningBalance.create({ entityType: 'supplier', entity: supplier._id, entityName: supplier.name, amount: 5, currency: 'PKR', note: 'legacy PKR' });
    await OpeningBalance.create({ entityType: 'supplier', entity: supplier._id, entityName: supplier.name, amount: 7, currency: 'GBP', reference: 'gbp-opening', note: 'GBP opening' });

    const pkrRes = mockRes();
    await getSupplier({ params: { id: supplier._id.toString() }, query: {} }, pkrRes);
    expect(pkrRes.body.summary).toMatchObject({ currency: 'PKR', totalPurchases: 20, openingBalance: 5, outstanding: 25, storedPayable: 25, reconciled: true });
    expect(pkrRes.body.purchaseOrders.map((po) => po.number)).toEqual(['PO-PKR']);

    const gbpRes = mockRes();
    await getSupplier({ params: { id: supplier._id.toString() }, query: { currency: 'GBP' } }, gbpRes);
    expect(gbpRes.body.summary).toMatchObject({ currency: 'GBP', totalPurchases: 30, openingBalance: 7, outstanding: 37, storedPayable: 37, reconciled: true });
    expect(gbpRes.body.purchaseOrders.map((po) => po.number)).toEqual(['PO-GBP']);

    const ledgerRes = mockRes();
    await supplierLedger({ params: { id: supplier._id.toString() }, query: { currency: 'GBP' } }, ledgerRes);
    expect(ledgerRes.body).toMatchObject({ currency: 'GBP', payable: 37, closingBalance: 37, reconciled: true });
    expect(ledgerRes.body.entries.every((entry) => entry.currency === 'GBP')).toBe(true);
  });
});
