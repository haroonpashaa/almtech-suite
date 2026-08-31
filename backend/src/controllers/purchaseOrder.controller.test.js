import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import Supplier from '../models/Supplier.js';
import Product from '../models/Product.js';
import Account from '../models/Account.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import '../models/User.js'; // registers the schema so .populate('createdBy') can resolve it
import {
  createPO, updatePO, receiveItems, recordSupplierPayment, reverseSupplierPayment, listPOs, getPO,
} from './purchaseOrder.controller.js';

describe('Purchase Order editing (DB-backed)', () => {
  let mem;
  const userId = new mongoose.Types.ObjectId();

  beforeAll(async () => {
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
});
