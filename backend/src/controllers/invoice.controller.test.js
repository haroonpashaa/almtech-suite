import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Invoice from '../models/Invoice.js';
import Activity from '../models/Activity.js';
import StockMovement from '../models/StockMovement.js';
import Settings from '../models/Settings.js';
import Account from '../models/Account.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import {
  resolveLineComments, normalizeSaleQuantity, buildLineFromProduct, validateLineSerials, createInvoice, recordPayment,
  updateInvoice, returnInvoice, listInvoices,
} from './invoice.controller.js';

describe('resolveLineComments', () => {
  it('falls back to the product comments when the sale sends none', () => {
    expect(resolveLineComments(undefined, { comments: 'Screen scratch' })).toBe('Screen scratch');
  });

  it('lets the salesperson override the product comments for this sale', () => {
    expect(resolveLineComments('Sold as-is, buyer aware of the scratch', { comments: 'Screen scratch' })).toBe(
      'Sold as-is, buyer aware of the scratch'
    );
  });

  it('lets the salesperson explicitly clear the comment with an empty string', () => {
    expect(resolveLineComments('', { comments: 'Screen scratch' })).toBe('');
  });

  it('defaults to empty when neither the sale nor the product has a comment', () => {
    expect(resolveLineComments(undefined, {})).toBe('');
  });
});

