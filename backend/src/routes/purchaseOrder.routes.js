import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { purchaseOrderPDF, purchaseOrderReceiptPDF } from '../controllers/document.controller.js';
import { listPOs, getPO, createPO, updatePO, receiveItems, recordSupplierPayment, reverseSupplierPayment } from '../controllers/purchaseOrder.controller.js';

const r = Router();
r.use(protect);
r.get('/', listPOs);
r.get('/:id', getPO);
// Mirrors GET /:id. The payment receipt follows the payment permission instead:
// only admin records or reverses supplier payments, so only admin prints them.
r.get('/:id/pdf', purchaseOrderPDF);
r.get('/:id/payments/:paymentIndex/receipt', requireRole('admin'), purchaseOrderReceiptPDF);
r.post('/', requireRole('admin', 'stock'), createPO);
r.patch('/:id', requireRole('admin', 'stock'), updatePO);
r.post('/:id/receive', requireRole('admin', 'stock'), receiveItems);
r.post('/:id/payments', requireRole('admin'), recordSupplierPayment);
r.post('/:id/payments/:paymentId/reverse', requireRole('admin'), reverseSupplierPayment);
export default r;
