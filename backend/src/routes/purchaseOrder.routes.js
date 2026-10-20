import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { reserveDealForRecordCreation } from '../utils/dealLink.js';
import { purchaseOrderPDF, purchaseOrderReceiptPDF } from '../controllers/document.controller.js';
import { listPOs, getPO, createPO, updatePO, receiveItems, recordSupplierPayment, reverseSupplierPayment } from '../controllers/purchaseOrder.controller.js';
import { purchaseSummary } from '../controllers/purchaseSummary.controller.js';

const r = Router();
r.use(protect);
r.get('/summary', requireRole('admin', 'stock'), purchaseSummary);
r.get('/', listPOs);
r.get('/:id', getPO);
// Mirrors GET /:id. The payment receipt follows the payment permission instead:
// only admin records or reverses supplier payments, so only admin prints them.
r.get('/:id/pdf', purchaseOrderPDF);
r.get('/:id/payments/:paymentIndex/receipt', requireRole('admin'), purchaseOrderReceiptPDF);
r.post('/', requireRole('admin', 'stock'), reserveDealForRecordCreation, createPO);
r.patch('/:id', requireRole('admin', 'stock'), updatePO);
r.post('/:id/receive', requireRole('admin', 'stock'), receiveItems);
r.post('/:id/payments', requireRole('admin'), recordSupplierPayment);
r.post('/:id/payments/:paymentId/reverse', requireRole('admin'), reverseSupplierPayment);
export default r;