describe('normalizeSaleQuantity', () => {
  it('accepts a valid positive integer', () => {
    expect(normalizeSaleQuantity(3, 'Laptop')).toBe(3);
  });

  it('rejects zero', () => {
    expect(() => normalizeSaleQuantity(0, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects a negative quantity', () => {
    expect(() => normalizeSaleQuantity(-3, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects a fractional quantity instead of silently truncating or flooring it', () => {
    expect(() => normalizeSaleQuantity(1.7, 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('rejects a non-numeric value', () => {
    expect(() => normalizeSaleQuantity('abc', 'Laptop')).toThrow(/whole number of at least 1/);
  });

  it('sets statusCode 400 so the global error handler responds correctly', () => {
    try {
      normalizeSaleQuantity(0, 'Laptop');
      expect.unreachable();
    } catch (e) {
      expect(e.statusCode).toBe(400);
    }
  });

  it('coerces a numeric string to a number', () => {
    expect(normalizeSaleQuantity('5', 'Laptop')).toBe(5);
  });
});

// ===========================================================================
// buildLineFromProduct — the cart-editing snapshot fields (Block 3). Each field
// takes the sale's own value when given (a salesperson's correction) and falls
// back to the product's own value when omitted, exactly like resolveLineComments
// already does for comments. sku is deliberately not among the overridable
// params — the line always carries the true product's own SKU.
// ===========================================================================
describe('buildLineFromProduct', () => {
  const product = {
    _id: 'p1', name: 'Laptop X', sku: 'SKU-X', purchasePrice: 500,
    model: 'X100', ram: '16GB', processor: 'i7', storage: '512GB SSD', comments: 'Screen scratch',
  };

  it('uses the product\'s own values when the line supplies none', async () => {
    const line = await buildLineFromProduct({ product, quantity: 1, unitPrice: 900 });
    expect(line).toMatchObject({
      name: 'Laptop X', sku: 'SKU-X', model: 'X100', ram: '16GB', processor: 'i7', storage: '512GB SSD',
    });
  });

  it('lets the salesperson override name and every spec field for this sale', async () => {
    const line = await buildLineFromProduct({
      product, quantity: 1, unitPrice: 900,
      name: 'Laptop X (corrected)', model: 'X100 Pro', ram: '32GB', processor: 'i9', storage: '1TB SSD',
    });
    expect(line).toMatchObject({
      name: 'Laptop X (corrected)', model: 'X100 Pro', ram: '32GB', processor: 'i9', storage: '1TB SSD',
    });
    // sku is never overridable — it always identifies the real product sold.
    expect(line.sku).toBe('SKU-X');
  });

  it('lets a spec field be explicitly cleared to an empty string rather than falling back', async () => {
    const line = await buildLineFromProduct({ product, quantity: 1, unitPrice: 900, model: '' });
    expect(line.model).toBe('');
  });

  it('never writes purchasePrice/comments overrides back onto the product object itself', async () => {
    const before = { ...product };
    await buildLineFromProduct({ product, quantity: 1, unitPrice: 900, model: 'Changed' });
    expect(product).toEqual(before);
  });

  it('uses the submitted unitPrice untouched, independent of the product\'s own pricing', async () => {
    const line = await buildLineFromProduct({ product, quantity: 2, unitPrice: 1234.5 });
    expect(line.unitPrice).toBe(1234.5);
    expect(line.lineTotal).toBe(2 * 1234.5);
  });
});

// ===========================================================================
// validateLineSerials — a chosen serial must be a real, currently in-stock unit
// on the exact product being sold, count must match quantity, and no serial may
// be claimed twice in the same sale. Serial capture itself stays optional.
// ===========================================================================
describe('validateLineSerials', () => {
  function makeProduct(overrides = {}) {
    return {
      name: 'Laptop X',
      tracksSerials: true,
      serials: [
        { serial: 'SN1', status: 'in_stock' },
        { serial: 'SN2', status: 'in_stock' },
        { serial: 'SN3', status: 'sold' },
      ],
      ...overrides,
    };
  }

  it('is a no-op when no serials are given, even for a tracksSerials product', () => {
    const product = makeProduct();
    expect(validateLineSerials({ product, quantity: 1, serials: [], claimedSerials: new Set() })).toEqual([]);
    expect(validateLineSerials({ product, quantity: 1, serials: undefined, claimedSerials: new Set() })).toEqual([]);
  });

  it('accepts a full, valid, in-stock selection matching quantity', () => {
    const product = makeProduct();
    const result = validateLineSerials({ product, quantity: 2, serials: ['SN1', 'SN2'], claimedSerials: new Set() });
    expect(result).toEqual(['SN1', 'SN2']);
  });

  it('rejects serials on a product that does not track them', () => {
    const product = makeProduct({ tracksSerials: false });
    expect(() => validateLineSerials({ product, quantity: 1, serials: ['SN1'], claimedSerials: new Set() }))
      .toThrow(/does not track serial numbers/);
  });

  it('rejects a serial count that does not match quantity', () => {
    const product = makeProduct();
    expect(() => validateLineSerials({ product, quantity: 2, serials: ['SN1'], claimedSerials: new Set() }))
      .toThrow(/selected 1 serial number\(s\) but quantity is 2/);
  });

  it('rejects a serial number that does not exist on the product', () => {
    const product = makeProduct();
    expect(() => validateLineSerials({ product, quantity: 1, serials: ['SN-GHOST'], claimedSerials: new Set() }))
      .toThrow(/was not found on this product/);
  });

  it('rejects a serial number that is already sold', () => {
    const product = makeProduct();
    expect(() => validateLineSerials({ product, quantity: 1, serials: ['SN3'], claimedSerials: new Set() }))
      .toThrow(/is not available \(status: sold\)/);
  });

  it('rejects the same serial chosen twice within one line', () => {
    const product = makeProduct();
    expect(() => validateLineSerials({ product, quantity: 2, serials: ['SN1', 'SN1'], claimedSerials: new Set() }))
      .toThrow(/selected more than once/);
  });

  it('rejects a serial already claimed by a different line in the same sale', () => {
    const product = makeProduct();
    const claimedSerials = new Set(['SN1']);
    expect(() => validateLineSerials({ product, quantity: 1, serials: ['SN1'], claimedSerials }))
      .toThrow(/selected more than once/);
  });

  it('adds accepted serials to the shared claimedSerials set', () => {
    const product = makeProduct();
    const claimedSerials = new Set();
    validateLineSerials({ product, quantity: 1, serials: ['SN1'], claimedSerials });
    expect(claimedSerials.has('SN1')).toBe(true);
  });
});

// ===========================================================================
// createInvoice (DB-backed) — the cart-editing values actually reach the
// persisted invoice, quantity/serial/price integrity holds, and none of this
// mutates the Product master record.
// ===========================================================================
describe('createInvoice cart editing (DB-backed)', () => {
  let mem;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await StockMovement.deleteMany({});
    await Invoice.deleteMany({});
    await Product.deleteMany({});
    await Customer.deleteMany({});
    await Settings.deleteMany({});
    await Promise.all([Account.deleteMany({}), FinancialTransaction.deleteMany({})]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    return res;
  }
  function req(body) {
    return { user: { _id: userId, role: 'sales' }, body };
  }
  async function makeCustomer() {
    return Customer.create({ name: 'Test Customer' });
  }
  async function makeProduct(overrides = {}) {
    return Product.create({
      sku: 'LAPTOP-1', name: 'Laptop X', stock: 5, purchasePrice: 500, sellingPrice: 900,
      model: 'X100', ram: '16GB', processor: 'i7', storage: '512GB SSD',
      ...overrides,
    });
  }
  async function callCreateInvoice(body) {
    const res = mockRes();
    await createInvoice(req(body), res);
    return { status: res.statusCode, body: res.body };
  }

  it('persists an edited Item name, spec fields and comments onto the invoice line', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct();
    const { status, body } = await callCreateInvoice({
      customer: customer._id.toString(),
      items: [{
        product: product._id.toString(), quantity: 1, unitPrice: 900,
        name: 'Laptop X (touch-up needed)', model: 'X100 Pro', ram: '32GB', processor: 'i9', storage: '1TB SSD',
        comments: 'Sold as-is, buyer aware of the scratch',
      }],
    });
    expect(status).toBe(201);
    const line = body.items[0];
    expect(line.name).toBe('Laptop X (touch-up needed)');
    expect(line.model).toBe('X100 Pro');
    expect(line.ram).toBe('32GB');
    expect(line.processor).toBe('i9');
    expect(line.storage).toBe('1TB SSD');
    expect(line.comments).toBe('Sold as-is, buyer aware of the scratch');
  });

  it('keeps a credit sale as a receivable and applies partial/full collections once', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct();
    const account = await Account.create({ name: 'Cash for receivable test', type: 'cash', openingBalance: 0, currentBalance: 0 });
    const { status, body: created } = await callCreateInvoice({
      customer: customer._id.toString(),
      items: [{ product: product._id.toString(), quantity: 1, unitPrice: 900 }],
    });
    expect(status).toBe(201);
    expect(created).toMatchObject({ paid: 0, balance: 900, status: 'open' });
    expect((await Customer.findById(customer._id)).balance).toBe(900);
    expect(created.payments).toHaveLength(0);

    await expect(recordPayment({ params: { id: String(created._id) }, body: { amount: 100, account: String(account._id) }, user: { _id: userId, role: 'sales' } }, mockRes()))
      .rejects.toThrow(/idempotency key is required/i);
    expect((await Customer.findById(customer._id)).balance).toBe(900);

    const paymentRequest = { params: { id: String(created._id) }, body: { amount: 300, account: String(account._id), idempotencyKey: 'invoice-partial-payment-1' }, user: { _id: userId, role: 'sales' } };
    const partial = mockRes();
    await recordPayment(paymentRequest, partial);
    expect(partial.body).toMatchObject({ paid: 300, balance: 600, status: 'partial' });
    expect(partial.body.payments).toHaveLength(1);
    expect((await Customer.findById(customer._id)).balance).toBe(600);
    expect((await Account.findById(account._id)).currentBalance).toBe(300);
    expect(await FinancialTransaction.countDocuments({ invoice: created._id })).toBe(1);

    const duplicate = mockRes();
    await expect(recordPayment(paymentRequest, duplicate)).rejects.toThrow(/already been recorded/i);
    expect(duplicate.statusCode).toBe(409);
    expect((await Customer.findById(customer._id)).balance).toBe(600);
    expect((await Account.findById(account._id)).currentBalance).toBe(300);
    expect(await FinancialTransaction.countDocuments({ invoice: created._id })).toBe(1);

    const final = mockRes();
    await recordPayment({ ...paymentRequest, body: { amount: 600, account: String(account._id), idempotencyKey: 'invoice-final-payment-1' } }, final);
    expect(final.body).toMatchObject({ paid: 900, balance: 0, status: 'paid' });
    expect(final.body.payments).toHaveLength(2);
    expect((await Customer.findById(customer._id)).balance).toBe(0);
    expect((await Account.findById(account._id)).currentBalance).toBe(900);
    expect(await FinancialTransaction.countDocuments({ invoice: created._id })).toBe(2);
  });

  it('blocks GBP sales invoices while Customer.balance and legacy reporting are single-currency', async () => {
    await Settings.create({ currency: 'GBP' });
    const customer = await makeCustomer();
    const product = await makeProduct();
    await expect(callCreateInvoice({
      customer: customer._id.toString(), items: [{ product: product._id.toString(), quantity: 1, unitPrice: 900 }],
    })).rejects.toThrow(/GBP sales invoices are disabled/i);
    expect(await Invoice.countDocuments()).toBe(0);
    expect((await Customer.findById(customer._id)).balance).toBe(0);
  });

  it('uses the edited cart price for the invoice and does not change the Product master price', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct({ sellingPrice: 900 });
    const { body } = await callCreateInvoice({
      customer: customer._id.toString(),
      items: [{ product: product._id.toString(), quantity: 2, unitPrice: 750 }],
    });
    expect(body.items[0].unitPrice).toBe(750);
    expect(body.items[0].lineTotal).toBe(1500);
    expect(body.subtotal).toBe(1500);
    const stored = await Product.findById(product._id);
    expect(stored.sellingPrice).toBe(900); // unchanged
  });

  it('rolls back stock, invoice and all movements when a later sale line fails', async () => {
    const customer = await makeCustomer();
    const first = await makeProduct({ sku: 'FAIL-A', stock: 3 });
    const second = await makeProduct({ sku: 'FAIL-B', stock: 3 });
    const create = StockMovement.create.bind(StockMovement);
    let calls = 0;
    vi.spyOn(StockMovement, 'create').mockImplementation((...args) => {
      if (++calls === 2) throw new Error('Injected isolated movement failure');
      return create(...args);
    });
    await expect(callCreateInvoice({ customer: customer._id, items: [{ product: first._id, quantity: 1, unitPrice: 900 }, { product: second._id, quantity: 1, unitPrice: 900 }] })).rejects.toThrow('Injected isolated movement failure');
    expect((await Product.findById(first._id)).stock).toBe(3);
    expect((await Product.findById(second._id)).stock).toBe(3);
    expect((await Customer.findById(customer._id)).balance).toBe(0);
    expect(await Invoice.countDocuments()).toBe(0);
    expect(await StockMovement.countDocuments()).toBe(0);
  });

  it('restores only this invoice serial claim when the serial write acknowledgement fails', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct({ tracksSerials: true, stock: 2, serials: [{ serial: 'SN-A', status: 'in_stock' }, { serial: 'SN-B', status: 'in_stock' }] });
    const update = Product.updateOne.bind(Product);
    let calls = 0;
    vi.spyOn(Product, 'updateOne').mockImplementation(async (...args) => {
      const result = await update(...args);
      if (++calls === 1) throw new Error('Injected lost serial acknowledgement');
      return result;
    });
    await expect(callCreateInvoice({ customer: customer._id, items: [{ product: product._id, quantity: 1, unitPrice: 900, serials: ['SN-A'] }] })).rejects.toThrow('Injected lost serial acknowledgement');
    const saved = await Product.findById(product._id);
    expect(saved.stock).toBe(2);
    expect(saved.serials.every(serial => serial.status === 'in_stock' && !serial.soldInvoice)).toBe(true);
    expect(await Invoice.countDocuments()).toBe(0);
    expect(await StockMovement.countDocuments()).toBe(0);
  });

  it('clearly reports a saved invoice when its separate initial payment fails', async () => {
    const customer = await makeCustomer(); const product = await makeProduct();
    const account = await Account.create({ name: 'Cash', type: 'cash', openingBalance: 1000, currentBalance: 1000 });
    vi.spyOn(FinancialTransaction, 'create').mockRejectedValueOnce(new Error('Injected payment failure'));
    const res = mockRes();
    await expect(createInvoice(req({ customer: customer._id, items: [{ product: product._id, quantity: 1, unitPrice: 900 }], initialPayment: { amount: 100, account: account._id, idempotencyKey: 'isolated-initial-payment' } }), res)).rejects.toThrow(/was created and stock was deducted.*Do not submit the sale again/);
    expect(res.statusCode).toBe(502);
    expect(await Invoice.countDocuments()).toBe(1);
    expect((await Invoice.findOne()).paid).toBe(0);
    expect((await Product.findById(product._id)).stock).toBe(4);
    expect((await Customer.findById(customer._id)).balance).toBe(900);
    expect((await Account.findById(account._id)).currentBalance).toBe(1000);
    expect(await FinancialTransaction.countDocuments()).toBe(0);
  });

  it('deducts exactly the edited quantity from stock', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct({ stock: 5 });
    await callCreateInvoice({
      customer: customer._id.toString(),
      items: [{ product: product._id.toString(), quantity: 3, unitPrice: 900 }],
    });
    const stored = await Product.findById(product._id);
    expect(stored.stock).toBe(2);
  });

  it('still rejects a quantity greater than available stock', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct({ stock: 2 });
    await expect(callCreateInvoice({
      customer: customer._id.toString(),
      items: [{ product: product._id.toString(), quantity: 5, unitPrice: 900 }],
    })).rejects.toThrow(/Insufficient stock/);
    const stored = await Product.findById(product._id);
    expect(stored.stock).toBe(2); // untouched
  });

  it('still rejects a zero/negative quantity', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct();
    await expect(callCreateInvoice({
      customer: customer._id.toString(),
      items: [{ product: product._id.toString(), quantity: 0, unitPrice: 900 }],
    })).rejects.toThrow(/whole number of at least 1/);
  });

  it('sells a specific edited serial number and marks it sold, tied to the invoice', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct({
      tracksSerials: true,
      stock: 2,
      serials: [{ serial: 'SN-A', status: 'in_stock' }, { serial: 'SN-B', status: 'in_stock' }],
    });
    const { body } = await callCreateInvoice({
      customer: customer._id.toString(),
      items: [{ product: product._id.toString(), quantity: 1, unitPrice: 900, serials: ['SN-B'] }],
    });
    expect(body.items[0].serials).toEqual(['SN-B']);
    const stored = await Product.findById(product._id);
    const soldSerial = stored.serials.find((s) => s.serial === 'SN-B');
    const otherSerial = stored.serials.find((s) => s.serial === 'SN-A');
    expect(soldSerial.status).toBe('sold');
    expect(soldSerial.soldInvoice.toString()).toBe(body._id.toString());
    expect(otherSerial.status).toBe('in_stock'); // the unselected unit is untouched
  });

  it('rejects selling a serial number that is already sold', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct({
      tracksSerials: true,
      stock: 1,
      serials: [{ serial: 'SN-A', status: 'sold' }],
    });
    await expect(callCreateInvoice({
      customer: customer._id.toString(),
      items: [{ product: product._id.toString(), quantity: 1, unitPrice: 900, serials: ['SN-A'] }],
    })).rejects.toThrow(/is not available/);
  });

  it('rejects a serial selection whose count does not match the edited quantity', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct({
      tracksSerials: true,
      stock: 2,
      serials: [{ serial: 'SN-A', status: 'in_stock' }, { serial: 'SN-B', status: 'in_stock' }],
    });
    await expect(callCreateInvoice({
      customer: customer._id.toString(),
      items: [{ product: product._id.toString(), quantity: 2, unitPrice: 900, serials: ['SN-A'] }],
    })).rejects.toThrow(/selected 1 serial number\(s\) but quantity is 2/);
    const stored = await Product.findById(product._id);
    expect(stored.stock).toBe(2); // rejected before anything was written
  });

  it('regression: a sale with none of the new fields behaves exactly as before', async () => {
    const customer = await makeCustomer();
    const product = await makeProduct();
    const { status, body } = await callCreateInvoice({
      customer: customer._id.toString(),
      items: [{ product: product._id.toString(), quantity: 1, unitPrice: 900 }],
    });
    expect(status).toBe(201);
    const line = body.items[0];
    expect(line.name).toBe('Laptop X');
    expect(line.model).toBe('X100');
    expect(line.ram).toBe('16GB');
    expect(line.serials).toEqual([]);
    expect(line.comments).toBe('');
  });
});

