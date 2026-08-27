import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Settings from '../models/Settings.js';
import { pickWritableSettingsFields, updateSettings } from './settings.controller.js';

describe('pickWritableSettingsFields', () => {
  it('keeps every legitimate settings field the frontend actually exposes', () => {
    const body = {
      businessName: 'ALMTech', address: '123 St', phone: '0300', email: 'a@a.com', taxNumber: 'T1',
      logoUrl: 'https://x/y.png', currency: 'PKR', defaultTaxRate: 5, showTaxOnInvoices: false,
      invoicePrefix: 'INV-', quotationPrefix: 'QT-', poPrefix: 'PO-',
    };
    expect(pickWritableSettingsFields(body)).toEqual(body);
  });

  it('strips the system-maintained numbering counters even when present in the body', () => {
    const body = { businessName: 'ALMTech', invoiceNextNumber: 1, quotationNextNumber: 1, poNextNumber: 1 };
    const clean = pickWritableSettingsFields(body);
    expect(clean).toEqual({ businessName: 'ALMTech' });
    expect(clean).not.toHaveProperty('invoiceNextNumber');
    expect(clean).not.toHaveProperty('quotationNextNumber');
    expect(clean).not.toHaveProperty('poNextNumber');
  });

  it('strips system/identity fields (_id, createdAt, updatedAt, __v)', () => {
    const body = { businessName: 'ALMTech', _id: 'x', createdAt: 'x', updatedAt: 'x', __v: 0 };
    expect(pickWritableSettingsFields(body)).toEqual({ businessName: 'ALMTech' });
  });

  it('strips arbitrary unknown fields', () => {
    const body = { businessName: 'ALMTech', someRandomField: 'whatever' };
    expect(pickWritableSettingsFields(body)).toEqual({ businessName: 'ALMTech' });
  });
});

// ===========================================================================
// updateSettings — DB-backed proof that the real handler (not just the pure
// allowlist function) rejects counter/system-field injection end to end while
// every field the Settings page round-trips on every save still persists.
// ===========================================================================
describe('updateSettings (DB-backed)', () => {
  let mem;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await Settings.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  function mockRes() {
    const res = { json: (body) => { res.body = body; return res; } };
    return res;
  }

  it('injecting invoiceNextNumber does not change the stored counter', async () => {
    await Settings.create({ invoiceNextNumber: 42 });
    const res = mockRes();
    await updateSettings({ body: { businessName: 'New Name', invoiceNextNumber: 999 } }, res);
    expect(res.body.invoiceNextNumber).toBe(42);
    const reloaded = await Settings.findOne();
    expect(reloaded.invoiceNextNumber).toBe(42);
    expect(reloaded.businessName).toBe('New Name');
  });

  it('every field the frontend Settings page actually edits still persists', async () => {
    await Settings.create({});
    const res = mockRes();
    await updateSettings({
      body: {
        businessName: 'Acme Traders', email: 'ops@acme.test', phone: '0300', taxNumber: 'NTN-1',
        address: 'Lahore', logoUrl: 'https://x/logo.png', currency: 'USD', defaultTaxRate: 17,
        invoicePrefix: 'AC-INV-', quotationPrefix: 'AC-QT-', poPrefix: 'AC-PO-', showTaxOnInvoices: false,
      },
    }, res);
    expect(res.body.businessName).toBe('Acme Traders');
    expect(res.body.currency).toBe('USD');
    expect(res.body.defaultTaxRate).toBe(17);
    expect(res.body.showTaxOnInvoices).toBe(false);
    const reloaded = await Settings.findOne();
    expect(reloaded.invoicePrefix).toBe('AC-INV-');
    expect(reloaded.poPrefix).toBe('AC-PO-');
  });

  it('arbitrary unknown fields are not persisted', async () => {
    await Settings.create({});
    const res = mockRes();
    await updateSettings({ body: { businessName: 'X', hackerField: 'pwned' } }, res);
    const reloaded = await Settings.findOne().lean();
    expect(reloaded).not.toHaveProperty('hackerField');
  });
});
