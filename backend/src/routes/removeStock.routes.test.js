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

async function product(extra = {}) { return Product.create({ name: 'Laptop', sku: 'REMOVE-1', stock: 3, purchasePrice: 100, ...extra }); }
const remove = (p, quantity = 1, extra = {}, role = 'admin') => request(`/products/${p._id}/remove-stock`, 'POST', { idempotencyKey: new mongoose.Types.ObjectId().toString(), quantity, reason: 'Damaged stock', ...extra }, role);
it.each(['sales', 'stock'])('rejects direct %s stock removal', async role => {
 const p = await product(); expect((await remove(p, 1, {}, role)).status).toBe(403);
 expect((await Product.findById(p._id)).stock).toBe(3); expect(await StockMovement.countDocuments()).toBe(0);
});
it('rejects unauthenticated stock removal', async () => {
 const p = await product(); const r = await fetch(base + `/products/${p._id}/remove-stock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({quantity:1,reason:'test'}) }); expect(r.status).toBe(401);
});
it.each([0,-1,1.5,'1',null,4])('rejects invalid/excess quantity %s without writes', async quantity => {
 const p = await product(); expect((await remove(p, quantity)).status).toBe(quantity===4 ? 409 : 400);
 expect((await Product.findById(p._id)).stock).toBe(3); expect(await StockMovement.countDocuments()).toBe(0);
});
it('requires a reason and records exact quantity, actor, timestamp and reason', async () => {
 const p = await product(); expect((await remove(p, 1, {reason:'  '})).status).toBe(400);
 expect((await remove(p, 2)).status).toBe(200);
 const saved = await Product.findById(p._id); expect(saved.stock).toBe(1); expect(saved.active).toBe(true); expect(saved.purchasePrice).toBe(100);
 const movement = await StockMovement.findOne(); expect(movement.quantity).toBe(-2); expect(movement.balanceAfter).toBe(1); expect(movement.createdBy).toBeTruthy(); expect(movement.createdAt).toBeInstanceOf(Date); expect(movement.note).toContain('Damaged stock');
 expect(await Activity.countDocuments({action:'stock_adjusted'})).toBe(1);
});
it('competing removals cannot make stock negative', async () => {
 const p = await product({stock:2}); const results = await Promise.all([remove(p,2),remove(p,2)]);
 expect(results.map(r=>r.status).sort()).toEqual([200,409]); expect((await Product.findById(p._id)).stock).toBe(0); expect(await StockMovement.countDocuments()).toBe(1);
});
it('requires exact unique available serials and preserves sold serials', async () => {
 const soldInvoice = new mongoose.Types.ObjectId();
 const p = await product({stock:2, tracksSerials:true,serials:[{serial:'A',status:'in_stock'},{serial:'B',status:'in_stock'},{serial:'SOLD',status:'sold',soldInvoice}]});
 for (const serials of [[],['A','A'],['SOLD'],['missing']]) expect((await remove(p,serials.length===2?2:1,{serials})).status).toBe(400);
 expect((await remove(p,1,{serials:['A']})).status).toBe(200);
 const saved = await Product.findById(p._id); expect(saved.stock).toBe(1); expect(saved.serials.map(s=>s.serial)).toEqual(['B','SOLD']); expect(saved.serials[1].soldInvoice).toEqual(soldInvoice);
 expect((await StockMovement.findOne()).note).toContain('A');
});
it('rolls back stock and serial removal if the movement write fails', async () => {
 const p = await product({tracksSerials:true, serials:[{serial:'A',status:'in_stock'}]});
 vi.spyOn(StockMovement,'create').mockRejectedValueOnce(new Error('isolated failure'));
 expect((await remove(p,1,{serials:['A']})).status).toBe(500);
 const saved=await Product.findById(p._id); expect(saved.stock).toBe(3); expect(saved.serials).toHaveLength(1); expect(await StockMovement.countDocuments()).toBe(0);
});
