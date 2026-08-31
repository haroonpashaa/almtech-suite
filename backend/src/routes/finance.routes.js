import { Router } from 'express';
import { protect, requireRole } from '../middleware/auth.js';
import {
  receivables,
  customerReceivable,
  payables,
  supplierPayable,
  position,
} from '../controllers/finance.controller.js';

// Payable totals and the combined position are company financial position, so they
// stay on the same admin-only policy already applied to account balances, ledgers,
// expenses, profit-loss and monthly summary.
//
// Receivables is the one exception: it is fundamentally a customer-facing view (who
// owes ALM, and collecting against it), and Sales already creates invoices and
// records invoice payments against these same customers — those endpoints are
// untouched. Granting read access to the aggregate view here does not hand Sales
// anything about payables or overall financial position, which remain admin-only
// below.
const r = Router();
r.use(protect);

r.get('/position', requireRole('admin'), position);
r.get('/receivables', requireRole('admin', 'sales'), receivables);
r.get('/receivables/:id', requireRole('admin', 'sales'), customerReceivable);
r.get('/payables', requireRole('admin'), payables);
r.get('/payables/:id', requireRole('admin'), supplierPayable);
export default r;
