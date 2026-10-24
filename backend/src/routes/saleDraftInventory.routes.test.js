import SaleDraft from '../models/SaleDraft.js';
import InventoryOperation from '../models/InventoryOperation.js';
import draftRoutes from './saleDraft.routes.js';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import productRoutes from './product.routes.js';
import invoiceRoutes from './invoice.routes.js';
import purchaseRoutes from './purchaseOrder.routes.js';
import reportRoutes from './report.routes.js';
import { errorHandler } from '../middleware/error.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import Invoice from '../models/Invoice.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import StockMovement from '../models/StockMovement.js';
import Settings from '../models/Settings.js';
import Activity from '../models/Activity.js';
import Account from '../models/Account.js';
import FinancialTransaction from '../models/FinancialTransaction.js';
import Deal from '../models/Deal.js';

let memory, server, base;
const tokens = {}, oldSecret = process.env.JWT_SECRET;
beforeAll(async () => {
  process.env.JWT_SECRET = 'isolated-inventory-lifecycle-test';
  memory = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(memory.getUri());
  await Promise.all([Product.init(), Invoice.init(), PurchaseOrder.init(), Deal.init(), InventoryOperation.init(), SaleDraft.init(), Account.init(), FinancialTransaction.init()]);
  for (const role of ['admin', 'sales', 'stock']) {
    const user = await User.create({ name: role, email: `${role}@inventory.test`, password: 'isolated-test-password', role });
    tokens[role] = jwt.sign({ id: String(user._id), tokenVersion: user.tokenVersion }, process.env.JWT_SECRET);
  }
  const app = express(); app.use(express.json());
  app.use('/sale-drafts', draftRoutes); app.use('/products', productRoutes); app.use('/invoices', invoiceRoutes); app.use('/purchase-orders', purchaseRoutes); app.use('/reports', reportRoutes); app.use(errorHandler);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
}, 120000);
afterEach(async () => {
  vi.restoreAllMocks();
  for (const Model of [Product, Customer, Supplier, Invoice, PurchaseOrder, StockMovement, Settings, Activity, Account, FinancialTransaction, Deal, SaleDraft, InventoryOperation]) await Model.deleteMany({});
});
afterAll(async () => {
  await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await memory.stop();
  if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
});
async function request(path, method = 'GET', body, role = 'admin') {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}

