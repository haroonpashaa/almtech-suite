import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Customer from '../models/Customer.js';
import { pickWritableCustomerFields, createCustomer, updateCustomer } from './customer.controller.js';

describe('pickWritableCustomerFields', () => {
  it('keeps legitimate profile fields', () => {
    const body = { name: 'Acme', company: 'Acme Corp', phone: '0300', email: 'a@a.com', cnicNtn: '123', address: 'X', creditLimit: 5000, notes: 'n', active: false };
    expect(pickWritableCustomerFields(body)).toEqual(body);
  });

  it('strips balance even when present in the request body', () => {
    const body = { name: 'Acme', balance: 999999 };
    const clean = pickWritableCustomerFields(body);
    expect(clean).toEqual({ name: 'Acme' });
    expect(clean).not.toHaveProperty('balance');
  });

  it('strips system/identity fields (_id, createdAt, updatedAt, __v)', () => {
    const body = { name: 'Acme', _id: 'x', createdAt: 'x', updatedAt: 'x', __v: 0 };
    expect(pickWritableCustomerFields(body)).toEqual({ name: 'Acme' });
  });

  it('strips any other unrecognized field, not just balance', () => {
    const body = { name: 'Acme', someRandomField: 'whatever' };
    expect(pickWritableCustomerFields(body)).toEqual({ name: 'Acme' });
  });

  it('is a no-op on an already-clean payload', () => {
    const body = { name: 'Acme', phone: '0300' };
    expect(pickWritableCustomerFields(body)).toEqual(body);
  });
});

// ===========================================================================
// updateCustomer — DB-backed proof that balance cannot be injected end to end
// through the real handler, not just through the pure allowlist function above.
// ===========================================================================
describe('updateCustomer (DB-backed)', () => {
  let mem;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await Customer.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    const res = { json: (body) => { res.body = body; return res; }, status: () => res };
    return res;
  }

  async function call(id, body) {
    const req = { params: { id }, body };
    const res = mockRes();
    await updateCustomer(req, res);
    return res.body;
  }

  it('injecting balance in the request body does not change the stored balance', async () => {
    const customer = await Customer.create({ name: 'Acme', balance: 1500 });
    const result = await call(customer._id.toString(), { name: 'Acme Updated', balance: 999999 });
    expect(result.balance).toBe(1500);
    const reloaded = await Customer.findById(customer._id);
    expect(reloaded.balance).toBe(1500);
    expect(reloaded.name).toBe('Acme Updated');
  });

  it('legitimate profile fields persist correctly', async () => {
    const customer = await Customer.create({ name: 'Acme' });
    const result = await call(customer._id.toString(), {
      name: 'Acme Corp', company: 'Acme Trading', phone: '03001234567',
      email: 'sales@acme.test', cnicNtn: '12345-6789012-3', address: '123 Main St',
      creditLimit: 50000, notes: 'VIP customer', active: false,
    });
    expect(result.company).toBe('Acme Trading');
    expect(result.creditLimit).toBe(50000);
    expect(result.active).toBe(false);
    const reloaded = await Customer.findById(customer._id);
    expect(reloaded.company).toBe('Acme Trading');
    expect(reloaded.active).toBe(false);
  });

  it('editing profile fields does not touch an unrelated invoice/ledger-derived balance', async () => {
    const customer = await Customer.create({ name: 'Acme', balance: 42000 });
    await call(customer._id.toString(), { phone: '03000000000' });
    const reloaded = await Customer.findById(customer._id);
    expect(reloaded.balance).toBe(42000);
  });
});

// ===========================================================================
// createCustomer — the same allowlist, now proven against Customer.create(req.body)
// directly, not just findByIdAndUpdate.
// ===========================================================================
describe('createCustomer (DB-backed)', () => {
  let mem;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await Customer.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    const res = { json: (body) => { res.body = body; return res; }, status: () => res };
    return res;
  }

  async function call(body) {
    const req = { body };
    const res = mockRes();
    await createCustomer(req, res);
    return res.body;
  }

  it('valid customer fields are accepted', async () => {
    const result = await call({ name: 'Acme', company: 'Acme Corp', phone: '0300', email: 'a@a.com' });
    expect(result.name).toBe('Acme');
    expect(result.company).toBe('Acme Corp');
  });

  it('balance supplied in the request cannot be persisted', async () => {
    const result = await call({ name: 'Acme', balance: 500000 });
    expect(result.balance).toBe(0);
    const reloaded = await Customer.findById(result._id);
    expect(reloaded.balance).toBe(0);
  });

  it('_id supplied in the request cannot override the generated id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const result = await call({ name: 'Acme', _id: fakeId });
    expect(result._id.toString()).not.toBe(fakeId);
  });

  it('createdAt/updatedAt cannot be arbitrarily injected', async () => {
    const bogusDate = new Date('2000-01-01').toISOString();
    const result = await call({ name: 'Acme', createdAt: bogusDate, updatedAt: bogusDate });
    expect(new Date(result.createdAt).getFullYear()).not.toBe(2000);
  });

  it('arbitrary unknown fields are not persisted', async () => {
    const result = await call({ name: 'Acme', hackerField: 'pwned' });
    expect(result).not.toHaveProperty('hackerField');
    const reloaded = await Customer.findById(result._id).lean();
    expect(reloaded).not.toHaveProperty('hackerField');
  });

  it('legitimate customer fields still persist', async () => {
    const result = await call({
      name: 'Acme', company: 'Acme Trading', phone: '03001234567', email: 'sales@acme.test',
      cnicNtn: '12345-6789012-3', address: '123 Main St', creditLimit: 50000, notes: 'VIP', active: true,
    });
    expect(result.creditLimit).toBe(50000);
    expect(result.notes).toBe('VIP');
  });

  it('active is left at the schema default when the request omits it, rather than being forced', async () => {
    const result = await call({ name: 'Acme' });
    expect(result.active).toBe(true); // Customer schema default
  });

  it('existing customer creation behaviour still works (required name enforced)', async () => {
    const req = { body: { company: 'No Name Co' } };
    const res = mockRes();
    await expect(createCustomer(req, res)).rejects.toThrow();
  });
});
