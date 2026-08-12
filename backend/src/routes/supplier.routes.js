import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  supplierLedger,
} from '../controllers/supplier.controller.js';
import { supplierStatementPDF } from '../controllers/document.controller.js';

// Supplier management belongs to the people who buy stock: admin and stock can list,
// view and maintain suppliers. Sales has no purchasing role — it cannot create a
// purchase order either — so it gets no supplier access at all.
//
// The ledger is a financial statement, so it follows the same admin-only rule as
// account ledgers, payables and profit-loss.
const r = Router();
r.use(protect);

r.get('/', requireRole('admin', 'stock'), listSuppliers);
r.get('/:id', requireRole('admin', 'stock'), getSupplier);
r.get('/:id/ledger', requireRole('admin'), supplierLedger);
// The printed statement is the ledger, so it stays admin-only like the ledger.
r.get('/:id/statement/pdf', requireRole('admin'), supplierStatementPDF);
r.post('/', requireRole('admin', 'stock'), createSupplier);
r.patch('/:id', requireRole('admin', 'stock'), updateSupplier);
export default r;