async function fixture(extra = {}) {
 const product = await Product.create({name:'Laptop',model:'T14',sku:'T14-1',stock:20,purchasePrice:100,...extra});
 const customer = await Customer.create({name:'Buyer'});
 return {product,customer};
}
const payload = (ctx, extra={}) => ({idempotencyKey:'sale-key',customer:String(ctx.customer._id),items:[{product:String(ctx.product._id),quantity:3,unitPrice:150}],...extra});
it('deducts 20 to 17 once, including concurrent and dropped-response retries',async()=>{
 const ctx=await fixture(); const body=payload(ctx); const results=await Promise.all([request('/invoices','POST',body),request('/invoices','POST',body)]);
 expect(results.map(r=>r.status)).toEqual([201,201]); expect(results[0].body._id).toBe(results[1].body._id);
 expect((await request('/invoices','POST',body)).status).toBe(201);
 expect((await Product.findById(ctx.product._id)).stock).toBe(17); expect(await Invoice.countDocuments()).toBe(1); expect(await StockMovement.countDocuments()).toBe(1); expect((await Customer.findById(ctx.customer._id)).balance).toBe(450);
 expect((await request('/invoices','POST',payload(ctx,{notes:'changed'}))).status).toBe(409);
});
it('rolls back the entire keyed sale when initial payment fails',async()=>{
 const ctx=await fixture(); const account=await Account.create({name:'Cash',type:'cash',openingBalance:0,currentBalance:0});
 vi.spyOn(FinancialTransaction,'create').mockRejectedValueOnce(new Error('Isolated payment failure'));
 const body=payload(ctx,{initialPayment:{amount:100,account:account._id,idempotencyKey:'initial-payment'}});
 expect((await request('/invoices','POST',body)).status).toBe(500);
 expect((await Product.findById(ctx.product._id)).stock).toBe(20); expect(await Invoice.countDocuments()).toBe(0); expect(await InventoryOperation.countDocuments()).toBe(0); expect(await StockMovement.countDocuments()).toBe(0);
 expect((await Customer.findById(ctx.customer._id)).balance).toBe(0);expect((await Account.findById(account._id)).currentBalance).toBe(0);
 expect((await request('/invoices','POST',body)).status).toBe(201); expect((await Product.findById(ctx.product._id)).stock).toBe(17);expect((await Account.findById(account._id)).currentBalance).toBe(100);
 expect((await request('/invoices','POST',body)).status).toBe(201);expect(await FinancialTransaction.countDocuments()).toBe(1);
});
it('rejects insufficient stock and validates serials, including automatic available serial selection',async()=>{
 const ctx=await fixture({stock:2,tracksSerials:true,serials:[{serial:'A',status:'in_stock'},{serial:'B',status:'in_stock'},{serial:'SOLD',status:'sold'}]});
 expect((await request('/invoices','POST',payload(ctx))).status).toBe(400);
 expect((await request('/invoices','POST',payload(ctx,{items:[{product:ctx.product._id,quantity:1,unitPrice:150,serials:['SOLD']}]}))).status).toBe(400);
 const result=await request('/invoices','POST',payload(ctx,{items:[{product:ctx.product._id,quantity:1,unitPrice:150}]}));expect(result.status).toBe(201); expect(result.body.items[0].serials).toEqual(['A']);expect((await Product.findById(ctx.product._id)).stock).toBe(1);
});
async function draft(ctx,id='draft-one',role='admin') {
 const state={cart:[{product:String(ctx.product._id),name:'Laptop',model:'T14',quantity:3,unitPrice:150,serials:[]}],customer:String(ctx.customer._id),notes:'Resume me',discount:0,taxRate:0,paymentAmount:0,payKey:'pay-1'};
 const result=await request(`/sale-drafts/${id}`,'PUT',{revision:0,state},role);expect(result.status).toBe(201);return result.body;
}
it('persists drafts across requests without stock, payments or invoice effects; enforces owner and role access',async()=>{
 const ctx=await fixture();const d=await draft(ctx);
 expect((await request('/sale-drafts')).body[0].state).toEqual(d.state);expect((await request('/sale-drafts','GET',undefined,'sales')).body).toEqual([]);
 expect((await request(`/sale-drafts/${d._id}`,'PUT',{revision:1,state:d.state},'sales')).status).toBe(409);
 expect((await request(`/sale-drafts/${d._id}`,'DELETE',{revision:1},'sales')).status).toBe(409);
 expect((await request('/sale-drafts','GET',undefined,'stock')).status).toBe(403);
 expect((await Product.findById(ctx.product._id)).stock).toBe(20);expect(await Invoice.countDocuments()).toBe(0);expect(await FinancialTransaction.countDocuments()).toBe(0);
});
it('saves edits with version checks and discards a draft without affecting inventory',async()=>{
 const ctx=await fixture();const d=await draft(ctx);
 const edit=await request(`/sale-drafts/${d._id}`,'PUT',{revision:1,state:{...d.state,notes:'Updated'}});expect(edit.status).toBe(200);expect(edit.body.revision).toBe(2);
 expect((await request(`/sale-drafts/${d._id}`,'PUT',{revision:1,state:d.state})).status).toBe(409);
 expect((await request(`/sale-drafts/${d._id}`,'DELETE',{revision:2})).status).toBe(200);expect((await request('/sale-drafts')).body).toEqual([]);expect((await Product.findById(ctx.product._id)).stock).toBe(20);
});
it('finalizes a persisted draft exactly once using saved details and rejects later edits',async()=>{
 const ctx=await fixture();const d=await draft(ctx);const body={draftId:d._id,draftVersion:d.revision};
 const results=await Promise.all([request('/invoices','POST',body),request('/invoices','POST',body)]);expect(results.map(r=>r.status)).toEqual([201,201]);expect(results[0].body._id).toBe(results[1].body._id);
 expect(results[0].body.notes).toBe('Resume me');expect((await Product.findById(ctx.product._id)).stock).toBe(17);expect(await Invoice.countDocuments()).toBe(1);expect((await SaleDraft.findById(d._id)).status).toBe('finalized');expect((await request('/sale-drafts')).body).toEqual([]);
 expect((await request(`/sale-drafts/${d._id}`,'PUT',{revision:1,state:d.state})).status).toBe(409);
});
it('revalidates stock on draft finalization and leaves a failed draft editable',async()=>{
 const ctx=await fixture();const d=await draft(ctx);await Product.updateOne({_id:ctx.product._id},{$set:{stock:1}});
 expect((await request('/invoices','POST',{draftId:d._id,draftVersion:1})).status).toBe(400);expect((await SaleDraft.findById(d._id)).status).toBe('active');expect(await Invoice.countDocuments()).toBe(0);expect(await InventoryOperation.countDocuments()).toBe(0);
});
it('removes multiple products atomically, audits each, and deduplicates concurrent retries',async()=>{
 const ctx=await fixture();const other=await Product.create({name:'Other',sku:'OTHER',stock:5});
 const body={idempotencyKey:'remove-many',reason:'Damaged',items:[{product:String(ctx.product._id),quantity:2},{product:String(other._id),quantity:3}]};
 const results=await Promise.all([request('/products/remove-stock','POST',body),request('/products/remove-stock','POST',body)]);expect(results.map(r=>r.status)).toEqual([200,200]);
 expect((await Product.findById(ctx.product._id)).stock).toBe(18);expect((await Product.findById(other._id)).stock).toBe(2);expect(await StockMovement.countDocuments()).toBe(2);expect((await StockMovement.find()).every(m=>m.createdBy && m.createdAt && m.note.includes('Damaged'))).toBe(true);
 expect((await request('/products/remove-stock','POST',{...body,reason:'Different'})).status).toBe(409);
});
it('rejects non-admin bulk removal and a repeated product',async()=>{
 const ctx=await fixture();const body={idempotencyKey:'remove-many',reason:'Damaged',items:[{product:String(ctx.product._id),quantity:1}]};
 for(const role of ['sales','stock'])expect((await request('/products/remove-stock','POST',body,role)).status).toBe(403);
 expect((await request('/products/remove-stock','POST',{...body,items:[...body.items,...body.items]})).status).toBe(400);expect(await StockMovement.countDocuments()).toBe(0);
});
it('rolls back every removal when a later product is unavailable or a later movement fails',async()=>{
 const ctx=await fixture();const other=await Product.create({name:'Other',sku:'OTHER',stock:1});
 const body={idempotencyKey:'remove-many',reason:'Damaged',items:[{product:String(ctx.product._id),quantity:2},{product:String(other._id),quantity:2}]};
 expect((await request('/products/remove-stock','POST',body)).status).toBe(409);expect((await Product.findById(ctx.product._id)).stock).toBe(20);expect(await StockMovement.countDocuments()).toBe(0);
 body.items[1].quantity=1;const original=StockMovement.create.bind(StockMovement);let calls=0;
 vi.spyOn(StockMovement,'create').mockImplementation((...args)=>++calls===2 ? Promise.reject(new Error('Isolated second movement failure')):original(...args));
 expect((await request('/products/remove-stock','POST',body)).status).toBe(500);expect((await Product.findById(ctx.product._id)).stock).toBe(20);expect((await Product.findById(other._id)).stock).toBe(1);expect(await StockMovement.countDocuments()).toBe(0);
});
it('supports serial search and rejects sold/duplicate serials in bulk removals',async()=>{
 const ctx=await fixture({tracksSerials:true,serials:[{serial:'FIND-ME',status:'in_stock'},{serial:'SOLD',status:'sold'}]});
 expect((await request('/products?q=FIND-ME')).body.items[0]._id).toBe(String(ctx.product._id));
 const body={idempotencyKey:'remove-serial',reason:'Damaged',items:[{product:String(ctx.product._id),quantity:1,serials:['SOLD']}]};
 expect((await request('/products/remove-stock','POST',body)).status).toBe(400);body.items[0].serials=['FIND-ME'];expect((await request('/products/remove-stock','POST',body)).status).toBe(200);expect((await Product.findById(ctx.product._id)).serials.map(s=>s.serial)).toEqual(['SOLD']);
});

