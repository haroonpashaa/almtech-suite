import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import { listQuotations, getQuotation, createQuotation, convertToInvoice } from '../controllers/quotation.controller.js';

const r = Router();
r.use(protect);
r.get('/', listQuotations);
r.get('/:id', getQuotation);
r.post('/', requireRole('admin', 'sales'), createQuotation);
r.post('/:id/convert', requireRole('admin', 'sales'), convertToInvoice);
export default r;
