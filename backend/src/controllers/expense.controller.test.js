import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Account from '../models/Account.js';
import Expense from '../models/Expense.js';
import { createExpense, updateExpense, voidExpense } from './expense.controller.js';

// ===========================================================================
// updateExpense — proves the frontend's new Edit UI is relying on a real,
// already-enforced backend contract: descriptive fields editable, financial
// identity (amount/account/date) immutable, voided expenses locked entirely.
// ===========================================================================
describe('expense edit contract (DB-backed)', () => {
  let mem;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await Expense.deleteMany({});
    await Account.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    const res = {
      body: undefined, statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    return res;
  }

  async function makeAccount() {
    return Account.create({ name: 'Test Cash', type: 'cash' });
  }

  async function makeExpense(account) {
    const req = {
      user: { _id: userId },
      body: { amount: 5000, category: 'Rent', account: account._id.toString(), description: 'Office rent', reference: 'REF-1', notes: 'n' },
    };
    const res = mockRes();
    await createExpense(req, res);
    return res.body;
  }

  it('allowed descriptive fields (category, description, notes, reference) can be edited', async () => {
    const account = await makeAccount();
    const expense = await makeExpense(account);
    const req = { params: { id: expense._id }, user: { _id: userId }, body: { category: 'Salaries', description: 'Updated', notes: 'updated notes', reference: 'REF-2' } };
    const res = mockRes();
    await updateExpense(req, res);
    expect(res.body.category).toBe('Salaries');
    expect(res.body.description).toBe('Updated');
    expect(res.body.notes).toBe('updated notes');
    expect(res.body.reference).toBe('REF-2');
  });

  it('amount cannot be changed', async () => {
    const account = await makeAccount();
    const expense = await makeExpense(account);
    const req = { params: { id: expense._id }, user: { _id: userId }, body: { amount: 99999 } };
    const res = mockRes();
    await expect(updateExpense(req, res)).rejects.toThrow(/Cannot change/);
    const reloaded = await Expense.findById(expense._id);
    expect(reloaded.amount).toBe(5000);
  });

  it('account cannot be changed', async () => {
    const account = await makeAccount();
    const otherAccount = await Account.create({ name: 'Other Bank', type: 'bank' });
    const expense = await makeExpense(account);
    const req = { params: { id: expense._id }, user: { _id: userId }, body: { account: otherAccount._id.toString() } };
    const res = mockRes();
    await expect(updateExpense(req, res)).rejects.toThrow(/Cannot change/);
    const reloaded = await Expense.findById(expense._id);
    expect(reloaded.account.toString()).toBe(account._id.toString());
  });

  it('date cannot be changed', async () => {
    const account = await makeAccount();
    const expense = await makeExpense(account);
    const originalDate = expense.date;
    const req = { params: { id: expense._id }, user: { _id: userId }, body: { date: '2020-01-01' } };
    const res = mockRes();
    await expect(updateExpense(req, res)).rejects.toThrow(/Cannot change/);
    const reloaded = await Expense.findById(expense._id);
    expect(new Date(reloaded.date).getTime()).toBe(new Date(originalDate).getTime());
  });

  it('a voided expense can no longer be edited, even for allowed fields', async () => {
    const account = await makeAccount();
    const expense = await makeExpense(account);
    await voidExpense({ params: { id: expense._id }, user: { _id: userId }, body: { reason: 'test void' } }, mockRes());

    const req = { params: { id: expense._id }, user: { _id: userId }, body: { description: 'should not apply' } };
    const res = mockRes();
    await expect(updateExpense(req, res)).rejects.toThrow(/voided/);
    const reloaded = await Expense.findById(expense._id);
    expect(reloaded.description).toBe('Office rent');
  });

  it('existing expense creation and void behaviour still works unchanged', async () => {
    const account = await makeAccount();
    const expense = await makeExpense(account);
    expect(expense.status).toBe('posted');
    expect(expense.amount).toBe(5000);

    const res = mockRes();
    await voidExpense({ params: { id: expense._id }, user: { _id: userId }, body: {} }, res);
    expect(res.body.status).toBe('voided');
    const reloaded = await Account.findById(account._id);
    // Expense out (5000) then reversal in (5000) nets back to the opening balance.
    expect(reloaded.currentBalance).toBe(0);
  });
});
