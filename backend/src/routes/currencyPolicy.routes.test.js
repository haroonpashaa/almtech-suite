import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import accounts from './account.routes.js';
import purchases from './purchaseOrder.routes.js';
import invoices from './invoice.routes.js';
import expenses from './expense.routes.js';
import quotations from './quotation.routes.js';
import { errorHandler } from '../middleware/error.js';
import User from '../models/User.js';
import Account from '../models/Account.js';
import Supplier from '../models/Supplier.js';
import Product from '../models/Product.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import OpeningBalance from '../models/OpeningBalance.js';
import { IMPORTERS, ACTIONS } from '../services/importers.js';
import { postTransaction } from '../utils/ledger.js';

let memory, server, base, token, user;
const originalSecret = process.env.JWT_SECRET;
beforeAll(async () => {
  process.env.JWT_SECRET = 'isolated-currency-policy-test';
  memory = await MongoMemoryServer.create(); await mongoose.connect(memory.getUri());
  user = await User.create({ name: 'Admin', email: 'currency@example.test', password: 'test-only-password', role: 'admin' });
  token = jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion }, process.env.JWT_SECRET);
  const app = express(); app.use(express.json());
  for (const [path, routes] of Object.entries({ accounts, 'purchase-orders': purchases, invoices, expenses, quotations })) app.use('/' + path, routes);
  app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 120000);
afterEach(async () => { for (const Model of [Account, Supplier, Product, PurchaseOrder, FinancialTransaction, OpeningBalance]) await Model.deleteMany({}); });
afterAll(async () => {
  await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await memory.stop();
  if (originalSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = originalSecret;
});
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
it.each(['GBP', 'USD', '', null])('rejects unsupported new account currency %s through the API', async currency => {
  const result = await request('/accounts', 'POST', { name: 'New account', type: 'bank', currency, openingBalance: 500 });
  expect(result.status).toBe(400); expect(result.body.message).toMatch(/Only PKR/);
  expect(await Account.countDocuments()).toBe(0);
});
it('defaults new accounts to PKR and preserves normal corrections', async () => {
  const result = await request('/accounts', 'POST', { name: 'Cash', type: 'cash', openingBalance: 500 });
  expect(result.status).toBe(201); expect(result.body.currency).toBe('PKR');
  const updated = await request('/accounts/' + result.body._id, 'PATCH', { openingBalance: 600 });
  expect(updated.status).toBe(200); expect(updated.body.currentBalance).toBe(600);
});
it('allows historical account metadata edits but prevents balance changes and relabelling', async () => {
  const account = await Account.create({ name: 'Historical', type: 'bank', currency: 'GBP', openingBalance: 10, currentBalance: 10 });
  expect((await request('/accounts/' + account._id, 'PATCH', { name: 'Renamed' })).status).toBe(200);
  for (const patch of [{ currency: 'PKR' }, { openingBalance: 20 }]) expect((await request('/accounts/' + account._id, 'PATCH', patch)).status).toBe(400);
  expect((await Account.findById(account._id)).toObject()).toMatchObject({ name: 'Renamed', currency: 'GBP', openingBalance: 10, currentBalance: 10 });
});
it('blocks new GBP account ledger postings without changing balances', async () => {
  const account = await Account.create({ name: 'Historical', type: 'bank', currency: 'GBP', currentBalance: 10 });
  expect((await request(`/accounts/${account._id}/adjustments`, 'POST', { amount: 5, direction: 'in', reason: 'Adjustment' })).status).toBe(400);
  expect(await FinancialTransaction.countDocuments()).toBe(0); expect((await Account.findById(account._id)).currentBalance).toBe(10);
});
it.each(['invoices', 'expenses', 'quotations'])('rejects explicitly supplied GBP on new %s instead of treating it as PKR', async path => {
  const result = await request('/' + path, 'POST', { currency: 'GBP' });
  expect(result.status).toBe(400); expect(result.body.message).toMatch(/Only PKR/);
});
it('creates PKR POs without FX and returns models without changing references or costs', async () => {
  const supplier = await Supplier.create({ name: 'Supplier' });
  const product = await Product.create({ name: 'Laptop', model: 'ThinkPad T14', sku: 'SN-1', purchasePrice: 17 });
  const result = await request('/purchase-orders', 'POST', { supplier: String(supplier._id), items: [{ product: String(product._id), quantity: 2, unitCost: 25 }], taxRate: 10 });
  expect(result.status).toBe(201); expect(result.body).toMatchObject({ currency: 'PKR', total: 55, fxSnapshots: [] });
  const detail = await request('/purchase-orders/' + result.body._id);
  expect(detail.status).toBe(200); expect(detail.body.items[0]).toMatchObject({ product: String(product._id), model: 'ThinkPad T14', sku: 'SN-1', unitCost: 25, quantity: 2 });
  expect((await Supplier.findById(supplier._id)).payable).toBe(55); expect((await Product.findById(product._id)).purchasePrice).toBe(17);
});
it('blocks GBP opening-balance imports, including stale previews', async () => {
  const account = await Account.create({ name: 'Historical', type: 'bank', currency: 'GBP', currentBalance: 10 });
  const importer = IMPORTERS['opening-balances'];
  const rows = await importer.prepare([{ name: account.name, type: 'Account', amount: 99, reference: 'NEW' }]);
  expect(rows[0].action).toBe(ACTIONS.ERROR);
  const result = await importer.commit([{ action: ACTIONS.CREATE, data: { entityType: 'account', entity: account._id, entityName: account.name, amount: 99 } }], { user, batchId: new mongoose.Types.ObjectId() });
  expect(result.failed).toBe(1); expect(await OpeningBalance.countDocuments()).toBe(0); expect((await Account.findById(account._id)).currentBalance).toBe(10);
});
it('permits exact historical reversals but rejects new or mismatched GBP ledger legs', async () => {
  const account = await Account.create({ name: 'Historical', type: 'bank', currency: 'GBP', currentBalance: 90 });
  const original = await FinancialTransaction.create({ account: account._id, currency: 'GBP', amount: 10, direction: 'out', type: 'supplier_payment' });
  const entry = { account: account._id, currency: 'GBP', amount: 10, direction: 'in', type: 'payment_reversal', reversalOf: original._id };
  await expect(postTransaction({ ...entry, amount: 11 })).rejects.toMatchObject({ statusCode: 400 });
  await expect(postTransaction({ ...entry, type: 'ledger_adjustment' })).rejects.toMatchObject({ statusCode: 400 });
  const reversal = await postTransaction(entry);
  expect(reversal.currency).toBe('GBP'); expect((await Account.findById(account._id)).currentBalance).toBe(100);
  expect((await FinancialTransaction.findById(original._id)).amount).toBe(10);
});


it.each(['/accounts/000000000000000000000001/adjustments', '/accounts/transfers', '/invoices/000000000000000000000001/payments', '/purchase-orders/000000000000000000000001/payments'])('rejects explicit GBP at %s before any write or reinterpretation as PKR', async path => {
  const result = await request(path, 'POST', { currency: 'GBP', amount: 10 });
  expect(result.status).toBe(400); expect(result.body.message).toMatch(/Only PKR/);
  expect(await FinancialTransaction.countDocuments()).toBe(0);
});
