import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import {
  listInvoices,
  getInvoice,
  createInvoice,
  recordPayment,
  reverseInvoicePayment,
  returnInvoice,
  invoicePDF,
} from '../controllers/invoice.controller.js';

const r = Router();
r.use(protect);
r.get('/', listInvoices);
r.get('/:id', getInvoice);
r.get('/:id/pdf', invoicePDF);
r.post('/', requireRole('admin', 'sales'), createInvoice);
r.post('/:id/payments', requireRole('admin', 'sales'), recordPayment);
// Reversing a payment is a correction to the accounting record, so it is admin-only
// even though sales may record payments.
r.post('/:id/payments/:paymentId/reverse', requireRole('admin'), reverseInvoicePayment);
r.post('/:id/return', requireRole('admin'), returnInvoice);
export default r;