// ===========================================================================
// Admin correction paths: notes-only amendment, and Return now requiring a
// stated reason (previously defaulted silently when there was nothing to
// refund, so the "why" was never captured anywhere for an unpaid invoice).
// ===========================================================================
describe('invoice correction actions (DB-backed)', () => {
  let mem;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await StockMovement.deleteMany({});
    await Invoice.deleteMany({});
    await Product.deleteMany({});
    await Customer.deleteMany({});
    await Activity.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  }
  function req(body) {
    return { user: { _id: userId, role: 'admin' }, body, params: {} };
  }
  async function makeCustomer() {
    return Customer.create({ name: 'Test Customer' });
  }
  async function makeInvoice(overrides = {}) {
    const customer = await makeCustomer();
    return Invoice.create({
      number: 'INV-TEST-1', customer: customer._id,
      items: [{ product: new mongoose.Types.ObjectId(), name: 'Laptop', sku: 'SKU-1', quantity: 1, unitPrice: 900, lineTotal: 900 }],
      subtotal: 900, total: 900, paid: 0, balance: 900, status: 'open',
      ...overrides,
    });
  }

  it('updateInvoice sets notes without touching items, totals or payments', async () => {
    const invoice = await makeInvoice();
    const r = req({ notes: 'Customer asked for a printed receipt by post' });
    r.params.id = invoice._id.toString();
    const res = mockRes();
    await updateInvoice(r, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.notes).toBe('Customer asked for a printed receipt by post');
    expect(res.body.total).toBe(900);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.status).toBe('open');
  });

  it('updateInvoice rejects a request with nothing to update', async () => {
    const invoice = await makeInvoice();
    const r = req({});
    r.params.id = invoice._id.toString();
    await expect(updateInvoice(r, mockRes())).rejects.toThrow(/nothing to update/i);
  });

  it('updateInvoice 404s for a missing invoice', async () => {
    const r = req({ notes: 'x' });
    r.params.id = new mongoose.Types.ObjectId().toString();
    await expect(updateInvoice(r, mockRes())).rejects.toThrow(/not found/i);
  });

  it('returnInvoice requires a reason even when there are no payments to refund', async () => {
    const invoice = await makeInvoice(); // unpaid — the refund loop never runs
    const r = req({}); // no reason supplied
    r.params.id = invoice._id.toString();
    await expect(returnInvoice(r, mockRes())).rejects.toThrow(/reason is required/i);

    const stored = await Invoice.findById(invoice._id);
    expect(stored.status).toBe('open'); // untouched — the return never proceeded
  });

  it('returnInvoice records the stated reason on the activity log even for an unpaid invoice', async () => {
    const invoice = await makeInvoice();
    const r = req({ reason: 'Customer changed their mind before pickup' });
    r.params.id = invoice._id.toString();
    const res = mockRes();
    await returnInvoice(r, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('returned');

    const activity = await Activity.findOne({ action: 'invoice_returned', entityId: invoice._id.toString() });
    expect(activity).toBeTruthy();
    expect(activity.meta.reason).toBe('Customer changed their mind before pickup');
    expect(activity.user.toString()).toBe(userId.toString());
  });
});

