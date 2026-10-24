import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import routes from './product.routes.js';
import invoiceRoutes from './invoice.routes.js';
import { errorHandler } from '../middleware/error.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import StockMovement from '../models/StockMovement.js';
import Activity from '../models/Activity.js';
import Invoice from '../models/Invoice.js';
import Customer from '../models/Customer.js';
import Settings from '../models/Settings.js';

const roles = ['admin', 'stock', 'sales'];
let memory;
let server;
let base;
const tokens = {};
const previousSecret = process.env.JWT_SECRET;

beforeAll(async () => {
  process.env.JWT_SECRET = 'isolated-product-route-regression-secret';
  memory = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(memory.getUri());
  await Product.init();
  for (const role of roles) {
    const user = await User.create({ name: role, email: `${role}@example.test`, password: 'testpassword', role });
    tokens[role] = jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion }, process.env.JWT_SECRET);
  }
  const app = express();
  app.use(express.json());
  app.use('/products', routes);
  app.use('/invoices', invoiceRoutes);
  app.use(errorHandler);
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await Promise.all([Product.deleteMany({}), StockMovement.deleteMany({}), Activity.deleteMany({}), Invoice.deleteMany({}), Customer.deleteMany({}), Settings.deleteMany({})]);
});

afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  await memory?.stop();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

