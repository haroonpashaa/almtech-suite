import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import {
  receivables,
  customerReceivable,
  payables,
  supplierPayable,
  position,
} from '../controllers/finance.controller.js';

// Receivable/payable totals are company financial position, so this module follows
// the same admin-only policy already applied to account balances, ledgers, expenses,
// profit-loss and monthly summary. Sales keeps its existing ability to create invoices
// and record invoice payments — those endpoints are untouched.
const r = Router();
r.use(protect);
r.use(requireRole('admin'));

r.get('/position', position);
r.get('/receivables', receivables);
r.get('/receivables/:id', customerReceivable);
r.get('/payables', payables);
r.get('/payables/:id', supplierPayable);
export default r;