describe('historical invoice product/model filtering', () => {
  let memory;
  beforeAll(async () => { memory = await MongoMemoryServer.create(); await mongoose.connect(memory.getUri()); });
  afterEach(async () => { await Promise.all([Invoice.deleteMany({}), Product.deleteMany({}), Customer.deleteMany({})]); });
  afterAll(async () => { await mongoose.disconnect(); await memory.stop(); });
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } });

  it('filters by selected product and the model snapshot on the same invoice line', async () => {
    const customer = await Customer.create({ name: 'Filter customer' });
    const one = await Product.create({ sku: 'FILTER-1', name: 'Model One', model: 'X100' });
    const two = await Product.create({ sku: 'FILTER-2', name: 'Model Two', model: 'X200' });
    const line = (product, model) => ({ product, name: 'Laptop', model, quantity: 1, unitPrice: 100, lineTotal: 100 });
    await Invoice.create([
      { number: 'FILTER-INV-1', customer: customer._id, items: [line(one._id, 'X100 Pro')], subtotal: 100, total: 100 },
      { number: 'FILTER-INV-2', customer: customer._id, items: [line(two._id, 'X200')], subtotal: 100, total: 100 },
    ]);
    const byModel = response();
    await listInvoices({ query: { model: 'X100' } }, byModel);
    expect(byModel.body.map((invoice) => invoice.number)).toEqual(['FILTER-INV-1']);
    const byProductAndModel = response();
    await listInvoices({ query: { product: String(one._id), model: 'X200' } }, byProductAndModel);
    expect(byProductAndModel.body).toHaveLength(0);
  });
});
