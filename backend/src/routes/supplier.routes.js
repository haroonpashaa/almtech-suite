import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  supplierLedger,
} from '../controllers/supplier.controller.js';

const r = Router();
r.use(protect);
r.get('/', listSuppliers);
r.get('/:id', getSupplier);
r.get('/:id/ledger', requireRole('admin'), supplierLedger);
r.post('/', requireRole('admin', 'stock'), createSupplier);
r.patch('/:id', requireRole('admin', 'stock'), updateSupplier);
export default r;
