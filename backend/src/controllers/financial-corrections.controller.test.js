import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Account from '../models/Account.js';
import Customer from '../models/Customer.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import Invoice from '../models/Invoice.js';
import OpeningBalance from '../models/OpeningBalance.js';
import ReceivableAdjustment from '../models/ReceivableAdjustment.js';
import Activity from '../models/Activity.js';
import '../models/User.js';
import { adjustCustomerReceivable, customerReceivable, position, receivables } from './finance.controller.js';
import { transferAccounts } from './account.controller.js';

describe('audited customer receivable corrections and account transfers', () => {
  let replica;
  const user = { _id: new mongoose.Types.ObjectId(), name: 'Admin' };
  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replica.getUri());
  }, 120000);
  afterEach(async () => {
    await Promise.all([
      Account.deleteMany({}), Customer.deleteMany({}), Invoice.deleteMany({}),
      OpeningBalance.deleteMany({}), ReceivableAdjustment.deleteMany({}),
      FinancialTransaction.deleteMany({}), Activity.deleteMany({}),
    ]);
  });
  afterAll(async () => { await mongoose.disconnect(); await replica.stop(); });

  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

  it('records an admin correction without changing invoices or payment history and reconciles the customer balance', async () => {
    const customer = await Customer.create({ name: 'Synthetic customer', balance: 75 });
    const invoice = await Invoice.create({
      number: 'TEST-REC-1', customer: customer._id, items: [], subtotal: 100, total: 100, paid: 25, balance: 75,
      status: 'partial', payments: [{ amount: 25, method: 'cash', currency: 'PKR', reference: 'existing payment' }],
    });
    const res = response();
    await adjustCustomerReceivable({
      params: { id: String(customer._id) },
      body: { amount: 10, direction: 'decrease', reason: 'Verified customer statement', expectedBalance: 75, idempotencyKey: 'receivable-correction-1' },
      user,
    }, res);

    expect(res.statusCode).toBe(201);
    expect(res.body.customer.balance).toBe(65);
    expect(res.body.adjustment).toMatchObject({ amount: 10, delta: -10, direction: 'decrease', reason: 'Verified customer statement', balanceBefore: 75, balanceAfter: 65, createdBy: user._id });
    const unchangedInvoice = await Invoice.findById(invoice._id);
    expect(unchangedInvoice).toMatchObject({ total: 100, paid: 25, balance: 75, status: 'partial' });
    expect(unchangedInvoice.payments).toHaveLength(1);
    const statement = response();
    await customerReceivable({ params: { id: String(customer._id) }, user: { ...user, role: 'admin' } }, statement);
    expect(statement.body).toMatchObject({ outstanding: 65, storedBalance: 65, reconciled: true, adjustmentTotal: -10 });
    const list = response();
    await receivables({ query: {}, user: { ...user, role: 'admin' } }, list);
    expect(list.body.rows[0]).toMatchObject({ outstanding: 65, adjustments: -10, total: 100, paid: 25 });
    expect(list.body).toMatchObject({ totalOutstanding: 65, totalPaid: 25, reconciled: true, agingExcludesAdjustments: true });
    const salesList = response();
    await receivables({ query: {}, user: { role: 'sales' } }, salesList);
    expect(salesList.body.rows[0]).not.toHaveProperty('adjustments');
    expect(salesList.body).not.toHaveProperty('adjustmentsTotal');
    const companyPosition = response();
    await position({}, companyPosition);
    expect(companyPosition.body).toMatchObject({ receivables: 65, storedReceivables: 65, reconciled: true });
    expect((await ReceivableAdjustment.findOne({ customer: customer._id })).createdAt).toBeInstanceOf(Date);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
    expect(await Activity.countDocuments({ action: 'receivable_adjusted' })).toBe(1);
  });

  it('rejects stale, excessive, and duplicate corrections without a second balance change', async () => {
    const customer = await Customer.create({ name: 'Correction checks', balance: 50 });
    const body = { amount: 10, direction: 'increase', reason: 'Correction test', expectedBalance: 50, idempotencyKey: 'receivable-correction-duplicate' };
    const request = () => adjustCustomerReceivable({ params: { id: String(customer._id) }, body, user }, response());
    await request();
    await expect(request()).rejects.toThrow(/already been recorded|changed since it was loaded/i);
    const stale = response();
    await expect(adjustCustomerReceivable({ params: { id: String(customer._id) }, body: { ...body, idempotencyKey: 'receivable-correction-stale' }, user }, stale)).rejects.toThrow(/changed since it was loaded/i);
    const excessive = response();
    await expect(adjustCustomerReceivable({ params: { id: String(customer._id) }, body: { ...body, direction: 'decrease', amount: 100, expectedBalance: 60, idempotencyKey: 'receivable-correction-excessive' }, user }, excessive)).rejects.toThrow(/below zero/i);
    expect((await Customer.findById(customer._id)).balance).toBe(60);
    expect(await ReceivableAdjustment.countDocuments({ customer: customer._id })).toBe(1);
  });

  it('posts paired same-currency transfer legs atomically and reconciles both account ledgers', async () => {
    const source = await Account.create({ name: 'Transfer source', type: 'bank', currency: 'PKR', openingBalance: 500, currentBalance: 500 });
    const destination = await Account.create({ name: 'Transfer destination', type: 'cash', currency: 'PKR', openingBalance: 20, currentBalance: 20 });
    const res = response();
    await transferAccounts({
      body: { sourceAccountId: String(source._id), destinationAccountId: String(destination._id), amount: 125, reason: 'Move float', idempotencyKey: 'account-transfer-1' },
      user,
    }, res);
    expect(res.statusCode).toBe(201);
    expect(res.body.transactions).toHaveLength(2);
    expect(new Set(res.body.transactions.map((t) => t.transferGroup)).size).toBe(1);
    expect(res.body.transactions.map((t) => [t.direction, t.type, t.amount, t.currency])).toEqual([
      ['out', 'transfer_out', 125, 'PKR'], ['in', 'transfer_in', 125, 'PKR'],
    ]);
    expect(res.body.transactions.every((t) => String(t.createdBy) === String(user._id))).toBe(true);
    expect((await Account.findById(source._id)).currentBalance).toBe(375);
    expect((await Account.findById(destination._id)).currentBalance).toBe(145);

    const duplicate = response();
    await expect(transferAccounts({ body: { sourceAccountId: String(source._id), destinationAccountId: String(destination._id), amount: 125, reason: 'Move float', idempotencyKey: 'account-transfer-1' }, user }, duplicate)).rejects.toThrow(/already been recorded/i);
    expect(duplicate.statusCode).toBe(409);
    expect(await FinancialTransaction.countDocuments({ transferGroup: res.body.transferGroup })).toBe(2);
  });

  it('rejects same-account, inactive, and cross-currency transfers without ledger writes', async () => {
    const source = await Account.create({ name: 'PKR active', type: 'bank', currency: 'PKR', openingBalance: 100, currentBalance: 100 });
    const gbp = await Account.create({ name: 'GBP active', type: 'bank', currency: 'GBP' });
    const inactive = await Account.create({ name: 'Inactive', type: 'cash', active: false });
    const call = (destination, key) => transferAccounts({ body: { sourceAccountId: String(source._id), destinationAccountId: String(destination._id), amount: 1, reason: 'Test transfer', idempotencyKey: key }, user }, response());
    await expect(call(source, 'transfer-same')).rejects.toThrow(/must be different/i);
    await expect(call(gbp, 'transfer-currency')).rejects.toThrow(/same currency/i);
    await expect(call(inactive, 'transfer-inactive')).rejects.toThrow(/must be active/i);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
    expect((await Account.findById(source._id)).currentBalance).toBe(100);
  });

  it('aborts the whole transfer when either unique ledger leg cannot be written', async () => {
    const source = await Account.create({ name: 'Atomic source', type: 'bank', openingBalance: 100, currentBalance: 100 });
    const destination = await Account.create({ name: 'Atomic destination', type: 'cash', openingBalance: 0, currentBalance: 0 });
    await FinancialTransaction.create({
      account: destination._id, amount: 1, currency: 'PKR', direction: 'in', type: 'other_income',
      description: 'preexisting unrelated entry', idempotencyKey: 'transfer-atomic-failure:in',
    });
    const res = response();
    await expect(transferAccounts({
      body: { sourceAccountId: String(source._id), destinationAccountId: String(destination._id), amount: 25, reason: 'Atomicity test', idempotencyKey: 'transfer-atomic-failure' },
      user,
    }, res)).rejects.toThrow(/already been recorded/i);
    expect(res.statusCode).toBe(409);
    expect((await Account.findById(source._id)).currentBalance).toBe(100);
    expect((await Account.findById(destination._id)).currentBalance).toBe(0);
    expect(await FinancialTransaction.countDocuments({ description: 'Atomicity test' })).toBe(0);
  });
});
