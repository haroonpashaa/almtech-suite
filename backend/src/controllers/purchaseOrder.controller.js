import asyncHandler from 'express-async-handler';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Product from '../models/Product.js';
import Supplier from '../models/Supplier.js';
import StockMovement from '../models/StockMovement.js';
import { nextNumber } from '../utils/numbering.js';
import { logActivity } from '../utils/activity.js';

export const listPOs = asyncHandler(async (req, res) => {
  const { supplier, status } = req.query;
  const filter = {};
  if (supplier) filter.supplier = supplier;
  if (status) filter.status = status;
  const items = await PurchaseOrder.find(filter).populate('supplier', 'name').sort('-orderedAt').limit(500);
  res.json(items);
});

export const getPO = asyncHandler(async (req, res) => {
  const po = await PurchaseOrder.findById(req.params.id).populate('supplier').populate('createdBy', 'name');
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  res.json(po);
});

export const createPO = asyncHandler(async (req, res) => {
  const { supplier: supplierId, items, taxRate = 0, expectedAt, notes } = req.body;
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const product = await Product.findById(it.product);
    if (!product) {
      res.status(400);
      throw new Error(`Product not found: ${it.product}`);
    }
    const lineTotal = it.quantity * it.unitCost;
    lines.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      quantity: it.quantity,
      received: 0,
      unitCost: it.unitCost,
      serials: it.serials || [],
      lineTotal,
    });
    subtotal += lineTotal;
  }
  const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  const number = await nextNumber('po');
  const po = await PurchaseOrder.create({
    number,
    supplier: supplier._id,
    items: lines,
    subtotal,
    taxRate,
    taxAmount,
    total,
    balance: total,
    expectedAt,
    notes,
    createdBy: req.user._id,
  });
  supplier.payable += total;
  await supplier.save();
  await logActivity(req, 'po_created', { entity: 'PurchaseOrder', entityId: po._id, meta: { number, total } });
  res.status(201).json(po);
});

export const receiveItems = asyncHandler(async (req, res) => {
  const { receipts } = req.body;
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  for (const r of receipts) {
    const line = po.items.find((l) => l.product.toString() === r.product);
    if (!line) continue;
    const incoming = Math.max(0, Math.min(r.quantity, line.quantity - line.received));
    if (!incoming) continue;
    line.received += incoming;
    const product = await Product.findById(line.product);
    if (product) {
      product.stock += incoming;
      product.purchasePrice = line.unitCost;
      if (product.tracksSerials && r.serials?.length) {
        for (const s of r.serials) {
          if (!product.serials.find((x) => x.serial === s)) {
            product.serials.push({ serial: s, status: 'in_stock' });
          }
        }
      }
      await product.save();
      await StockMovement.create({
        product: product._id,
        type: 'purchase',
        quantity: incoming,
        balanceAfter: product.stock,
        refType: 'PurchaseOrder',
        refId: po._id,
        refNumber: po.number,
        createdBy: req.user._id,
      });
    }
  }
  const allReceived = po.items.every((l) => l.received >= l.quantity);
  const anyReceived = po.items.some((l) => l.received > 0);
  po.status = allReceived ? 'received' : anyReceived ? 'partial' : po.status;
  await po.save();
  await logActivity(req, 'po_received', { entity: 'PurchaseOrder', entityId: po._id });
  res.json(po);
});

export const recordSupplierPayment = asyncHandler(async (req, res) => {
  const { amount, method = 'bank', reference } = req.body;
  if (!(amount > 0)) {
    res.status(400);
    throw new Error('Amount must be > 0');
  }
  const po = await PurchaseOrder.findById(req.params.id);
  if (!po) {
    res.status(404);
    throw new Error('Purchase order not found');
  }
  const cappedAmount = Math.min(amount, po.balance);
  po.payments.push({ amount: cappedAmount, method, reference, recordedBy: req.user._id });
  po.paid += cappedAmount;
  po.balance = Math.max(0, po.total - po.paid);
  await po.save();
  const supplier = await Supplier.findById(po.supplier);
  if (supplier) {
    supplier.payable = Math.max(0, supplier.payable - cappedAmount);
    await supplier.save();
  }
  await logActivity(req, 'supplier_payment', { entity: 'PurchaseOrder', entityId: po._id, meta: { amount: cappedAmount } });
  res.json(po);
});
