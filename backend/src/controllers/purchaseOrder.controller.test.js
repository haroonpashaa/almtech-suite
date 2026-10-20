import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Supplier from '../models/Supplier.js';
import Product from '../models/Product.js';
import Account from '../models/Account.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import '../models/User.js'; // registers the schema so .populate('createdBy') can resolve it
import {
  createPO, updatePO, receiveItems, recordSupplierPayment, reverseSupplierPayment, listPOs, getPO,
} from './purchaseOrder.controller.js';

describe('Purchase Order editing (DB-backed)', () => {
  let mem;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    process.env.EXCHANGE_RATE_API_KEY = 'test-only-key';
    vi.stubGlobal('fetch', async (url) => {
      const base = String(url).split('/').at(-1);
      const time = Math.floor(Date.now() / 1000);
      return { ok: true, json: async () => ({ result: 'success', base_code: base, conversion_rates: base === 'GBP' ? { GBP: 1, PKR: 360 } : { GBP: 1 / 360, PKR: 1 }, time_last_update_unix: time - 60, time_next_update_unix: time + 86400 }) };
    });
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await PurchaseOrder.deleteMany({});
    await Product.deleteMany({});
    await Supplier.deleteMany({});
    await Account.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
    vi.unstubAllGlobals();
    delete process.env.EXCHANGE_RATE_API_KEY;
  });

  function mockRes() {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    return res;
  }
  function req(overrides) {
    return { user: { _id: userId }, params: {}, body: {}, ...overrides };
  }

  async function makeSupplier(name = 'Supplier A') {
    return Supplier.create({ name });
  }
  async function makeProduct(sku, purchasePrice = 0) {
    return Product.create({ sku, name: `Product ${sku}`, stock: 0, purchasePrice });
  }
  async function makeAccount() {
    return Account.create({ name: 'Test Cash', type: 'cash' });
  }

  async function callCreatePO(supplier, items, extra = {}) {
    const res = mockRes();
    await createPO(req({ body: { supplier: supplier._id.toString(), items, ...extra } }), res);
    return res.body;
  }
  // Mirrors what a real client does: it echoes back the `updatedAt` it saw when
  // it loaded the PO for editing. Callers that want to test staleness explicitly
  // pass their own `expectedUpdatedAt` in `body` to override this default.
  async function callUpdatePO(po, body) {
    const res = mockRes();
    const payload = { expectedUpdatedAt: po.updatedAt.toISOString(), ...body };
    try {
      await updatePO(req({ params: { id: po._id.toString() }, body: payload }), res);
      return { status: res.statusCode, body: res.body };
    } catch (err) {
      return { status: res.statusCode, body: { message: err.message } };
    }
  }
  async function callReceive(po, receipts) {
    const res = mockRes();
    await receiveItems(req({ params: { id: po._id.toString() }, body: { receipts } }), res);
    return res.body;
  }

  // =========================================================================
  it('1. an unreceived PO can be edited', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]);
    const { status, body } = await callUpdatePO(po, {
      items: [{ product: p1._id.toString(), quantity: 10, unitCost: 150 }],
      taxRate: 0,
    });
    expect(status).toBe(200);
    expect(body.items[0].quantity).toBe(10);
    expect(body.items[0].unitCost).toBe(150);
  });

  it('2. PO totals are recalculated correctly', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]);
    const { body } = await callUpdatePO(po, {
      items: [{ product: p1._id.toString(), quantity: 10, unitCost: 100 }],
      taxRate: 10,
    });
    expect(body.subtotal).toBe(1000);
    expect(body.taxAmount).toBe(100);
    expect(body.total).toBe(1100);
    expect(body.balance).toBe(1100);
  });

  it('stores a GBP payable snapshot and retains prior snapshots when an eligible edit changes its amount', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-GBP');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 2, unitCost: 10.25 }], { currency: 'GBP' });
    expect(po.currency).toBe('GBP');
    expect(po.fxSnapshots).toHaveLength(1);
    expect(po.fxSnapshots[0]).toMatchObject({ fromCurrency: 'GBP', toCurrency: 'PKR', originalAmount: 20.5, source: 'ExchangeRate-API' });
    const original = po.fxSnapshots[0];
    const { status, body } = await callUpdatePO(po, { items: [{ product: p1._id.toString(), quantity: 2, unitCost: 12 }] });
    expect(status).toBe(200);
    expect(body.fxSnapshots).toHaveLength(2);
    expect(body.fxSnapshots[0].rate).toBe(original.rate);
    expect(body.fxSnapshots[0].originalAmount).toBe(20.5);
    expect(body.fxSnapshots[1].originalAmount).toBe(24);
    expect((await Supplier.findById(supplier._id)).payableGBP).toBe(24);
  });

  it('rejects a GBP payable payment from a PKR account without changing either balance', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-GBP');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 1, unitCost: 50 }], { currency: 'GBP' });
    const account = await Account.create({ name: 'PKR Cash', type: 'cash', currency: 'PKR', openingBalance: 100, currentBalance: 100 });
    const res = mockRes();
    await expect(recordSupplierPayment(req({ params: { id: po._id.toString() }, body: { amount: 10, account: account._id.toString() } }), res)).rejects.toThrow(/must be denominated in GBP/i);
    expect((await PurchaseOrder.findById(po._id)).balance).toBe(50);
    expect((await Supplier.findById(supplier._id)).payableGBP).toBe(50);
    expect((await Account.findById(account._id)).currentBalance).toBe(100);
  });

  it('posts a GBP payable payment only to a GBP account and reconciles the GBP balance', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-GBP');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 1, unitCost: 50 }], { currency: 'GBP' });
    const account = await Account.create({ name: 'GBP Bank', type: 'bank', currency: 'GBP', openingBalance: 100, currentBalance: 100 });
    const res = mockRes();
    await recordSupplierPayment(req({ params: { id: po._id.toString() }, body: { amount: 10, account: account._id.toString(), idempotencyKey: 'gbp-payment-test' } }), res);
    const savedPO = await PurchaseOrder.findById(po._id);
    const savedSupplier = await Supplier.findById(supplier._id);
    const savedAccount = await Account.findById(account._id);
    expect(savedPO.payments[0].currency).toBe('GBP');
    expect(savedPO.balance).toBe(40);
    expect(savedSupplier.payableGBP).toBe(40);
    expect(savedSupplier.payable).toBe(0);
    expect(savedAccount.currentBalance).toBe(90);
    expect(await FinancialTransaction.exists({ account: account._id, currency: 'GBP', amount: 10 })).toBeTruthy();
  });

  it('does not receive GBP POs into currency-less product inventory costs', async () => {
    const supplier = await makeSupplier();
    const product = await makeProduct('SKU-GBP');
    const po = await callCreatePO(supplier, [{ product: product._id.toString(), quantity: 1, unitCost: 50 }], { currency: 'GBP' });
    await expect(callReceive(po, [{ product: product._id.toString(), quantity: 1 }])).rejects.toThrow(/Receiving GBP purchase orders is disabled/i);
    expect((await Product.findById(product._id)).stock).toBe(0);
    expect((await PurchaseOrder.findById(po._id)).items[0].received).toBe(0);
  });

  it('3 & 12. Supplier payable changes by the correct delta on an allowed edit', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]); // total 500
    let s = await Supplier.findById(supplier._id);
    expect(s.payable).toBe(500);

    await callUpdatePO(po, { items: [{ product: p1._id.toString(), quantity: 5, unitCost: 200 }], taxRate: 0 }); // new total 1000
    s = await Supplier.findById(supplier._id);
    expect(s.payable).toBe(1000); // delta of +500 applied, not a fresh overwrite that could drift
  });

  it('4. no duplicate payable is created across repeated edits', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]); // 500
    let current = po;
    for (const cost of [120, 90, 300]) {
      const { body } = await callUpdatePO(current, { items: [{ product: p1._id.toString(), quantity: 5, unitCost: cost }] });
      current = body;
    }
    const s = await Supplier.findById(supplier._id);
    // Final total is 5*300 = 1500; payable must equal exactly that, not an accumulation of every intermediate total.
    expect(s.payable).toBe(1500);
    expect(current.total).toBe(1500);
  });

  it('5. a partial PO cannot reduce ordered quantity below received quantity', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 10, unitCost: 100 }]);
    await callReceive(po, [{ product: p1._id.toString(), quantity: 4 }]);
    const fresh = await PurchaseOrder.findById(po._id);
    const { status, body } = await callUpdatePO(fresh, { items: [{ product: p1._id.toString(), quantity: 3, unitCost: 100 }] });
    expect(status).toBe(400);
    expect(body.message).toMatch(/cannot be less than the 4 already received/);
  });

  it('6. received quantity cannot be directly modified via the request body', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 10, unitCost: 100 }]);
    await callReceive(po, [{ product: p1._id.toString(), quantity: 4 }]);
    const fresh = await PurchaseOrder.findById(po._id);
    const { body } = await callUpdatePO(fresh, {
      items: [{ product: p1._id.toString(), quantity: 10, unitCost: 100, received: 999 }],
    });
    expect(body.items[0].received).toBe(4); // the injected `received: 999` is ignored entirely
  });

  it('7. already-received inventory purchase price is not retroactively rewritten', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 10, unitCost: 100 }]);
    await callReceive(po, [{ product: p1._id.toString(), quantity: 4 }]); // Product.purchasePrice becomes 100
    let product = await Product.findById(p1._id);
    expect(product.purchasePrice).toBe(100);

    const fresh = await PurchaseOrder.findById(po._id);
    // Attempting to change the cost of a line that has received units must be rejected.
    const { status, body } = await callUpdatePO(fresh, {
      items: [{ product: p1._id.toString(), quantity: 10, unitCost: 500 }],
    });
    expect(status).toBe(409);
    expect(body.message).toMatch(/unit cost cannot be changed/);
    product = await Product.findById(p1._id);
    expect(product.purchasePrice).toBe(100); // unaffected
  });

  it('7b. quantity CAN be raised on a partially-received line, cost staying locked', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 10, unitCost: 100 }]);
    await callReceive(po, [{ product: p1._id.toString(), quantity: 4 }]);
    const fresh = await PurchaseOrder.findById(po._id);
    const { status, body } = await callUpdatePO(fresh, {
      items: [{ product: p1._id.toString(), quantity: 20, unitCost: 100 }], // same cost, higher qty — allowed
    });
    expect(status).toBe(200);
    expect(body.items[0].quantity).toBe(20);
    expect(body.items[0].received).toBe(4);
    expect(body.items[0].unitCost).toBe(100);
  });

  it('8. a fully received PO cannot have financial fields edited', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]);
    await callReceive(po, [{ product: p1._id.toString(), quantity: 5 }]);
    const fresh = await PurchaseOrder.findById(po._id);
    expect(fresh.status).toBe('received');
    const { status, body } = await callUpdatePO(fresh, { items: [{ product: p1._id.toString(), quantity: 10, unitCost: 100 }] });
    expect(status).toBe(409);
    expect(body.message).toMatch(/fully received/);
    // Notes-only edit must still be allowed on a fully received PO.
    const { status: notesStatus, body: notesBody } = await callUpdatePO(fresh, { notes: 'Delivered in good condition' });
    expect(notesStatus).toBe(200);
    expect(notesBody.notes).toBe('Delivered in good condition');
  });

  it('9. a PO with payments cannot be edited financially, but notes remain editable', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const account = await makeAccount();
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]); // total 500
    const payRes = mockRes();
    await recordSupplierPayment(req({ params: { id: po._id.toString() }, body: { amount: 200, account: account._id.toString() } }), payRes);
    expect(payRes.body.paid).toBe(200);

    const fresh = await PurchaseOrder.findById(po._id);
    const { status, body } = await callUpdatePO(fresh, { items: [{ product: p1._id.toString(), quantity: 5, unitCost: 50 }] });
    expect(status).toBe(409);
    expect(body.message).toMatch(/payments recorded/);

    const { status: notesStatus } = await callUpdatePO(fresh, { notes: 'ok' });
    expect(notesStatus).toBe(200);
  });

  it('10. unauthorized field injection cannot set protected values (status/paid/balance/supplier payable/_id)', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]);
    const fakeId = new mongoose.Types.ObjectId().toString();
    const { body } = await callUpdatePO(po, {
      items: [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }],
      status: 'cancelled', paid: 99999, balance: -1, _id: fakeId, createdAt: '2000-01-01',
    });
    expect(body._id.toString()).not.toBe(fakeId);
    expect(body.status).not.toBe('cancelled');
    expect(body.paid).toBe(0);
    expect(new Date(body.createdAt).getFullYear()).not.toBe(2000);
  });

  it('10b. arbitrary unknown fields are not persisted', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]);
    const { body } = await callUpdatePO(po, { notes: 'x', hackerField: 'pwned' });
    expect(body).not.toHaveProperty('hackerField');
    const reloaded = await PurchaseOrder.findById(po._id).lean();
    expect(reloaded).not.toHaveProperty('hackerField');
  });

  it('a cancelled PO cannot be edited at all', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]);
    await PurchaseOrder.updateOne({ _id: po._id }, { $set: { status: 'cancelled' } });
    const fresh = await PurchaseOrder.findById(po._id);
    const { status, body } = await callUpdatePO(fresh, { notes: 'x' });
    expect(status).toBe(409);
    expect(body.message).toMatch(/cancelled/);
  });

  it('a line that has received units cannot be removed from the PO', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const p2 = await makeProduct('SKU-2');
    const po = await callCreatePO(supplier, [
      { product: p1._id.toString(), quantity: 5, unitCost: 100 },
      { product: p2._id.toString(), quantity: 5, unitCost: 50 },
    ]);
    await callReceive(po, [{ product: p1._id.toString(), quantity: 2 }]);
    const fresh = await PurchaseOrder.findById(po._id);
    const { status, body } = await callUpdatePO(fresh, { items: [{ product: p2._id.toString(), quantity: 5, unitCost: 50 }] });
    expect(status).toBe(400);
    expect(body.message).toMatch(/cannot be removed/);
  });

  it('a fully-unreceived line can be removed freely, and a new line added', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const p2 = await makeProduct('SKU-2');
    const p3 = await makeProduct('SKU-3');
    const po = await callCreatePO(supplier, [
      { product: p1._id.toString(), quantity: 5, unitCost: 100 },
      { product: p2._id.toString(), quantity: 5, unitCost: 50 },
    ]);
    const { status, body } = await callUpdatePO(po, {
      items: [
        { product: p1._id.toString(), quantity: 5, unitCost: 100 },
        { product: p3._id.toString(), quantity: 2, unitCost: 20 },
      ],
    });
    expect(status).toBe(200);
    expect(body.items.map((l) => l.sku).sort()).toEqual(['SKU-1', 'SKU-3']);
  });

  it('supplier can be changed on a fully-unreceived, unpaid PO, moving the payable correctly', async () => {
    const supplierA = await makeSupplier('Supplier A');
    const supplierB = await makeSupplier('Supplier B');
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplierA, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]); // 500
    const { status, body } = await callUpdatePO(po, {
      supplier: supplierB._id.toString(),
      items: [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }],
    });
    expect(status).toBe(200);
    expect(body.supplier._id.toString()).toBe(supplierB._id.toString());
    const a = await Supplier.findById(supplierA._id);
    const b = await Supplier.findById(supplierB._id);
    expect(a.payable).toBe(0);
    expect(b.payable).toBe(500);
  });

  it('supplier cannot be changed once anything has been received', async () => {
    const supplierA = await makeSupplier('Supplier A');
    const supplierB = await makeSupplier('Supplier B');
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplierA, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]);
    await callReceive(po, [{ product: p1._id.toString(), quantity: 1 }]);
    const fresh = await PurchaseOrder.findById(po._id);
    const { status, body } = await callUpdatePO(fresh, {
      supplier: supplierB._id.toString(),
      items: [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }],
    });
    expect(status).toBe(409);
    expect(body.message).toMatch(/supplier cannot be changed/i);
  });

  it('duplicate products in the edit payload are rejected', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]);
    const { status, body } = await callUpdatePO(po, {
      items: [
        { product: p1._id.toString(), quantity: 5, unitCost: 100 },
        { product: p1._id.toString(), quantity: 2, unitCost: 100 },
      ],
    });
    expect(status).toBe(400);
    expect(body.message).toMatch(/Duplicate product/);
  });

  it('concurrency: an edit based on a stale read is rejected after a receive happens in between', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 10, unitCost: 100 }]);
    const stale = await PurchaseOrder.findById(po._id); // simulate a client that opened the edit form...
    await callReceive(po, [{ product: p1._id.toString(), quantity: 3 }]); // ...then someone else received against it...
    const { status, body } = await callUpdatePO(stale, { // ...before the stale edit is submitted
      items: [{ product: p1._id.toString(), quantity: 10, unitCost: 100 }],
    });
    expect(status).toBe(409);
    expect(body.message).toMatch(/changed since you opened it/);
  });

  // =========================================================================
  // Regression: existing PO workflows are unaffected by this change.
  // =========================================================================
  it('13. existing PO creation still works', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 3, unitCost: 40 }]);
    expect(po.total).toBe(120);
    expect(po.status).toBe('ordered');
    const s = await Supplier.findById(supplier._id);
    expect(s.payable).toBe(120);
  });

  it('14. existing receiving still works, including stock and purchasePrice updates', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1', 0);
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 75 }]);
    await callReceive(po, [{ product: p1._id.toString(), quantity: 5 }]);
    const product = await Product.findById(p1._id);
    expect(product.stock).toBe(5);
    expect(product.purchasePrice).toBe(75);
    const fresh = await PurchaseOrder.findById(po._id);
    expect(fresh.status).toBe('received');
  });

  // =========================================================================
  // H1 — serial numbers must be globally unique across products, and a
  // conflict must reject the whole receive request before any stock moves.
  // =========================================================================
  it('H1: rejects receiving a serial already assigned to a different product, before any stock moves', async () => {
    const supplier = await makeSupplier();
    const pA = await Product.create({ sku: 'SKU-A', name: 'Product A', stock: 0, tracksSerials: true, serials: [{ serial: 'SN-DUP', status: 'in_stock' }] });
    const pB = await makeProduct('SKU-B');
    await Product.updateOne({ _id: pB._id }, { $set: { tracksSerials: true } });

    const po = await callCreatePO(supplier, [{ product: pB._id.toString(), quantity: 1, unitCost: 50 }]);
    await expect(callReceive(po, [{ product: pB._id.toString(), quantity: 1, serials: ['SN-DUP'] }]))
      .rejects.toThrow(/already assigned to Product A \(SKU SKU-A\)/);

    // No partial update: neither the PO line nor product B's stock moved.
    const freshPO = await PurchaseOrder.findById(po._id);
    expect(freshPO.items[0].received).toBe(0);
    expect(freshPO.status).toBe('ordered');
    const freshB = await Product.findById(pB._id);
    expect(freshB.stock).toBe(0);
    expect(freshB.serials).toHaveLength(0);
    // Product A (the true owner) is untouched too.
    const freshA = await Product.findById(pA._id);
    expect(freshA.serials).toHaveLength(1);
  });

  it('H1: rejects two different products in the SAME request claiming the same new serial', async () => {
    const supplier = await makeSupplier();
    const pA = await makeProduct('SKU-A');
    const pB = await makeProduct('SKU-B');
    await Product.updateMany({ _id: { $in: [pA._id, pB._id] } }, { $set: { tracksSerials: true } });
    const po = await callCreatePO(supplier, [
      { product: pA._id.toString(), quantity: 1, unitCost: 50 },
      { product: pB._id.toString(), quantity: 1, unitCost: 50 },
    ]);
    await expect(callReceive(po, [
      { product: pA._id.toString(), quantity: 1, serials: ['SN-NEW'] },
      { product: pB._id.toString(), quantity: 1, serials: ['SN-NEW'] },
    ])).rejects.toThrow(/being received onto more than one product/);

    const freshA = await Product.findById(pA._id);
    const freshB = await Product.findById(pB._id);
    expect(freshA.stock).toBe(0);
    expect(freshB.stock).toBe(0);
  });

  it('H1: re-receiving a serial the SAME product already has is not treated as a conflict', async () => {
    const supplier = await makeSupplier();
    const pA = await Product.create({ sku: 'SKU-A', name: 'Product A', stock: 1, tracksSerials: true, serials: [{ serial: 'SN-EXIST', status: 'in_stock' }] });
    const po = await callCreatePO(supplier, [{ product: pA._id.toString(), quantity: 1, unitCost: 50 }]);
    const body = await callReceive(po, [{ product: pA._id.toString(), quantity: 1, serials: ['SN-EXIST'] }]);
    expect(body.status).toBe('received');
    const fresh = await Product.findById(pA._id);
    expect(fresh.serials).toHaveLength(1); // not duplicated onto itself
  });

  it('H1: distinct serials across two different products in one request succeed normally', async () => {
    const supplier = await makeSupplier();
    const pA = await makeProduct('SKU-A');
    const pB = await makeProduct('SKU-B');
    await Product.updateMany({ _id: { $in: [pA._id, pB._id] } }, { $set: { tracksSerials: true } });
    const po = await callCreatePO(supplier, [
      { product: pA._id.toString(), quantity: 1, unitCost: 50 },
      { product: pB._id.toString(), quantity: 1, unitCost: 50 },
    ]);
    const body = await callReceive(po, [
      { product: pA._id.toString(), quantity: 1, serials: ['SN-A1'] },
      { product: pB._id.toString(), quantity: 1, serials: ['SN-B1'] },
    ]);
    expect(body.status).toBe('received');
    expect((await Product.findById(pA._id)).serials.map((s) => s.serial)).toEqual(['SN-A1']);
    expect((await Product.findById(pB._id)).serials.map((s) => s.serial)).toEqual(['SN-B1']);
  });

  it('15. existing supplier payment still works', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const account = await makeAccount();
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]); // 500
    const res = mockRes();
    await recordSupplierPayment(req({ params: { id: po._id.toString() }, body: { amount: 300, account: account._id.toString() } }), res);
    expect(res.body.paid).toBe(300);
    expect(res.body.balance).toBe(200);
    const s = await Supplier.findById(supplier._id);
    expect(s.payable).toBe(200);
  });

  it('16. existing payment reversal still works', async () => {
    const supplier = await makeSupplier();
    const p1 = await makeProduct('SKU-1');
    const account = await makeAccount();
    const po = await callCreatePO(supplier, [{ product: p1._id.toString(), quantity: 5, unitCost: 100 }]);
    const payRes = mockRes();
    await recordSupplierPayment(req({ params: { id: po._id.toString() }, body: { amount: 300, account: account._id.toString() } }), payRes);

    const revRes = mockRes();
    await reverseSupplierPayment(req({ params: { id: po._id.toString(), paymentId: '0' }, body: { reason: 'test' } }), revRes);
    expect(revRes.body.paid).toBe(0);
    expect(revRes.body.balance).toBe(500);
    const s = await Supplier.findById(supplier._id);
    expect(s.payable).toBe(500);
  });
});

