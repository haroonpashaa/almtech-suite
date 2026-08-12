import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  customerLedger,
} from '../controllers/customer.controller.js';
import { customerStatementPDF } from '../controllers/document.controller.js';

const r = Router();
r.use(protect);
r.get('/', listCustomers);
r.get('/:id', getCustomer);
r.get('/:id/ledger', requireRole('admin', 'sales'), customerLedger);
// The printed statement is the ledger, so it carries the ledger's permission.
r.get('/:id/statement/pdf', requireRole('admin', 'sales'), customerStatementPDF);
r.post('/', requireRole('admin', 'sales'), createCustomer);
r.patch('/:id', requireRole('admin', 'sales'), updateCustomer);
export default r;
