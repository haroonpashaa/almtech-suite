import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { listQuotations, getQuotation, createQuotation, convertToInvoice } from '../controllers/quotation.controller.js';
import { quotationPDF } from '../controllers/document.controller.js';

const r = Router();
r.use(protect);
r.get('/', listQuotations);
r.get('/:id', getQuotation);
// The document mirrors GET /:id exactly — a PDF must never widen access.
r.get('/:id/pdf', quotationPDF);
r.post('/', requireRole('admin', 'sales'), createQuotation);
r.post('/:id/convert', requireRole('admin', 'sales'), convertToInvoice);
export default r;
