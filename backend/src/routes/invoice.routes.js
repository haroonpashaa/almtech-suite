import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { invoiceReceiptPDF } from '../controllers/document.controller.js';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  recordPayment,
  reverseInvoicePayment,
  updateInvoice,
  returnInvoice,
  invoicePDF,
} from '../controllers/invoice.controller.js';

const r = Router();
r.use(protect);
r.get('/', listInvoices);
r.get('/:id', getInvoice);
r.get('/:id/pdf', invoicePDF);
// A receipt evidences a payment, so it follows who may record one: admin and sales.
r.get('/:id/payments/:paymentIndex/receipt', requireRole('admin', 'sales'), invoiceReceiptPDF);
r.post('/', requireRole('admin', 'sales'), createInvoice);
r.post('/:id/payments', requireRole('admin', 'sales'), recordPayment);
// Reversing a payment is a correction to the accounting record, so it is admin-only
// even though sales may record payments.
r.post('/:id/payments/:paymentId/reverse', requireRole('admin'), reverseInvoicePayment);
// Metadata-only correction (notes) — admin-only, same policy as every other
// correction path on this router.
r.patch('/:id', requireRole('admin'), updateInvoice);
r.post('/:id/return', requireRole('admin'), returnInvoice);
export default r;
