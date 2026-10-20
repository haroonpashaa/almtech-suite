import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Deal from '../models/Deal.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Expense from '../models/Expense.js';
import Account from '../models/Account.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import '../models/User.js';
import { createDealAccount, getDealAccount, linkDealRecord, unlinkDealRecord } from './dealAccounts.controller.js';

describe('deal accounts', () => {
  let memory;
  const user = { _id: new mongoose.Types.ObjectId(), name: 'Admin' };
  beforeAll(async () => { memory = await MongoMemoryServer.create(); await mongoose.connect(memory.getUri()); });
  afterEach(async () => { await Promise.all([Deal.deleteMany({}), Invoice.deleteMany({}), PurchaseOrder.deleteMany({}), Expense.deleteMany({}), Account.deleteMany({}), FinancialTransaction.deleteMany({})]); });
  afterAll(async () => { await mongoose.disconnect(); await memory.stop(); });
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

  it('keeps revenue, purchase costs, and expenses isolated per explicitly linked deal', async () => {
    const first = response();
    await createDealAccount({ body: { identifier: '931x' }, user }, first);
    const second = response();
    await createDealAccount({ body: { identifier: '932x' }, user }, second);
    const customer = new mongoose.Types.ObjectId();
    const supplier = new mongoose.Types.ObjectId();
    const product = new mongoose.Types.ObjectId();
    const invoice = await Invoice.create({ number: 'INV-1', customer, items: [{ product, name: 'Laptop', quantity: 1, unitPrice: 500, unitCost: 200, lineTotal: 500 }], subtotal: 500, total: 500, balance: 500 });
    const po = await PurchaseOrder.create({ number: 'PO-1', supplier, items: [{ product, quantity: 1, received: 0, unitCost: 200, lineTotal: 200 }], subtotal: 200, total: 200, balance: 200 });
    const account = await Account.create({ name: 'Cash', type: 'cash' });
    const expenses = [];
    for (const [category, amount] of [['Customs', 30], ['Duty', 20], ['Shipping', 10], ['Miscellaneous', 5]]) {
      const txn = await FinancialTransaction.create({ account: account._id, amount, direction: 'out', type: 'expense' });
      expenses.push(await Expense.create({ amount, category, account: account._id, financialTransaction: txn._id, description: `Deal ${category}` }));
    }
    for (const [type, recordId] of [['invoice', invoice._id], ['purchase', po._id], ...expenses.map((expense) => ['expense', expense._id])]) {
      await linkDealRecord({ params: { id: String(first.body._id) }, body: { type, recordId: String(recordId) }, user }, response());
    }
    const result = response();
    await getDealAccount({ params: { id: String(first.body._id) } }, result);
    expect(result.body.totals).toMatchObject({ revenue: 500, costOfGoods: 200, purchaseCosts: 200, otherExpenses: 65, grossProfit: 300, netProfit: 235 });
    expect(result.body.records.invoices).toHaveLength(1);
    expect(result.body.records.expenses).toHaveLength(4);
    const isolated = response();
    await getDealAccount({ params: { id: String(second.body._id) } }, isolated);
    expect(isolated.body.totals).toMatchObject({ revenue: 0, purchaseCosts: 0, otherExpenses: 0, grossProfit: 0, netProfit: 0 });
  });

  it('prevents duplicate deal identifiers and a record from being assigned to two deals; unlink preserves source record', async () => {
    const first = response();
    await createDealAccount({ body: { identifier: '931X' }, user }, first);
    await expect(createDealAccount({ body: { identifier: '931x' }, user }, response())).rejects.toThrow(/already exists/i);
    const second = response();
    await createDealAccount({ body: { identifier: 'other' }, user }, second);
    const customer = new mongoose.Types.ObjectId();
    const product = new mongoose.Types.ObjectId();
    const invoice = await Invoice.create({ number: 'INV-2', customer, items: [{ product, name: 'Laptop', quantity: 1, unitPrice: 100, unitCost: 40, lineTotal: 100 }], subtotal: 100, total: 100, balance: 100 });
    const req = (dealId) => ({ params: { id: String(dealId) }, body: { type: 'invoice', recordId: String(invoice._id) }, user });
    await linkDealRecord(req(first.body._id), response());
    await expect(linkDealRecord(req(second.body._id), response())).rejects.toThrow(/another deal/i);
    await unlinkDealRecord({ params: { id: String(first.body._id), type: 'invoice', recordId: String(invoice._id) }, user }, response());
    expect((await Invoice.findById(invoice._id)).total).toBe(100);
    expect((await Invoice.findById(invoice._id)).deal).toBeUndefined();
  });
});
