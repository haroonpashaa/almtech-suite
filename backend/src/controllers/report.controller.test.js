import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Customer from '../models/Customer.js';
import Expense from '../models/Expense.js';
import Invoice from '../models/Invoice.js';
import Supplier from '../models/Supplier.js';
import { dashboard, dailySales, monthlySummary, profitAndLoss, salesByCustomer, salesByProduct, series } from './report.controller.js';

describe('dashboard role-specific financial fields (isolated database)', () => {
  let memory;

  beforeAll(async () => {
    memory = await MongoMemoryServer.create();
    await mongoose.connect(memory.getUri());
  });

  afterEach(async () => {
    await Promise.all([Supplier.deleteMany({}), Customer.deleteMany({}), Invoice.deleteMany({}), Expense.deleteMany({})]);
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

  const createCustomer = () => Customer.create({ name: 'Synthetic customer' });

  async function createInvoice(customer, overrides = {}) {
    const items = overrides.items || [
      { product: new mongoose.Types.ObjectId(), name: 'Synthetic laptop', sku: 'SYN-1', quantity: 1, unitPrice: 100, unitCost: 40, lineTotal: 100 },
    ];
    const subtotal = overrides.subtotal ?? items.reduce((sum, item) => sum + item.lineTotal, 0);
    const discount = overrides.discount ?? 0;
    const taxAmount = overrides.taxAmount ?? 0;
    const total = overrides.total ?? Math.round((Math.max(0, subtotal - discount) + taxAmount) * 100) / 100;
    const { items: _items, ...fields } = overrides;
    return Invoice.create({
      number: `SYN-${new mongoose.Types.ObjectId().toString()}`,
      customer: customer._id,
      items,
      subtotal,
      discount,
      taxAmount,
      total,
      paid: 0,
      balance: total,
      status: 'open',
      issuedAt: new Date(),
      ...fields,
    });
  }

  it('omits payables from the Sales response', async () => {
    await Supplier.create({ name: 'Synthetic supplier', payable: 1250 });
    const res = response();

    await dashboard({ user: { role: 'sales' } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).not.toHaveProperty('payables');
    expect(res.body).not.toHaveProperty('accounts');
  });

  it.each(['admin', 'stock'])('preserves the existing payables figure for %s', async (role) => {
    await Supplier.create({ name: 'Synthetic supplier', payable: 1250 });
    const res = response();

    await dashboard({ user: { role } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.payables).toBe(1250);
  });

  it('subtracts the invoice discount once, uses saved unit costs, excludes non-realized invoices, and deducts posted expenses', async () => {
    const customer = await createCustomer();
    const productA = new mongoose.Types.ObjectId();
    const productB = new mongoose.Types.ObjectId();
    await createInvoice(customer, {
      items: [
        { product: productA, name: 'Synthetic A', sku: 'SYN-A', quantity: 1, unitPrice: 60, unitCost: 20, discount: 0, lineTotal: 60 },
        { product: productB, name: 'Synthetic B', sku: 'SYN-B', quantity: 1, unitPrice: 40, unitCost: 10, discount: 0, lineTotal: 40 },
      ],
      subtotal: 100,
      discount: 10,
      taxAmount: 9,
      total: 99,
      paid: 0,
      balance: 99,
    });
    await createInvoice(customer, { status: 'draft', subtotal: 500, total: 500 });
    await createInvoice(customer, { status: 'cancelled', subtotal: 300, total: 300 });
    await createInvoice(customer, { status: 'returned', subtotal: 200, total: 200 });
    await Expense.create({
      amount: 7,
      currency: 'PKR',
      category: 'Rent',
      account: new mongoose.Types.ObjectId(),
      date: new Date(),
      financialTransaction: new mongoose.Types.ObjectId(),
      status: 'posted',
    });
    await Expense.create({
      amount: 50,
      currency: 'PKR',
      category: 'Rent',
      account: new mongoose.Types.ObjectId(),
      date: new Date(),
      financialTransaction: new mongoose.Types.ObjectId(),
      status: 'voided',
    });

    const res = response();
    await profitAndLoss({ query: { from: '2026-01-01', to: '2027-01-01' } }, res);

    expect(res.body.revenue).toBe(90);
    expect(res.body.cost).toBe(30);
    expect(res.body.grossProfit).toBe(60);
    expect(res.body.expenses).toBe(7);
    expect(res.body.netProfit).toBe(53);
  });

  it('uses the same realized invoice statuses for dashboard, daily, product, customer and trend sales', async () => {
    const customer = await createCustomer();
    const product = new mongoose.Types.ObjectId();
    const now = new Date();
    await createInvoice(customer, {
      items: [{ product, name: 'Synthetic laptop', sku: 'SYN-2', quantity: 1, unitPrice: 100, unitCost: 40, lineTotal: 100 }],
      subtotal: 100,
      discount: 10,
      taxAmount: 9,
      total: 99,
      paid: 0,
      balance: 99,
      issuedAt: now,
    });
    await createInvoice(customer, {
      items: [{ product, name: 'Synthetic laptop', sku: 'SYN-2', quantity: 2, unitPrice: 50, unitCost: 15, lineTotal: 100 }],
      subtotal: 100,
      discount: 0,
      total: 100,
      paid: 25,
      balance: 75,
      status: 'partial',
      issuedAt: now,
    });
    await createInvoice(customer, { status: 'draft', issuedAt: now, subtotal: 800, total: 800 });
    await createInvoice(customer, { status: 'cancelled', issuedAt: now, subtotal: 600, total: 600 });
    await createInvoice(customer, { status: 'returned', issuedAt: now, subtotal: 400, total: 400 });

    const date = now.toISOString().slice(0, 10);
    const daily = response();
    await dailySales({ query: { date } }, daily);
    expect(daily.body.invoiceCount).toBe(2);
    expect(daily.body.gross).toBe(199);
    expect(daily.body.paid).toBe(25);
    expect(daily.body.outstanding).toBe(174);

    const products = response();
    await salesByProduct({ query: { from: '2026-01-01', to: '2027-01-01' } }, products);
    expect(products.body).toHaveLength(1);
    expect(products.body[0]).toMatchObject({ quantity: 3, revenue: 200 });

    const customers = response();
    await salesByCustomer({ query: { from: '2026-01-01', to: '2027-01-01' } }, customers);
    expect(customers.body).toHaveLength(1);
    expect(customers.body[0]).toMatchObject({ invoices: 2, revenue: 199 });

    const dashboardResponse = response();
    await dashboard({ user: { role: 'sales' } }, dashboardResponse);
    expect(dashboardResponse.body.salesToday).toMatchObject({ total: 199, count: 2 });
    expect(dashboardResponse.body.salesWeek).toBe(199);
    expect(dashboardResponse.body.salesMonth).toBe(199);
    expect(dashboardResponse.body.topProducts[0]).toMatchObject({ quantity: 3, revenue: 200 });
    expect(dashboardResponse.body.dailySeries.reduce((sum, row) => sum + row.count, 0)).toBe(2);

    const trend = response();
    await series({ query: { from: '2026-01-01', to: '2027-01-01', granularity: 'day' } }, trend);
    expect(trend.body.totals.revenue).toBe(190);

    const monthly = response();
    await monthlySummary({}, monthly);
    expect(monthly.body).toHaveLength(1);
    expect(monthly.body[0]).toMatchObject({ revenue: 190, cost: 70, grossProfit: 120 });

    const pnl = response();
    await profitAndLoss({ query: { from: '2026-01-01', to: '2027-01-01' } }, pnl);
    expect(trend.body.totals.revenue).toBe(pnl.body.revenue);
    expect(monthly.body[0].revenue).toBe(pnl.body.revenue);
  });
});
