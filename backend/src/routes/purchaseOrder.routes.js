import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { listPOs, getPO, createPO, receiveItems, recordSupplierPayment, reverseSupplierPayment } from '../controllers/purchaseOrder.controller.js';

const r = Router();
r.use(protect);
r.get('/', listPOs);
r.get('/:id', getPO);
r.post('/', requireRole('admin', 'stock'), createPO);
r.post('/:id/receive', requireRole('admin', 'stock'), receiveItems);
r.post('/:id/payments', requireRole('admin'), recordSupplierPayment);
r.post('/:id/payments/:paymentId/reverse', requireRole('admin'), reverseSupplierPayment);
export default r;
