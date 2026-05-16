import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { listPOs, getPO, createPO, receiveItems, recordSupplierPayment } from '../controllers/purchaseOrder.controller.js';

const r = Router();
r.use(protect);
r.get('/', listPOs);
r.get('/:id', getPO);
r.post('/', requireRole('admin', 'stock'), createPO);
r.post('/:id/receive', requireRole('admin', 'stock'), receiveItems);
r.post('/:id/payments', requireRole('admin'), recordSupplierPayment);
export default r;