async function request(role, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function makeProduct() {
  return Product.create({
    name: 'Laptop', sku: 'EDIT-1', stock: 3, tracksSerials: true, purchasePrice: 500, sellingPrice: 900,
    comments: 'Original comment', serials: ['SN-1', 'SN-2', 'SN-3'].map(serial => ({ serial, status: 'in_stock' })),
  });
}

describe.each(roles)('ordinary product edits through the API (%s)', role => {
  it.each([
    ['stock', 99], ['serials', []], ['tracksSerials', false],
    ['serials.0.status', 'in_stock'], ['stockMovements', []],
    ['$set', { stock: 99 }], ['_id', new mongoose.Types.ObjectId().toString()],
    ['createdAt', '2020-01-01'], ['updatedAt', '2020-01-01'], ['__v', 100], ['unknownField', 'value'],
  ])('rejects %s without partially saving a legitimate edit', async (field, value) => {
    const product = await makeProduct();
    const before = await Product.findById(product._id).lean();
    const response = await request(role, 'PATCH', `/products/${product._id}`, { name: 'Must not save', [field]: value });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain(field);
    expect(response.body.message).toContain('cannot be changed through product edits');
    expect(await Product.findById(product._id).lean()).toEqual(before);
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(await Activity.countDocuments({ action: 'product_updated' })).toBe(0);
  });

  it('preserves catalogue edits and existing price/comment role restrictions', async () => {
    const product = await makeProduct();
    const response = await request(role, 'PATCH', `/products/${product._id}`, {
      name: 'Updated laptop', sku: 'EDIT-2', brand: 'Lenovo', model: 'X1', category: 'Laptops',
      description: 'Updated description', processor: 'i7', ram: '32GB', storage: '1TB SSD',
      graphics: 'Iris Xe', screen: '14 inch', condition: 'used', warranty: '1 year',
      image: '/laptop.png', lowStockThreshold: 2, barcode: '  BAR-1  ',
      purchasePrice: 600, sellingPrice: 1000, comments: 'Updated comment',
    });
    expect(response.status).toBe(200);
    const saved = await Product.findById(product._id);
    expect(saved).toMatchObject({ name: 'Updated laptop', sku: 'EDIT-2', brand: 'Lenovo', model: 'X1', category: 'Laptops', description: 'Updated description', processor: 'i7', ram: '32GB', storage: '1TB SSD', graphics: 'Iris Xe', screen: '14 inch', condition: 'used', warranty: '1 year', image: '/laptop.png', lowStockThreshold: 2, barcode: 'BAR-1', sellingPrice: 1000, stock: 3, tracksSerials: true });
    expect(saved.purchasePrice).toBe(role === 'sales' ? 500 : 600);
    expect(saved.comments).toBe(role === 'sales' ? 'Original comment' : 'Updated comment');
    if (role === 'sales') {
      expect(response.body).not.toHaveProperty('purchasePrice');
      expect(response.body).not.toHaveProperty('comments');
    }
    expect(await StockMovement.countDocuments()).toBe(0);
    expect(await Activity.countDocuments({ action: 'product_updated' })).toBe(1);
    const clearBarcode = await request(role, 'PATCH', `/products/${product._id}`, { barcode: '' });
    expect(clearBarcode.status).toBe(200);
    expect((await Product.findById(product._id)).barcode).toBeUndefined();
  });

  it('still permits authorized stock adjustments with movement history', async () => {
    const product = await makeProduct();
    const response = await request(role, 'POST', `/products/${product._id}/adjust`, { quantity: -1, note: 'Count correction' });
    expect(response.status).toBe(200);
    expect((await Product.findById(product._id)).stock).toBe(2);
    expect(await StockMovement.findOne({ product: product._id }).lean()).toMatchObject({ quantity: -1, type: 'adjustment', balanceAfter: 2, note: 'Count correction' });
    const invalid = await request(role, 'POST', `/products/${product._id}/adjust`, { quantity: 1.5 });
    expect(invalid.status).toBe(400);
    expect((await Product.findById(product._id)).stock).toBe(2);
  });

  it('keeps initial stock and serial tracking creation behaviour', async () => {
    const response = await request(role, 'POST', '/products', { name: 'New laptop', sku: 'NEW-1', stock: 2, tracksSerials: true, purchasePrice: 500, sellingPrice: 900 });
    expect(response.status).toBe(201);
    const saved = await Product.findById(response.body._id);
    expect(saved).toMatchObject({ stock: 2, tracksSerials: true, sellingPrice: 900 });
    expect(saved.purchasePrice).toBe(role === 'sales' ? 0 : 500);
  });
});

it('preserves inventory changed by a sale after the product form was loaded', async () => {
  const product = await makeProduct();
  const stale = await Product.findById(product._id).lean();
  const customer = await Customer.create({ name: 'Test customer' });
  const sale = await request('admin', 'POST', '/invoices', {
    idempotencyKey: 'stale-product-sale', customer: String(customer._id), items: [{ product: String(product._id), quantity: 1, unitPrice: 800, serials: ['SN-1'] }],
  });
  expect(sale.status).toBe(201);
  const inventoryAfterSale = await Product.findById(product._id).lean();
  expect(inventoryAfterSale.stock).toBe(2);
  expect(inventoryAfterSale.serials[0].status).toBe('sold');
  const rejected = await request('admin', 'PATCH', `/products/${product._id}`, { ...stale, name: 'Stale edit' });
  expect(rejected.status).toBe(400);
  expect(await Product.findById(product._id).lean()).toEqual(inventoryAfterSale);
  const edited = await request('admin', 'PATCH', `/products/${product._id}`, { name: 'Safe edit', ram: '32GB' });
  expect(edited.status).toBe(200);
  const afterEdit = await Product.findById(product._id).lean();
  expect(afterEdit.stock).toBe(2);
  expect(afterEdit.serials).toEqual(inventoryAfterSale.serials);
  expect(afterEdit.name).toBe('Safe edit');
  expect(await StockMovement.countDocuments({ product: product._id, type: 'sale' })).toBe(1);
  expect((await Invoice.findById(sale.body._id)).items[0].serials).toEqual(['SN-1']);
});

it('continues to reject unauthenticated product edits and adjustments', async () => {
  const product = await makeProduct();
  expect((await request(null, 'PATCH', `/products/${product._id}`, { name: 'Unauthorized' })).status).toBe(401);
  expect((await request(null, 'POST', `/products/${product._id}/adjust`, { quantity: 1 })).status).toBe(401);
  expect((await Product.findById(product._id)).stock).toBe(3);
});
