import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Account from '../models/Account.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import Activity from '../models/Activity.js';
import '../models/User.js';
import { adjustAccountLedger } from './account.controller.js';

describe('manual account ledger adjustments', () => {
  let memory;
  const user = { _id: new mongoose.Types.ObjectId(), name: 'Admin' };
  beforeAll(async () => { memory = await MongoMemoryServer.create(); await mongoose.connect(memory.getUri()); });
  afterEach(async () => { await Promise.all([Account.deleteMany({}), FinancialTransaction.deleteMany({}), Activity.deleteMany({})]); });
  afterAll(async () => { await mongoose.disconnect(); await memory.stop(); });
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

  it('accepts Other Bank and posts a reasoned credit with a reconciled balance and creator', async () => {
    const account = await Account.create({ name: 'Other Bank', type: 'other_bank', openingBalance: 50, currentBalance: 50 });
    const res = response();
    await adjustAccountLedger({ params: { id: String(account._id) }, body: { amount: 125, direction: 'in', reason: 'Cash deposit correction', idempotencyKey: 'test-credit-1' }, user }, res);
    const fresh = await Account.findById(account._id);
    const txn = await FinancialTransaction.findById(res.body._id);
    expect(fresh.currentBalance).toBe(175);
    expect(txn).toMatchObject({ amount: 125, direction: 'in', type: 'ledger_adjustment', description: 'Cash deposit correction', createdBy: user._id });
    const rows = await FinancialTransaction.aggregate([
      { $match: { account: fresh._id } },
      { $group: { _id: null, delta: { $sum: { $cond: [{ $eq: ['$direction', 'in'] }, '$amount', { $multiply: ['$amount', -1] }] } } } },
    ]);
    expect(fresh.openingBalance + rows[0].delta).toBe(175);
  });

  it('posts deductions and requires a reason and positive amount', async () => {
    const account = await Account.create({ name: 'Cash', type: 'cash', openingBalance: 200, currentBalance: 200 });
    const res = response();
    await adjustAccountLedger({ params: { id: String(account._id) }, body: { amount: 40, direction: 'out', reason: 'Bank fee correction' }, user }, res);
    expect((await Account.findById(account._id)).currentBalance).toBe(160);
    await expect(adjustAccountLedger({ params: { id: String(account._id) }, body: { amount: 1, direction: 'in' }, user }, response())).rejects.toThrow(/reason is required/i);
    await expect(adjustAccountLedger({ params: { id: String(account._id) }, body: { amount: 0, direction: 'in', reason: 'No amount' }, user }, response())).rejects.toThrow(/greater than zero/i);
  });

  it('rejects a retried idempotency key without moving the balance twice', async () => {
    const account = await Account.create({ name: 'Wallet', type: 'wallet', openingBalance: 0, currentBalance: 0 });
    const req = { params: { id: String(account._id) }, body: { amount: 15, direction: 'in', reason: 'Till correction', idempotencyKey: 'same-adjustment' }, user };
    await adjustAccountLedger(req, response());
    const duplicate = response();
    await expect(adjustAccountLedger(req, duplicate)).rejects.toThrow(/already been recorded/i);
    expect(duplicate.statusCode).toBe(409);
    expect((await Account.findById(account._id)).currentBalance).toBe(15);
    expect(await FinancialTransaction.countDocuments({ account: account._id })).toBe(1);
  });
});
