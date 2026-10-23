import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import routes from './invoice.routes.js';
import { errorHandler } from '../middleware/error.js';
import Product from '../models/Product.js';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import Account from '../models/Account.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import StockMovement from '../models/StockMovement.js';
import Activity from '../models/Activity.js';
import Settings from '../models/Settings.js';
import User from '../models/User.js';
import { profitAndLoss } from '../controllers/report.controller.js';
import { addPosStockSelection } from '../../../frontend/src/lib/posStockSelection.js';

let memory, server, base;
const tokens = {};
const previousSecret = process.env.JWT_SECRET;
beforeAll(async () => {
  process.env.JWT_SECRET = 'isolated-bulk-sale-test-secret';
  memory = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(memory.getUri());
  for (const role of ['admin', 'sales', 'stock']) {
    const user = await User.create({ name: role, email: `${role}@example.test`, password: 'test-password-123', role });
    tokens[role] = jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion }, process.env.JWT_SECRET);
  }
  const app = express();
  app.use(express.json());
  app.use('/invoices', routes);
  app.use(errorHandler);
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}/invoices`;
});
afterEach(async () => {
  await Promise.all([Product, Invoice, Customer, Account, FinancialTransaction, StockMovement, Activity, Settings].map(model => model.deleteMany({})));
});
afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  await memory?.stop();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});
async function post(body, role = 'admin', path = '') {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
async function fixture() {
  const customer = await Customer.create({ name: 'Synthetic wholesale buyer' });
  const product = await Product.create({ name: 'Laptop', sku: 'BULK-1', stock: 500, purchasePrice: 1000, sellingPrice: 2000 });
  return { product, customer, input: { customer: customer._id, bulkSellingTotal: 900000.01, items: [{ product: product._id, quantity: 450, unitPrice: 1, unitCost: 0, discount: 9999999 }] } };
}

describe('Admin bulk selling (isolated replica set)', () => {
  it('sells 450 of 500 at one batch amount and reconciles costs, stock, receivables, tax and payments', async () => {
    const { product, customer, input } = await fixture();
    const cash = await Account.create({ name: 'Cash', type: 'cash' });
    const result = await post({ ...input, discount: 100.01, taxRate: 10, initialPayment: { amount: 100000, account: cash._id, method: 'cash', idempotencyKey: 'bulk-upfront-1' } });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ bulkSellingTotal: 900000.01, subtotal: 900000.01, discount: 100.01, taxAmount: 89990, total: 989890, paid: 100000, balance: 889890, status: 'partial' });
    expect(result.body.items[0]).toMatchObject({ quantity: 450, unitCost: 1000, lineTotal: 900000.01 });
    expect((await Product.findById(product._id))).toMatchObject({ stock: 50, purchasePrice: 1000, sellingPrice: 2000 });
    expect((await Customer.findById(customer._id)).balance).toBe(889890);
    expect((await Account.findById(cash._id)).currentBalance).toBe(100000);
    expect(await FinancialTransaction.countDocuments()).toBe(1);
    expect(await StockMovement.findOne({ product: product._id, type: 'sale' })).toMatchObject({ quantity: -450 });
    const report = { json(body) { this.body = body; } };
    await profitAndLoss({ query: {} }, report);
    expect(report.body).toMatchObject({ revenue: 899900, cost: 450000, grossProfit: 449900 });
    const saved = await Invoice.findById(result.body._id);
    expect(saved.bulkSellingTotal).toBe(900000.01);
    expect(await Activity.findOne({ action: 'invoice_created' })).toMatchObject({ meta: { bulkSellingTotal: 900000.01 } });
  });

  it('preserves mixed-product specifications and selected serials, then restores only sold stock on return', async () => {
    const { product, input } = await fixture();
    product.stock = 3;
    product.tracksSerials = true;
    product.serials = ['SN-1', 'SN-2', 'SN-3'].map(serial => ({ serial, status: 'in_stock' }));
    await product.save();
    const second = await Product.create({ name: 'Second laptop', sku: 'BULK-2', stock: 2, purchasePrice: 500 });
    const result = await post({ ...input, bulkSellingTotal: 100, items: [
      { product: product._id, quantity: 2, serials: ['SN-1', 'SN-2'], model: 'Selected model', processor: 'i7', storage: '512GB' },
      { product: second._id, quantity: 1 },
    ] });
    expect(result.status).toBe(201);
    expect(result.body.items.map(line => line.lineTotal)).toEqual([66.66, 33.34]);
    expect(result.body.items[0]).toMatchObject({ serials: ['SN-1', 'SN-2'], model: 'Selected model', processor: 'i7', storage: '512GB', unitCost: 1000 });
    expect(result.body.items[1].unitCost).toBe(500);
    expect((await Product.findById(product._id)).serials.map(unit => unit.status)).toEqual(['sold', 'sold', 'in_stock']);
    expect((await post({ reason: 'Synthetic batch return' }, 'admin', `/${result.body._id}/return`)).status).toBe(200);
    expect((await Product.findById(product._id)).stock).toBe(3);
    // Preserve the existing returns workflow: returned serials await inventory
    // review; the untouched third unit remains available.
    expect((await Product.findById(product._id)).serials.map(unit => unit.status)).toEqual(['returned', 'returned', 'in_stock']);
    expect((await Product.findById(second._id)).stock).toBe(2);
    const report = { json(body) { this.body = body; } };
    await profitAndLoss({ query: {} }, report);
    expect(report.body.revenue).toBe(0);
  });

  it.each(['sales', 'stock', null])('rejects a direct bulk-price override from %s', async role => {
    const { product, customer, input } = await fixture();
    expect((await post(input, role)).status).toBe(role ? 403 : 401);
    expect(await Invoice.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).stock).toBe(500);
    expect((await Customer.findById(customer._id)).balance).toBe(0);
  });

  it.each(['', ' ', null, false, {}, [], 0, -1, 1.234, 1e20])('rejects invalid batch amount %j without financial or stock effects', async bulkSellingTotal => {
    const { product, customer, input } = await fixture();
    expect((await post({ ...input, bulkSellingTotal })).status).toBe(400);
    expect(await Invoice.countDocuments()).toBe(0);
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).stock).toBe(500);
    expect((await Customer.findById(customer._id)).balance).toBe(0);
  });

  it('preserves insufficient-stock, fractional-quantity and serial validation', async () => {
    const { product, input } = await fixture();
    for (const quantity of [501, 1.5, 0]) {
      expect((await post({ ...input, items: [{ product: product._id, quantity }] })).status).toBe(400);
    }
    product.tracksSerials = true;
    product.serials = [{ serial: 'SN-1', status: 'in_stock' }, { serial: 'SOLD', status: 'sold' }];
    await product.save();
    for (const serials of [['SOLD'], ['UNKNOWN'], ['SN-1', 'SN-1']]) {
      expect((await post({ ...input, items: [{ product: product._id, quantity: serials.length, serials }] })).status).toBe(400);
    }
    expect(await Invoice.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).stock).toBe(500);
  });

  it('uses normal selling prices and buying costs when batch pricing is omitted', async () => {
    const { product, input } = await fixture();
    delete input.bulkSellingTotal;
    input.items = [{ product: product._id, quantity: 1, unitPrice: 1500 }];
    const result = await post(input, 'sales');
    expect(result.status).toBe(201);
    expect(result.body.total).toBe(1500);
    expect(result.body.items[0].unitCost).toBe(1000);
    expect(result.body).not.toHaveProperty('bulkSellingTotal');
  });

  it('refunds a paid bulk sale once and reconciles the account, ledger, receivable and stock', async () => {
    const { product, customer, input } = await fixture();
    const cash = await Account.create({ name: 'Cash', type: 'cash' });
    const created = await post({ ...input, bulkSellingTotal: 100, initialPayment: { amount: 100, account: cash._id, idempotencyKey: 'paid-bulk-1' } });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('paid');
    const returned = await post({ reason: 'Synthetic full refund' }, 'admin', `/${created.body._id}/return`);
    expect(returned.status).toBe(200);
    expect((await Account.findById(cash._id)).currentBalance).toBe(0);
    expect((await Customer.findById(customer._id)).balance).toBe(0);
    expect((await Product.findById(product._id)).stock).toBe(500);
    expect(await FinancialTransaction.countDocuments()).toBe(2);
    expect((await post({ reason: 'Duplicate return' }, 'admin', `/${created.body._id}/return`)).status).toBe(400);
    expect((await Product.findById(product._id)).stock).toBe(500);
    expect(await FinancialTransaction.countDocuments()).toBe(2);
  });

  it('still enforces customer credit limits and validates the initial payment account before selling', async () => {
    const { product, customer, input } = await fixture();
    await Customer.updateOne({ _id: customer._id }, { $set: { creditLimit: 10 } });
    expect((await post(input)).status).toBe(400);
    await Customer.updateOne({ _id: customer._id }, { $set: { creditLimit: 0 } });
    expect((await post({ ...input, initialPayment: { amount: 10, account: 'invalid' } })).status).toBe(400);
    expect(await Invoice.countDocuments()).toBe(0);
    expect((await Product.findById(product._id)).stock).toBe(500);
    expect((await Customer.findById(customer._id)).balance).toBe(0);
  });

  it('cannot oversell stock when two bulk requests compete for the same 450 units', async () => {
    const { product, input } = await fixture();
    const attempts = await Promise.all([post(input), post(input)]);
    expect(attempts.filter(result => result.status === 201)).toHaveLength(1);
    expect(attempts.filter(result => result.status >= 400)).toHaveLength(1);
    expect(await Invoice.countDocuments()).toBe(1);
    expect((await Product.findById(product._id)).stock).toBe(50);
  });

  it('posts a batch built by stock selection and reduces only the chosen quantities and serial units', async () => {
    const { product, customer } = await fixture();
    const tracked = await Product.create({ name: 'Tracked laptop', sku: 'SELECTED-2', stock: 3, purchasePrice: 500, sellingPrice: 1000,
      tracksSerials: true, serials: ['SELECT-1', 'SELECT-2', 'SELECT-3'].map(serial => ({ serial, status: 'in_stock' })) });
    const asPickerProduct = doc => ({ ...doc.toObject(), _id: String(doc._id) });
    const selected = addPosStockSelection([], [{ product: asPickerProduct(product), quantity: 450 }, { product: asPickerProduct(tracked), quantity: 2 }]);
    expect(selected.error).toBeNull();
    const response = await post({ customer: customer._id, bulkSellingTotal: 1000000.01, items: selected.cart });
    expect(response.status).toBe(201);
    expect(response.body.items.map(line => line.quantity)).toEqual([450, 2]);
    expect(response.body.items[1].serials).toEqual(['SELECT-1', 'SELECT-2']);
    expect((await Product.findById(product._id)).stock).toBe(50);
    expect((await Product.findById(tracked._id)).stock).toBe(1);
    expect((await Product.findById(tracked._id)).serials.map(unit => unit.status)).toEqual(['sold', 'sold', 'in_stock']);
    expect(await StockMovement.countDocuments({ type: 'sale' })).toBe(2);
    expect((await Customer.findById(customer._id)).balance).toBe(1000000.01);
    const report = { json(body) { this.body = body; } };
    await profitAndLoss({ query: {} }, report);
    expect(report.body.cost).toBe(451000);
    expect(report.body.revenue).toBe(1000000.01);
  });

  it('rejects a selected batch if stock or a selected serial became unavailable before saving', async () => {
    const { product, customer } = await fixture();
    const pickerProduct = { ...product.toObject(), _id: String(product._id) };
    const selected = addPosStockSelection([], [{ product: pickerProduct, quantity: 450 }]);
    await Product.updateOne({ _id: product._id }, { $set: { stock: 400 } });
    expect((await post({ customer: customer._id, bulkSellingTotal: 1000000, items: selected.cart })).status).toBe(400);
    expect((await Product.findById(product._id)).stock).toBe(400);
    const tracked = await Product.create({ name: 'Tracked', sku: 'STALE-SERIAL', stock: 2, tracksSerials: true,
      serials: [{ serial: 'STALE-1', status: 'in_stock' }, { serial: 'STALE-2', status: 'in_stock' }] });
    const trackedSelection = addPosStockSelection([], [{ product: { ...tracked.toObject(), _id: String(tracked._id) }, quantity: 2 }]);
    await Product.updateOne({ _id: tracked._id }, { $set: { 'serials.0.status': 'sold' } });
    expect((await post({ customer: customer._id, bulkSellingTotal: 100, items: trackedSelection.cart })).status).toBe(400);
    expect(await Invoice.countDocuments()).toBe(0);
    expect(await StockMovement.countDocuments()).toBe(0);
    expect((await Customer.findById(customer._id)).balance).toBe(0);
    expect((await Product.findById(tracked._id)).stock).toBe(2);
  });
});
