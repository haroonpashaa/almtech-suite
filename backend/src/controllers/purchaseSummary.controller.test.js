import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Supplier from '../models/Supplier.js';
import { purchaseSummary } from './purchaseSummary.controller.js';

describe('purchase summary (isolated database)', () => {
  let memory;
  let alpha;
  let beta;
  const jan10 = new Date('2025-01-10T12:00:00.000Z');

  beforeAll(async () => {
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
  });

  afterEach(async () => {
    await Promise.all([PurchaseOrder.deleteMany({}), Supplier.deleteMany({})]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memory.stop();
  });

  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });

  async function addOrder({ number, supplier = alpha, currency = 'PKR', total, paid, balance, status = 'received', date = jan10 }) {
    return PurchaseOrder.create({ number, supplier: supplier._id, currency, total, paid, balance, status, subtotal: total, orderedAt: date, items: [] });
  }

  async function seed() {
    alpha = await Supplier.create({ name: 'Alpha Supplies', payable: 93, payableGBP: 20 });
    beta = await Supplier.create({ name: 'Beta Supplies', payable: 500, payableGBP: 0 });
    await addOrder({ number: 'PO-1', total: 100, paid: 40, balance: 60 });
    await addOrder({ number: 'PO-2', total: 50, paid: 25, balance: 25, status: 'partial' });
    await addOrder({ number: 'PO-3', total: 20, paid: 0, balance: 20, currency: 'GBP' });
    await addOrder({ number: 'PO-DRAFT', total: 200, paid: 0, balance: 200, status: 'draft' });
    await addOrder({ number: 'PO-CANCELLED', total: 300, paid: 0, balance: 0, status: 'cancelled' });
    // Legacy stored rows without currency are PKR, matching current reports.
    await PurchaseOrder.collection.insertOne({
      number: 'PO-LEGACY', supplier: alpha._id, total: 10, paid: 2, balance: 8,
      status: 'received', subtotal: 10, orderedAt: jan10, items: [],
    });
    await addOrder({ number: 'PO-OLD', supplier: beta, total: 900, paid: 0, balance: 900, date: new Date('2024-12-31T12:00:00.000Z') });
  }

  it('filters by inclusive date range and supplier, and separates currencies and current balances', async () => {
    await seed();
    const res = response();
    await purchaseSummary({ query: { from: '2025-01-10', to: '2025-01-10', supplier: alpha._id.toString() } }, res);

    expect(res.body.totalsByCurrency).toEqual([
      { currency: 'PKR', purchaseCount: 3, purchaseValue: 160, paid: 67, outstanding: 93 },
      { currency: 'GBP', purchaseCount: 1, purchaseValue: 20, paid: 0, outstanding: 20 },
    ]);
    expect(res.body.currentSupplierBalancesByCurrency).toEqual([
      { currency: 'PKR', outstanding: 93 },
      { currency: 'GBP', outstanding: 20 },
    ]);
    expect(res.body.purchases.map((row) => row.number)).toContain('PO-DRAFT');
    expect(res.body.purchases.map((row) => row.number)).not.toContain('PO-OLD');
    expect(res.body.suppliers).toHaveLength(2);
  });

  it('keeps another supplier out of every filtered result while the unfiltered range includes both', async () => {
    await seed();
    await addOrder({ number: 'PO-BETA-IN-RANGE', supplier: beta, total: 75, paid: 15, balance: 60, status: 'ordered' });

    const filtered = response();
    await purchaseSummary({ query: { from: '2025-01-10', to: '2025-01-10', supplier: alpha._id.toString() } }, filtered);
    expect(filtered.body.totalsByCurrency).toEqual([
      { currency: 'PKR', purchaseCount: 3, purchaseValue: 160, paid: 67, outstanding: 93 },
      { currency: 'GBP', purchaseCount: 1, purchaseValue: 20, paid: 0, outstanding: 20 },
    ]);
    expect(filtered.body.suppliers.map((row) => row.supplierName)).toEqual(['Alpha Supplies', 'Alpha Supplies']);
    expect(filtered.body.statusBreakdown.find((row) => row.status === 'ordered').currencies.find((row) => row.currency === 'PKR')).toMatchObject({ count: 0, value: 0 });
    expect(filtered.body.purchases.map((row) => row.number)).not.toContain('PO-BETA-IN-RANGE');

    const unfiltered = response();
    await purchaseSummary({ query: { from: '2025-01-10', to: '2025-01-10' } }, unfiltered);
    expect(unfiltered.body.totalsByCurrency.find((row) => row.currency === 'PKR')).toMatchObject({ purchaseCount: 4, purchaseValue: 235, paid: 82, outstanding: 153 });
    expect([...new Set(unfiltered.body.suppliers.map((row) => row.supplierName))].sort()).toEqual(['Alpha Supplies', 'Beta Supplies']);
    expect(unfiltered.body.statusBreakdown.find((row) => row.status === 'ordered').currencies.find((row) => row.currency === 'PKR')).toMatchObject({ count: 1, value: 75 });
    expect(unfiltered.body.purchases.map((row) => row.number)).toContain('PO-BETA-IN-RANGE');
  });

  it('reports all order statuses while excluding draft/cancelled from counted purchase metrics', async () => {
    await seed();
    const res = response();
    await purchaseSummary({ query: { from: '2025-01-10', to: '2025-01-10' } }, res);

    const status = Object.fromEntries(res.body.statusBreakdown.map((row) => [row.status, row]));
    expect(status.received.currencies.find((row) => row.currency === 'PKR')).toMatchObject({ count: 2, value: 110 });
    expect(status.partial.currencies.find((row) => row.currency === 'PKR')).toMatchObject({ count: 1, value: 50 });
    expect(status.draft.currencies.find((row) => row.currency === 'PKR')).toMatchObject({ count: 1, value: 200 });
    expect(status.cancelled.currencies.find((row) => row.currency === 'PKR')).toMatchObject({ count: 1, value: 300 });
    expect(res.body.totalsByCurrency.find((row) => row.currency === 'PKR').purchaseValue).toBe(160);
  });

  it('paginates history and rejects invalid filters', async () => {
    await seed();
    const res = response();
    await purchaseSummary({ query: { page: '2', limit: '2' } }, res);
    expect(res.body.pagination).toEqual({ page: 2, limit: 2, total: 7 });
    expect(res.body.purchases).toHaveLength(2);

    const badDate = response();
    await expect(purchaseSummary({ query: { from: 'yesterday' } }, badDate)).rejects.toMatchObject({ statusCode: 400 });
    const badSupplier = response();
    await expect(purchaseSummary({ query: { supplier: 'not-an-id' } }, badSupplier)).rejects.toThrow('Invalid supplier');
    expect(badSupplier.statusCode).toBe(400);
  });

  it('returns zero totals and history for empty filters', async () => {
    alpha = await Supplier.create({ name: 'No purchases', payable: 0 });
    const res = response();
    await purchaseSummary({ query: { supplier: alpha._id.toString() } }, res);
    expect(res.body.totalsByCurrency.every((row) => row.purchaseValue === 0 && row.paid === 0 && row.outstanding === 0)).toBe(true);
    expect(res.body.suppliers).toEqual([]);
    expect(res.body.purchases).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });
});
