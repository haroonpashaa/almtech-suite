import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import routes from './finance.routes.js';
import { recordPayment } from '../controllers/invoice.controller.js';
import { recordSupplierPayment } from '../controllers/purchaseOrder.controller.js';
import { errorHandler } from '../middleware/error.js';
import User from '../models/User.js';
import Account from '../models/Account.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Product from '../models/Product.js';
import StockMovement from '../models/StockMovement.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import PartyEntry, { PartyEntryEvent } from '../models/PartyEntry.js';
import OpeningBalance from '../models/OpeningBalance.js';
import ReceivableAdjustment from '../models/ReceivableAdjustment.js';
import { customerLedger } from '../controllers/customer.controller.js';
import { supplierLedger, getSupplier } from '../controllers/supplier.controller.js';
import { recentPayments } from '../controllers/payment.controller.js';
import { dashboard } from '../controllers/report.controller.js';
import { customerStatementPDF, supplierStatementPDF } from '../controllers/document.controller.js';
import { buildStatement } from '../utils/pdf/index.js';
import { partyEntryLedgerEvents } from '../services/partyFinance.js';

vi.mock('../utils/pdf/index.js', async original => ({ ...(await original()), buildStatement: vi.fn() }));

let replica, server, base, key = 0;
const tokens = {}, users = {};
const oldSecret = process.env.JWT_SECRET;
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
beforeAll(async () => {
  process.env.JWT_SECRET = 'isolated-party-finance-tests-only';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replica.getUri());
  await Promise.all([PartyEntry.init(), PartyEntryEvent.init(), FinancialTransaction.init()]);
  for (const role of ['admin', 'sales', 'stock']) {
    const user = await User.create({ name: role, email: `${role}@example.test`, password: 'test-password', role });
    users[role] = user;
    tokens[role] = jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion }, process.env.JWT_SECRET);
  }
  const app = express(); app.use(express.json()); app.use('/finance', routes); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/finance`;
}, 120000);
afterEach(async () => {
  vi.restoreAllMocks();
  for (const model of [PartyEntry, PartyEntryEvent, FinancialTransaction, Account, Customer, Supplier, Invoice, PurchaseOrder, Product, StockMovement, OpeningBalance, ReceivableAdjustment]) await model.deleteMany({});
});
afterAll(async () => { await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await replica.stop(); if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
async function request(path, method = 'GET', body, role = 'admin') {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() };
}
const action = extra => ({ reason: 'Reconciled against supporting records', idempotencyKey: `test-action-${++key}`, ...extra });
const editFields = (total = 100) => ({ total, date: '2026-10-20', description: 'Standalone obligation', reference: 'STATEMENT-1' });
async function setup(category, currency = 'PKR') {
  const Model = category === 'receivables' ? Customer : Supplier;
  const party = await Model.create({ name: 'Synthetic finance party' });
  const account = await Account.create({ name: 'Synthetic account', currency, type: 'bank', openingBalance: 1000, currentBalance: 1000 });
  const path = `/${category}/${party._id}`;
  const created = await request(path + '/entries', 'POST', action({ ...editFields(), currency }));
  expect(created.status).toBe(201);
  return { party, account, path, entry: created.body.entry, Model, field: category === 'receivables' ? 'balance' : currency === 'GBP' ? 'payableGBP' : 'payable' };
}
async function pay(ctx, amount = 40, extras = {}) {
  return request(`${ctx.path}/entries/${ctx.entry._id}/payments`, 'POST', action({ amount, date: '2026-10-21', account: String(ctx.account._id), method: 'bank', reference: 'PAY-1', expectedVersion: ctx.entry.version, ...extras }));
}

describe.each(['receivables', 'payables'])('Admin standalone %s: HTTP regression and smoke checks', category => {
  it('adds and corrects an obligation without changing stock, invoices or POs', async () => {
    const ctx = await setup(category);
    expect((await ctx.Model.findById(ctx.party._id))[ctx.field]).toBe(100);
    const change = await request(`${ctx.path}/entries/${ctx.entry._id}`, 'PATCH', action({ ...editFields(125.01), expectedVersion: 0 }));
    expect(change.status).toBe(200);
    expect(change.body.entry).toMatchObject({ total: 125.01, paid: 0, balance: 125.01, version: 1 });
    expect((await ctx.Model.findById(ctx.party._id))[ctx.field]).toBe(125.01);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
    expect(await Invoice.countDocuments()).toBe(0); expect(await PurchaseOrder.countDocuments()).toBe(0); expect(await StockMovement.countDocuments()).toBe(0);
    const events = await PartyEntryEvent.find().sort('createdAt');
    expect(events.map(e => e.action)).toEqual(['created', 'corrected']);
    expect(events[1].before.total).toBe(100); expect(events[1].after.total).toBe(125.01);
    expect(String(events[1].createdBy)).toBe(String(users.admin._id));
  });
  it('posts and reverses payment atomically; totals, open count, position and account ledger reconcile', async () => {
    const ctx = await setup(category);
    const payment = await pay(ctx, 100);
    expect(payment.status).toBe(201);
    expect(payment.body.entry).toMatchObject({ total: 100, paid: 100, balance: 0, version: 1 });
    expect((await Account.findById(ctx.account._id)).currentBalance).toBe(category === 'receivables' ? 1100 : 900);
    let detail = await request(ctx.path);
    expect(detail.body).toMatchObject({ total: 100, paid: 100, outstanding: 0, reconciled: true, entryTotals: { openCount: 0 } });
    const tx = payment.body.entry.payments[0].transaction;
    const reversal = await request(`${ctx.path}/entries/${ctx.entry._id}/payments/${tx}/reverse`, 'POST', action({ expectedVersion: 1 }));
    expect(reversal.status).toBe(200);
    expect(reversal.body.entry).toMatchObject({ paid: 0, balance: 100, version: 2 });
    expect(reversal.body.entry.payments[0].reversed).toBe(true);
    expect((await Account.findById(ctx.account._id)).currentBalance).toBe(1000);
    detail = await request(ctx.path);
    expect(detail.body.entryTotals.openCount).toBe(1);
    expect(detail.body.reconciled).toBe(true);
    const position = await request('/position');
    expect(position.body.reconciled).toBe(true);
    expect(position.body[category]).toBe(100);
    const res = response();
    await dashboard({ user: { role: 'admin' } }, res);
    expect(res.body[category]).toBe(100);
    const ledger = response();
    if (category === 'receivables') await customerLedger({ params: { id: String(ctx.party._id) }, user: { role: 'admin' } }, ledger);
    else await supplierLedger({ params: { id: String(ctx.party._id) }, query: {} }, ledger);
    expect(ledger.body.closingBalance).toBe(100);
    const statement = await partyEntryLedgerEvents(category === 'receivables' ? 'customer' : 'supplier', ctx.party._id);
    expect(statement.reduce((sum, row) => sum + row.credit - row.debit, 0)).toBe(100);
    const history = response(); await recentPayments({ query: {} }, history);
    expect(history.body).toHaveLength(2);
    expect(history.body.every(p => p.partyEntryId)).toBe(true);
  });
  it('recalculates a mixed document/standalone account through full settlement and leaves inventory intact', async () => {
    const ctx = await setup(category);
    const product = await Product.create({ name: 'Unchanged stock', sku: 'STOCK-UNCHANGED', purchasePrice: 123, stock: 1, tracksSerials: true, serials: [{ serial: 'UNCHANGED-SN', status: 'in_stock' }] });
    const before = product.toObject();
    const document = category === 'receivables'
      ? await Invoice.create({ number: 'INV-MIXED', customer: ctx.party._id, items: [], subtotal: 500, total: 500, paid: 0, balance: 500, status: 'open' })
      : await PurchaseOrder.create({ number: 'PO-MIXED', supplier: ctx.party._id, items: [], subtotal: 500, total: 500, paid: 0, balance: 500, status: 'ordered', currency: 'PKR' });
    await ctx.Model.updateOne({ _id: ctx.party._id }, { $inc: { [ctx.field]: 500 } });
    expect((await pay(ctx, 100)).status).toBe(201);
    let detail = await request(ctx.path);
    expect(detail.body).toMatchObject({ total: 600, paid: 100, outstanding: 500, reconciled: true, entryTotals: { openCount: 0 } });
    expect((category === 'receivables' ? detail.body.invoices : detail.body.purchaseOrders)).toHaveLength(1);
    const res = response();
    const controller = category === 'receivables' ? recordPayment : recordSupplierPayment;
    await controller({ params: { id: String(document._id) }, user: users.admin, body: { amount: 500, method: 'bank', account: String(ctx.account._id), idempotencyKey: 'mixed-document-payment' } }, res);
    detail = await request(ctx.path);
    expect(detail.body).toMatchObject({ total: 600, paid: 600, outstanding: 0, reconciled: true });
    expect((category === 'receivables' ? detail.body.invoices : detail.body.purchaseOrders)).toHaveLength(0);
    expect((await ctx.Model.findById(ctx.party._id))[ctx.field]).toBe(0);
    expect((await Product.findById(product._id)).toObject()).toEqual(before);
    expect(await StockMovement.countDocuments()).toBe(0);
    const statementController = category === 'receivables' ? customerStatementPDF : supplierStatementPDF;
    await statementController({ params: { id: String(ctx.party._id) }, query: {}, user: users.admin }, response());
    const statement = vi.mocked(buildStatement).mock.calls.at(-1)[0];
    expect(statement.entries.reduce((sum, row) => sum + row.credit - row.debit, 0)).toBe(0);
    expect(statement.entries.at(-1).balance).toBe(0);
    expect(statement.entries.some(row => row.type === 'standalone_payment')).toBe(true);
  });
  it('rejects document payment after a legacy correction has already reduced the party balance to zero', async () => {
    const ctx = await setup(category);
    const document = category === 'receivables'
      ? await Invoice.create({ number: 'INV-LEGACY', customer: ctx.party._id, items: [], subtotal: 100, total: 100, paid: 0, balance: 100, status: 'open' })
      : await PurchaseOrder.create({ number: 'PO-LEGACY', supplier: ctx.party._id, items: [], subtotal: 100, total: 100, paid: 0, balance: 100, status: 'ordered', currency: 'PKR' });
    if (category === 'receivables') await ReceivableAdjustment.create({ customer: ctx.party._id, currency: 'PKR', amount: 200, delta: -200, direction: 'decrease', balanceBefore: 200, balanceAfter: 0, reason: 'Legacy correction', idempotencyKey: 'legacy-correction', createdBy: users.admin._id });
    else await OpeningBalance.create({ entityType: 'supplier', entity: ctx.party._id, currency: 'PKR', amount: -200, reference: 'legacy-correction' });
    await ctx.Model.updateOne({ _id: ctx.party._id }, { [ctx.field]: 0 });
    expect((await request(ctx.path)).body).toMatchObject({ outstanding: 0, reconciled: true });
    const controller = category === 'receivables' ? recordPayment : recordSupplierPayment;
    await expect(controller({ params: { id: String(document._id) }, user: users.admin, body: { amount: 100, method: 'bank', account: String(ctx.account._id), idempotencyKey: 'legacy-document-payment' } }, response())).rejects.toMatchObject({ statusCode: 409 });
    expect((await Account.findById(ctx.account._id)).currentBalance).toBe(1000);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
    const Model = category === 'receivables' ? Invoice : PurchaseOrder;
    expect((await Model.findById(document._id)).paid).toBe(0);
  });
  it('supports partial payments and corrections above paid; refuses a total below paid or voiding a paid entry', async () => {
    const ctx = await setup(category);
    expect((await pay(ctx)).status).toBe(201);
    const below = await request(`${ctx.path}/entries/${ctx.entry._id}`, 'PATCH', action({ ...editFields(30), expectedVersion: 1 }));
    expect(below.status).toBe(409);
    const noVoid = await request(`${ctx.path}/entries/${ctx.entry._id}/void`, 'POST', action({ expectedVersion: 1 }));
    expect(noVoid.status).toBe(409);
    const valid = await request(`${ctx.path}/entries/${ctx.entry._id}`, 'PATCH', action({ ...editFields(120), expectedVersion: 1 }));
    expect(valid.body.entry).toMatchObject({ total: 120, paid: 40, balance: 80 });
    expect((await ctx.Model.findById(ctx.party._id))[ctx.field]).toBe(80);
  });
  it('voids an unpaid entry without removing its history or allowing edits afterwards', async () => {
    const ctx = await setup(category);
    const r = await request(`${ctx.path}/entries/${ctx.entry._id}/void`, 'POST', action({ expectedVersion: 0 }));
    expect(r.status).toBe(200);
    expect(r.body.entry).toMatchObject({ status: 'void', total: 100, balance: 0 });
    expect((await request(ctx.path)).body).toMatchObject({ total: 0, paid: 0, outstanding: 0, entryTotals: { openCount: 0 } });
    const stale = await request(`${ctx.path}/entries/${ctx.entry._id}`, 'PATCH', action({ ...editFields(), expectedVersion: 1 }));
    expect(stale.status).toBe(409);
    expect(await PartyEntryEvent.countDocuments()).toBe(2);
  });
  it('rejects duplicate creates, stale edits, duplicate reversals and cross-party entry access', async () => {
    const ctx = await setup(category);
    const body = action({ ...editFields(10) });
    expect((await request(ctx.path + '/entries', 'POST', body)).status).toBe(201);
    expect((await request(ctx.path + '/entries', 'POST', body)).status).toBe(409);
    const payment = await pay(ctx);
    expect((await pay(ctx)).status).toBe(409);
    const other = await ctx.Model.create({ name: 'Other party' });
    expect((await request(`/${category}/${other._id}/entries/${ctx.entry._id}`, 'PATCH', action({ ...editFields(), expectedVersion: 1 }))).status).toBe(404);
    const tx = payment.body.entry.payments[0].transaction;
    expect((await request(`${ctx.path}/entries/${ctx.entry._id}/payments/${tx}/reverse`, 'POST', action({ expectedVersion: 1 }))).status).toBe(200);
    expect((await request(`${ctx.path}/entries/${ctx.entry._id}/payments/${tx}/reverse`, 'POST', action({ expectedVersion: 2 }))).status).toBe(409);
    expect((await ctx.Model.findById(ctx.party._id))[ctx.field]).toBe(110);
  });
  it('keeps search, date, status and aging filters correct without inflating document counts', async () => {
    const ctx = await setup(category);
    const list = await request(`/${category}?from=2026-10-20&to=2026-10-20&q=Synthetic`);
    expect(list.body.rows).toHaveLength(1);
    expect(list.body.rows[0]).toMatchObject({ outstanding: 100, manualEntryCount: 1, [category === 'receivables' ? 'invoiceCount' : 'poCount']: 0 });
    expect(Object.values(list.body.aging).reduce((sum, n) => sum + n, 0)).toBe(100);
    expect((await request(`/${category}?from=2026-10-21`)).body.totalOutstanding).toBe(0);
    expect((await request(`/${category}?q=Unmatched`)).body.rows).toHaveLength(0);
    expect((await pay(ctx, 40)).status).toBe(201);
    expect((await request(`/${category}?status=partial`)).body.rows[0]).toMatchObject({ outstanding: 60, paid: 40 });
  });
  it('allows only one concurrent payment to claim an entry version', async () => {
    const ctx = await setup(category);
    const results = await Promise.all([pay(ctx, 60), pay(ctx, 60)]);
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect((await ctx.Model.findById(ctx.party._id))[ctx.field]).toBe(40);
    expect(await FinancialTransaction.countDocuments()).toBe(1);
  });
  it('preserves both valid payments when different entries of one party are paid concurrently', async () => {
    const ctx = await setup(category);
    const second = await request(ctx.path + '/entries', 'POST', action(editFields()));
    const results = await Promise.all([pay(ctx, 60), pay({ ...ctx, entry: second.body.entry }, 60)]);
    expect(results.map(r => r.status)).toEqual([201, 201]);
    expect((await ctx.Model.findById(ctx.party._id))[ctx.field]).toBe(80);
    expect(await FinancialTransaction.countDocuments()).toBe(2);
    const detail = await request(ctx.path); expect(detail.body).toMatchObject({ paid: 120, outstanding: 80, reconciled: true });
  });
  it('refuses to push a legacy-corrected party below zero and rolls account movement back', async () => {
    const ctx = await setup(category);
    await ctx.Model.updateOne({ _id: ctx.party._id }, { [ctx.field]: 0 });
    expect((await pay(ctx, 40)).status).toBe(409);
    expect((await Account.findById(ctx.account._id)).currentBalance).toBe(1000);
    expect((await PartyEntry.findById(ctx.entry._id)).paid).toBe(0);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
  });
  it('aborts entry, party, payment and account changes if the immutable audit write fails', async () => {
    const ctx = await setup(category);
    vi.spyOn(PartyEntryEvent, 'create').mockRejectedValueOnce(new Error('Simulated audit failure'));
    expect((await pay(ctx)).status).toBe(500);
    expect((await Account.findById(ctx.account._id)).currentBalance).toBe(1000);
    expect((await ctx.Model.findById(ctx.party._id))[ctx.field]).toBe(100);
    expect((await PartyEntry.findById(ctx.entry._id)).paid).toBe(0);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
    expect(await PartyEntryEvent.countDocuments()).toBe(1);
  });
  it('rejects excessive, inactive-account and wrong-currency payments without changing balances', async () => {
    const ctx = await setup(category);
    expect((await pay(ctx, 100.01)).status).toBe(400);
    await Account.updateOne({ _id: ctx.account._id }, { currency: 'GBP' });
    expect((await pay(ctx)).status).toBe(400);
    await Account.updateOne({ _id: ctx.account._id }, { currency: 'PKR', active: false });
    expect((await pay(ctx)).status).toBe(400);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
    expect((await ctx.Model.findById(ctx.party._id))[ctx.field]).toBe(100);
  });
  it.each(['sales', 'stock', null])('blocks %s from every write route', async role => {
    const ctx = await setup(category);
    for (const [suffix, method, body] of [
      ['/entries', 'POST', action(editFields())],
      [`/entries/${ctx.entry._id}`, 'PATCH', action({ ...editFields(), expectedVersion: 0 })],
      [`/entries/${ctx.entry._id}/void`, 'POST', action({ expectedVersion: 0 })],
      [`/entries/${ctx.entry._id}/payments`, 'POST', action({ expectedVersion: 0 })],
      [`/entries/${ctx.entry._id}/payments/${new mongoose.Types.ObjectId()}/reverse`, 'POST', action({ expectedVersion: 0 })],
    ]) expect((await request(ctx.path + suffix, method, body, role)).status).toBe(role ? 403 : 401);
    expect(await PartyEntry.countDocuments()).toBe(1);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
  });
  it.each(['', -1, 0, 1.001, true, 'not-money'])('rejects malformed total %s and unknown protected fields', async total => {
    const ctx = await setup(category);
    expect((await request(ctx.path + '/entries', 'POST', action({ ...editFields(total) }))).status).toBe(400);
    expect((await request(ctx.path + '/entries', 'POST', action({ ...editFields(), paid: 100, balance: 0 }))).status).toBe(400);
    expect(await PartyEntry.countDocuments()).toBe(1);
  });
});

it('keeps GBP supplier obligations and payments separate from PKR', async () => {
  const ctx = await setup('payables', 'GBP');
  expect((await pay(ctx, 40)).status).toBe(201);
  const supplier = await Supplier.findById(ctx.party._id);
  expect(supplier.payableGBP).toBe(60); expect(supplier.payable).toBe(0);
  const position = await request('/position');
  expect(position.body.payablesByCurrency).toEqual({ PKR: 0, GBP: 60 });
  expect(position.body.reconciled).toBe(true);
  const profile = response(); await getSupplier({ params: { id: String(supplier._id) }, query: { currency: 'GBP' } }, profile);
  expect(profile.body.summary).toMatchObject({ outstanding: 60, reconciled: true, standalone: { paid: 40 } });
});
it('refuses GBP customer entries and malformed dates', async () => {
  const ctx = await setup('receivables');
  expect((await request(ctx.path + '/entries', 'POST', action({ ...editFields(), currency: 'GBP' }))).status).toBe(400);
  expect((await request(ctx.path + '/entries', 'POST', action({ ...editFields(), date: '2026-02-30' }))).status).toBe(400);
  expect(await PartyEntry.countDocuments()).toBe(1);
});
it('makes a customer with no invoices reachable without exposing Admin entry history to Sales', async () => {
  const blank = await Customer.create({ name: 'Empty customer' });
  const list = await request('/receivables');
  expect(list.body.rows.some(row => row.customerId === String(blank._id))).toBe(true);
  const ctx = await setup('receivables');
  const sales = await request(ctx.path, 'GET', undefined, 'sales');
  expect(sales.body.outstanding).toBe(100);
  expect(sales.body).not.toHaveProperty('manualEntries'); expect(sales.body).not.toHaveProperty('entryHistory');
});
