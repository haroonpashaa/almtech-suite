import asyncHandler from 'express-async-handler';
import Supplier from '../models/Supplier.js';

// The standalone Supplier module was removed. This lookup is retained because
// Purchase Orders still reference suppliers (PurchaseOrder.supplier is a required
// ref) and PurchaseOrderForm needs the list to populate its supplier dropdown.
export const listSuppliers = asyncHandler(async (_req, res) => {
  const items = await Supplier.find().sort('-createdAt');
  res.json(items);
});
