import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import routes from './expense.routes.js';
import { errorHandler } from '../middleware/error.js';
import Account from '../models/Account.js';
import Expense from '../models/Expense.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import Activity from '../models/Activity.js';
import User from '../models/User.js';
import Deal from '../models/Deal.js';
import { EXPORTERS } from '../services/exporters.js';
import { profitAndLoss } from '../controllers/report.controller.js';

let memory, server, base;
const tokens = {};
const previousSecret = process.env.JWT_SECRET;
beforeAll(async () => {
  process.env.JWT_SECRET = 'expense-route-test-only-secret';
  memory = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(memory.getUri());
  await Expense.init();
  for (const role of ['admin', 'sales', 'stock']) {
    const user = await User.create({ name: role, email: `${role}@example.test`, password: 'test-password-123', role });
    tokens[role] = jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion }, process.env.JWT_SECRET);
  }
  const app = express();
  app.use(express.json());
  app.use('/expenses', routes);
  app.use(errorHandler);
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}/expenses`;
});
afterEach(async () => {
  await Promise.all([Expense, Account, FinancialTransaction, Activity, Deal].map(model => model.deleteMany({})));
});
afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  await memory?.stop();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

async function request(method, path = '', body, role = 'admin') {
  const response = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
const external = (overrides = {}) => ({ amount: 250, category: 'Fuel', paymentSource: 'other', reference: 'Paid from personal wallet', date: '2026-10-24', ...overrides });
const account = () => Account.create({ name: 'Cash', type: 'cash', openingBalance: 1000, currentBalance: 1000 });

describe('Other expense payment source (isolated replica set)', () => {
  it('records and audits an external expense without touching accounts or their ledgers', async () => {
    const cash = await account();
    const created = await request('POST', '', external());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ paymentSource: 'other', reference: 'Paid from personal wallet', amount: 250, currency: 'PKR', status: 'posted' });
    expect(created.body.account).toBeFalsy();
    expect(created.body.financialTransaction).toBeUndefined();
    expect((await Account.findById(cash._id)).currentBalance).toBe(1000);
    expect(await Account.countDocuments()).toBe(1);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
    expect(await Activity.findOne({ action: 'expense_created' })).toMatchObject({ meta: { account: 'Other', paymentSource: 'other' } });
    expect((await request('GET', `/${created.body._id}`)).body.reference).toBe('Paid from personal wallet');
  });

  it.each(['sales', 'stock', null])('rejects Other through direct API requests by %s', async role => {
    expect((await request('POST', '', external(), role)).status).toBe(role ? 403 : 401);
    expect(await Expense.countDocuments()).toBe(0);
  });

  it.each([
    { reference: '' }, { reference: '   ' }, { reference: null }, { reference: {} },
    { account: new mongoose.Types.ObjectId().toString() }, { paymentSource: 'unknown' },
    { amount: 0 }, { amount: -1 }, { date: 'invalid' }, { category: 'invalid' },
  ])('rejects invalid Other input %j without writes', async overrides => {
    expect((await request('POST', '', external(overrides))).status).toBe(400);
    expect(await Expense.countDocuments()).toBe(0);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
  });

  it('still requires a valid account for ordinary expenses and preserves Sales posting/reversal', async () => {
    const cash = await account();
    const input = { amount: 100, category: 'Fuel', reference: 'Receipt' };
    expect((await request('POST', '', input)).status).toBe(400);
    expect((await request('POST', '', { ...input, account: 'invalid' })).status).toBe(400);
    const created = await request('POST', '', { ...input, account: cash._id }, 'sales');
    expect(created.status).toBe(201);
    expect(created.body.paymentSource).toBe('account');
    expect((await Account.findById(cash._id)).currentBalance).toBe(900);
    expect(await FinancialTransaction.countDocuments()).toBe(1);
    expect((await request('POST', `/${created.body._id}/void`, { reason: 'Duplicate' })).status).toBe(200);
    expect((await Account.findById(cash._id)).currentBalance).toBe(1000);
    expect(await FinancialTransaction.countDocuments()).toBe(2);
  });

  it('includes Other in lists, daily/monthly totals, P&L and exports, with a separate filter', async () => {
    const cash = await account();
    await request('POST', '', external());
    await request('POST', '', { amount: 100, category: 'Fuel', account: cash._id, date: '2026-10-24' });
    expect((await request('GET')).body).toMatchObject({ total: 350, count: 2 });
    const filtered = await request('GET', '?account=other');
    expect(filtered.body).toMatchObject({ total: 250, count: 1 });
    expect(filtered.body.items[0].paymentSource).toBe('other');
    expect((await request('GET', `/daily?date=2026-10-24`)).body.total).toBe(350);
    const monthly = (await request('GET', '/monthly?month=2026-10')).body;
    expect(monthly.total).toBe(350);
    expect(monthly.byAccount).toEqual(expect.arrayContaining([{ account: 'Other', total: 250 }, { account: 'Cash', total: 100 }]));
    const pnl = { json(body) { this.body = body; } };
    await profitAndLoss({ query: { from: '2026-10-01', to: '2026-10-31' } }, pnl);
    expect(pnl.body.expenses).toBe(350);
    const exported = await EXPORTERS.expenses.build({ account: 'other' });
    expect(exported.rows).toHaveLength(1);
    expect(exported.columns.find(column => column.header === 'Account').value(exported.rows[0])).toBe('Other');
  });

  it('allows reference corrections but prevents clearing it or changing the payment source', async () => {
    const { body: created } = await request('POST', '', external());
    const path = `/${created._id}`;
    expect((await request('PATCH', path, { reference: 'Paid by Admin', description: 'Fuel receipt' })).status).toBe(200);
    expect((await request('PATCH', path, { reference: ' ' })).status).toBe(400);
    expect((await request('PATCH', path, { paymentSource: 'account' })).status).toBe(400);
    expect((await request('PATCH', path, { amount: 1 })).status).toBe(400);
    expect((await request('GET', path)).body.reference).toBe('Paid by Admin');
  });

  it('voids Other without crediting an account, preserves history and excludes it from totals', async () => {
    const cash = await account();
    const { body: created } = await request('POST', '', external());
    const path = `/${created._id}`;
    expect((await request('POST', `${path}/void`, { reason: 'Duplicate' }, 'sales')).status).toBe(403);
    const voided = await request('POST', `${path}/void`, { reason: 'Duplicate' });
    expect(voided.status).toBe(200);
    expect(voided.body).toMatchObject({ status: 'voided', voidReason: 'Duplicate', reference: created.reference });
    expect((await request('POST', `${path}/void`, {})).status).toBe(400);
    expect((await request('PATCH', path, { reference: 'Changed' })).status).toBe(400);
    expect((await request('GET')).body.total).toBe(0);
    expect((await request('GET', '?status=all')).body.count).toBe(1);
    expect((await Account.findById(cash._id)).currentBalance).toBe(1000);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
    expect(await Activity.countDocuments({ action: 'expense_voided' })).toBe(1);
  });

  it('rejects duplicate idempotency keys without creating a second external expense', async () => {
    const input = external({ idempotencyKey: 'external-expense-1' });
    expect((await request('POST', '', input)).status).toBe(201);
    expect((await request('POST', '', input)).status).toBe(409);
    expect(await Expense.countDocuments()).toBe(1);
  });

  it('retains validated deal linking for Other expenses', async () => {
    const deal = await Deal.create({ identifier: 'EXTERNAL-EXPENSE' });
    const created = await request('POST', '', external({ dealId: deal._id }));
    expect(created.status).toBe(201);
    expect(created.body.deal).toBe(String(deal._id));
    await Deal.updateOne({ _id: deal._id }, { $set: { status: 'closed' } });
    expect((await request('POST', '', external({ dealId: deal._id }))).status).toBe(400);
    expect(await Expense.countDocuments()).toBe(1);
  });
});