it('rejects unkeyed finalization and unauthorized access to another user draft without writes',async()=>{
 const ctx=await fixture();const d=await draft(ctx);const unkeyed=payload(ctx);delete unkeyed.idempotencyKey;
 expect((await request('/invoices','POST',unkeyed)).status).toBe(400);
 expect((await request(`/sale-drafts/${d._id}`,'GET',undefined,'sales')).status).toBe(404);
 expect((await request('/invoices','POST',{draftId:d._id,draftVersion:1},'sales')).status).toBe(409);
 expect((await request(`/sale-drafts/${d._id}`)).body.state).toEqual(d.state);
 expect((await Product.findById(ctx.product._id)).stock).toBe(20);expect(await Invoice.countDocuments()).toBe(0);
});
it('rejects malformed draft lines and blank selling prices, retaining the saved draft',async()=>{
 const ctx=await fixture();const d=await draft(ctx);
 expect((await request('/sale-drafts/invalid','PUT',{revision:0,state:{cart:[null]}})).status).toBe(400);
 const edit=await request(`/sale-drafts/${d._id}`,'PUT',{revision:1,state:{...d.state,cart:d.state.cart.map(line=>({...line,unitPrice:''}))}});expect(edit.status).toBe(200);
 expect((await request('/invoices','POST',{draftId:d._id,draftVersion:2})).status).toBe(400);expect((await SaleDraft.findById(d._id)).status).toBe('active');
});

it('applies the credit limit to the net receivable after the atomic initial payment',async()=>{
 const ctx=await fixture();await Customer.updateOne({_id:ctx.customer._id},{$set:{creditLimit:200}});
 const account=await Account.create({name:'Cash',type:'cash'});
 const body=payload(ctx,{initialPayment:{amount:300,account:account._id,idempotencyKey:'credit-payment'}});
 const response=await request('/invoices','POST',body);expect(response.status).toBe(201);expect(response.body.balance).toBe(150);expect(response.body.paid).toBe(300);expect((await Customer.findById(ctx.customer._id)).balance).toBe(150);expect((await Account.findById(account._id)).currentBalance).toBe(300);
 const rejected=await request('/invoices','POST',{...body,idempotencyKey:'second-sale',initialPayment:{...body.initialPayment,idempotencyKey:'second-payment'}});expect(rejected.status).toBe(400);expect(await Invoice.countDocuments()).toBe(1);expect((await Product.findById(ctx.product._id)).stock).toBe(17);
});