// ===========================================================================
// Notes visibility (DB-backed) — Sales can only ever reach listPOs/getPO (every
// write route is admin/stock-only at the router level), so those are the only
// two places notes could leak to Sales. Admin and Stock keep seeing notes
// exactly as before.
// ===========================================================================
describe('Purchase order notes visibility (DB-backed)', () => {
  let mem;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
    process.env.EXCHANGE_RATE_API_KEY = 'test-only-key';
    vi.stubGlobal('fetch', async (url) => {
      const base = String(url).split('/').at(-1);
      const time = Math.floor(Date.now() / 1000);
      return { ok: true, json: async () => ({ result: 'success', base_code: base, conversion_rates: base === 'GBP' ? { GBP: 1, PKR: 360 } : { GBP: 1 / 360, PKR: 1 }, time_last_update_unix: time - 60, time_next_update_unix: time + 86400 }) };
    });
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterEach(async () => {
    await PurchaseOrder.deleteMany({});
    await Product.deleteMany({});
    await Supplier.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
    vi.unstubAllGlobals();
    delete process.env.EXCHANGE_RATE_API_KEY;
  });

  function mockRes() {
    const headers = {};
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      set: (k, v) => { headers[String(k).toLowerCase()] = String(v); return res; },
      get: (k) => headers[String(k).toLowerCase()],
      json(body) { this.body = body; return this; },
    };
    return res;
  }

  async function makePO(notes = 'Call supplier before delivery') {
    const supplier = await Supplier.create({ name: 'Supplier A' });
    const product = await Product.create({ sku: 'PO-NOTE-1', name: 'Product', stock: 0 });
    return PurchaseOrder.create({
      number: 'PO-0001',
      supplier: supplier._id,
      items: [{ product: product._id, name: product.name, sku: product.sku, quantity: 1, unitCost: 10, lineTotal: 10 }],
      subtotal: 10,
      total: 10,
      balance: 10,
      notes,
      createdBy: userId,
    });
  }

  it('getPO hides notes from a sales user but keeps them for admin/stock', async () => {
    const po = await makePO();

    const salesRes = mockRes();
    await getPO({ params: { id: po._id.toString() }, user: { role: 'sales' } }, salesRes);
    expect(salesRes.body.notes).toBeUndefined();

    const adminRes = mockRes();
    await getPO({ params: { id: po._id.toString() }, user: { role: 'admin' } }, adminRes);
    expect(adminRes.body.notes).toBe('Call supplier before delivery');

    const stockRes = mockRes();
    await getPO({ params: { id: po._id.toString() }, user: { role: 'stock' } }, stockRes);
    expect(stockRes.body.notes).toBe('Call supplier before delivery');
  });

  it('listPOs hides notes from a sales user but keeps them for admin', async () => {
    await makePO();

    const salesRes = mockRes();
    await listPOs({ query: {}, user: { role: 'sales' } }, salesRes);
    expect(salesRes.body[0].notes).toBeUndefined();

    const adminRes = mockRes();
    await listPOs({ query: {}, user: { role: 'admin' } }, adminRes);
    expect(adminRes.body[0].notes).toBe('Call supplier before delivery');
  });

  it('filters the purchase order list by supplier, status, number and date window', async () => {
    const supplier = await Supplier.create({ name: 'Filter supplier' });
    const otherSupplier = await Supplier.create({ name: 'Other supplier' });
    const product = await Product.create({ sku: 'FILTER-PO', name: 'Filter product', stock: 0 });
    const makeFilteredPO = (number, supplierId) => PurchaseOrder.create({
      number, supplier: supplierId, items: [{ product: product._id, name: product.name, sku: product.sku, quantity: 1, unitCost: 20, lineTotal: 20 }],
      subtotal: 20, total: 20, balance: 20, status: 'ordered',
    });
    const match = await makeFilteredPO('PO-FILTER-1', supplier._id);
    await makeFilteredPO('PO-OTHER-2', otherSupplier._id);

    const res = mockRes();
    await listPOs({ query: { supplier: supplier._id.toString(), status: 'ordered', search: match.number, from: '2020-01-01', to: '2035-12-31' }, user: { role: 'admin' } }, res);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].number).toBe(match.number);

    const empty = mockRes();
    await listPOs({ query: { search: 'no-such-order' }, user: { role: 'admin' } }, empty);
    expect(empty.body).toEqual([]);
  });
});
