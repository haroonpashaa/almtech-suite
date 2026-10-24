import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import productRoutes from './product.routes.js';
import invoiceRoutes from './invoice.routes.js';
import purchaseRoutes from './purchaseOrder.routes.js';
import reportRoutes from './report.routes.js';
import { errorHandler } from '../middleware/error.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import StockMovement from '../models/StockMovement.js';
import Settings from '../models/Settings.js';
import Activity from '../models/Activity.js';
import Account from '../models/Account.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import Deal from '../models/Deal.js';

let memory, server, base;
const tokens = {}, oldSecret = process.env.JWT_SECRET;
beforeAll(async () => {
  process.env.JWT_SECRET = 'isolated-inventory-lifecycle-test';
  memory = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(memory.getUri());
  await Promise.all([Product.init(), Invoice.init(), PurchaseOrder.init(), Deal.init()]);
  for (const role of ['admin', 'sales', 'stock']) {
    const user = await User.create({ name: role, email: `${role}@inventory.test`, password: 'isolated-test-password', role });
    tokens[role] = jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion }, process.env.JWT_SECRET);
  }
  const app = express(); app.use(express.json());
  app.use('/products', productRoutes); app.use('/invoices', invoiceRoutes); app.use('/purchase-orders', purchaseRoutes); app.use('/reports', reportRoutes); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 120000);
afterEach(async () => {
  vi.restoreAllMocks();
  for (const Model of [Product, Customer, Supplier, Invoice, PurchaseOrder, StockMovement, Settings, Activity, Account, FinancialTransaction, Deal]) await Model.deleteMany({});
});
afterAll(async () => {
  await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await memory.stop();
  if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
});
async function request(path, method = 'GET', body, role = 'admin') {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function fixture(quantity = 6) {
  const product = await Product.create({ name: 'Laptop', model: 'ThinkPad T14', sku: 'UNIQUE-LAPTOP', stock: 0, lowStockThreshold: 5, purchasePrice: 10, sellingPrice: 150 });
  const supplier = await Supplier.create({ name: 'Supplier' });
  const customer = await Customer.create({ name: 'Buyer' });
  const result = await request('/purchase-orders', 'POST', { supplier: supplier._id, items: [{ product: product._id, quantity, unitCost: 100 }] });
  expect(result.status).toBe(201);
  return { product, supplier, customer, po: result.body };
}
const receive = async (ctx, quantity) => {
  const latest = await PurchaseOrder.findById(ctx.po._id);
  return request(`/purchase-orders/${ctx.po._id}/receive`, 'POST', { receipts: [{ product: String(ctx.product._id), quantity }], expectedUpdatedAt: latest.updatedAt.toISOString(), expectedVersion: latest.__v });
};
const sell = (ctx, quantity, role = 'admin') => request('/invoices', 'POST', { idempotencyKey: new mongoose.Types.ObjectId().toString(), customer: ctx.customer._id, items: [{ product: ctx.product._id, quantity, unitPrice: 150 }] }, role);
it('receives partially, caps repeated full receiving, then sells the same product and updates Low Stock at the exact threshold', async () => {
  const ctx = await fixture();
  expect((await request(`/products/${ctx.product._id}`)).body.stock).toBe(0);
  expect((await request('/products?lowStock=true')).body.items.map(p => p._id)).toContain(String(ctx.product._id));
  expect((await receive(ctx, 2)).body.status).toBe('partial');
  expect((await Product.findById(ctx.product._id)).stock).toBe(2);
  expect((await receive(ctx, 6)).body.status).toBe('received');
  expect((await receive(ctx, 6)).status).toBe(200);
  expect((await Product.findById(ctx.product._id)).stock).toBe(6);
  expect((await request('/products?lowStock=true')).body.items).toHaveLength(0);
  const sale = await sell(ctx, 1);
  expect(sale.status).toBe(201); expect(sale.body.total).toBe(150); expect(sale.body.items[0].unitCost).toBe(100);
  expect((await request(`/products/${ctx.product._id}`)).body.stock).toBe(5);
  expect((await request('/products?lowStock=true')).body.items.map(p => p._id)).toContain(String(ctx.product._id));
  expect((await request('/reports/dashboard')).body.lowStock.map(p => p._id)).toContain(String(ctx.product._id));
  expect((await Customer.findById(ctx.customer._id)).balance).toBe(150);
  expect((await Supplier.findById(ctx.supplier._id)).payable).toBe(600);
  const movements = await StockMovement.find({ product: ctx.product._id });
  expect(movements.reduce((sum, movement) => sum + movement.quantity, 0)).toBe(5);
  const report = await request('/reports/profit-loss');
  expect(report.body).toMatchObject({ revenue: 150, cost: 100, grossProfit: 50 });
});
it.each([0, -1, 1.5, 'invalid', 3])('rejects invalid or insufficient sale quantity %s without stock or financial writes', async quantity => {
  const ctx = await fixture(2); await receive(ctx, 2);
  const result = await sell(ctx, quantity);
  expect(result.status).toBe(400);
  expect((await Product.findById(ctx.product._id)).stock).toBe(2);
  expect(await Invoice.countDocuments()).toBe(0);
  expect(await StockMovement.countDocuments({ type: 'sale' })).toBe(0);
  expect((await Customer.findById(ctx.customer._id)).balance).toBe(0);
});
it('allows only one competing sale of the same remaining stock', async () => {
  const ctx = await fixture(2); await receive(ctx, 2);
  const results = await Promise.all([sell(ctx, 2), sell(ctx, 2)]);
  expect(results.map(result => result.status).sort()).toEqual([201, 400]);
  expect((await Product.findById(ctx.product._id)).stock).toBe(0);
  expect(await Invoice.countDocuments()).toBe(1);
  expect(await StockMovement.countDocuments({ type: 'sale' })).toBe(1);
  expect((await Customer.findById(ctx.customer._id)).balance).toBe(300);
});
it('does not grant the Stock role permission to sell', async () => {
  const ctx = await fixture(2); await receive(ctx, 2);
  expect((await sell(ctx, 1, 'stock')).status).toBe(403);
  expect((await Product.findById(ctx.product._id)).stock).toBe(2);
});
it.each(['draft', 'cancelled'])('does not receive a %s PO into available stock', async status => {
  const ctx = await fixture(2); await PurchaseOrder.updateOne({ _id: ctx.po._id }, { $set: { status } });
  expect((await receive(ctx, 1)).status).toBe(409);
  expect((await Product.findById(ctx.product._id)).stock).toBe(0);
  expect((await PurchaseOrder.findById(ctx.po._id)).items[0].received).toBe(0);
});
it('refuses a missing inventory product without marking it received', async () => {
  const ctx = await fixture(2); await Product.deleteOne({ _id: ctx.product._id });
  expect((await receive(ctx, 1)).status).toBe(400);
  expect((await PurchaseOrder.findById(ctx.po._id)).items[0].received).toBe(0);
  expect(await StockMovement.countDocuments()).toBe(0);
});
it('rolls back receiving quantities, costs, stock and movements when a write fails', async () => {
  const ctx = await fixture(2);
  vi.spyOn(StockMovement, 'create').mockRejectedValueOnce(new Error('Isolated receipt write failure'));
  expect((await receive(ctx, 1)).status).toBe(500);
  expect((await PurchaseOrder.findById(ctx.po._id)).items[0].received).toBe(0);
  expect((await Product.findById(ctx.product._id)).toObject()).toMatchObject({ stock: 0, purchasePrice: 10 });
  expect(await StockMovement.countDocuments()).toBe(0);
});
it('sells 26 distinct selected laptops linked to a deal at an exact batch total, with one stock deduction per product', async () => {
  const customer = await Customer.create({ name: 'Bulk buyer' }); const deal = await Deal.create({ identifier: 'BULK-26' });
  const products = await Product.create(Array.from({ length: 26 }, (_, i) => ({ name: `Laptop ${i}`, model: 'EliteBook', sku: `SERIAL-${i}`, stock: 1, purchasePrice: 100 })));
  const response = await request('/invoices', 'POST', { idempotencyKey: 'bulk-26-laptops', customer: customer._id, dealId: deal._id, bulkSellingTotal: 1000000, items: products.map(p => ({ product: p._id, quantity: 1 })) });
  expect(response.status).toBe(201); expect(response.body.items).toHaveLength(26);
  expect(response.body.items.reduce((sum, line) => sum + Math.round(line.lineTotal * 100), 0)).toBe(100000000);
  expect(await Product.countDocuments({ stock: 0 })).toBe(26);
  expect(await StockMovement.countDocuments({ type: 'sale' })).toBe(26);
  expect(await Invoice.countDocuments()).toBe(1);
  expect((await Customer.findById(customer._id)).balance).toBe(1000000);
});


it('rejects a retried partial receipt with the same observed PO version instead of adding stock twice', async () => {
  const ctx = await fixture(6);
  const body = { receipts: [{ product: String(ctx.product._id), quantity: 2 }], expectedUpdatedAt: ctx.po.updatedAt, expectedVersion: ctx.po.__v };
  expect((await request(`/purchase-orders/${ctx.po._id}/receive`, 'POST', body)).status).toBe(200);
  expect((await request(`/purchase-orders/${ctx.po._id}/receive`, 'POST', body)).status).toBe(409);
  expect((await Product.findById(ctx.product._id)).stock).toBe(2);
  expect((await PurchaseOrder.findById(ctx.po._id)).items[0].received).toBe(2);
  expect(await StockMovement.countDocuments()).toBe(1);
});


it('requires a receipt version and rejects a replay even if timestamps match', async () => {
  const ctx = await fixture(6);
  const receipts = [{ product: String(ctx.product._id), quantity: 1 }];
  expect((await request(`/purchase-orders/${ctx.po._id}/receive`, 'POST', { receipts })).status).toBe(400);
  const body = { receipts, expectedUpdatedAt: ctx.po.updatedAt, expectedVersion: ctx.po.__v };
  expect((await request(`/purchase-orders/${ctx.po._id}/receive`, 'POST', body)).status).toBe(200);
  await PurchaseOrder.updateOne({ _id: ctx.po._id }, { $set: { updatedAt: new Date(ctx.po.updatedAt) } }, { timestamps: false });
  expect((await request(`/purchase-orders/${ctx.po._id}/receive`, 'POST', body)).status).toBe(409);
  expect((await Product.findById(ctx.product._id)).stock).toBe(1);
});


it('rejects a receipt for a different product without changing the PO or stock', async () => {
  const ctx = await fixture(2);
  const result = await request(`/purchase-orders/${ctx.po._id}/receive`, 'POST', { receipts: [{ product: String(new mongoose.Types.ObjectId()), quantity: 1 }], expectedUpdatedAt: ctx.po.updatedAt, expectedVersion: ctx.po.__v });
  expect(result.status).toBe(400);
  expect((await Product.findById(ctx.product._id)).stock).toBe(0);
  expect((await PurchaseOrder.findById(ctx.po._id)).__v).toBe(0);
  expect(await StockMovement.countDocuments()).toBe(0);
});
